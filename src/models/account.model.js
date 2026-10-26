const pool = require('../config/database');

class AccountModel {
  /**
   * Create a new account
   */
  static async create({ userId, accountType, currency = 'INR', description = '' }, client = pool) {
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
   * List all accounts with ledger-derived balances.
   * Balances are computed by PostgreSQL (NUMERIC(20,4)) — no JS float arithmetic.
   * @param {number} [limit] - Max rows to return
   * @param {number} [offset] - Pagination offset
   */
  static async findAll({ limit = 100, offset = 0 } = {}, client = pool) {
    const result = await client.query(
      `SELECT
         a.id,
         a.user_id,
         a.account_type,
         a.currency,
         a.status,
         a.description,
         a.created_at,
         a.updated_at,
         COALESCE(
           SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE -le.amount END),
           0
         )::NUMERIC(20,4) AS balance
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.account_id = a.id
       GROUP BY a.id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
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
         )::NUMERIC(20,4) AS balance
       FROM ledger_entries
       WHERE account_id = $1`,
      [accountId]
    );
    return parseFloat(result.rows[0].balance);
  }

  /**
   * Check if account has sufficient funds using exact PostgreSQL NUMERIC arithmetic.
   * Avoids JavaScript floating-point inaccuracies.
   */
  static async checkSufficientFunds(accountId, requiredAmount, client = pool) {
    const result = await client.query(
      `SELECT
         COALESCE(
           SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END),
           0
         )::NUMERIC(20,4) AS current_balance,
         (
           COALESCE(
             SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END),
             0
           ) >= $2::NUMERIC(20,4)
         ) AS has_sufficient_funds
       FROM ledger_entries
       WHERE account_id = $1`,
      [accountId, requiredAmount]
    );
    return {
      currentBalance: result.rows[0].current_balance,
      hasSufficientFunds: result.rows[0].has_sufficient_funds,
    };
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
