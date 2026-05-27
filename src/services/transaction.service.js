const pool = require('../config/database');
const AccountModel = require('../models/account.model');
const TransactionModel = require('../models/transaction.model');
const LedgerEntryModel = require('../models/ledger-entry.model');

class TransactionService {
  /**
   * Execute a transfer between two accounts.
   * Uses a single ACID transaction with REPEATABLE READ isolation.
   * Creates exactly two ledger entries: one debit, one credit.
   * Prevents negative balances via locked balance check before commit.
   */
  static async transfer({ sourceAccountId, destinationAccountId, amount, currency, description }) {
    const client = await pool.connect();
    try {
      // Use REPEATABLE READ to prevent dirty reads and non-repeatable reads
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

      // Lock both accounts to prevent race conditions
      const sourceAccount = await client.query(
        `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
        [sourceAccountId]
      );
      const destAccount = await client.query(
        `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
        [destinationAccountId]
      );

      if (sourceAccount.rows.length === 0) {
        throw { statusCode: 404, message: `Source account not found: ${sourceAccountId}` };
      }
      if (destAccount.rows.length === 0) {
        throw { statusCode: 404, message: `Destination account not found: ${destinationAccountId}` };
      }
      if (sourceAccount.rows[0].status !== 'active') {
        throw { statusCode: 422, message: 'Source account is not active.' };
      }
      if (destAccount.rows[0].status !== 'active') {
        throw { statusCode: 422, message: 'Destination account is not active.' };
      }
      if (sourceAccountId === destinationAccountId) {
        throw { statusCode: 400, message: 'Source and destination accounts must be different.' };
      }

      // Calculate current balance of source account
      const sourceBalance = await AccountModel.calculateBalance(sourceAccountId, client);
      if (sourceBalance < amount) {
        throw {
          statusCode: 422,
          message: `Insufficient funds. Available balance: ${sourceBalance}, required: ${amount}`,
        };
      }

      // Create the transaction record (pending)
      const transaction = await TransactionModel.create(
        {
          type: 'transfer',
          sourceAccountId,
          destinationAccountId,
          amount,
          currency,
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

      // Verify double-entry balance: debit amount + (-credit amount) = 0
      if (debitEntry.amount !== creditEntry.amount) {
        throw { statusCode: 500, message: 'Double-entry integrity check failed.' };
      }

      // Mark transaction as completed
      const completedTxn = await TransactionModel.updateStatus(transaction.id, 'completed', client);

      await client.query('COMMIT');

      return {
        transaction: completedTxn,
        debitEntry,
        creditEntry,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      // Mark transaction as failed if it was created
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Simulate a deposit into an account.
   * Creates a single credit ledger entry.
   */
  static async deposit({ destinationAccountId, amount, currency, description }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

      const destAccount = await client.query(
        `SELECT id, status FROM accounts WHERE id = $1 FOR UPDATE`,
        [destinationAccountId]
      );

      if (destAccount.rows.length === 0) {
        throw { statusCode: 404, message: `Account not found: ${destinationAccountId}` };
      }
      if (destAccount.rows[0].status !== 'active') {
        throw { statusCode: 422, message: 'Account is not active.' };
      }

      const transaction = await TransactionModel.create(
        {
          type: 'deposit',
          destinationAccountId,
          amount,
          currency,
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
   * Simulate a withdrawal from an account.
   * Creates a single debit ledger entry.
   * Prevents negative balance.
   */
  static async withdrawal({ sourceAccountId, amount, currency, description }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

      const srcAccount = await client.query(
        `SELECT id, status FROM accounts WHERE id = $1 FOR UPDATE`,
        [sourceAccountId]
      );

      if (srcAccount.rows.length === 0) {
        throw { statusCode: 404, message: `Account not found: ${sourceAccountId}` };
      }
      if (srcAccount.rows[0].status !== 'active') {
        throw { statusCode: 422, message: 'Account is not active.' };
      }

      const currentBalance = await AccountModel.calculateBalance(sourceAccountId, client);
      if (currentBalance < amount) {
        throw {
          statusCode: 422,
          message: `Insufficient funds. Available balance: ${currentBalance}, requested: ${amount}`,
        };
      }

      const transaction = await TransactionModel.create(
        {
          type: 'withdrawal',
          sourceAccountId,
          amount,
          currency,
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
