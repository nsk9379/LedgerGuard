'use strict';
const pool = require('../config/database');
const TransactionService = require('../services/transaction.service');
const IdempotencyModel = require('../models/idempotency.model');

class TransactionController {
  /**
   * POST /transfers
   *
   * Idempotency protocol (key is pre-validated by idempotency middleware):
   *
   *   1. Build a SHA-256 payload hash from normalised request fields.
   *   2. Attempt INSERT of (key, payload_hash) inside the transfer's own DB
   *      transaction — so reservation and all ledger writes are atomic.
   *   3a. INSERT succeeds → fresh request; run transfer, commit, then mark key
   *       'resolved' with the stored response.
   *   3b. INSERT raises 23505 (unique violation) → key already exists.
   *       • Same payload_hash → replay: wait briefly for 'resolved', return 200.
   *       • Different payload_hash → 409 Conflict; ROLLBACK, no DB changes.
   *   4. If the transfer service throws, ROLLBACK removes the key reservation
   *      too, so a future retry can succeed.
   *
   * Concurrent identical requests:
   *   The losing concurrent request gets a 23505 on INSERT. It then re-reads
   *   the row. If still 'pending' (winner not yet committed) it waits up to
   *   2 s in short polling increments before returning 202 Accepted advising
   *   the client to retry. Once 'resolved', it returns 200 with the stored result.
   */
  static async transfer(req, res, next) {
    try {
      const { sourceAccountId, destinationAccountId, amount, currency, description } = req.body;
      const key = req.idempotencyKey; // set by idempotency middleware

      // Build the exact payload hash using String(amount) — no parseFloat loss.
      const payloadHash = IdempotencyModel.buildPayloadHash({
        sourceAccountId,
        destinationAccountId,
        amount,      // Joi-validated number, exact decimals preserved via String()
        currency,
        description,
      });

      // ── Open a transaction client shared by idempotency INSERT + transfer ────
      const client = await pool.connect();
      let transferResult = null;
      let wasReplayed = false;
      let replayResponse = null;

      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

        // ── Try to reserve the idempotency key ───────────────────────────────
        const { inserted, row } = await IdempotencyModel.insertKey(key, payloadHash, client, pool);

        if (!inserted && row) {
          // Key already exists in DB
          if (row.payload_hash !== payloadHash) {
            // Different payload → 409 Conflict; ROLLBACK ensures no writes
            await client.query('ROLLBACK');
            return res.status(409).json({
              status: 'error',
              message:
                'Idempotency-Key has already been used with a different request payload. ' +
                'Use a new Idempotency-Key for a different transfer.',
            });
          }

          // Same payload → replay
          await client.query('ROLLBACK'); // release the transaction; nothing to write

          // If status is already resolved, return stored result immediately
          if (row.status === 'resolved' && row.response) {
            return res.status(200).json({
              ...row.response,
              replayed: true,
            });
          }

          // Status is 'pending' — winner is still in flight; poll briefly
          const POLL_INTERVAL_MS = 100;
          const POLL_TIMEOUT_MS = 2000;
          const deadline = Date.now() + POLL_TIMEOUT_MS;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            const current = await IdempotencyModel.findByKey(key, pool);
            if (current && current.status === 'resolved' && current.response) {
              return res.status(200).json({
                ...current.response,
                replayed: true,
              });
            }
          }

          // Winner took too long; advise client to retry
          return res.status(202).json({
            status: 'pending',
            message: 'Transfer is still being processed. Retry with the same Idempotency-Key.',
          });
        }

        // ── Key was fresh: run the transfer inside the same client/transaction ─
        transferResult = await TransactionService.transferWithClient({
          sourceAccountId,
          destinationAccountId,
          amount: parseFloat(amount),
          currency,
          description,
          client,
        });

        // Build the response body we will store for future replays
        replayResponse = {
          status: 'success',
          message: 'Transfer completed successfully.',
          data: transferResult,
        };

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err; // propagate to global error handler
      } finally {
        client.release();
      }

      // ── Mark key 'resolved' (outside the committed transaction) ─────────────
      // A failure here is non-fatal for the user: the transfer already committed.
      // The key stays 'pending' and will be cleaned up by the expiry index.
      try {
        await IdempotencyModel.resolve(key, replayResponse, pool);
      } catch (resolveErr) {
        console.error('⚠️  Failed to mark idempotency key resolved:', resolveErr.message);
      }

      wasReplayed = false;
      return res.status(201).json(replayResponse);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /deposits
   */
  static async deposit(req, res, next) {
    try {
      const { accountId, amount, currency, description } = req.body;
      const result = await TransactionService.deposit({
        destinationAccountId: accountId,
        amount: parseFloat(amount),
        currency,
        description,
      });
      return res.status(201).json({
        status: 'success',
        message: 'Deposit completed successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /withdrawals
   */
  static async withdrawal(req, res, next) {
    try {
      const { accountId, amount, currency, description } = req.body;
      const result = await TransactionService.withdrawal({
        sourceAccountId: accountId,
        amount: parseFloat(amount),
        currency,
        description,
      });
      return res.status(201).json({
        status: 'success',
        message: 'Withdrawal completed successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = TransactionController;
