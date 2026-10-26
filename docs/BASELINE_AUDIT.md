# Baseline Audit: LedgerGuard Reference Codebase

**Date of Audit:** October 26, 2026  
**Audited Repository:** [double-entry-ledger-api](file:///d:/Projects/LedgerGuard/LedgerGuard)  
**Target Project:** LedgerGuard — Banking Transaction Integrity System  
**Audit Purpose:** Comprehensive technical baseline analysis prior to implementing LedgerGuard enhancements.  
**Scope:** Architecture, scripts, dependencies, database schema & migrations, endpoints, ledger invariants, test coverage, secrets/configuration, concurrency/correctness risks, external dependencies, and licensing.

---

## 1. Actual Project Architecture and Request Flow

### 1.1 Architecture Style
The codebase follows a standard multi-tier layered MVC-service pattern in Node.js / Express:

```
HTTP Request
     │
     ▼
[Express App: src/app.js]
  ├── Middleware: cors, express.json, morgan('dev')
  └── Route Dispatchers:
       ├── /health
       ├── /accounts  ──> [src/routes/account.routes.js]
       └── /          ──> [src/routes/transaction.routes.js]
                             │
                             ▼
                    [src/middleware/validation.js]
                      (Joi payload schema validation)
                             │
                             ▼
                    [Controllers: src/controllers/]
                      ├── account.controller.js
                      └── transaction.controller.js
                             │
                             ▼
                    [Services: src/services/]
                      ├── account.service.js
                      └── transaction.service.js (ACID, row locking, ledger entries)
                             │
                             ▼
                    [Models: src/models/]
                      ├── account.model.js
                      ├── transaction.model.js
                      └── ledger-entry.model.js
                             │
                             ▼
                    [Database Pool: src/config/database.js]
                      (pg.Pool -> PostgreSQL)
                             │
                             ▼
                    [Terminal Middleware: src/middleware/errorHandler.js]
                      (Centralized error formatting)
```

### 1.2 Component Breakdown
- **Entry Points:**
  - [`src/server.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/server.js): Initializes the DB connection test (`pool.connect()`), then starts HTTP listening on `PORT` (default `3000`).
  - [`src/app.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/app.js): Express instance configuration, middleware registration, routing, 404 handler, and error handler.
- **Data Access Layer:**
  - [`src/config/database.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/config/database.js): Instantiates a single `pg.Pool` instance (max 20 connections, 30s idle timeout).
  - Models are static ES6 classes executing parameterized SQL queries via `client.query` (supporting both pool and dedicated transaction clients).
- **Business Layer:**
  - [`src/services/account.service.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/services/account.service.js): Account creation and computed balance aggregation.
  - [`src/services/transaction.service.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/services/transaction.service.js): Core transactional logic handling transfers, deposits, and withdrawals using explicit transaction blocks (`BEGIN ISOLATION LEVEL REPEATABLE READ` ... `COMMIT`/`ROLLBACK`).

### 1.3 Verified End-to-End Request Flow (Example: `POST /transfers`)
1. **Client Request:** An HTTP `POST` arrives at `/transfers` with a JSON payload (`sourceAccountId`, `destinationAccountId`, `amount`, `currency`, `description`).
2. **Pre-processing:** `src/app.js` runs `cors()`, `express.json()`, and `morgan('dev')`.
3. **Route Match & Input Validation:** `src/routes/transaction.routes.js` triggers `validate(schemas.transfer)` from [`src/middleware/validation.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/middleware/validation.js). If any field fails Joi validation (e.g. non-UUID, negative amount, precision > 4 decimals), it immediately responds with `400 Bad Request` and an error list.
4. **Controller Invocation:** [`TransactionController.transfer`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/transaction.controller.js#L7-L25) parses `amount` using `parseFloat(amount)` and delegates to [`TransactionService.transfer`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/services/transaction.service.js#L13-L113).
5. **Connection & Isolation:** A dedicated PostgreSQL client is acquired from the pool via `pool.connect()`. The service executes `BEGIN ISOLATION LEVEL REPEATABLE READ`.
6. **Row Locking:** The service queries `accounts` with `SELECT ... FOR UPDATE` sequentially for `sourceAccountId` then `destinationAccountId`.
7. **Business Rule Verification:**
   - Both accounts must exist (otherwise `404`).
   - Both accounts must have `status === 'active'` (otherwise `422`).
   - `sourceAccountId !== destinationAccountId` (otherwise `400`).
   - Source account balance is dynamically calculated (`AccountModel.calculateBalance`) and checked against `amount` (otherwise `422 Insufficient funds`).
8. **Mutation & Ledger Generation:**
   - Inserts record into `transactions` table with status `pending`.
   - Inserts DEBIT entry into `ledger_entries` for `sourceAccountId`.
   - Inserts CREDIT entry into `ledger_entries` for `destinationAccountId`.
   - Verifies `debitEntry.amount === creditEntry.amount` (otherwise throws `500`).
   - Updates `transactions.status` to `completed`.
9. **Commit & Cleanup:** Executes `COMMIT`, releases the client back to the pool in a `finally` block, and returns `201 Created` with the transaction and entries.
10. **Error Flow:** If any exception is thrown, the catch block executes `ROLLBACK`, client is released in `finally`, and `next(err)` hands off to [`src/middleware/errorHandler.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/middleware/errorHandler.js).

---

## 2. Available Scripts and Dependencies

### 2.1 Package Scripts (from [`package.json`](file:///d:/Projects/LedgerGuard/LedgerGuard/package.json))
| Script | Command | Purpose | Verified Status |
|--------|---------|---------|-----------------|
| `start` | `node src/server.js` | Starts server in production mode | Verified in `package.json` |
| `dev` | `nodemon src/server.js` | Starts server with nodemon auto-restart | Verified in `package.json` |
| `test` | `jest --runInBand --forceExit` | Runs Jest integration test suite | Verified in `package.json` |
| `db:migrate` | `node src/config/migrate.js` | Runs schema DDL script | Verified in `package.json` |
| `db:seed` | `node src/config/seed.js` | Injects mock accounts & initial deposit | Verified in `package.json` |

### 2.2 Production Dependencies
- `express` (`^4.18.2`): Minimal HTTP web framework.
- `pg` (`^8.11.3`): PostgreSQL client supporting connection pooling and parameterized queries.
- `dotenv` (`^16.3.1`): Loads environment variables from `.env`.
- `uuid` (`^9.0.0`): Generates UUIDv4 identifiers.
- `joi` (`^17.11.0`): Object schema validation for HTTP requests.
- `morgan` (`^1.10.0`): HTTP request logger.
- `cors` (`^2.8.5`): Enables Cross-Origin Resource Sharing.

### 2.3 Development Dependencies
- `jest` (`^29.7.0`): JavaScript test runner.
- `supertest` (`^6.3.3`): HTTP assertion library for Express testing.
- `nodemon` (`^3.0.2`): Development server file watcher.

### 2.4 Dependency Installation Status
- **Verified Finding:** `node_modules/` is not present in the workspace. Dependencies have not been installed yet.

---

## 3. Current Database Tables and Migration Approach

### 3.1 Migration Mechanism
- **Approach:** Custom procedural JavaScript script ([`src/config/migrate.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/config/migrate.js)).
- **Mechanism:** Acquires a DB client, wraps DDL execution in `BEGIN` ... `COMMIT`, and creates tables, indexes, and rules.
- **Architectural Limitations:**
  - No migration framework (e.g., Knex, Umzug, db-migrate).
  - No migration tracking table (e.g., `schema_migrations`) recording applied migration versions or timestamps.
  - No down-migration / rollback capability. Schema modifications require either manually editing `migrate.js` or dropping the entire database.
  - Idempotency is partially achieved via `IF NOT EXISTS` clauses on tables, indexes, and custom PL/pgSQL conditional blocks for rules.

### 3.2 Schema Definition

#### Table: `accounts`
| Column | Type | Constraints / Defaults | Description |
|--------|------|------------------------|-------------|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique account identifier |
| `user_id` | `UUID` | `NOT NULL` | Owning customer/user identifier |
| `account_type` | `VARCHAR(20)` | `NOT NULL CHECK (account_type IN ('checking', 'savings', 'business', 'loan'))` | Permitted account categories |
| `currency` | `VARCHAR(3)` | `NOT NULL DEFAULT 'USD'` | ISO currency code |
| `status` | `VARCHAR(10)` | `NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed'))` | Operational state |
| `description` | `VARCHAR(255)` | Nullable | Human-readable account label |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Record creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Last modification timestamp |

#### Table: `transactions`
| Column | Type | Constraints / Defaults | Description |
|--------|------|------------------------|-------------|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique transaction ID |
| `type` | `VARCHAR(20)` | `NOT NULL CHECK (type IN ('transfer', 'deposit', 'withdrawal'))` | Business transaction type |
| `source_account_id` | `UUID` | `REFERENCES accounts(id)`, Nullable | Originating account (null for deposits) |
| `destination_account_id` | `UUID` | `REFERENCES accounts(id)`, Nullable | Target account (null for withdrawals) |
| `amount` | `NUMERIC(20, 4)` | `NOT NULL CHECK (amount > 0)` | Monetary quantity |
| `currency` | `VARCHAR(3)` | `NOT NULL DEFAULT 'USD'` | Transaction currency |
| `status` | `VARCHAR(10)` | `NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed'))` | Transaction lifecycle status |
| `description` | `VARCHAR(500)` | Nullable | Narrative memo |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Last update timestamp |

#### Table: `ledger_entries`
| Column | Type | Constraints / Defaults | Description |
|--------|------|------------------------|-------------|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique entry ID |
| `account_id` | `UUID` | `NOT NULL REFERENCES accounts(id)` | Affected ledger account |
| `transaction_id` | `UUID` | `NOT NULL REFERENCES transactions(id)` | Parent transaction reference |
| `entry_type` | `VARCHAR(6)` | `NOT NULL CHECK (entry_type IN ('debit', 'credit'))` | Double-entry side |
| `amount` | `NUMERIC(20, 4)` | `NOT NULL CHECK (amount > 0)` | Entry value |
| `running_description` | `VARCHAR(500)` | Nullable | Narrative note |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Immutability timestamp |

### 3.3 Indexes & Immutability Rules
- **Indexes:**
  - `idx_ledger_account_id` on `ledger_entries(account_id)`
  - `idx_ledger_transaction_id` on `ledger_entries(transaction_id)`
  - `idx_transactions_source` on `transactions(source_account_id)`
  - `idx_transactions_dest` on `transactions(destination_account_id)`
- **Database Rules:**
  - `no_update_ledger`: `CREATE RULE no_update_ledger AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;`
  - `no_delete_ledger`: `CREATE RULE no_delete_ledger AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;`
  - *Behavioral Note:* Postgres `DO INSTEAD NOTHING` rules quietly swallow `UPDATE` or `DELETE` statements without throwing an error (returning 0 rows affected), rather than raising an explicit permission/integrity exception.

---

## 4. Available Endpoints

| Method | Route | Middleware | Controller Handler | Success Status | Description |
|--------|-------|------------|--------------------|----------------|-------------|
| `GET` | `/health` | None | Inline handler | `200 OK` | Liveness check with timestamp |
| `POST` | `/accounts` | `validate(schemas.createAccount)` | [`AccountController.createAccount`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/account.controller.js#L7) | `201 Created` | Creates a new account |
| `GET` | `/accounts/:accountId` | None | [`AccountController.getAccount`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/account.controller.js#L23) | `200 OK` | Fetches account with computed balance |
| `GET` | `/accounts/:accountId/ledger` | None | [`AccountController.getAccountLedger`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/account.controller.js#L42) | `200 OK` | Fetches chronological ledger entries |
| `POST` | `/transfers` | `validate(schemas.transfer)` | [`TransactionController.transfer`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/transaction.controller.js#L7) | `201 Created` | Double-entry fund transfer |
| `POST` | `/deposits` | `validate(schemas.deposit)` | [`TransactionController.deposit`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/transaction.controller.js#L30) | `201 Created` | Single-entry credit deposit |
| `POST` | `/withdrawals` | `validate(schemas.withdrawal)` | [`TransactionController.withdrawal`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/controllers/transaction.controller.js#L52) | `201 Created` | Single-entry debit withdrawal |
| `ALL` | `*` | Catch-all | Inline handler | `404 Not Found` | Unrecognized route handler |

---

## 5. Transaction and Ledger Invariants

### 5.1 Enforced Invariants (Verified in Code)
1. **Dynamic Balance Aggregation:** Account balances are never stored as mutable columns on `accounts`. Balance is always calculated via SQL aggregate:
   $$\text{Balance} = \sum (\text{credits}) - \sum (\text{debits})$$
2. **Transfer Balance Symmetry:** In [`TransactionService.transfer`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/services/transaction.service.js#L91-L94), every transfer generates exactly two entries (1 debit, 1 credit) with identical amounts.
3. **Pessimistic Account Row Locking:** Transfers and withdrawals execute `SELECT ... FOR UPDATE` on account rows prior to checking balances.
4. **Non-Negative Balance Guard:** Withdrawals and transfers compute current available balance before insertion; if balance < amount, the transaction is rejected with status `422`.
5. **No Negative or Zero Amounts:** Database `CHECK (amount > 0)` constraint and Joi `Joi.number().positive()` prevent non-positive transaction amounts.
6. **No Self-Transfers:** Transfers reject `sourceAccountId === destinationAccountId` at both service and controller layers.

### 5.2 Invariant Breaches & Theoretical Flaws (Verified Gaps)
1. **Violation of Global Double-Entry Equilibrium on Deposits & Withdrawals:**
   - In standard double-entry bookkeeping, every debit must have an equal credit across the entire system.
   - Currently, `POST /deposits` creates **only 1 credit entry** (no corresponding debit against a Cash / Vault / External Clearing account).
   - Currently, `POST /withdrawals` creates **only 1 debit entry** (no corresponding credit against a Cash / Vault / External Clearing account).
   - Consequently, system-wide total debits $\neq$ total credits whenever deposits or withdrawals occur.
2. **Currency Consistency Not Enforced:**
   - `accounts` table stores `currency` (e.g. `USD`).
   - Transfer logic does not verify that `sourceAccount.currency === destAccount.currency === transaction.currency`.
   - A user could transfer between accounts with different currency codes without exchange-rate conversion or error.
3. **No Idempotency Invariant:**
   - There is no deduplication or idempotency key mechanism. If a client retries a network-interrupted `POST /transfers`, the transfer will execute twice.
4. **Audit Trail Destruction on Abort:**
   - If a transaction fails mid-flight (e.g., integrity check or database error), the entire transaction block rolls back (`ROLLBACK`). The pending `transactions` row is removed, leaving zero audit record of the failed or rejected transaction attempt in the database.

---

## 6. Test Coverage and Gaps

### 6.1 Existing Test Suite ([`tests/api.test.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/tests/api.test.js))
The test file contains 13 end-to-end integration tests using `supertest` against a running PostgreSQL database:
- `GET /health` returns status `ok` (status 200).
- `POST /accounts` creates checking account (status 201).
- `POST /accounts` creates savings account (status 201).
- `POST /accounts` rejects invalid account type (status 400).
- `POST /accounts` rejects missing `userId` (status 400).
- `GET /accounts/:accountId` returns balance = 0 for fresh account (status 200).
- `GET /accounts/:accountId` returns 404 for non-existent UUID (status 404).
- `POST /deposits` deposits funds and verifies balance increases (status 201).
- `POST /deposits` rejects zero amount (status 400).
- `POST /deposits` rejects deposit to non-existent account (status 404).
- `POST /withdrawals` withdraws funds and verifies balance decreases (status 201).
- `POST /withdrawals` rejects withdrawal exceeding balance (status 422).
- `POST /withdrawals` rejects withdrawal on zero balance (status 422).
- `POST /transfers` transfers funds and verifies both ledger entries and final balances (status 201).
- `POST /transfers` rejects transfer with insufficient funds (status 422).
- `POST /transfers` rejects same-account transfer (status 400).
- `POST /transfers` rejects non-existent source account (status 404).
- `GET /accounts/:accountId/ledger` verifies chronological order and current balance (status 200).
- `GET /accounts/:accountId/ledger` returns 404 for non-existent account (status 404).
- Immutability check: sends `DELETE /accounts/:id/ledger/:entryId` and expects 404.

### 6.2 Critical Test Gaps
1. **Zero Concurrency / Race Condition Tests:** No tests execute concurrent transfers or concurrent withdrawals on the same account to test race conditions or row-lock behavior.
2. **No Deadlock Verification:** No test runs simultaneous bi-directional transfers (Account A -> B and B -> A concurrently).
3. **No Database Rule Test:** The test only asserts that Express has no `DELETE` HTTP route (returning 404). It does NOT execute a direct SQL `UPDATE ledger_entries` or `DELETE FROM ledger_entries` to prove the DB rule works.
4. **No Account Status / Freeze Tests:** No tests verify that frozen or closed accounts reject transactions.
5. **No Unit Tests:** There are zero mock-based unit tests for isolated business logic or models; every test requires a live PostgreSQL instance.
6. **No Boundary / Precision Tests:** No tests for large numbers, boundary decimal precision (`0.0001`), or floating-point rounding anomalies.
7. **No Serialization Failure / Rollback Tests:** No tests verifying system behavior when database queries fail or error mid-transaction.

---

## 7. Configuration and Secret-Management Risks

### 7.1 Verified Risks
1. **Hardcoded Fallback Credentials:**
   - In [`src/config/database.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/config/database.js#L4-L13):
     ```javascript
     password: process.env.DB_PASSWORD || 'password',
     database: process.env.DB_NAME || 'financial_ledger',
     user: process.env.DB_USER || 'postgres',
     ```
     If environment variables are omitted, the application falls back to generic default database credentials.
2. **Missing Environment Validation:**
   - Environment variables are read directly via `process.env` without validation (e.g. no checks that `DB_PORT` is an integer, or that mandatory variables exist).
3. **Information Disclosure in Error Handler:**
   - [`src/middleware/errorHandler.js`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/middleware/errorHandler.js#L2) logs full error objects via `console.error(err)`, which can expose connection strings, database schemas, or query text in production logs.
   - For PostgreSQL check constraint errors (`23514`), line 20 returns: `'Constraint violation: ' + err.detail` to the client, disclosing internal database constraint definitions.
4. **`.env` File Status:**
   - Verified that `.env` is properly ignored in [`.gitignore`](file:///d:/Projects/LedgerGuard/LedgerGuard/.gitignore#L7).
   - Verified that `.env` does not exist in the working directory (only [`.env.example`](file:///d:/Projects/LedgerGuard/LedgerGuard/.env.example) exists).

---

## 8. Correctness and Concurrency Risks

### 8.1 Critical Concurrency Defect: Lock Ordering Deadlock
In [`TransactionService.transfer`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/services/transaction.service.js#L20-L27):
```javascript
const sourceAccount = await client.query(
  `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
  [sourceAccountId]
);
const destAccount = await client.query(
  `SELECT id, status, currency FROM accounts WHERE id = $1 FOR UPDATE`,
  [destinationAccountId]
);
```
- **Scenario:**
  - Transaction 1 transfers from Account A to Account B.
  - Transaction 2 transfers from Account B to Account A simultaneously.
  - Transaction 1 locks row A, then requests row B.
  - Transaction 2 locks row B, then requests row A.
- **Result:** PostgreSQL detects a circular dependency and terminates one of the queries with `deadlock detected (code 40P01)`.
- **Mitigation Requirement:** Account row locks must always be acquired in a deterministic order (e.g., sorting UUIDs: `min(id1, id2)` locked before `max(id1, id2)`).

### 8.2 Serialization Failure Abort under `REPEATABLE READ`
- `TransactionService` uses `ISOLATION LEVEL REPEATABLE READ`.
- In PostgreSQL, if two concurrent transactions attempt to lock or update the same row under `REPEATABLE READ`, the second transaction will fail with error `40001 (serialization_failure)`.
- The application has no retry loop or exponential backoff mechanism. It simply fails with an internal server error (500).

### 8.3 Precision Loss via JavaScript `parseFloat`
- Monetary amounts are stored as `NUMERIC(20, 4)` in PostgreSQL.
- However, throughout the application:
  - Controllers pass amounts through `parseFloat(amount)`.
  - [`AccountModel.calculateBalance`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/models/account.model.js#L44) returns `parseFloat(result.rows[0].balance)`.
  - [`TransactionService.transfer`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/services/transaction.service.js#L47) compares `if (sourceBalance < amount)`.
- **Risk:** JavaScript double-precision binary floats (`IEEE 754`) suffer from precision issues (e.g., `0.1 + 0.2 !== 0.3`). For large values or 4-decimal fractions, float arithmetic introduces inaccuracies. Calculations and balance checks should either remain in arbitrary-precision decimal strings / libraries or be computed directly within SQL.

### 8.4 Unbounded Ledger History Query
- [`LedgerEntryModel.findByAccountId`](file:///d:/Projects/LedgerGuard/LedgerGuard/src/models/ledger-entry.model.js#L25-L44) executes an unbounded query:
  `SELECT ... FROM ledger_entries WHERE account_id = $1 ORDER BY created_at ASC`.
- There is no pagination (`LIMIT` / `OFFSET` or cursor-based pagination). For active accounts with thousands of entries, this endpoint will cause memory bloat and API latency spikes.

---

## 9. External-Service Dependencies

### 9.1 Verified Findings
- **Zero Third-Party External Services:** A thorough search across the entire codebase confirms that no external APIs, cloud services, or SaaS platforms are utilized:
  - No payment gateways (Stripe, Razorpay, PayPal, etc.).
  - No external auth providers (Auth0, Clerk, Firebase, Cognito, etc.).
  - No OTP / SMS / Email communication services (Twilio, Sendgrid, AWS SES, etc.).
  - No cloud storage or media CDNs (Cloudinary, AWS S3, etc.).
  - No remote cloud databases; connection configuration points strictly to a local PostgreSQL instance.
- The project is 100% self-contained locally, fulfilling LedgerGuard’s strict architectural constraints.

---

## 10. License and Reuse Concerns

### 10.1 Verified Upstream Status
- **Source Repository:** Cloned from `https://github.com/KONDIUMAVARALAKSHMI/double-entry-ledger-api.git`.
- **Author:** `kondi varalakshmi <umakondi167@gmail.com>` (initial commit `7669924`).
- **License File Inspection:** No `LICENSE`, `LICENSE.md`, `COPYING`, or `UNLICENSE` file exists anywhere in the repository.
- **`package.json` Inspection:** No `"license"` field exists in `package.json`.

### 10.2 Legal and Engineering Implications
- Under standard international copyright law (Berne Convention), works published without an explicit open-source license retain **All Rights Reserved** by default, granting third parties no express right to reproduce, modify, or distribute the code commercially or publicly.
- **Recommendations for LedgerGuard:**
  1. Use this existing codebase purely as a local learning, reference, and educational base.
  2. For the final LedgerGuard deliverable, all production components, services, and modules should be structured, expanded, or rewritten with original implementation patterns under an explicit license (e.g., MIT or proprietary as required by the project stakeholders).

---

## Summary of Findings: Verified vs. Assumptions

| Domain | Verified Finding | Assumption / Inferred Gap |
|--------|------------------|---------------------------|
| **Stack** | Node.js, Express, PostgreSQL (`pg`), Joi, Jest, Supertest | Assumes Node.js >= 18 and PostgreSQL >= 13 are installed locally |
| **Dependencies** | Declared in `package.json`, but `node_modules` not yet installed | Assumes standard npm registry availability |
| **Database** | Tables `accounts`, `transactions`, `ledger_entries` defined in single migration script | Assumes PostgreSQL service is running and accessible on localhost |
| **Double-Entry** | Transfers enforce balanced debit/credit; Deposits/withdrawals are single-entry | Assumes LedgerGuard will require system clearing accounts for true double-entry |
| **Concurrency** | Bi-directional transfers lock accounts in order of argument, causing deadlocks | Verified via code analysis; test suite has no concurrency tests to expose it |
| **Security** | No external third-party services present; `.env` is gitignored and absent | Assumes local `.env` will be populated with secure non-default credentials |
| **Licensing** | Upstream repository contains no license file or `package.json` license field | Assumes codebase is currently usable solely for private/local development |
