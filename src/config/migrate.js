require('dotenv').config();
const pool = require('./database');

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Accounts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('checking', 'savings', 'business', 'loan')),
        currency VARCHAR(3) NOT NULL DEFAULT 'INR',
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
        description VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(20) NOT NULL CHECK (type IN ('transfer', 'deposit', 'withdrawal')),
        source_account_id UUID REFERENCES accounts(id),
        destination_account_id UUID REFERENCES accounts(id),
        amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'INR',
        status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
        description VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Additive migration: Ensure default currency is INR for existing schemas
    await client.query(`ALTER TABLE accounts ALTER COLUMN currency SET DEFAULT 'INR';`);
    await client.query(`ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'INR';`);

    // Localize starter demo records to INR (rerunnable, preserves unrelated historical/test records)
    await client.query(`
      UPDATE accounts
      SET currency = 'INR', updated_at = NOW()
      WHERE description IN ('Alice Checking Account', 'Bob Savings Account')
        AND currency != 'INR';
    `);

    await client.query(`
      UPDATE transactions
      SET currency = 'INR', updated_at = NOW()
      WHERE description = 'Initial seed deposit'
        AND currency != 'INR';
    `);

    // Ledger entries table — immutable, no UPDATE/DELETE allowed via app logic
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES accounts(id),
        transaction_id UUID NOT NULL REFERENCES transactions(id),
        entry_type VARCHAR(6) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
        amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
        running_description VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ledger_account_id ON ledger_entries(account_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries(transaction_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_account_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_dest ON transactions(destination_account_id);`);

    // Rule to prevent UPDATE/DELETE on ledger_entries (immutability enforcement at DB level)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_rules WHERE tablename = 'ledger_entries' AND rulename = 'no_update_ledger'
        ) THEN
          CREATE RULE no_update_ledger AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
        END IF;
      END$$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_rules WHERE tablename = 'ledger_entries' AND rulename = 'no_delete_ledger'
        ) THEN
          CREATE RULE no_delete_ledger AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;
        END IF;
      END$$;
    `);

    // ── Idempotency keys table (additive, rerunnable) ─────────────────────────
    // PRIMARY KEY on `key` enforces uniqueness at the DB level.
    // A concurrent INSERT on a duplicate key raises error code 23505,
    // which the application detects and handles without a separate SELECT guard.
    await client.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key          VARCHAR(255) PRIMARY KEY,
        payload_hash VARCHAR(64)  NOT NULL,
        status       VARCHAR(10)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'resolved')),
        response     JSONB,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
      );
    `);

    // Index to support efficient expired-key cleanup (not yet automated, but prepared)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at
        ON idempotency_keys (expires_at);
    `);

    await client.query('COMMIT');
    console.log('✅ Database migration completed successfully.');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('❌ Rollback failed:', rollbackErr.message);
      }
    }
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

createTables().catch((err) => {
  console.error('❌ Migration process exited with error.');
  process.exit(1);
});
