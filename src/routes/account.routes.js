const express = require('express');
const router = express.Router();
const AccountController = require('../controllers/account.controller');
const { validate, schemas } = require('../middleware/validation');

// POST /accounts - Create new account
router.post('/', validate(schemas.createAccount), AccountController.createAccount);

// GET /accounts/:accountId - Get account details with balance
router.get('/:accountId', AccountController.getAccount);

// GET /accounts/:accountId/ledger - Get chronological ledger entries
router.get('/:accountId/ledger', AccountController.getAccountLedger);

module.exports = router;
