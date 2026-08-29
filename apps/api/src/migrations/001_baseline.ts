import type { Db } from '../db.ts';
import type { Migration } from './index.ts';

/** The schema as it stood at v4 (claims). Every table uses IF NOT EXISTS, so a v4 file is adopted as-is. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  policy_prefix    TEXT NOT NULL,
  claim_prefix     TEXT NOT NULL,
  next_policy_seq  INTEGER NOT NULL DEFAULT 1,
  next_account_seq INTEGER NOT NULL DEFAULT 1,
  next_claim_seq   INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('csr','underwriter','adjuster','claims_supervisor','admin')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  api_key        TEXT NOT NULL UNIQUE,
  authority_limit_cents INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS claims (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  account_id         TEXT NOT NULL REFERENCES accounts(id),
  policy_id          TEXT NOT NULL REFERENCES policies(id),
  policy_version_id  TEXT NOT NULL REFERENCES policy_versions(id),
  claim_number       TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('Open','Closed')),
  loss_date          TEXT NOT NULL,
  reported_date      TEXT NOT NULL,
  loss_cause         TEXT NOT NULL,
  description        TEXT NOT NULL,
  loss_location      TEXT,
  assigned_user_id   TEXT REFERENCES users(id),
  fraud_flags_json   TEXT NOT NULL DEFAULT '[]',
  created_by         TEXT NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_tenant_number ON claims(tenant_id, claim_number);
CREATE INDEX IF NOT EXISTS claims_tenant_status ON claims(tenant_id, status);
CREATE INDEX IF NOT EXISTS claims_tenant_policy ON claims(tenant_id, policy_id);
CREATE INDEX IF NOT EXISTS claims_tenant_account ON claims(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS claims_tenant_adjuster ON claims(tenant_id, assigned_user_id, status);

CREATE TABLE IF NOT EXISTS claim_exposures (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  claim_id          TEXT NOT NULL REFERENCES claims(id),
  coverage_code     TEXT NOT NULL,
  coverage_name     TEXT NOT NULL,
  risk_item_id      TEXT,
  risk_item_label   TEXT,
  claimant_name     TEXT NOT NULL,
  claimant_kind     TEXT NOT NULL CHECK (claimant_kind IN ('insured','thirdParty')),
  deductible_cents  INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('Open','Closed')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_exposures_claim ON claim_exposures(tenant_id, claim_id);

CREATE TABLE IF NOT EXISTS claim_reserve_movements (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  claim_id       TEXT NOT NULL REFERENCES claims(id),
  exposure_id    TEXT NOT NULL REFERENCES claim_exposures(id),
  category       TEXT NOT NULL CHECK (category IN ('indemnity','expense')),
  amount_cents   INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_reserves_exposure
  ON claim_reserve_movements(tenant_id, exposure_id, created_at);
CREATE INDEX IF NOT EXISTS claim_reserves_claim
  ON claim_reserve_movements(tenant_id, claim_id, created_at);

CREATE TABLE IF NOT EXISTS claim_payments (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id),
  claim_id                  TEXT NOT NULL REFERENCES claims(id),
  exposure_id               TEXT NOT NULL REFERENCES claim_exposures(id),
  category                  TEXT NOT NULL CHECK (category IN ('indemnity','expense')),
  amount_cents              INTEGER NOT NULL,
  deductible_applied_cents  INTEGER NOT NULL DEFAULT 0,
  payee_name                TEXT NOT NULL,
  payee_kind                TEXT NOT NULL CHECK (payee_kind IN ('insured','claimant','vendor','other')),
  method                    TEXT NOT NULL CHECK (method IN ('cheque','eft')),
  memo                      TEXT,
  status                    TEXT NOT NULL CHECK (status IN ('Requested','Approved','Issued','Rejected','Voided')),
  requested_by              TEXT NOT NULL REFERENCES users(id),
  approved_by               TEXT REFERENCES users(id),
  decision_note             TEXT,
  issued_at                 TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_payments_claim ON claim_payments(tenant_id, claim_id);
CREATE INDEX IF NOT EXISTS claim_payments_status ON claim_payments(tenant_id, status);

CREATE TABLE IF NOT EXISTS claim_recoveries (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  claim_id        TEXT NOT NULL REFERENCES claims(id),
  exposure_id     TEXT NOT NULL REFERENCES claim_exposures(id),
  recovery_type   TEXT NOT NULL CHECK (recovery_type IN ('subrogation','salvage','deductible')),
  category        TEXT NOT NULL CHECK (category IN ('indemnity','expense')),
  counterparty    TEXT NOT NULL,
  expected_cents  INTEGER NOT NULL,
  received_cents  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('Open','Recovered','Closed')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_recoveries_claim ON claim_recoveries(tenant_id, claim_id);

CREATE TABLE IF NOT EXISTS claim_events (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  claim_id       TEXT NOT NULL REFERENCES claims(id),
  action         TEXT NOT NULL,
  subject_kind   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  detail         TEXT,
  actor_user_id  TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_events_claim ON claim_events(tenant_id, claim_id, created_at);

CREATE TABLE IF NOT EXISTS claim_notes (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  claim_id       TEXT NOT NULL REFERENCES claims(id),
  body           TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_notes_claim ON claim_notes(tenant_id, claim_id, created_at);

CREATE TABLE IF NOT EXISTS claim_tasks (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  claim_id          TEXT NOT NULL REFERENCES claims(id),
  subject           TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  assigned_user_id  TEXT NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL CHECK (status IN ('open','done')),
  created_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_tasks_diary
  ON claim_tasks(tenant_id, assigned_user_id, status, due_date);
CREATE INDEX IF NOT EXISTS claim_tasks_claim ON claim_tasks(tenant_id, claim_id);
`;

export const baseline: Migration = {
  id: 1,
  name: 'baseline',
  up(db: Db) {
    db.exec(SCHEMA);
  },
};
