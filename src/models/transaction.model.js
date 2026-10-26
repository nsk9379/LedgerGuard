const pool = require('../config/database');

class TransactionModel {
  /**
   * Create a pending transaction record
   */
  static async create(
    { type, sourceAccountId, destinationAccountId, amount, currency = 'INR', description = '' },
    client = pool
  ) {
    const result = await client.query(
      `INSERT INTO transactions
         (type, source_account_id, destination_account_id, amount, currency, status, description)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [type, sourceAccountId || null, destinationAccountId || null, amount, currency, description]
    );
    return result.rows[0];
  }

  /**
   * Update transaction status
   */
  static async updateStatus(transactionId, status, client = pool) {
    const result = await client.query(
      `UPDATE transactions SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, transactionId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find transaction by ID
   */
  static async findById(transactionId, client = pool) {
    const result = await client.query(
      `SELECT * FROM transactions WHERE id = $1`,
      [transactionId]
    );
    return result.rows[0] || null;
  }

  /**
   * List recent transactions, newest first.
   * @param {number} [limit] - Max rows (default 50)
   * @param {number} [offset] - Pagination offset
   */
  static async findRecent({ limit = 50, offset = 0 } = {}, client = pool) {
    const result = await client.query(
      `SELECT
         t.id,
         t.type,
         t.status,
         t.amount::text AS amount,
         t.currency,
         t.description,
         t.created_at,
         t.source_account_id,
         t.destination_account_id,
         src.description AS source_description,
         dst.description AS destination_description
       FROM transactions t
       LEFT JOIN accounts src ON t.source_account_id = src.id
       LEFT JOIN accounts dst ON t.destination_account_id = dst.id
       ORDER BY t.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }
}

module.exports = TransactionModel;
