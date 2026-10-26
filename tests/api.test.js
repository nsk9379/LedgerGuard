const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

let accountA, accountB;

// Helper: create an INR account (default currency for LedgerGuard)
const createAccount = async (accountType = 'checking', currency = 'INR') => {
  const res = await request(app)
    .post('/accounts')
    .send({ userId: uuidv4(), accountType, currency });
  return res.body.data;
};

// Helper: deposit INR into an account
const deposit = async (accountId, amount, currency = 'INR') => {
  return request(app)
    .post('/deposits')
    .send({ accountId, amount, currency, description: 'Test deposit' });
};

beforeAll(async () => {
  // Verify DB connection
  const client = await pool.connect();
  client.release();
});

afterAll(async () => {
  await pool.end();
});

// ─── Health Check ──────────────────────────────────────────────────────────────

describe('Health Check', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ─── Account Creation ──────────────────────────────────────────────────────────

describe('POST /accounts', () => {
  it('creates a checking account with INR currency successfully', async () => {
    const res = await request(app).post('/accounts').send({
      userId: uuidv4(),
      accountType: 'checking',
      currency: 'INR',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.account_type).toBe('checking');
    expect(res.body.data.currency).toBe('INR');
    accountA = res.body.data;
  });

  it('creates a savings account with INR currency successfully', async () => {
    const res = await request(app).post('/accounts').send({
      userId: uuidv4(),
      accountType: 'savings',
      currency: 'INR',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.currency).toBe('INR');
    accountB = res.body.data;
  });

  it('defaults to INR currency when not specified', async () => {
    const res = await request(app).post('/accounts').send({
      userId: uuidv4(),
      accountType: 'checking',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.currency).toBe('INR');
  });

  it('rejects invalid account type', async () => {
    const res = await request(app).post('/accounts').send({
      userId: uuidv4(),
      accountType: 'crypto',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing userId', async () => {
    const res = await request(app).post('/accounts').send({
      accountType: 'checking',
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Account Retrieval ─────────────────────────────────────────────────────────

describe('GET /accounts/:accountId', () => {
  it('returns account with balance=0 for new account', async () => {
    const account = await createAccount();
    const res = await request(app).get(`/accounts/${account.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.balance).toBe(0);
  });

  it('returns 404 for non-existent account', async () => {
    const res = await request(app).get(`/accounts/${uuidv4()}`);
    expect(res.statusCode).toBe(404);
  });
});

// ─── Deposits ─────────────────────────────────────────────────────────────────

describe('POST /deposits', () => {
  it('deposits money and balance reflects it', async () => {
    const account = await createAccount();
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: account.id, amount: 500, currency: 'INR' });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('success');

    const balRes = await request(app).get(`/accounts/${account.id}`);
    expect(parseFloat(balRes.body.data.balance)).toBe(500);
  });

  it('rejects deposit with zero amount', async () => {
    const account = await createAccount();
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: account.id, amount: 0 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects deposit with negative amount', async () => {
    const account = await createAccount();
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: account.id, amount: -100 });
    expect(res.statusCode).toBe(400);
  });

  it('rejects deposit to non-existent account', async () => {
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: uuidv4(), amount: 100 });
    expect(res.statusCode).toBe(404);
  });

  it('rejects deposit with mismatched currency', async () => {
    const account = await createAccount('checking', 'INR');
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: account.id, amount: 500, currency: 'USD' });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/currency mismatch/i);
  });
});

// ─── Withdrawals ──────────────────────────────────────────────────────────────

describe('POST /withdrawals', () => {
  it('withdraws money and balance reflects it', async () => {
    const account = await createAccount();
    await deposit(account.id, 1000);

    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 400, currency: 'INR' });
    expect(res.statusCode).toBe(201);

    const balRes = await request(app).get(`/accounts/${account.id}`);
    expect(parseFloat(balRes.body.data.balance)).toBe(600);
  });

  it('rejects withdrawal exceeding balance (insufficient funds)', async () => {
    const account = await createAccount();
    await deposit(account.id, 100);

    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 500 });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  it('rejects withdrawal from account with zero balance', async () => {
    const account = await createAccount();
    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 1 });
    expect(res.statusCode).toBe(422);
  });

  it('rejects withdrawal with mismatched currency', async () => {
    const account = await createAccount('checking', 'INR');
    await deposit(account.id, 1000);
    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 100, currency: 'USD' });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/currency mismatch/i);
  });

  it('cannot produce a negative balance — withdrawal equals exact balance succeeds', async () => {
    const account = await createAccount();
    await deposit(account.id, 250);
    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 250 });
    expect(res.statusCode).toBe(201);
    const balRes = await request(app).get(`/accounts/${account.id}`);
    expect(parseFloat(balRes.body.data.balance)).toBe(0);
  });

  it('rejects withdrawal of 1 paisa more than available', async () => {
    const account = await createAccount();
    await deposit(account.id, 100);
    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 100.0001 });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/insufficient/i);
  });
});

// ─── Transfers ────────────────────────────────────────────────────────────────

describe('POST /transfers', () => {
  it('transfers money and creates exactly two balanced ledger entries', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 250,
      currency: 'INR',
      description: 'Test transfer',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toHaveProperty('debitEntry');
    expect(res.body.data).toHaveProperty('creditEntry');
    expect(res.body.data.debitEntry.entry_type).toBe('debit');
    expect(res.body.data.creditEntry.entry_type).toBe('credit');
    // Amounts returned from DB as NUMERIC strings — must be equal
    expect(res.body.data.debitEntry.amount).toBe(res.body.data.creditEntry.amount);

    const srcBal = await request(app).get(`/accounts/${src.id}`);
    const dstBal = await request(app).get(`/accounts/${dst.id}`);
    expect(parseFloat(srcBal.body.data.balance)).toBe(750);
    expect(parseFloat(dstBal.body.data.balance)).toBe(250);
  });

  it('rejects transfer with insufficient funds', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 100);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 500,
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  it('rejects transfer to same account', async () => {
    const src = await createAccount();
    await deposit(src.id, 100);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: src.id,
      amount: 50,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects transfer with non-existent source account', async () => {
    const dst = await createAccount();
    const res = await request(app).post('/transfers').send({
      sourceAccountId: uuidv4(),
      destinationAccountId: dst.id,
      amount: 50,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects transfer with non-existent destination account', async () => {
    const src = await createAccount();
    await deposit(src.id, 500);
    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: uuidv4(),
      amount: 50,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects cross-currency transfer (INR -> USD)', async () => {
    const src = await createAccount('checking', 'INR');
    const dst = await createAccount('savings', 'USD');
    await deposit(src.id, 1000);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 500,
      currency: 'INR',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/cross-currency/i);
  });

  it('rejects transfer where currency mismatches source account', async () => {
    const src = await createAccount('checking', 'INR');
    const dst = await createAccount('checking', 'INR');
    await deposit(src.id, 1000);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 100,
      currency: 'USD',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/currency mismatch/i);
  });
});

// ─── Inactive Account Guards ───────────────────────────────────────────────────

describe('Inactive Account Restrictions', () => {
  it('rejects deposit into a frozen account', async () => {
    // Create account then freeze it directly in DB
    const account = await createAccount();
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [account.id]);

    const res = await request(app)
      .post('/deposits')
      .send({ accountId: account.id, amount: 500, currency: 'INR' });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/not active/i);
  });

  it('rejects withdrawal from a frozen account', async () => {
    const account = await createAccount();
    await deposit(account.id, 500);
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [account.id]);

    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 100, currency: 'INR' });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/not active/i);
  });

  it('rejects transfer from a frozen source account', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 500);
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [src.id]);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 100,
      currency: 'INR',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/not active/i);
  });

  it('rejects transfer to a frozen destination account', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 500);
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [dst.id]);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 100,
      currency: 'INR',
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toMatch(/not active/i);
  });
});

// ─── Ledger / Balance ─────────────────────────────────────────────────────────

describe('GET /accounts/:accountId/ledger', () => {
  it('returns chronological ledger entries', async () => {
    const account = await createAccount();
    await deposit(account.id, 500);
    await request(app).post('/withdrawals').send({ accountId: account.id, amount: 100 });

    const res = await request(app).get(`/accounts/${account.id}/ledger`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.entries.length).toBe(2);
    expect(res.body.data.entries[0].entry_type).toBe('credit');
    expect(res.body.data.entries[1].entry_type).toBe('debit');
    expect(parseFloat(res.body.data.currentBalance)).toBe(400);
  });

  it('returns 404 for non-existent account ledger', async () => {
    const res = await request(app).get(`/accounts/${uuidv4()}/ledger`);
    expect(res.statusCode).toBe(404);
  });
});

// ─── Ledger Immutability ───────────────────────────────────────────────────────

describe('Ledger Immutability', () => {
  it('ledger entries cannot be deleted via API (no delete route exists)', async () => {
    const account = await createAccount();
    await deposit(account.id, 100);
    const ledger = await request(app).get(`/accounts/${account.id}/ledger`);
    const entryId = ledger.body.data.entries[0].id;

    // No delete route should exist; must return 404
    const res = await request(app).delete(`/accounts/${account.id}/ledger/${entryId}`);
    expect(res.statusCode).toBe(404);
  });

  it('DB-level rule blocks direct UPDATE on ledger_entries (returns 0 rows affected)', async () => {
    // Deposit so we have an entry to attempt to update
    const account = await createAccount();
    await deposit(account.id, 999);
    const ledger = await request(app).get(`/accounts/${account.id}/ledger`);
    const entryId = ledger.body.data.entries[0].id;

    // Attempt a direct SQL UPDATE — the DB rule (DO INSTEAD NOTHING) silently swallows it
    const result = await pool.query(
      `UPDATE ledger_entries SET amount = 0 WHERE id = $1`,
      [entryId]
    );
    // rowCount should be 0 because the rule prevents the update
    expect(result.rowCount).toBe(0);

    // Verify amount is still 999 (unchanged)
    const entryCheck = await pool.query(
      `SELECT amount FROM ledger_entries WHERE id = $1`,
      [entryId]
    );
    expect(parseFloat(entryCheck.rows[0].amount)).toBe(999);
  });

  it('DB-level rule blocks direct DELETE on ledger_entries (returns 0 rows affected)', async () => {
    const account = await createAccount();
    await deposit(account.id, 100);
    const ledger = await request(app).get(`/accounts/${account.id}/ledger`);
    const entryId = ledger.body.data.entries[0].id;

    // Attempt a direct SQL DELETE — the DB rule silently swallows it
    const result = await pool.query(
      `DELETE FROM ledger_entries WHERE id = $1`,
      [entryId]
    );
    expect(result.rowCount).toBe(0);

    // Entry must still exist
    const entryCheck = await pool.query(
      `SELECT id FROM ledger_entries WHERE id = $1`,
      [entryId]
    );
    expect(entryCheck.rows.length).toBe(1);
  });
});
