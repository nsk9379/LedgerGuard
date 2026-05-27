# Financial Ledger API — Double-Entry Bookkeeping

A robust REST API implementing double-entry bookkeeping for a mock banking application. Built with **Node.js**, **Express**, and **PostgreSQL**.

---

## Features

- **Double-Entry Bookkeeping**: Every transfer generates exactly two balanced ledger entries (debit + credit)
- **ACID Transactions**: All database operations are atomic with `REPEATABLE READ` isolation
- **Immutable Ledger**: Entries are append-only; DB-level rules prevent UPDATE/DELETE
- **Balance Integrity**: Prevents negative balances before committing any transaction
- **Balance Calculation**: Always computed from ledger sum — never stored directly
- **Race Condition Safe**: Uses `SELECT ... FOR UPDATE` row locking during transactions

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| Database | PostgreSQL |
| Validation | Joi |
| Testing | Jest + Supertest |
| ORM/Query | Raw SQL via `pg` |

---

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 13
- npm

---

## Setup & Installation

### 1. Clone and Install

```bash
cd financial-ledger-api
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL credentials:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=financial_ledger
DB_USER=postgres
DB_PASSWORD=yourpassword
NODE_ENV=development
```

### 3. Create Database

```sql
-- In psql or pgAdmin:
CREATE DATABASE financial_ledger;
```

### 4. Run Migrations

```bash
npm run db:migrate
```

### 5. (Optional) Seed Demo Data

```bash
npm run db:seed
```

This creates two demo accounts and prints their IDs.

### 6. Start the Server

```bash
npm start          # production
npm run dev        # development (auto-reload)
```

Server starts at: `http://localhost:3000`

---

## API Reference

### Health Check

```
GET /health
```

---

### Accounts

#### Create Account
```
POST /accounts
Content-Type: application/json

{
  "userId": "uuid",
  "accountType": "checking | savings | business | loan",
  "currency": "USD",
  "description": "My Account"
}
```

Response `201`:
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "account_type": "checking",
    "currency": "USD",
    "status": "active",
    "created_at": "..."
  }
}
```

#### Get Account (with balance)
```
GET /accounts/:accountId
```

Response `200`:
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "balance": 1250.00,
    ...
  }
}
```

#### Get Ledger Entries
```
GET /accounts/:accountId/ledger
```

Response `200`:
```json
{
  "status": "success",
  "data": {
    "accountId": "uuid",
    "currentBalance": 1250.00,
    "entries": [
      {
        "id": "uuid",
        "entry_type": "credit",
        "amount": "1500.0000",
        "created_at": "...",
        "transaction_type": "deposit"
      }
    ]
  }
}
```

---

### Transactions

#### Transfer (Double-Entry)
```
POST /transfers
Content-Type: application/json

{
  "sourceAccountId": "uuid",
  "destinationAccountId": "uuid",
  "amount": 500.00,
  "currency": "USD",
  "description": "Rent payment"
}
```

Response `201` — creates exactly one debit and one credit entry:
```json
{
  "status": "success",
  "data": {
    "transaction": { "id": "uuid", "status": "completed", ... },
    "debitEntry":  { "entry_type": "debit",  "amount": "500.0000" },
    "creditEntry": { "entry_type": "credit", "amount": "500.0000" }
  }
}
```

#### Deposit
```
POST /deposits
Content-Type: application/json

{
  "accountId": "uuid",
  "amount": 1000.00,
  "currency": "USD",
  "description": "Salary"
}
```

#### Withdrawal
```
POST /withdrawals
Content-Type: application/json

{
  "accountId": "uuid",
  "amount": 200.00,
  "currency": "USD",
  "description": "ATM withdrawal"
}
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Invalid request body / validation error |
| 404 | Account not found |
| 422 | Business rule violation (e.g. insufficient funds, frozen account) |
| 500 | Internal server error |

---

## Running Tests

Tests require a running PostgreSQL instance with the migrated schema.

```bash
npm test
```

Tests cover:
- Account creation and retrieval
- Deposits, withdrawals, transfers
- Insufficient funds rejection
- Same-account transfer rejection
- Ledger immutability (no delete route)
- Balance calculation accuracy

---

## Architecture

```
src/
├── app.js                    # Express app setup
├── server.js                 # Entry point (DB connect + listen)
├── config/
│   ├── database.js           # pg Pool
│   ├── migrate.js            # Schema migration
│   └── seed.js               # Demo data
├── models/
│   ├── account.model.js      # Account DB queries
│   ├── transaction.model.js  # Transaction DB queries
│   └── ledger-entry.model.js # Ledger DB queries (append-only)
├── services/
│   ├── account.service.js    # Account business logic
│   └── transaction.service.js# Transfer/deposit/withdrawal logic + ACID
├── controllers/
│   ├── account.controller.js
│   └── transaction.controller.js
├── routes/
│   ├── account.routes.js
│   └── transaction.routes.js
└── middleware/
    ├── validation.js          # Joi schemas
    └── errorHandler.js        # Global error handler
```

---

## Double-Entry Bookkeeping Design

For every **transfer** of amount `A` from Account X to Account Y:

| Entry | Account | Type   | Amount |
|-------|---------|--------|--------|
| 1     | X       | Debit  | +A     |
| 2     | Y       | Credit | +A     |

**Balance = SUM(credits) - SUM(debits)** from ledger_entries for that account.

The debit amount always equals the credit amount, ensuring the books are always balanced.

---

## Security & Data Integrity

- `NUMERIC(20,4)` for all amounts — no floating-point errors
- Foreign key constraints on all relational fields
- DB-level `RULE` prevents UPDATE/DELETE on `ledger_entries`
- `SELECT ... FOR UPDATE` prevents race conditions on concurrent transfers
- `REPEATABLE READ` isolation prevents dirty reads
