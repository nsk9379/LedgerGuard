require('dotenv').config();
const { Pool } = require('pg');

// Validate required database credentials
if (!process.env.DB_PASSWORD) {
  console.error('❌ Configuration Error: DB_PASSWORD environment variable is required.');
  console.error('   Please ensure DB_PASSWORD is set in your local .env file.');
  throw new Error('Missing required environment variable: DB_PASSWORD');
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'ledgerguard_dev',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client:', err.message);
  process.exit(-1);
});

module.exports = pool;
