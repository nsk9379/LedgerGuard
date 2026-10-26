const pool = require('../config/database');
const AccountModel = require('../models/account.model');
const TransactionModel = require('../models/transaction.model');
const LedgerEntryModel = require('../models/ledger-entry.model');

class TransactionService {
  /**
   * Execute a transfer using a pre-opened DB client that is already inside
   * a transaction (BEGIN has been called by the caller).
   * The caller is responsible for COMMIT / ROLLBACK and client.release().
   *
   * This variant is used by the idempotency-aware controller so the key
   * reservation INSERT and all transfer writes share one atomic transaction.
   */
  static async transferWithClient({ sourceAccountId, destinationAccountId, amount, currency, description, client }) {
    return TransactionService._runTransfer({
      sourceAccountId, destinationAccountId, amount, currency, description, client,
    });
  }

  /**
   * Execute a transfer between two accounts.
   * Uses a single ACID transaction with REPEATABLE READ isolation.
   * Creates exactly two balanced ledger entries: one debit, one credit.
   * Prevents negative balances via DB-level NUMERIC balance check.
   *
   * DEADLOCK PREVENTION: Accounts are always locked in ascending UUID order
   * so concurrent opposite-direction transfers cannot create circular waits.
   *
   * CURRENCY VALIDATION: Transaction currency must match both account currencies.
   */
  static async transfer({ sourceAccountId, destinationAccountId, amount, currency, description }) {
    // Reject self-transfer before opening any DB resources
    if (sourceAccountId === destinationAccountId) {
      throw { statusCode: 400, message: 'Source and destination accounts must be different.' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const result = await TransactionService._runTransfer({
        sourceAccountId, destinationAccountId, amount, currency, description, client,
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Core transfer logic shared by transfer() and transferWithClient().
   * Requires an open client already inside a BEGIN transaction.
   */
  static async _runTransfer({ sourceAccountId, destinationAccountId, amount, currency, description, client }) {
    // Reject self-transfer (also checked in transfer(); kept here for transferWithClient() callers)
    if (sourceAccountId === destinationAccountId) {
      throw { statusCode: 400, message: 'Source and destination accounts must be different.' };
    }

    // Always acquire locks in deterministic ascending UUID order so two
    // simultaneous cross-direction transfers cannot deadlock on circular waits.
    const [firstId, secondId] = [sourceAccountId, destinationAccountId].sort();

      const firstLock = await client.query(
        `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
        [firstId]
      );
      const secondLock = await client.query(
        `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
        [secondId]
      );

      // Map back to named variables for clarity
      const allLocked = [firstLock, secondLock];
      const sourceRow = allLocked.find((r) => r.rows[0] && r.rows[0].id === sourceAccountId);
      const destRow = allLocked.find((r) => r.rows[0] && r.rows[0].id === destinationAccountId);

      if (!sourceRow || sourceRow.rows.length === 0) {
        throw { statusCode: 404, message: `Source account not found: ${sourceAccountId}` };
      }
      if (!destRow || destRow.rows.length === 0) {
        throw { statusCode: 404, message: `Destination account not found: ${destinationAccountId}` };
      }

      const src = sourceRow.rows[0];
      const dest = destRow.rows[0];

      if (src.status !== 'active') {
        throw { statusCode: 422, message: 'Source account is not active.' };
      }
      if (dest.status !== 'active') {
        throw { statusCode: 422, message: 'Destination account is not active.' };
      }

      // --- CURRENCY VALIDATION ---
      // Transaction currency must match source account currency
      if (currency && src.currency !== currency) {
        throw {
          statusCode: 422,
          message: `Currency mismatch: source account currency is ${src.currency}, transaction currency is ${currency}.`,
        };
      }
      // Source and destination must share the same currency
      if (src.currency !== dest.currency) {
        throw {
          statusCode: 422,
          message: `Cross-currency transfers are not supported: source is ${src.currency}, destination is ${dest.currency}.`,
        };
      }
      // Resolved currency: use account currency (canonical)
      const resolvedCurrency = src.currency;

      // --- BALANCE CHECK (DB-level NUMERIC comparison, avoids JS float rounding) ---
      const { currentBalance, hasSufficientFunds } = await AccountModel.checkSufficientFunds(
        sourceAccountId,
        amount,
        client
      );
      if (!hasSufficientFunds) {
        throw {
          statusCode: 422,
          message: `Insufficient funds. Available balance: ${currentBalance} ${resolvedCurrency}, required: ${amount} ${resolvedCurrency}`,
        };
      }

      // Create the transaction record (pending)
      const transaction = await TransactionModel.create(
        {
          type: 'transfer',
          sourceAccountId,
          destinationAccountId,
          amount,
          currency: resolvedCurrency,
          description,
        },
        client
      );

      // Create DEBIT entry for source account
      const debitEntry = await LedgerEntryModel.create(
        {
          accountId: sourceAccountId,
          transactionId: transaction.id,
          entryType: 'debit',
          amount,
          runningDescription: `Transfer out to ${destinationAccountId}: ${description || ''}`,
        },
        client
      );

      // Create CREDIT entry for destination account
      const creditEntry = await LedgerEntryModel.create(
        {
          accountId: destinationAccountId,
          transactionId: transaction.id,
          entryType: 'credit',
          amount,
          runningDescription: `Transfer in from ${sourceAccountId}: ${description || ''}`,
        },
        client
      );

    // Verify double-entry balance integrity using DB NUMERIC string comparison
    // (debitEntry.amount and creditEntry.amount come back as NUMERIC strings from pg)
    if (debitEntry.amount !== creditEntry.amount) {
      throw { statusCode: 500, message: 'Double-entry integrity check failed.' };
    }

    // Mark transaction as completed
    const completedTxn = await TransactionModel.updateStatus(transaction.id, 'completed', client);

    return {
      transaction: completedTxn,
      debitEntry,
      creditEntry,
    };
  }

  /**
   * Deposit into an account.
   * Creates a single credit ledger entry.
   * CURRENCY VALIDATION: Transaction currency must match account currency.
   */
  static async deposit({ destinationAccountId, amount, currency, description }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

      const destAccount = await client.query(
        `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
        [destinationAccountId]
      );

      if (destAccount.rows.length === 0) {
        throw { statusCode: 404, message: `Account not found: ${destinationAccountId}` };
      }
      if (destAccount.rows[0].status !== 'active') {
        throw { statusCode: 422, message: 'Account is not active.' };
      }

      const accountCurrency = destAccount.rows[0].currency;

      // Currency must match account currency
      if (currency && accountCurrency !== currency) {
        throw {
          statusCode: 422,
          message: `Currency mismatch: account currency is ${accountCurrency}, transaction currency is ${currency}.`,
        };
      }
      const resolvedCurrency = accountCurrency;

      const transaction = await TransactionModel.create(
        {
          type: 'deposit',
          destinationAccountId,
          amount,
          currency: resolvedCurrency,
          description,
        },
        client
      );

      const creditEntry = await LedgerEntryModel.create(
        {
          accountId: destinationAccountId,
          transactionId: transaction.id,
          entryType: 'credit',
          amount,
          runningDescription: `Deposit: ${description || ''}`,
        },
        client
      );

      const completedTxn = await TransactionModel.updateStatus(transaction.id, 'completed', client);

      await client.query('COMMIT');
      return { transaction: completedTxn, creditEntry };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Withdrawal from an account.
   * Creates a single debit ledger entry.
   * Prevents negative balance via DB-level NUMERIC comparison.
   * CURRENCY VALIDATION: Transaction currency must match account currency.
   */
  static async withdrawal({ sourceAccountId, amount, currency, description }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

      const srcAccount = await client.query(
        `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
        [sourceAccountId]
      );

      if (srcAccount.rows.length === 0) {
        throw { statusCode: 404, message: `Account not found: ${sourceAccountId}` };
      }
      if (srcAccount.rows[0].status !== 'active') {
        throw { statusCode: 422, message: 'Account is not active.' };
      }

      const accountCurrency = srcAccount.rows[0].currency;

      // Currency must match account currency
      if (currency && accountCurrency !== currency) {
        throw {
          statusCode: 422,
          message: `Currency mismatch: account currency is ${accountCurrency}, transaction currency is ${currency}.`,
        };
      }
      const resolvedCurrency = accountCurrency;

      // --- BALANCE CHECK (DB-level NUMERIC comparison) ---
      const { currentBalance, hasSufficientFunds } = await AccountModel.checkSufficientFunds(
        sourceAccountId,
        amount,
        client
      );
      if (!hasSufficientFunds) {
        throw {
          statusCode: 422,
          message: `Insufficient funds. Available balance: ${currentBalance} ${resolvedCurrency}, requested: ${amount} ${resolvedCurrency}`,
        };
      }

      const transaction = await TransactionModel.create(
        {
          type: 'withdrawal',
          sourceAccountId,
          amount,
          currency: resolvedCurrency,
          description,
        },
        client
      );

      const debitEntry = await LedgerEntryModel.create(
        {
          accountId: sourceAccountId,
          transactionId: transaction.id,
          entryType: 'debit',
          amount,
          runningDescription: `Withdrawal: ${description || ''}`,
        },
        client
      );

      const completedTxn = await TransactionModel.updateStatus(transaction.id, 'completed', client);

      await client.query('COMMIT');
      return { transaction: completedTxn, debitEntry };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = TransactionService;
