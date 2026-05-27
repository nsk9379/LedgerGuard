const pool = require('../config/database');

class LedgerEntryModel {
  /**
   * Create a single immutable ledger entry.
   * No update or delete methods are exposed intentionally.
   */
  static async create(
    { accountId, transactionId, entryType, amount, runningDescription = '' },
    client = pool
  ) {
    const result = await client.query(
      `INSERT INTO ledger_entries
         (account_id, transaction_id, entry_type, amount, running_description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [accountId, transactionId, entryType, amount, runningDescription]
    );
    return result.rows[0];
  }

  /**
   * Get all ledger entries for an account, chronologically
   */
  static async findByAccountId(accountId, client = pool) {
    const result = await client.query(
      `SELECT
         le.id,
         le.account_id,
         le.transaction_id,
         le.entry_type,
         le.amount,
         le.running_description,
         le.created_at,
         t.type AS transaction_type,
         t.description AS transaction_description
       FROM ledger_entries le
       JOIN transactions t ON le.transaction_id = t.id
       WHERE le.account_id = $1
       ORDER BY le.created_at ASC`,
      [accountId]
    );
    return result.rows;
  }
}

module.exports = LedgerEntryModel;
