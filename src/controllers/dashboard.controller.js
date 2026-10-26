'use strict';
const AccountModel = require('../models/account.model');
const TransactionModel = require('../models/transaction.model');
const ReconciliationService = require('../services/reconciliation.service');

/**
 * DashboardController
 *
 * Serves the local EJS demonstration dashboard and the small read-only
 * JSON sub-endpoints the dashboard page fetches via client-side XHR.
 *
 * ALL endpoints here are read-only. The transfer simulator in the dashboard
 * delegates writes to the existing POST /transfers API endpoint with its full
 * validation, idempotency, and ACID guarantees.
 *
 * ⚠️  LOCAL DEMONSTRATION ONLY — Not production-ready.
 *     No authentication or authorisation controls are implemented.
 *     See docs/PROJECT_STATUS.md for the full security blocker list.
 */
class DashboardController {
  /**
   * GET /dashboard
   * Render the EJS dashboard shell; real data is fetched client-side via JSON APIs.
   */
  static async index(req, res, next) {
    try {
      return res.render('dashboard', {
        title: 'LedgerGuard — Local Demo Dashboard',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /dashboard/api/accounts
   * Return all accounts with ledger-derived balances, newest first.
   * Amounts come straight from PostgreSQL NUMERIC — no JS float arithmetic.
   */
  static async listAccounts(req, res, next) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const accounts = await AccountModel.findAll({ limit, offset });
      return res.json({ status: 'success', data: accounts });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /dashboard/api/transactions
   * Return the most-recent transactions with joined account descriptions.
   */
  static async listTransactions(req, res, next) {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
      const offset = parseInt(req.query.offset, 10) || 0;
      const transactions = await TransactionModel.findRecent({ limit, offset });
      return res.json({ status: 'success', data: transactions });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /dashboard/api/reconciliation
   * Run full reconciliation and return structured findings.
   * Thin pass-through to ReconciliationService — no extra logic.
   */
  static async reconciliation(req, res, next) {
    try {
      const report = await ReconciliationService.reconcile({});
      return res.json({ status: 'success', data: report });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = DashboardController;
