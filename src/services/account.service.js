const pool = require('../config/database');
const AccountModel = require('../models/account.model');
const LedgerEntryModel = require('../models/ledger-entry.model');

class AccountService {
  /**
   * Create a new account
   */
  static async createAccount({ userId, accountType, currency, description }) {
    const account = await AccountModel.create({ userId, accountType, currency, description });
    return account;
  }

  /**
   * Get account details with current balance
   */
  static async getAccountById(accountId) {
    const account = await AccountModel.findById(accountId);
    if (!account) return null;

    const balance = await AccountModel.calculateBalance(accountId);
    return { ...account, balance };
  }

  /**
   * Get all ledger entries for an account
   */
  static async getAccountLedger(accountId) {
    const account = await AccountModel.findById(accountId);
    if (!account) return null;

    const entries = await LedgerEntryModel.findByAccountId(accountId);
    return entries;
  }
}

module.exports = AccountService;
