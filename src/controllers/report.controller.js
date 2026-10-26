'use strict';
const ReconciliationService = require('../services/reconciliation.service');

class ReportController {
  /**
   * GET /reports/reconciliation
   *
   * Read-only endpoint that inspects transactions and reconciles them against ledger entries.
   *
   * Query parameters:
   *   - transactionId: optional UUID to scope verification to a specific transaction
   *   - status: optional status filter ('completed', 'pending', 'failed')
   *   - limit: optional number
   *   - offset: optional number
   */
  static async reconciliation(req, res, next) {
    try {
      const { transactionId, status, limit, offset } = req.query;

      if (transactionId) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(transactionId)) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid transactionId query parameter. Must be a valid UUID.',
          });
        }
      }

      if (status && !['completed', 'pending', 'failed'].includes(status)) {
        return res.status(400).json({
          status: 'error',
          message: "Invalid status query parameter. Must be one of: 'completed', 'pending', 'failed'.",
        });
      }

      const report = await ReconciliationService.reconcile({
        transactionId,
        status,
        limit,
        offset,
      });

      return res.status(200).json({
        status: 'success',
        data: report,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ReportController;
