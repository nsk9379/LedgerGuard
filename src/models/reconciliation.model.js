'use strict';
const pool = require('../config/database');

class ReconciliationModel {
  /**
   * Fetch transactions joined with their source/destination accounts and
   * aggregated ledger entries in a single efficient query.
   *
   * @param {Object} options
   * @param {string} [options.transactionId] - Optional transaction UUID to reconcile
   * @param {string} [options.status] - Optional status filter ('completed', 'pending', 'failed')
   * @param {number} [options.limit] - Optional result limit
   * @param {number} [options.offset] - Optional result offset
   */
  static async getTransactionsWithLedgerEntries({ transactionId, status, limit, offset } = {}) {
    const conditions = [];
    const params = [];

    if (transactionId) {
      params.push(transactionId);
      conditions.push(`t.id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let paginationClause = '';
    if (limit) {
      params.push(parseInt(limit, 10));
      paginationClause += ` LIMIT $${params.length}`;
    }
    if (offset) {
      params.push(parseInt(offset, 10));
      paginationClause += ` OFFSET $${params.length}`;
    }

    const query = `
      SELECT
        t.id AS transaction_id,
        t.type,
        t.status,
        t.amount::text AS amount,
        t.currency AS transaction_currency,
        t.source_account_id,
        t.destination_account_id,
        src.currency AS source_account_currency,
        dst.currency AS destination_account_currency,
        src.status AS source_account_status,
        dst.status AS destination_account_status,
        t.created_at,
        t.description,
        COALESCE(
          json_agg(
            json_build_object(
              'id', le.id,
              'account_id', le.account_id,
              'entry_type', le.entry_type,
              'amount', le.amount::text,
              'created_at', le.created_at
            ) ORDER BY le.created_at ASC
          ) FILTER (WHERE le.id IS NOT NULL),
          '[]'::json
        ) AS entries
      FROM transactions t
      LEFT JOIN accounts src ON t.source_account_id = src.id
      LEFT JOIN accounts dst ON t.destination_account_id = dst.id
      LEFT JOIN ledger_entries le ON t.id = le.transaction_id
      ${whereClause}
      GROUP BY t.id, src.currency, dst.currency, src.status, dst.status
      ORDER BY t.created_at ASC
      ${paginationClause};
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Check for any orphaned ledger entries referencing non-existent transactions.
   */
  static async getOrphanedLedgerEntriesCount() {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM ledger_entries le
      LEFT JOIN transactions t ON le.transaction_id = t.id
      WHERE t.id IS NULL;
    `);
    return result.rows[0].count;
  }
}

module.exports = ReconciliationModel;
