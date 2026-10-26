'use strict';

/**
 * idempotency middleware — for POST /transfers
 *
 * Validates the Idempotency-Key request header then attaches
 * `req.idempotencyKey` and `req.idempotencyPayloadHash` for downstream use.
 * The actual DB reserve + replay logic lives in the controller so it can share
 * the transfer's DB transaction client.
 *
 * Header rules (enforced here, before any DB work):
 *   - Must be present.
 *   - 1–255 characters.
 *   - Allowed characters: alphanumeric, hyphen, underscore, dot  [A-Za-z0-9\-_.]+
 *
 * These rules prevent injection, match common client idioms (UUID v4, ULID, etc.)
 * and fit the VARCHAR(255) column without truncation.
 */

const IdempotencyModel = require('../models/idempotency.model');

// Allowed key format: printable, no whitespace or control chars; common in Stripe / Adyen style APIs
const KEY_PATTERN = /^[A-Za-z0-9\-_.]{1,255}$/;

/**
 * Express middleware: validate the Idempotency-Key header.
 * Attaches req.idempotencyKey on success, rejects with 400 on failure.
 */
function validateIdempotencyKey(req, res, next) {
  const key = req.headers['idempotency-key'];

  if (!key) {
    return res.status(400).json({
      status: 'error',
      message: 'Missing required header: Idempotency-Key.',
    });
  }

  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({
      status: 'error',
      message:
        'Invalid Idempotency-Key. Must be 1–255 characters using only ' +
        'alphanumeric characters, hyphens (-), underscores (_), or dots (.).',
    });
  }

  req.idempotencyKey = key;
  next();
}

module.exports = { validateIdempotencyKey, IdempotencyModel };
