require('dotenv').config();
const pool = require('./database');
const { v4: uuidv4 } = require('uuid');

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if demo data is already present to prevent duplicate records
    const existing = await client.query(
      `SELECT COUNT(*) AS count FROM accounts WHERE description IN ('Alice Checking Account', 'Bob Savings Account')`
    );
    if (parseInt(existing.rows[0].count, 10) > 0) {
      console.log('ℹ️ Seed data already present. Skipping seeding to prevent duplicates.');
      return;
    }

    const userId1 = uuidv4();
    const userId2 = uuidv4();

    // Create two demo accounts
    const acc1 = await client.query(
      `INSERT INTO accounts (user_id, account_type, currency, description)
       VALUES ($1, 'checking', 'USD', 'Alice Checking Account') RETURNING id`,
      [userId1]
    );
    const acc2 = await client.query(
      `INSERT INTO accounts (user_id, account_type, currency, description)
       VALUES ($1, 'savings', 'USD', 'Bob Savings Account') RETURNING id`,
      [userId2]
    );

    const accountId1 = acc1.rows[0].id;
    const accountId2 = acc2.rows[0].id;

    // Seed a deposit into Alice's account
    const txn = await client.query(
      `INSERT INTO transactions (type, destination_account_id, amount, currency, status, description)
       VALUES ('deposit', $1, 1000.0000, 'USD', 'completed', 'Initial seed deposit')
       RETURNING id`,
      [accountId1]
    );
    const txnId = txn.rows[0].id;

    await client.query(
      `INSERT INTO ledger_entries (account_id, transaction_id, entry_type, amount, running_description)
       VALUES ($1, $2, 'credit', 1000.0000, 'Seed deposit credit')`,
      [accountId1, txnId]
    );

    await client.query('COMMIT');
    console.log('✅ Seed data inserted.');
    console.log(`   Alice Account ID : ${accountId1}`);
    console.log(`   Bob   Account ID : ${accountId2}`);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('❌ Rollback failed:', rollbackErr.message);
      }
    }
    console.error('❌ Seeding failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
};

seed().catch((err) => {
  console.error('❌ Seed process exited with error.');
  process.exit(1);
});
