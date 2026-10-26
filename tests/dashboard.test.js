'use strict';
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/config/database');

describe('Dashboard Integration Tests', () => {
  afterAll(async () => {
    await pool.end();
  });

  describe('GET / and GET /dashboard (HTML Rendering)', () => {
    it('GET / redirects to /dashboard', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/dashboard');
    });

    it('GET /dashboard renders the EJS HTML shell successfully', async () => {
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('LedgerGuard');
      expect(res.text).toContain('Transfer Execution Simulator');
      expect(res.text).toContain('Ledger Reconciliation Engine');
      expect(res.text).toContain('/css/style.css');
      expect(res.text).toContain('/js/dashboard.js');
    });
  });

  describe('Static Assets Serving', () => {
    it('serves local CSS with correct content-type without external CDNs', async () => {
      const res = await request(app).get('/css/style.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/css/);
      expect(res.text).toContain('--bg-primary');
    });

    it('serves local JS with correct content-type without external CDNs', async () => {
      const res = await request(app).get('/js/dashboard.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text).toContain('refreshAllData');
    });
  });

  describe('Dashboard Read-Only APIs', () => {
    it('GET /dashboard/api/accounts returns status success and array of accounts with balance', async () => {
      const res = await request(app).get('/dashboard/api/accounts');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        const acc = res.body.data[0];
        expect(acc).toHaveProperty('id');
        expect(acc).toHaveProperty('balance');
        expect(acc).toHaveProperty('currency');
      }
    });

    it('GET /dashboard/api/transactions returns status success and array of recent transactions', async () => {
      const res = await request(app).get('/dashboard/api/transactions');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /dashboard/api/reconciliation returns live ledger reconciliation report', async () => {
      const res = await request(app).get('/dashboard/api/reconciliation');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data.summary).toHaveProperty('reconciliationStatus');
      expect(res.body.data.summary).toHaveProperty('completedTransactionsChecked');
      expect(res.body.data).toHaveProperty('findings');
    });
  });
});
