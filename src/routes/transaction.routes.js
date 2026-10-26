const express = require('express');
const router = express.Router();
const TransactionController = require('../controllers/transaction.controller');
const { validate, schemas } = require('../middleware/validation');
const { validateIdempotencyKey } = require('../middleware/idempotency');

// POST /transfers
router.post('/transfers', validateIdempotencyKey, validate(schemas.transfer), TransactionController.transfer);

// POST /deposits
router.post('/deposits', validate(schemas.deposit), TransactionController.deposit);

// POST /withdrawals
router.post('/withdrawals', validate(schemas.withdrawal), TransactionController.withdrawal);

module.exports = router;
