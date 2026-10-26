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

#### Transfer (Double-Entry & Idempotent)
```
POST /transfers
Content-Type: application/json
Idempotency-Key: txn-rent-oct-2026-001

{
  "sourceAccountId": "uuid",
  "destinationAccountId": "uuid",
  "amount": 500.00,
  "currency": "INR",
  "description": "Rent payment"
}
```

##### `Idempotency-Key` Header Specification (Required)
Every transfer request **must** supply an `Idempotency-Key` HTTP header.
- **Format**: 1–255 characters matching `^[A-Za-z0-9\-_.]{1,255}$` (alphanumerics, hyphens, underscores, dots).
- **First Submission (Fresh)**: Returns `201 Created` with the transaction and balanced ledger entries.
- **Identical Replay**: Resending the identical key with the exact same normalized payload returns `200 OK` with `"replayed": true` and the original transaction data. No extra debits, credits, or transactions are created.
- **Payload Mismatch (Conflict)**: Resending the same key with different transfer parameters (e.g., changed amount, source, or recipient) returns `409 Conflict` and makes no database modifications.
- **Atomic Reservation**: Key reservation and transfer writes share a single PostgreSQL transaction. Failed transfers (e.g. insufficient funds) roll back both the transaction and the key reservation, permitting immediate retry.
- **Concurrent Races**: Handled via database-level primary key uniqueness (`23505` error catch and savepoint/polling), guaranteeing zero duplicate execution even under simultaneous requests.
- **Retention**: Keys are persisted in `idempotency_keys` with a 24-hour expiration (`expires_at`).

Response `201 Created` (fresh request):
```json
{
  "status": "success",
  "message": "Transfer completed successfully.",
  "data": {
    "transaction": { "id": "uuid", "type": "transfer", "status": "completed", ... },
    "debitEntry":  { "entry_type": "debit",  "amount": "500.0000" },
    "creditEntry": { "entry_type": "credit", "amount": "500.0000" }
  }
}
```

Response `200 OK` (replayed retry):
```json
{
  "status": "success",
  "message": "Transfer completed successfully.",
  "replayed": true,
  "data": {
    "transaction": { "id": "uuid", "type": "transfer", "status": "completed", ... },
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
  "currency": "INR",
  "description": "ATM withdrawal"
}
```

---

### Reports

#### Ledger Reconciliation Report (Read-Only)
```
GET /reports/reconciliation
```

Inspects transactions in the database and verifies that ledger postings strictly conform to double-entry banking rules. Does not alter, delete, or repair any records.

**Optional Query Parameters:**
- `transactionId` (UUID): Scope reconciliation to a specific transaction.
- `status` (`completed` | `pending` | `failed`): Filter verification by transaction status.
- `limit` (integer): Paginate the inspection set.
- `offset` (integer): Pagination offset.

##### Expected Posting Patterns:
- **`transfer`**: Exactly one `debit` for the source account and one `credit` for the destination account; both amounts must equal the transaction amount (`NUMERIC(20,4)`).
- **`deposit`**: Exactly one `credit` to the destination account, equal to the transaction amount.
- **`withdrawal`**: Exactly one `debit` from the source account, equal to the transaction amount.
- **`pending` / `failed`**: Must have zero posted ledger entries. Non-completed transactions with entries are flagged as discrepancies.
- **Currency Invariants**: Verifies schema consistency; accounts and transactions must agree on currency.

##### Detected Discrepancy Types:
- `MISSING_LEDGER_ENTRIES`: Completed transaction lacks expected ledger entries.
- `EXTRA_LEDGER_ENTRIES`: More entries exist than permitted for the transaction type.
- `WRONG_DIRECTION`: Inverted debit/credit assignments.
- `WRONG_ACCOUNT`: Entry account ID does not match transaction source/destination.
- `AMOUNT_MISMATCH`: Ledger entry amount differs from transaction amount (compared using exact database numeric semantics).
- `CURRENCY_MISMATCH`: Account currency conflicts with transaction currency or cross-currency transfer.
- `UNEXPECTED_ENTRIES_FOR_NON_COMPLETED_TRANSACTION`: Pending or failed transaction has posted entries.
- `ORPHANED_LEDGER_ENTRIES`: Ledger entry references a non-existent transaction ID.

##### Response `200 OK` (Balanced):
```json
{
  "status": "success",
  "data": {
    "summary": {
      "totalTransactionsChecked": 45,
      "completedTransactionsChecked": 41,
      "pendingTransactions": 2,
      "failedTransactions": 2,
      "validTransactions": 45,
      "discrepantTransactionsCount": 0,
      "discrepancyCount": 0,
      "orphanedLedgerEntriesCount": 0,
      "reconciliationStatus": "BALANCED",
      "checkedAt": "2026-10-26T18:15:38.123Z"
    },
    "findings": []
  }
}
```

##### Response `200 OK` (Discrepancies Detected):
```json
{
  "status": "success",
  "data": {
    "summary": {
      "totalTransactionsChecked": 45,
      "completedTransactionsChecked": 41,
      "pendingTransactions": 2,
      "failedTransactions": 2,
      "validTransactions": 44,
      "discrepantTransactionsCount": 1,
      "discrepancyCount": 1,
      "orphanedLedgerEntriesCount": 0,
      "reconciliationStatus": "DISCREPANCIES_DETECTED",
      "checkedAt": "2026-10-26T18:15:38.123Z"
    },
    "findings": [
      {
        "transactionId": "b1b74dc8-...",
        "transactionType": "deposit",
        "status": "completed",
        "issueType": "AMOUNT_MISMATCH",
        "explanation": "Deposit entry amount (400.0000) does not equal transaction amount (999.0000).",
        "details": {
          "entryAmount": "400.0000",
          "transactionAmount": "999.0000"
        }
      }
    ]
  }
}
```

##### Limitations:
- The reconciliation endpoint is strictly **read-only**. It identifies discrepancies but never modifies or deletes ledger entries, preserving the database immutability rules.
- Operational remediation of reported discrepancies must be handled via offsetting corrective transactions.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Invalid request body or missing/malformed `Idempotency-Key` header |
| 404 | Account not found |
| 409 | Conflict: `Idempotency-Key` was already used with a different payload |
| 422 | Business rule violation (e.g. insufficient funds, frozen account, cross-currency) |
| 500 | Internal server error |

---

## Running Tests

Tests require a running PostgreSQL instance with the migrated schema.

```bash
npm test
```

Tests cover:
- Health check and environment readiness
- Account creation, validation, and retrieval with balance
- Deposits, withdrawals, transfers
- Insufficient funds rejection and zero-balance guards
- Same-account transfer rejection
- Cross-currency transfer rejections
- Inactive / frozen account restrictions across all transaction types
- Ledger immutability (no delete route and PostgreSQL rule-based blocks)
- Idempotency suite (missing/invalid header, identical retries, 409 conflicts, rollback on failure, concurrent races)
- Ledger reconciliation engine (read-only balance audits, missing/extra postings, wrong accounts/directions, amount mismatches, currency inconsistencies, and non-completed transaction guards)

---

## Architecture

```
src/
├── app.js                    # Express app setup
├── server.js                 # Entry point (DB connect + listen)
├── config/
│   ├── database.js           # pg Pool
│   ├── migrate.js            # Additive schema migrations
│   └── seed.js               # Demo data
├── models/
│   ├── account.model.js      # Account DB queries
│   ├── transaction.model.js  # Transaction DB queries
│   ├── ledger-entry.model.js # Ledger DB queries (append-only)
│   ├── idempotency.model.js  # Idempotency key persistence, hash, & lifecycle
│   └── reconciliation.model.js # Aggregated reconciliation inspection queries
├── services/
│   ├── account.service.js    # Account business logic
│   ├── transaction.service.js# Transfer/deposit/withdrawal logic + ACID transactions
│   └── reconciliation.service.js # Read-only double-entry verification engine
├── controllers/
│   ├── account.controller.js
│   ├── transaction.controller.js
│   └── report.controller.js
├── routes/
│   ├── account.routes.js
│   ├── transaction.routes.js
│   └── report.routes.js
└── middleware/
    ├── validation.js          # Joi schemas
    ├── idempotency.js         # Header validation & IdempotencyModel re-export
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
