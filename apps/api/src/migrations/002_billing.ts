import { randomUUID } from 'node:crypto';
import { DEFAULT_CHARGE_PATTERNS, DEFAULT_PAYMENT_PLANS, DEFAULT_TAX_RATES, LEDGER_ACCOUNTS, postingsFor } from '@polaris/domain';
import type { JournalEntryInput } from '@polaris/domain';
import type { Db } from '../db.ts';
import type { Migration } from './index.ts';
import { TABLES } from './002_billing.sql.ts';

function now(): string {
  return new Date().toISOString();
}

/** Seed the catalogue for one tenant. Also called by bootstrap for new tenants (Task 9). */
export function seedBillingCatalogue(db: Db, tenantId: string): void {
  const ts = now();
  for (const p of DEFAULT_CHARGE_PATTERNS) {
    db.prepare(`INSERT OR IGNORE INTO charge_patterns (id, tenant_id, code, name, kind, category, invoicing, priority, commissionable, taxable, filing_reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), tenantId, p.code, p.name, p.kind, p.category, p.invoicing, p.priority, p.commissionable ? 1 : 0, p.taxable ? 1 : 0, p.filingReference, ts);
  }
  for (const p of DEFAULT_PAYMENT_PLANS) {
    db.prepare(`INSERT OR IGNORE INTO payment_plans (id, tenant_id, code, name, down_payment_bps, installments, periodicity, fee_pattern_code, fee_bps, fee_cap_bps, renewal_down_payment_bps, products_json, provinces_json, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(randomUUID(), tenantId, p.code, p.name, p.downPaymentBps, p.installments, p.periodicity, p.feePatternCode, p.feeBps, p.feeCapBps, p.renewalDownPaymentBps, JSON.stringify(p.products), JSON.stringify(p.provinces), ts);
  }
  for (const r of DEFAULT_TAX_RATES) {
    db.prepare(`INSERT OR IGNORE INTO tax_rates (id, tenant_id, code, province, line, rate_bps, effective_from, effective_to, applies_on, pattern_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), tenantId, r.code, r.province, r.line, r.rateBps, r.effectiveFrom, r.effectiveTo, r.appliesOn, r.patternCode, ts);
  }
  for (const [code, acct] of Object.entries(LEDGER_ACCOUNTS)) {
    db.prepare(`INSERT OR IGNORE INTO ledger_accounts (id, tenant_id, code, name, side, gl_code, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`).run(randomUUID(), tenantId, code, acct.name, acct.side, ts);
  }
}

function writeEntry(db: Db, tenantId: string, entry: JournalEntryInput): void {
  const id = randomUUID();
  db.prepare(`INSERT INTO journal_entries (id, tenant_id, posted_at, effective_date, event_type, reference_kind, reference_id, actor_user_id, reversal_of, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`).run(id, tenantId, now(), entry.effectiveDate, entry.eventType, entry.referenceKind, entry.referenceId, entry.reason);
  for (const l of entry.lines) {
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, entry_id, account_code, account_id, policy_id, producer_id, province, method, debit_cents, credit_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), tenantId, id, l.account, l.dimension.accountId ?? null, l.dimension.policyId ?? null, l.dimension.producerId ?? null, l.dimension.province ?? null, l.dimension.method ?? null, l.debitCents, l.creditCents);
  }
}

interface LegacyInvoice { id: string; tenant_id: string; account_id: string; policy_id: string; invoice_number: string; sequence: number; term_number: number; due_date: string; amount_cents: number; paid_cents: number; status: string }

/** One premium charge and one item per non-void legacy invoice; postings to match. */
function convertLegacy(db: Db): void {
  const ts = now();
  const invoices = db.prepare(`SELECT * FROM invoices WHERE status <> 'void' ORDER BY tenant_id, policy_id, sequence`).all() as unknown as LegacyInvoice[];
  const streams = new Map<string, string>();
  const instructions = new Map<string, string>();
  const itemByInvoice = new Map<string, string>();
  for (const inv of invoices) {
    const policy = db.prepare('SELECT * FROM policies WHERE id = ?').get(inv.policy_id) as { billing_plan: string } | undefined;
    const version = db.prepare('SELECT id, term_start FROM policy_versions WHERE policy_id = ? ORDER BY version_number LIMIT 1').get(inv.policy_id) as { id: string; term_start: string } | undefined;
    const account = db.prepare('SELECT province FROM accounts WHERE id = ?').get(inv.account_id) as { province: string };
    let streamId = streams.get(inv.policy_id);
    if (!streamId) {
      streamId = randomUUID();
      db.prepare(`INSERT INTO invoice_streams (id, tenant_id, account_id, policy_id, anchor_date, periodicity, lead_days, created_at) VALUES (?, ?, ?, ?, ?, 'monthly', 21, ?)`)
        .run(streamId, inv.tenant_id, inv.account_id, inv.policy_id, version?.term_start ?? inv.due_date, ts);
      streams.set(inv.policy_id, streamId);
    }
    let instructionId = instructions.get(inv.policy_id);
    if (!instructionId) {
      instructionId = randomUUID();
      db.prepare(`INSERT INTO billing_instructions (id, tenant_id, policy_id, policy_version_id, transaction_id, type, payment_plan_code, billing_method, effective_date, created_at)
        VALUES (?, ?, ?, ?, NULL, 'adjustment', ?, 'direct', ?, ?)`).run(instructionId, inv.tenant_id, inv.policy_id, version?.id ?? 'legacy', policy?.billing_plan ?? 'monthly', inv.due_date, ts);
      instructions.set(inv.policy_id, instructionId);
    }
    const chargeId = randomUUID();
    db.prepare(`INSERT INTO charges (id, tenant_id, instruction_id, account_id, policy_id, pattern_code, amount_cents, effective_date, province, line, created_at) VALUES (?, ?, ?, ?, ?, 'PREMIUM', ?, ?, ?, 'auto', ?)`)
      .run(chargeId, inv.tenant_id, instructionId, inv.account_id, inv.policy_id, inv.amount_cents, inv.due_date, account.province, ts);
    const invoiceId = randomUUID();
    db.prepare(`INSERT INTO billing_invoices (id, tenant_id, account_id, policy_id, stream_id, invoice_number, sequence, term_number, event_date, bill_date, due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invoiceId, inv.tenant_id, inv.account_id, inv.policy_id, streamId, inv.invoice_number, inv.sequence, inv.term_number, inv.due_date, inv.due_date, inv.due_date, inv.status === 'paid' ? 'paid' : 'billed', ts, ts);
    const itemId = randomUUID();
    db.prepare(`INSERT INTO invoice_items (id, tenant_id, charge_id, invoice_id, account_id, policy_id, kind, pattern_code, amount_cents, event_date, sequence, paid_cents, offsets_item_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'installment', 'PREMIUM', ?, ?, 1, ?, NULL, ?)`)
      .run(itemId, inv.tenant_id, chargeId, invoiceId, inv.account_id, inv.policy_id, inv.amount_cents, inv.due_date, inv.paid_cents, ts);
    itemByInvoice.set(inv.id, itemId);
    writeEntry(db, inv.tenant_id, postingsFor({ type: 'chargeBilled', category: 'premium', amountCents: inv.amount_cents, effectiveDate: inv.due_date, chargeId, accountId: inv.account_id, policyId: inv.policy_id, province: account.province }));
  }
  const payments = db.prepare('SELECT * FROM payments').all() as { id: string; tenant_id: string; account_id: string; amount_cents: number; method: string; received_at: string }[];
  for (const p of payments) {
    writeEntry(db, p.tenant_id, postingsFor({ type: 'paymentReceived', amountCents: p.amount_cents, effectiveDate: p.received_at, paymentId: p.id, accountId: p.account_id, method: p.method }));
    const apps = db.prepare('SELECT * FROM payment_applications WHERE payment_id = ?').all(p.id) as { id: string; invoice_id: string; amount_cents: number; created_at: string }[];
    for (const a of apps) {
      const itemId = itemByInvoice.get(a.invoice_id);
      if (!itemId) continue;
      const policyId = (db.prepare('SELECT policy_id FROM invoice_items WHERE id = ?').get(itemId) as { policy_id: string }).policy_id;
      const appId = randomUUID();
      db.prepare(`INSERT INTO item_applications (id, tenant_id, payment_id, item_id, amount_cents, reversed_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`).run(appId, p.tenant_id, p.id, itemId, a.amount_cents, a.created_at);
      writeEntry(db, p.tenant_id, postingsFor({ type: 'distribution', amountCents: a.amount_cents, effectiveDate: p.received_at, applicationId: appId, accountId: p.account_id, policyId }));
    }
  }
  db.exec('ALTER TABLE invoices RENAME TO legacy_invoices');
  db.exec('ALTER TABLE payment_applications RENAME TO legacy_payment_applications');
}

export const billing: Migration = {
  id: 2,
  name: 'billing',
  up(db: Db) {
    db.exec(TABLES);
    for (const t of db.prepare('SELECT id FROM tenants').all() as { id: string }[]) seedBillingCatalogue(db, t.id);
    convertLegacy(db);
  },
};
