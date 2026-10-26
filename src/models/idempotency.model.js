'use strict';
const crypto = require('crypto');

/**
 * IdempotencyModel
 *
 * Persists per-request idempotency keys in the `idempotency_keys` table.
 * The PRIMARY KEY constraint on `key` is the authoritative uniqueness guard;
 * the application never relies solely on a SELECT-before-INSERT check.
 *
 * Lifecycle of a key:
 *   1. status = 'pending'  – key reserved; transfer is in flight.
 *   2. status = 'resolved' – transfer committed; stored response ready for replay.
 *
 * If two concurrent requests carry the same key the losing INSERT raises
 * PostgreSQL error 23505 (unique_violation). The caller catches this,
 * polls briefly, and returns the resolved result once available.
 */
class IdempotencyModel {
  /**
   * Produce a deterministic SHA-256 hex digest over the normalised transfer
   * fields that define uniqueness.
   *
   * Rules:
   *  - amount is converted via String() on the already-validated number to
   *    preserve exact decimal representation without JS floating-point loss.
   *  - currency is upper-cased.
   *  - description is trimmed; absent / null → empty string.
   *  - sourceAccountId and destinationAccountId are lower-cased UUIDs.
   */
  static buildPayloadHash({ sourceAccountId, destinationAccountId, amount, currency, description }) {
    const normalized = JSON.stringify({
      src: String(sourceAccountId).toLowerCase(),
      dst: String(destinationAccountId).toLowerCase(),
      amt: String(amount),                 // exact decimal, no parseFloat rounding
      cur: String(currency || 'INR').toUpperCase(),
      dsc: String(description || '').trim(),
    });
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Attempt to reserve an idempotency key inside an already-open DB client
   * (so the reservation and the transfer share the same ACID transaction).
   *
   * Uses a SAVEPOINT so that if PostgreSQL raises 23505 (unique_violation),
   * the sub-transaction is cleanly rolled back without aborting the client's
   * main transaction block.
   *
   * Returns:
   *   { inserted: true }             – key was fresh; caller should proceed with transfer.
   *   { inserted: false, row }       – key already existed; row.status / row.response available.
   *
   * @param {string}      key         – Idempotency-Key header value
   * @param {string}      payloadHash – SHA-256 from buildPayloadHash()
   * @param {pg.PoolClient} client    – open DB client (within a transaction)
   * @param {object}      [pool]      – pg Pool for clean read outside aborted state
   */
  static async insertKey(key, payloadHash, client, pool) {
    try {
      await client.query('SAVEPOINT sp_idempotency');
      await client.query(
        `INSERT INTO idempotency_keys (key, payload_hash) VALUES ($1, $2)`,
        [key, payloadHash]
      );
      await client.query('RELEASE SAVEPOINT sp_idempotency');
      return { inserted: true };
    } catch (err) {
      if (err.code === '23505') {
        try {
          await client.query('ROLLBACK TO SAVEPOINT sp_idempotency');
        } catch (_) {}

        // Query existing row using pool for a fresh snapshot
        const queryTarget = pool || client;
        let existing = await queryTarget.query(
          `SELECT key, payload_hash, status, response FROM idempotency_keys WHERE key = $1`,
          [key]
        );

        let row = existing.rows[0];
        if (!row && pool) {
          // If concurrent winner just committed, brief wait and retry
          await new Promise((r) => setTimeout(r, 50));
          existing = await pool.query(
            `SELECT key, payload_hash, status, response FROM idempotency_keys WHERE key = $1`,
            [key]
          );
          row = existing.rows[0] || null;
        }

        return { inserted: false, row };
      }
      throw err;
    }
  }

  /**
   * Mark a key as resolved and store the response payload.
   * Called after the transfer transaction commits.
   * Uses a standalone pool query (outside the transfer transaction, which is
   * already committed by this point).
   *
   * @param {string} key      – Idempotency-Key value
   * @param {object} response – Serialisable response body to replay
   * @param {object} pool     – pg Pool (not a client)
   */
  static async resolve(key, response, pool) {
    await pool.query(
      `UPDATE idempotency_keys
          SET status   = 'resolved',
              response = $2::jsonb
        WHERE key = $1`,
      [key, JSON.stringify(response)]
    );
  }

  /**
   * Fetch an existing key row by key value (read-only, outside a transaction).
   * Used to poll for a 'resolved' result when a concurrent request won the INSERT.
   *
   * @param {string} key
   * @param {object} pool
   */
  static async findByKey(key, pool) {
    const result = await pool.query(
      `SELECT key, payload_hash, status, response FROM idempotency_keys WHERE key = $1`,
      [key]
    );
    return result.rows[0] || null;
  }
}

module.exports = IdempotencyModel;
