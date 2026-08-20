import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** Bump when the schema changes shape. Older files are rejected, not migrated. */
export const SCHEMA_VERSION = 3;

/**
 * Schema notes:
 * - Every business table carries `tenant_id`; all repository reads are scoped
 *   by it. Tenant isolation is enforced in one place (see repo.ts).
 * - Money is always integer cents. Dates are ISO-8601 strings (UTC).
 * - An account is the customer of record; policies hang off it.
 * - A policy is a container; each transaction (new business, endorsement,
 *   renewal, cancellation) appends an immutable `policy_versions` snapshot.
 * - Invoices are the installment schedule. They are reconciled against the
 *   policy's transactions rather than edited in place by each job type.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  policy_prefix    TEXT NOT NULL,
  next_policy_seq  INTEGER NOT NULL DEFAULT 1,
  next_account_seq INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('csr','underwriter','admin')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  api_key        TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email ON users(tenant_id, email);

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  account_number  TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('person','organization')),
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  address_line1   TEXT NOT NULL,
  address_line2   TEXT,
  city            TEXT NOT NULL,
  province        TEXT NOT NULL,
  postal_code     TEXT NOT NULL,
  producer_code   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_tenant_number ON accounts(tenant_id, account_number);
CREATE INDEX IF NOT EXISTS accounts_tenant_name ON accounts(tenant_id, name);

CREATE TABLE IF NOT EXISTS policies (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  account_id     TEXT NOT NULL REFERENCES accounts(id),
  policy_number  TEXT NOT NULL,
  product_code   TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('InForce','Cancelled','Expired')),
  billing_plan   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS policies_tenant_number ON policies(tenant_id, policy_number);
CREATE INDEX IF NOT EXISTS policies_tenant_account ON policies(tenant_id, account_id);

CREATE TABLE IF NOT EXISTS policy_versions (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id),
  policy_id             TEXT NOT NULL REFERENCES policies(id),
  version_number        INTEGER NOT NULL,
  term_number           INTEGER NOT NULL,
  transaction_type      TEXT NOT NULL,
  effective_date        TEXT NOT NULL,
  term_start            TEXT NOT NULL,
  term_end              TEXT NOT NULL,
  risk_json             TEXT NOT NULL,
  quote_json            TEXT NOT NULL,
  annual_premium_cents  INTEGER NOT NULL,
  job_id                TEXT NOT NULL,
  created_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_versions_seq
  ON policy_versions(tenant_id, policy_id, version_number);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  job_type        TEXT NOT NULL CHECK (job_type IN ('Submission','PolicyChange','Renewal','Cancellation')),
  status          TEXT NOT NULL,
  policy_id       TEXT REFERENCES policies(id),
  product_code    TEXT NOT NULL,
  billing_plan    TEXT NOT NULL,
  effective_date  TEXT NOT NULL,
  term_start      TEXT NOT NULL,
  term_end        TEXT NOT NULL,
  risk_json       TEXT NOT NULL,
  quote_json      TEXT,
  uw_approved     INTEGER NOT NULL DEFAULT 0,
  uw_note         TEXT,
  cancel_reason   TEXT,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_tenant_status ON jobs(tenant_id, status);
CREATE INDEX IF NOT EXISTS jobs_tenant_policy ON jobs(tenant_id, policy_id);
CREATE INDEX IF NOT EXISTS jobs_tenant_account ON jobs(tenant_id, account_id);

CREATE TABLE IF NOT EXISTS job_events (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  job_id          TEXT NOT NULL REFERENCES jobs(id),
  action          TEXT NOT NULL,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  actor_user_id   TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_events_job ON job_events(tenant_id, job_id, created_at);

CREATE TABLE IF NOT EXISTS transactions (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  policy_id          TEXT NOT NULL REFERENCES policies(id),
  policy_version_id  TEXT NOT NULL REFERENCES policy_versions(id),
  job_id             TEXT NOT NULL REFERENCES jobs(id),
  type               TEXT NOT NULL,
  effective_date     TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_policy ON transactions(tenant_id, policy_id, created_at);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  policy_id       TEXT NOT NULL REFERENCES policies(id),
  invoice_number  TEXT NOT NULL,
  sequence        INTEGER NOT NULL,
  term_number     INTEGER NOT NULL,
  due_date        TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  paid_cents      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('open','paid','void')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_policy ON invoices(tenant_id, policy_id, sequence);
CREATE INDEX IF NOT EXISTS invoices_account ON invoices(tenant_id, account_id, due_date);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  amount_cents  INTEGER NOT NULL,
  method        TEXT NOT NULL CHECK (method IN ('card','eft','cheque','cash')),
  reference     TEXT,
  received_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_account ON payments(tenant_id, account_id, received_at);

CREATE TABLE IF NOT EXISTS payment_applications (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  payment_id    TEXT NOT NULL REFERENCES payments(id),
  invoice_id    TEXT NOT NULL REFERENCES invoices(id),
  amount_cents  INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_applications_invoice
  ON payment_applications(tenant_id, invoice_id);
`;

export class SchemaVersionError extends Error {}

function assertCompatible(db: Db, target: string): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const version = row?.user_version ?? 0;
  if (version === SCHEMA_VERSION) return;

  const populated =
    (
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
        n: number;
      }
    ).n > 0;

  if (populated && version !== SCHEMA_VERSION) {
    throw new SchemaVersionError(
      `Database ${target} is schema v${version}, expected v${SCHEMA_VERSION}. ` +
        `There is no migration path yet: delete the file and re-run \`npm run seed\`.`,
    );
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export function openDb(file?: string): Db {
  const target = file ?? process.env.POLARIS_DB ?? 'polaris.db';
  const db = new DatabaseSync(target);
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  assertCompatible(db, target);
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction, rolling back on any thrown error. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
