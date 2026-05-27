const pool = require('../config/database');

class AccountModel {
  /**
   * Create a new account
   */
  static async create({ userId, accountType, currency = 'USD', description = '' }, client = pool) {
    const result = await client.query(
      `INSERT INTO accounts (user_id, account_type, currency, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, account_type, currency, status, description, created_at, updated_at`,
      [userId, accountType, currency, description]
    );
    return result.rows[0];
  }

  /**
   * Find account by ID
   */
  static async findById(accountId, client = pool) {
    const result = await client.query(
      `SELECT id, user_id, account_type, currency, status, description, created_at, updated_at
       FROM accounts WHERE id = $1`,
      [accountId]
    );
    return result.rows[0] || null;
  }

  /**
   * Calculate the current balance of an account by summing ledger entries.
   * Credits increase balance, debits decrease it.
   */
  static async calculateBalance(accountId, client = pool) {
    const result = await client.query(
      `SELECT
         COALESCE(
           SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END),
           0
         ) AS balance
       FROM ledger_entries
       WHERE account_id = $1`,
      [accountId]
    );
    return parseFloat(result.rows[0].balance);
  }

  /**
   * Update account status
   */
  static async updateStatus(accountId, status, client = pool) {
    const result = await client.query(
      `UPDATE accounts SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, accountId]
    );
    return result.rows[0] || null;
  }
}

module.exports = AccountModel;
