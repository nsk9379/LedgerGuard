'use strict';
const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboard.controller');

// ── Dashboard HTML page ──────────────────────────────────────────────────────
// GET /dashboard  →  EJS rendered page
router.get('/', DashboardController.index);

// ── Read-only JSON APIs consumed by the dashboard page ──────────────────────
// These are intentionally separated under /dashboard/api so they cannot be
// confused with the core financial API routes.

// GET /dashboard/api/accounts
router.get('/api/accounts', DashboardController.listAccounts);

// GET /dashboard/api/transactions
router.get('/api/transactions', DashboardController.listTransactions);

// GET /dashboard/api/reconciliation
router.get('/api/reconciliation', DashboardController.reconciliation);

module.exports = router;
