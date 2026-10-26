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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
        sourceAccountId: src.id,
        destinationAccountId: src.id,
        amount: 50,
      });
    expect(res.statusCode).toBe(400);
  });

  it('rejects transfer with non-existent source account', async () => {
    const dst = await createAccount();
    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
        sourceAccountId: uuidv4(),
        destinationAccountId: dst.id,
        amount: 50,
      });
    expect(res.statusCode).toBe(404);
  });

  it('rejects transfer with non-existent destination account', async () => {
    const src = await createAccount();
    await deposit(src.id, 500);
    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
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

// ─── POST /transfers — Idempotency ──────────────────────────────────────────

describe('POST /transfers — Idempotency', () => {
  it('rejects request when Idempotency-Key header is missing', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const res = await request(app)
      .post('/transfers')
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst.id,
        amount: 100,
        currency: 'INR',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/Missing required header: Idempotency-Key/i);
  });

  it('rejects request when Idempotency-Key format contains spaces or illegal characters', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', 'invalid key with spaces!')
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst.id,
        amount: 100,
        currency: 'INR',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/Invalid Idempotency-Key/i);
  });

  it('rejects request when Idempotency-Key exceeds 255 characters', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const longKey = 'a'.repeat(256);
    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', longKey)
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst.id,
        amount: 100,
        currency: 'INR',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/Invalid Idempotency-Key/i);
  });

  it('processes normal transfer with valid Idempotency-Key and returns HTTP 201', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const key = `key-initial-${uuidv4()}`;
    const res = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst.id,
        amount: 200,
        currency: 'INR',
        description: 'Initial transfer',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.replayed).toBeFalsy();
    expect(res.body.data).toHaveProperty('transaction');
    expect(res.body.data.transaction.status).toBe('completed');
  });

  it('returns original result (HTTP 200, replayed: true) on identical retry with same key and payload', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const key = `key-retry-${uuidv4()}`;
    const payload = {
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 300,
      currency: 'INR',
      description: 'Rent payment retry test',
    };

    // First request
    const firstRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(firstRes.statusCode).toBe(201);
    const originalTxId = firstRes.body.data.transaction.id;

    // Retry with identical key and identical payload
    const retryRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.body.status).toBe('success');
    expect(retryRes.body.replayed).toBe(true);
    expect(retryRes.body.data.transaction.id).toBe(originalTxId);

    // Verify balances reflect ONLY ONE transfer (300 deducted, not 600)
    const srcBal = await request(app).get(`/accounts/${src.id}`);
    const dstBal = await request(app).get(`/accounts/${dst.id}`);
    expect(parseFloat(srcBal.body.data.balance)).toBe(700);
    expect(parseFloat(dstBal.body.data.balance)).toBe(300);

    // Verify ledger has exactly 2 entries (1 debit, 1 credit) for this transaction
    const ledgerCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ledger_entries WHERE transaction_id = $1`,
      [originalTxId]
    );
    expect(ledgerCheck.rows[0].count).toBe(2);
  });

  it('returns HTTP 409 Conflict when same Idempotency-Key is reused with different amount', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const key = `key-mismatch-amt-${uuidv4()}`;

    // First request: amount 200
    const firstRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst.id,
        amount: 200,
        currency: 'INR',
      });
    expect(firstRes.statusCode).toBe(201);

    // Second request: same key, different amount (500)
    const conflictRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst.id,
        amount: 500,
        currency: 'INR',
      });

    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.body.status).toBe('error');
    expect(conflictRes.body.message).toMatch(/different request payload/i);

    // Balances must not have been modified by the second request
    const srcBal = await request(app).get(`/accounts/${src.id}`);
    expect(parseFloat(srcBal.body.data.balance)).toBe(800);
  });

  it('returns HTTP 409 Conflict when same Idempotency-Key is reused with different destination account', async () => {
    const src = await createAccount();
    const dst1 = await createAccount();
    const dst2 = await createAccount();
    await deposit(src.id, 1000);

    const key = `key-mismatch-dst-${uuidv4()}`;

    // First request: to dst1
    const firstRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst1.id,
        amount: 150,
        currency: 'INR',
      });
    expect(firstRes.statusCode).toBe(201);

    // Second request: same key, but to dst2
    const conflictRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst2.id,
        amount: 150,
        currency: 'INR',
      });

    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.body.message).toMatch(/different request payload/i);

    // dst2 must have 0 balance
    const dst2Bal = await request(app).get(`/accounts/${dst2.id}`);
    expect(parseFloat(dst2Bal.body.data.balance)).toBe(0);
  });

  it('rolls back key reservation on insufficient funds, permitting retry after deposit', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    // Only 50 in account
    await deposit(src.id, 50);

    const key = `key-rollback-${uuidv4()}`;
    const payload = {
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 200,
      currency: 'INR',
    };

    // First attempt: should fail with 422 Insufficient funds
    const failRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(failRes.statusCode).toBe(422);
    expect(failRes.body.message).toMatch(/insufficient/i);

    // Check that the key reservation was rolled back in the DB (not persisted)
    const keyInDb = await pool.query(`SELECT * FROM idempotency_keys WHERE key = $1`, [key]);
    expect(keyInDb.rows.length).toBe(0);

    // Now deposit sufficient funds
    await deposit(src.id, 500);

    // Retry with the exact same Idempotency-Key and payload
    const successRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(successRes.statusCode).toBe(201);
    expect(successRes.body.status).toBe('success');

    const srcBal = await request(app).get(`/accounts/${src.id}`);
    expect(parseFloat(srcBal.body.data.balance)).toBe(350); // 50 + 500 - 200 = 350
  });

  it('handles concurrent identical transfer requests correctly without duplicate debits', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const key = `key-concurrent-${uuidv4()}`;
    const payload = {
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 400,
      currency: 'INR',
      description: 'Concurrent race test',
    };

    // Send two identical requests concurrently
    const [res1, res2] = await Promise.all([
      request(app).post('/transfers').set('Idempotency-Key', key).send(payload),
      request(app).post('/transfers').set('Idempotency-Key', key).send(payload),
    ]);

    // One must be 201 Created and the other must be 200 OK (replayed)
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 201]);

    const winner = res1.statusCode === 201 ? res1 : res2;
    const loser = res1.statusCode === 200 ? res1 : res2;

    expect(winner.body.status).toBe('success');
    expect(loser.body.status).toBe('success');
    expect(loser.body.replayed).toBe(true);
    expect(loser.body.data.transaction.id).toBe(winner.body.data.transaction.id);

    // Source balance must only be debited once: 1000 - 400 = 600
    const srcBal = await request(app).get(`/accounts/${src.id}`);
    expect(parseFloat(srcBal.body.data.balance)).toBe(600);

    // Destination balance must only be credited once: 400
    const dstBal = await request(app).get(`/accounts/${dst.id}`);
    expect(parseFloat(dstBal.body.data.balance)).toBe(400);

    // Exactly 2 ledger entries created total for this transaction
    const ledgerCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM ledger_entries WHERE transaction_id = $1`,
      [winner.body.data.transaction.id]
    );
    expect(ledgerCheck.rows[0].count).toBe(2);
  });
});

// ─── GET /reports/reconciliation — Ledger Reconciliation Engine ─────────────

describe('GET /reports/reconciliation — Ledger Reconciliation Engine', () => {
  it('returns 200 and balanced summary for valid baseline ledger', async () => {
    const res = await request(app).get('/reports/reconciliation');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('findings');
    expect(res.body.data.summary.totalTransactionsChecked).toBeGreaterThan(0);
    expect(res.body.data.summary.discrepancyCount).toBe(0);
    expect(res.body.data.summary.reconciliationStatus).toBe('BALANCED');
    expect(res.body.data.findings).toEqual([]);
  });

  it('rejects invalid transactionId UUID format with HTTP 400', async () => {
    const res = await request(app).get('/reports/reconciliation?transactionId=not-a-valid-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/valid UUID/i);
  });

  it('rejects invalid status filter parameter with HTTP 400', async () => {
    const res = await request(app).get('/reports/reconciliation?status=unknown_status');
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/Invalid status query parameter/i);
  });

  it('correctly handles pending and failed transactions with 0 postings without reporting discrepancies', async () => {
    const src = await createAccount();
    const dst = await createAccount();

    const pendingTxId = uuidv4();
    const failedTxId = uuidv4();

    // Insert a pending transaction with 0 entries
    await pool.query(
      `INSERT INTO transactions (id, type, source_account_id, destination_account_id, amount, currency, status, description)
       VALUES ($1, 'transfer', $2, $3, 100, 'INR', 'pending', 'Test pending transfer')`,
      [pendingTxId, src.id, dst.id]
    );

    // Insert a failed transaction with 0 entries
    await pool.query(
      `INSERT INTO transactions (id, type, source_account_id, destination_account_id, amount, currency, status, description)
       VALUES ($1, 'withdrawal', $2, NULL, 50, 'INR', 'failed', 'Test failed withdrawal')`,
      [failedTxId, src.id]
    );

    // Reconcile pending tx
    const pendingRes = await request(app).get(`/reports/reconciliation?transactionId=${pendingTxId}`);
    expect(pendingRes.statusCode).toBe(200);
    expect(pendingRes.body.data.summary.pendingTransactions).toBe(1);
    expect(pendingRes.body.data.summary.discrepancyCount).toBe(0);
    expect(pendingRes.body.data.summary.reconciliationStatus).toBe('BALANCED');
    expect(pendingRes.body.data.findings).toEqual([]);

    // Reconcile failed tx
    const failedRes = await request(app).get(`/reports/reconciliation?transactionId=${failedTxId}`);
    expect(failedRes.statusCode).toBe(200);
    expect(failedRes.body.data.summary.failedTransactions).toBe(1);
    expect(failedRes.body.data.summary.discrepancyCount).toBe(0);
    expect(failedRes.body.data.summary.reconciliationStatus).toBe('BALANCED');
    expect(failedRes.body.data.findings).toEqual([]);

    // Safe cleanup: delete the test fixture transactions (no ledger entries linked)
    await pool.query(`DELETE FROM transactions WHERE id = ANY($1)`, [[pendingTxId, failedTxId]]);
  });

  it('detects MISSING_LEDGER_ENTRIES when completed transaction has no ledger postings', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    const brokenTxId = uuidv4();

    // Insert a completed transaction with NO ledger entries
    await pool.query(
      `INSERT INTO transactions (id, type, source_account_id, destination_account_id, amount, currency, status, description)
       VALUES ($1, 'transfer', $2, $3, 350.0000, 'INR', 'completed', 'Inconsistent tx with missing entries')`,
      [brokenTxId, src.id, dst.id]
    );

    const res = await request(app).get(`/reports/reconciliation?transactionId=${brokenTxId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary.reconciliationStatus).toBe('DISCREPANCIES_DETECTED');
    expect(res.body.data.summary.discrepancyCount).toBe(1);

    const finding = res.body.data.findings[0];
    expect(finding.transactionId).toBe(brokenTxId);
    expect(finding.issueType).toBe('MISSING_LEDGER_ENTRIES');
    expect(finding.explanation).toMatch(/expected exactly 2 ledger entries/i);

    // Safe cleanup: delete the unposted transaction
    await pool.query(`DELETE FROM transactions WHERE id = $1`, [brokenTxId]);
  });

  it('detects UNEXPECTED_ENTRIES_FOR_NON_COMPLETED_TRANSACTION when non-completed tx has postings', async () => {
    const acc = await createAccount();
    const depRes = await request(app).post('/deposits').send({
      accountId: acc.id,
      amount: 250,
      currency: 'INR',
    });
    const txId = depRes.body.data.transaction.id;

    // Temporarily mutate status to 'failed'
    await pool.query(`UPDATE transactions SET status = 'failed' WHERE id = $1`, [txId]);

    const res = await request(app).get(`/reports/reconciliation?transactionId=${txId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary.reconciliationStatus).toBe('DISCREPANCIES_DETECTED');
    expect(res.body.data.summary.discrepancyCount).toBe(1);

    const finding = res.body.data.findings[0];
    expect(finding.transactionId).toBe(txId);
    expect(finding.issueType).toBe('UNEXPECTED_ENTRIES_FOR_NON_COMPLETED_TRANSACTION');
    expect(finding.explanation).toMatch(/failed.*posted ledger entries/i);

    // Safe restoration: restore status to 'completed'
    await pool.query(`UPDATE transactions SET status = 'completed' WHERE id = $1`, [txId]);
  });

  it('detects AMOUNT_MISMATCH when ledger entry amount diverges from transaction amount', async () => {
    const acc = await createAccount();
    const depRes = await request(app).post('/deposits').send({
      accountId: acc.id,
      amount: 400,
      currency: 'INR',
    });
    const txId = depRes.body.data.transaction.id;

    // Temporarily alter transaction amount to simulate corruption/tampering
    await pool.query(`UPDATE transactions SET amount = 999.0000 WHERE id = $1`, [txId]);

    const res = await request(app).get(`/reports/reconciliation?transactionId=${txId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary.reconciliationStatus).toBe('DISCREPANCIES_DETECTED');
    expect(res.body.data.summary.discrepancyCount).toBe(1);

    const finding = res.body.data.findings[0];
    expect(finding.transactionId).toBe(txId);
    expect(finding.issueType).toBe('AMOUNT_MISMATCH');
    expect(finding.explanation).toMatch(/does not equal transaction amount/i);
    expect(finding.details.entryAmount).toBe('400.0000');
    expect(finding.details.transactionAmount).toBe('999.0000');

    // Safe restoration: restore amount back to 400.0000
    await pool.query(`UPDATE transactions SET amount = 400.0000 WHERE id = $1`, [txId]);
  });

  it('detects WRONG_ACCOUNT when ledger entry points to unexpected account', async () => {
    const src = await createAccount();
    const dst1 = await createAccount();
    const dst2 = await createAccount();
    await deposit(src.id, 1000);

    const transferRes = await request(app)
      .post('/transfers')
      .set('Idempotency-Key', uuidv4())
      .send({
        sourceAccountId: src.id,
        destinationAccountId: dst1.id,
        amount: 200,
        currency: 'INR',
      });
    const txId = transferRes.body.data.transaction.id;

    // Temporarily swap transaction destination to dst2
    await pool.query(`UPDATE transactions SET destination_account_id = $1 WHERE id = $2`, [dst2.id, txId]);

    const res = await request(app).get(`/reports/reconciliation?transactionId=${txId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary.reconciliationStatus).toBe('DISCREPANCIES_DETECTED');

    const wrongAccountFinding = res.body.data.findings.find((f) => f.issueType === 'WRONG_ACCOUNT');
    expect(wrongAccountFinding).toBeDefined();
    expect(wrongAccountFinding.transactionId).toBe(txId);
    expect(wrongAccountFinding.explanation).toMatch(/does not match transaction destination account/i);

    // Safe restoration: revert destination back to dst1
    await pool.query(`UPDATE transactions SET destination_account_id = $1 WHERE id = $2`, [dst1.id, txId]);
  });

  it('detects CURRENCY_MISMATCH when transaction currency contradicts account schema currency', async () => {
    const acc = await createAccount('checking', 'INR');
    const depRes = await request(app).post('/deposits').send({
      accountId: acc.id,
      amount: 150,
      currency: 'INR',
    });
    const txId = depRes.body.data.transaction.id;

    // Temporarily alter transaction currency to USD
    await pool.query(`UPDATE transactions SET currency = 'USD' WHERE id = $1`, [txId]);

    const res = await request(app).get(`/reports/reconciliation?transactionId=${txId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary.reconciliationStatus).toBe('DISCREPANCIES_DETECTED');

    const currencyFinding = res.body.data.findings.find((f) => f.issueType === 'CURRENCY_MISMATCH');
    expect(currencyFinding).toBeDefined();
    expect(currencyFinding.transactionId).toBe(txId);
    expect(currencyFinding.details.destinationAccountCurrency).toBe('INR');
    expect(currencyFinding.details.transactionCurrency).toBe('USD');

    // Safe restoration: revert currency back to INR
    await pool.query(`UPDATE transactions SET currency = 'INR' WHERE id = $1`, [txId]);
  });

  it('read-only guarantee: reconciliation leaves transactions and ledger_entries counts untouched', async () => {
    const beforeTx = await pool.query(`SELECT COUNT(*)::int AS count FROM transactions`);
    const beforeLe = await pool.query(`SELECT COUNT(*)::int AS count FROM ledger_entries`);

    await request(app).get('/reports/reconciliation');

    const afterTx = await pool.query(`SELECT COUNT(*)::int AS count FROM transactions`);
    const afterLe = await pool.query(`SELECT COUNT(*)::int AS count FROM ledger_entries`);

    expect(afterTx.rows[0].count).toBe(beforeTx.rows[0].count);
    expect(afterLe.rows[0].count).toBe(beforeLe.rows[0].count);
  });
});


