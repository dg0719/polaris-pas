// ─── Migration 002 schema ────────────────────────────────────────────────
// The billing tables: catalogue (charge patterns, payment plans, tax rates,
// chart of accounts), the ledger (journal entries/lines), and the new
// billing instruction -> charge -> invoice -> item -> application chain.
// Kept in its own file because the combined block pushes 002_billing.ts
// past the project's file-size ceiling.

export const TABLES = `
CREATE TABLE IF NOT EXISTS charge_patterns (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('prorata','immediate','passthrough')),
  category TEXT NOT NULL CHECK (category IN ('premium','tax','fee','other')),
  invoicing TEXT NOT NULL CHECK (invoicing IN ('spread','single')), priority INTEGER NOT NULL,
  commissionable INTEGER NOT NULL, taxable INTEGER NOT NULL, filing_reference TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS charge_patterns_code ON charge_patterns(tenant_id, code);

CREATE TABLE IF NOT EXISTS payment_plans (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, name TEXT NOT NULL,
  down_payment_bps INTEGER NOT NULL, installments INTEGER NOT NULL,
  periodicity TEXT NOT NULL CHECK (periodicity IN ('monthly','quarterly','annual')),
  fee_pattern_code TEXT, fee_bps INTEGER NOT NULL, fee_cap_bps INTEGER, renewal_down_payment_bps INTEGER,
  products_json TEXT NOT NULL, provinces_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS payment_plans_code ON payment_plans(tenant_id, code);

CREATE TABLE IF NOT EXISTS tax_rates (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, province TEXT NOT NULL, line TEXT NOT NULL,
  rate_bps INTEGER NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
  applies_on TEXT NOT NULL CHECK (applies_on IN ('billed','paid')), pattern_code TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tax_rates_lookup ON tax_rates(tenant_id, province, line, effective_from);

CREATE TABLE IF NOT EXISTS ledger_accounts (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('debit','credit')), gl_code TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_code ON ledger_accounts(tenant_id, code);

CREATE TABLE IF NOT EXISTS journal_entries (id TEXT PRIMARY KEY, tenant_id, posted_at TEXT NOT NULL, effective_date TEXT NOT NULL,
  event_type TEXT NOT NULL, reference_kind TEXT NOT NULL, reference_id TEXT NOT NULL, actor_user_id TEXT,
  reversal_of TEXT REFERENCES journal_entries(id), reason TEXT);
CREATE INDEX IF NOT EXISTS journal_entries_ref ON journal_entries(tenant_id, reference_kind, reference_id);
CREATE INDEX IF NOT EXISTS journal_entries_date ON journal_entries(tenant_id, effective_date);

CREATE TABLE IF NOT EXISTS journal_lines (id TEXT PRIMARY KEY, tenant_id, entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL, account_id TEXT, policy_id TEXT, producer_id TEXT, province TEXT, method TEXT,
  debit_cents INTEGER NOT NULL DEFAULT 0, credit_cents INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(tenant_id, account_code, account_id);
CREATE INDEX IF NOT EXISTS journal_lines_policy ON journal_lines(tenant_id, account_code, policy_id);
CREATE INDEX IF NOT EXISTS journal_lines_entry ON journal_lines(tenant_id, entry_id);

CREATE TABLE IF NOT EXISTS billing_instructions (id TEXT PRIMARY KEY, tenant_id, policy_id TEXT NOT NULL REFERENCES policies(id),
  policy_version_id TEXT NOT NULL, transaction_id TEXT, type TEXT NOT NULL, payment_plan_code TEXT NOT NULL,
  billing_method TEXT NOT NULL DEFAULT 'direct', effective_date TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS billing_instructions_policy ON billing_instructions(tenant_id, policy_id);

CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, tenant_id, instruction_id TEXT NOT NULL REFERENCES billing_instructions(id),
  account_id TEXT NOT NULL, policy_id TEXT NOT NULL, pattern_code TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  effective_date TEXT NOT NULL, province TEXT NOT NULL, line TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS charges_policy ON charges(tenant_id, policy_id);

CREATE TABLE IF NOT EXISTS invoice_streams (id TEXT PRIMARY KEY, tenant_id, account_id TEXT NOT NULL, policy_id TEXT,
  anchor_date TEXT NOT NULL, periodicity TEXT NOT NULL, lead_days INTEGER NOT NULL DEFAULT 21, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS invoice_streams_account ON invoice_streams(tenant_id, account_id);

CREATE TABLE IF NOT EXISTS billing_invoices (id TEXT PRIMARY KEY, tenant_id, account_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  stream_id TEXT NOT NULL REFERENCES invoice_streams(id), invoice_number TEXT NOT NULL, sequence INTEGER NOT NULL,
  term_number INTEGER NOT NULL, event_date TEXT NOT NULL, bill_date TEXT NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','billed','paid','void')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_number ON billing_invoices(tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS billing_invoices_policy ON billing_invoices(tenant_id, policy_id, sequence);
CREATE INDEX IF NOT EXISTS billing_invoices_account ON billing_invoices(tenant_id, account_id, due_date);
CREATE INDEX IF NOT EXISTS billing_invoices_bill ON billing_invoices(tenant_id, status, bill_date);

CREATE TABLE IF NOT EXISTS invoice_items (id TEXT PRIMARY KEY, tenant_id, charge_id TEXT NOT NULL REFERENCES charges(id),
  invoice_id TEXT NOT NULL REFERENCES billing_invoices(id), account_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('downPayment','installment','oneTime','fee','tax')), pattern_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, event_date TEXT NOT NULL, sequence INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0, offsets_item_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS invoice_items_invoice ON invoice_items(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS invoice_items_policy ON invoice_items(tenant_id, policy_id);
CREATE INDEX IF NOT EXISTS invoice_items_account ON invoice_items(tenant_id, account_id, event_date);

CREATE TABLE IF NOT EXISTS item_applications (id TEXT PRIMARY KEY, tenant_id, payment_id TEXT NOT NULL REFERENCES payments(id),
  item_id TEXT NOT NULL REFERENCES invoice_items(id), amount_cents INTEGER NOT NULL, reversed_by TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS item_applications_item ON item_applications(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS item_applications_payment ON item_applications(tenant_id, payment_id);

CREATE TABLE IF NOT EXISTS billing_runs (id TEXT PRIMARY KEY, tenant_id, run_date TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, summary_json TEXT NOT NULL DEFAULT '{}');
CREATE UNIQUE INDEX IF NOT EXISTS billing_runs_date ON billing_runs(tenant_id, run_date);

CREATE TABLE IF NOT EXISTS earning_snapshots (id TEXT PRIMARY KEY, tenant_id, policy_version_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  as_of TEXT NOT NULL, written_cents INTEGER NOT NULL, earned_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS earning_snapshots_version ON earning_snapshots(tenant_id, policy_version_id, as_of);

ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'cleared';
ALTER TABLE payments ADD COLUMN created_by TEXT;
ALTER TABLE payments ADD COLUMN policy_id TEXT;
`;
