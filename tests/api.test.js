const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

let accountA, accountB;

// Helper: create account
const createAccount = async (accountType = 'checking') => {
  const res = await request(app)
    .post('/accounts')
    .send({ userId: uuidv4(), accountType, currency: 'USD' });
  return res.body.data;
};

// Helper: deposit
const deposit = async (accountId, amount) => {
  return request(app)
    .post('/deposits')
    .send({ accountId, amount, currency: 'USD', description: 'Test deposit' });
};

beforeAll(async () => {
  // Verify DB connection
  const client = await pool.connect();
  client.release();
});

afterAll(async () => {
  await pool.end();
});

describe('Health Check', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /accounts', () => {
  it('creates a checking account successfully', async () => {
    const res = await request(app).post('/accounts').send({
      userId: uuidv4(),
      accountType: 'checking',
      currency: 'USD',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.account_type).toBe('checking');
    accountA = res.body.data;
  });

  it('creates a savings account successfully', async () => {
    const res = await request(app).post('/accounts').send({
      userId: uuidv4(),
      accountType: 'savings',
      currency: 'USD',
    });
    expect(res.statusCode).toBe(201);
    accountB = res.body.data;
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

describe('POST /deposits', () => {
  it('deposits money and balance reflects it', async () => {
    const account = await createAccount();
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: account.id, amount: 500, currency: 'USD' });
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

  it('rejects deposit to non-existent account', async () => {
    const res = await request(app)
      .post('/deposits')
      .send({ accountId: uuidv4(), amount: 100 });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /withdrawals', () => {
  it('withdraws money and balance reflects it', async () => {
    const account = await createAccount();
    await deposit(account.id, 1000);

    const res = await request(app)
      .post('/withdrawals')
      .send({ accountId: account.id, amount: 400, currency: 'USD' });
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
});

describe('POST /transfers', () => {
  it('transfers money and creates two ledger entries', async () => {
    const src = await createAccount();
    const dst = await createAccount();
    await deposit(src.id, 1000);

    const res = await request(app).post('/transfers').send({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 250,
      currency: 'USD',
      description: 'Test transfer',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toHaveProperty('debitEntry');
    expect(res.body.data).toHaveProperty('creditEntry');
    expect(res.body.data.debitEntry.entry_type).toBe('debit');
    expect(res.body.data.creditEntry.entry_type).toBe('credit');
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
});

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

describe('Ledger Immutability', () => {
  it('ledger entries cannot be deleted via API (no delete route exists)', async () => {
    const account = await createAccount();
    await deposit(account.id, 100);
    const ledger = await request(app).get(`/accounts/${account.id}/ledger`);
    const entryId = ledger.body.data.entries[0].id;

    // No delete route should exist
    const res = await request(app).delete(`/accounts/${account.id}/ledger/${entryId}`);
    expect(res.statusCode).toBe(404);
  });
});
