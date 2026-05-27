const AccountService = require('../services/account.service');

class AccountController {
  /**
   * POST /accounts
   */
  static async createAccount(req, res, next) {
    try {
      const { userId, accountType, currency, description } = req.body;
      const account = await AccountService.createAccount({ userId, accountType, currency, description });
      return res.status(201).json({
        status: 'success',
        data: account,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /accounts/:accountId
   */
  static async getAccount(req, res, next) {
    try {
      const { accountId } = req.params;
      const account = await AccountService.getAccountById(accountId);
      if (!account) {
        return res.status(404).json({ status: 'error', message: 'Account not found.' });
      }
      return res.status(200).json({
        status: 'success',
        data: account,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /accounts/:accountId/ledger
   */
  static async getAccountLedger(req, res, next) {
    try {
      const { accountId } = req.params;
      const account = await AccountService.getAccountById(accountId);
      if (!account) {
        return res.status(404).json({ status: 'error', message: 'Account not found.' });
      }
      const entries = await AccountService.getAccountLedger(accountId);
      return res.status(200).json({
        status: 'success',
        data: {
          accountId,
          currentBalance: account.balance,
          entries,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = AccountController;
