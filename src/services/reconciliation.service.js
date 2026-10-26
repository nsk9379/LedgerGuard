'use strict';
const ReconciliationModel = require('../models/reconciliation.model');

/**
 * Normalizes a numeric string to 4 decimal places using pure string manipulation,
 * avoiding any JavaScript floating-point conversion.
 * e.g., '100' -> '100.0000', '250.5' -> '250.5000', '500.0000' -> '500.0000'
 */
function normalizeNumeric(val) {
  if (val == null) return '';
  const str = String(val).trim();
  const [integerPart, decimalPart = ''] = str.split('.');
  const paddedDecimal = (decimalPart + '0000').slice(0, 4);
  return `${integerPart}.${paddedDecimal}`;
}

function exactAmountEqual(a, b) {
  if (a === b) return true;
  return normalizeNumeric(a) === normalizeNumeric(b);
}

class ReconciliationService {
  /**
   * Run read-only reconciliation over transactions and their ledger postings.
   *
   * @param {Object} filter
   * @param {string} [filter.transactionId] - Optional transaction UUID to reconcile
   * @param {string} [filter.status] - Optional status filter
   * @param {number} [filter.limit] - Optional pagination limit
   * @param {number} [filter.offset] - Optional pagination offset
   * @returns {Promise<Object>} Structured reconciliation report
   */
  static async reconcile(filter = {}) {
    const transactions = await ReconciliationModel.getTransactionsWithLedgerEntries(filter);
    const orphanedCount = await ReconciliationModel.getOrphanedLedgerEntriesCount();

    const findings = [];
    let completedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    const transactionsWithIssues = new Set();

    for (const tx of transactions) {
      if (tx.status === 'completed') {
        completedCount++;
        const txFindings = ReconciliationService._reconcileCompletedTransaction(tx);
        if (txFindings.length > 0) {
          transactionsWithIssues.add(tx.transaction_id);
          findings.push(...txFindings);
        }
      } else if (tx.status === 'pending' || tx.status === 'failed') {
        if (tx.status === 'pending') pendingCount++;
        if (tx.status === 'failed') failedCount++;

        // Pending and failed transactions MUST NOT have any ledger entries posted
        if (tx.entries && tx.entries.length > 0) {
          transactionsWithIssues.add(tx.transaction_id);
          findings.push({
            transactionId: tx.transaction_id,
            transactionType: tx.type,
            status: tx.status,
            issueType: 'UNEXPECTED_ENTRIES_FOR_NON_COMPLETED_TRANSACTION',
            explanation:
              `Transaction ${tx.transaction_id} is in '${tx.status}' state ` +
              `but has ${tx.entries.length} posted ledger entries. Non-completed transactions ` +
              `must not contain ledger entries.`,
            details: {
              status: tx.status,
              entriesFound: tx.entries.length,
            },
          });
        }
      }
    }

    // Check for orphaned ledger entries
    if (orphanedCount > 0) {
      findings.push({
        transactionId: null,
        transactionType: null,
        status: null,
        issueType: 'ORPHANED_LEDGER_ENTRIES',
        explanation: `Detected ${orphanedCount} ledger entries referencing non-existent transaction IDs.`,
        details: { orphanedCount },
      });
    }

    const totalTransactions = transactions.length;
    const validTransactions = totalTransactions - transactionsWithIssues.size;
    const isBalanced = findings.length === 0;

    return {
      summary: {
        totalTransactionsChecked: totalTransactions,
        completedTransactionsChecked: completedCount,
        pendingTransactions: pendingCount,
        failedTransactions: failedCount,
        validTransactions,
        discrepantTransactionsCount: transactionsWithIssues.size,
        discrepancyCount: findings.length,
        orphanedLedgerEntriesCount: orphanedCount,
        reconciliationStatus: isBalanced ? 'BALANCED' : 'DISCREPANCIES_DETECTED',
        checkedAt: new Date().toISOString(),
      },
      findings,
    };
  }

  /**
   * Internal verification for a completed transaction.
   * Checks expected patterns:
   *  - transfer: 1 debit for source, 1 credit for destination, amounts == tx.amount
   *  - deposit: 1 credit for destination, amount == tx.amount
   *  - withdrawal: 1 debit for source, amount == tx.amount
   *  - schema currency consistency
   */
  static _reconcileCompletedTransaction(tx) {
    const findings = [];
    const entries = tx.entries || [];

    // 1. Currency consistency checks based on schema
    if (tx.source_account_currency && tx.source_account_currency !== tx.transaction_currency) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'CURRENCY_MISMATCH',
        explanation:
          `Source account currency (${tx.source_account_currency}) does not match ` +
          `transaction currency (${tx.transaction_currency}).`,
        details: {
          sourceAccountCurrency: tx.source_account_currency,
          transactionCurrency: tx.transaction_currency,
        },
      });
    }

    if (tx.destination_account_currency && tx.destination_account_currency !== tx.transaction_currency) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'CURRENCY_MISMATCH',
        explanation:
          `Destination account currency (${tx.destination_account_currency}) does not match ` +
          `transaction currency (${tx.transaction_currency}).`,
        details: {
          destinationAccountCurrency: tx.destination_account_currency,
          transactionCurrency: tx.transaction_currency,
        },
      });
    }

    // 2. Pattern verification by transaction type
    switch (tx.type) {
      case 'transfer':
        findings.push(...ReconciliationService._verifyTransfer(tx, entries));
        break;

      case 'deposit':
        findings.push(...ReconciliationService._verifyDeposit(tx, entries));
        break;

      case 'withdrawal':
        findings.push(...ReconciliationService._verifyWithdrawal(tx, entries));
        break;

      default:
        findings.push({
          transactionId: tx.transaction_id,
          transactionType: tx.type,
          status: tx.status,
          issueType: 'UNKNOWN_TRANSACTION_TYPE',
          explanation: `Transaction type '${tx.type}' is unrecognized.`,
          details: { type: tx.type },
        });
        break;
    }

    return findings;
  }

  /**
   * Transfer pattern verification:
   * Exactly 1 debit for source, exactly 1 credit for destination.
   * Both amounts must exactly match tx.amount.
   */
  static _verifyTransfer(tx, entries) {
    const findings = [];

    if (tx.source_account_currency && tx.destination_account_currency &&
        tx.source_account_currency !== tx.destination_account_currency) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'CURRENCY_MISMATCH',
        explanation:
          `Cross-currency transfer detected between source account (${tx.source_account_currency}) ` +
          `and destination account (${tx.destination_account_currency}).`,
        details: {
          sourceCurrency: tx.source_account_currency,
          destinationCurrency: tx.destination_account_currency,
        },
      });
    }

    if (entries.length === 0) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'MISSING_LEDGER_ENTRIES',
        explanation: 'Completed transfer expected exactly 2 ledger entries (1 debit, 1 credit), but found 0 entries.',
        details: { expectedEntries: 2, actualEntries: 0 },
      });
      return findings;
    }

    if (entries.length < 2) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'MISSING_LEDGER_ENTRIES',
        explanation: `Completed transfer expected exactly 2 ledger entries, but found ${entries.length}.`,
        details: { expectedEntries: 2, actualEntries: entries.length },
      });
      return findings;
    }

    if (entries.length > 2) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'EXTRA_LEDGER_ENTRIES',
        explanation: `Completed transfer expected exactly 2 ledger entries, but found ${entries.length} entries.`,
        details: { expectedEntries: 2, actualEntries: entries.length },
      });
      return findings;
    }

    // Exactly 2 entries
    const debits = entries.filter((e) => e.entry_type === 'debit');
    const credits = entries.filter((e) => e.entry_type === 'credit');

    if (debits.length !== 1 || credits.length !== 1) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_DIRECTION',
        explanation:
          `Completed transfer requires exactly 1 debit and 1 credit, but found ` +
          `${debits.length} debit(s) and ${credits.length} credit(s).`,
        details: { debitsFound: debits.length, creditsFound: credits.length },
      });
      return findings;
    }

    const debit = debits[0];
    const credit = credits[0];

    // Check account assignment
    if (debit.account_id !== tx.source_account_id) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_ACCOUNT',
        explanation:
          `Debit entry account ID (${debit.account_id}) does not match ` +
          `transaction source account ID (${tx.source_account_id}).`,
        details: {
          expectedAccountId: tx.source_account_id,
          actualAccountId: debit.account_id,
          entryType: 'debit',
        },
      });
    }

    if (credit.account_id !== tx.destination_account_id) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_ACCOUNT',
        explanation:
          `Credit entry account ID (${credit.account_id}) does not match ` +
          `transaction destination account ID (${tx.destination_account_id}).`,
        details: {
          expectedAccountId: tx.destination_account_id,
          actualAccountId: credit.account_id,
          entryType: 'credit',
        },
      });
    }

    // Check amounts with exact numeric string comparison
    if (!exactAmountEqual(debit.amount, tx.amount)) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'AMOUNT_MISMATCH',
        explanation:
          `Debit entry amount (${debit.amount}) does not equal transaction amount (${tx.amount}).`,
        details: {
          entryAmount: debit.amount,
          transactionAmount: tx.amount,
          entryType: 'debit',
        },
      });
    }

    if (!exactAmountEqual(credit.amount, tx.amount)) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'AMOUNT_MISMATCH',
        explanation:
          `Credit entry amount (${credit.amount}) does not equal transaction amount (${tx.amount}).`,
        details: {
          entryAmount: credit.amount,
          transactionAmount: tx.amount,
          entryType: 'credit',
        },
      });
    }

    if (!exactAmountEqual(debit.amount, credit.amount)) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'AMOUNT_MISMATCH',
        explanation:
          `Debit entry amount (${debit.amount}) does not balance with credit entry amount (${credit.amount}).`,
        details: {
          debitAmount: debit.amount,
          creditAmount: credit.amount,
        },
      });
    }

    return findings;
  }

  /**
   * Deposit pattern verification:
   * Exactly 1 credit entry for destination account, amount == tx.amount.
   */
  static _verifyDeposit(tx, entries) {
    const findings = [];

    if (entries.length === 0) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'MISSING_LEDGER_ENTRIES',
        explanation: 'Completed deposit expected exactly 1 credit ledger entry, but found 0 entries.',
        details: { expectedEntries: 1, actualEntries: 0 },
      });
      return findings;
    }

    if (entries.length > 1) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'EXTRA_LEDGER_ENTRIES',
        explanation: `Completed deposit expected exactly 1 credit ledger entry, but found ${entries.length} entries.`,
        details: { expectedEntries: 1, actualEntries: entries.length },
      });
      return findings;
    }

    const entry = entries[0];

    if (entry.entry_type !== 'credit') {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_DIRECTION',
        explanation: `Deposit entry must be 'credit', but found '${entry.entry_type}'.`,
        details: { expectedEntryType: 'credit', actualEntryType: entry.entry_type },
      });
    }

    if (entry.account_id !== tx.destination_account_id) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_ACCOUNT',
        explanation:
          `Deposit entry account ID (${entry.account_id}) does not match ` +
          `transaction destination account ID (${tx.destination_account_id}).`,
        details: {
          expectedAccountId: tx.destination_account_id,
          actualAccountId: entry.account_id,
        },
      });
    }

    if (!exactAmountEqual(entry.amount, tx.amount)) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'AMOUNT_MISMATCH',
        explanation:
          `Deposit entry amount (${entry.amount}) does not equal transaction amount (${tx.amount}).`,
        details: {
          entryAmount: entry.amount,
          transactionAmount: tx.amount,
        },
      });
    }

    return findings;
  }

  /**
   * Withdrawal pattern verification:
   * Exactly 1 debit entry for source account, amount == tx.amount.
   */
  static _verifyWithdrawal(tx, entries) {
    const findings = [];

    if (entries.length === 0) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'MISSING_LEDGER_ENTRIES',
        explanation: 'Completed withdrawal expected exactly 1 debit ledger entry, but found 0 entries.',
        details: { expectedEntries: 1, actualEntries: 0 },
      });
      return findings;
    }

    if (entries.length > 1) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'EXTRA_LEDGER_ENTRIES',
        explanation: `Completed withdrawal expected exactly 1 debit ledger entry, but found ${entries.length} entries.`,
        details: { expectedEntries: 1, actualEntries: entries.length },
      });
      return findings;
    }

    const entry = entries[0];

    if (entry.entry_type !== 'debit') {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_DIRECTION',
        explanation: `Withdrawal entry must be 'debit', but found '${entry.entry_type}'.`,
        details: { expectedEntryType: 'debit', actualEntryType: entry.entry_type },
      });
    }

    if (entry.account_id !== tx.source_account_id) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'WRONG_ACCOUNT',
        explanation:
          `Withdrawal entry account ID (${entry.account_id}) does not match ` +
          `transaction source account ID (${tx.source_account_id}).`,
        details: {
          expectedAccountId: tx.source_account_id,
          actualAccountId: entry.account_id,
        },
      });
    }

    if (!exactAmountEqual(entry.amount, tx.amount)) {
      findings.push({
        transactionId: tx.transaction_id,
        transactionType: tx.type,
        status: tx.status,
        issueType: 'AMOUNT_MISMATCH',
        explanation:
          `Withdrawal entry amount (${entry.amount}) does not equal transaction amount (${tx.amount}).`,
        details: {
          entryAmount: entry.amount,
          transactionAmount: tx.amount,
        },
      });
    }

    return findings;
  }
}

module.exports = ReconciliationService;
