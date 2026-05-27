const TransactionService = require('../services/transaction.service');

class TransactionController {
  /**
   * POST /transfers
   */
  static async transfer(req, res, next) {
    try {
      const { sourceAccountId, destinationAccountId, amount, currency, description } = req.body;
      const result = await TransactionService.transfer({
        sourceAccountId,
        destinationAccountId,
        amount: parseFloat(amount),
        currency,
        description,
      });
      return res.status(201).json({
        status: 'success',
        message: 'Transfer completed successfully.',
        data: result,
      });
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
