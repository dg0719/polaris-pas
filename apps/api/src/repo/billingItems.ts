import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type {
  BillingInstructionRow,
  ChargeRow,
  InvoiceItemRow,
  InvoiceStreamRow,
  ItemApplicationRow,
  TenantCtx,
} from './shared.ts';

// ─── Billing instructions, charges, streams, items and applications ────────
// The chain a job's billing produces: an instruction records why a policy
// is being billed, charges are the amounts, an invoice stream anchors the
// schedule, invoice items are the billable lines on an invoice, and item
// applications record how a payment settled them. Invoices themselves live
// in `repo/billingInvoices.ts` (split out to stay under the file-size
// ceiling).

// ─── Billing instructions ───────────────────────────────────────────────

export function insertInstruction(
  db: Db,
  ctx: TenantCtx,
  input: Omit<BillingInstructionRow, 'id' | 'tenant_id' | 'created_at'>,
): BillingInstructionRow {
  const row: BillingInstructionRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO billing_instructions
       (id, tenant_id, policy_id, policy_version_id, transaction_id, type,
        payment_plan_code, billing_method, effective_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.policy_id,
    row.policy_version_id,
    row.transaction_id,
    row.type,
    row.payment_plan_code,
    row.billing_method,
    row.effective_date,
    row.created_at,
  );
  return row;
}

// ─── Charges ─────────────────────────────────────────────────────────────

export function insertCharge(
  db: Db,
  ctx: TenantCtx,
  input: Omit<ChargeRow, 'id' | 'tenant_id' | 'created_at'>,
): ChargeRow {
  const row: ChargeRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO charges
       (id, tenant_id, instruction_id, account_id, policy_id, pattern_code,
        amount_cents, effective_date, province, line, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.instruction_id,
    row.account_id,
    row.policy_id,
    row.pattern_code,
    row.amount_cents,
    row.effective_date,
    row.province,
    row.line,
    row.created_at,
  );
  return row;
}

export function listChargesForPolicy(db: Db, ctx: TenantCtx, policyId: string): ChargeRow[] {
  return many<ChargeRow>(
    db
      .prepare(
        'SELECT * FROM charges WHERE tenant_id = ? AND policy_id = ? ORDER BY effective_date ASC',
      )
      .all(ctx.tenantId, policyId),
  );
}

// ─── Invoice streams ─────────────────────────────────────────────────────

export function insertStream(
  db: Db,
  ctx: TenantCtx,
  input: Omit<InvoiceStreamRow, 'id' | 'tenant_id' | 'created_at'>,
): InvoiceStreamRow {
  const row: InvoiceStreamRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO invoice_streams
       (id, tenant_id, account_id, policy_id, anchor_date, periodicity, lead_days, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.policy_id,
    row.anchor_date,
    row.periodicity,
    row.lead_days,
    row.created_at,
  );
  return row;
}

export function getStreamForPolicy(db: Db, ctx: TenantCtx, policyId: string): InvoiceStreamRow | null {
  return one<InvoiceStreamRow>(
    db
      .prepare(
        `SELECT * FROM invoice_streams
          WHERE tenant_id = ? AND policy_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(ctx.tenantId, policyId),
  );
}

// ─── Invoice items ───────────────────────────────────────────────────────

export function insertItem(
  db: Db,
  ctx: TenantCtx,
  input: Omit<InvoiceItemRow, 'id' | 'tenant_id' | 'created_at' | 'paid_cents'>,
): InvoiceItemRow {
  const row: InvoiceItemRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    paid_cents: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO invoice_items
       (id, tenant_id, charge_id, invoice_id, account_id, policy_id, kind,
        pattern_code, amount_cents, event_date, sequence, paid_cents,
        offsets_item_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.charge_id,
    row.invoice_id,
    row.account_id,
    row.policy_id,
    row.kind,
    row.pattern_code,
    row.amount_cents,
    row.event_date,
    row.sequence,
    row.paid_cents,
    row.offsets_item_id,
    row.created_at,
  );
  return row;
}

export function listItemsForInvoice(db: Db, ctx: TenantCtx, invoiceId: string): InvoiceItemRow[] {
  return many<InvoiceItemRow>(
    db
      .prepare(
        'SELECT * FROM invoice_items WHERE tenant_id = ? AND invoice_id = ? ORDER BY sequence ASC',
      )
      .all(ctx.tenantId, invoiceId),
  );
}

export function listItemsForPolicy(db: Db, ctx: TenantCtx, policyId: string): InvoiceItemRow[] {
  return many<InvoiceItemRow>(
    db
      .prepare(
        'SELECT * FROM invoice_items WHERE tenant_id = ? AND policy_id = ? ORDER BY event_date ASC',
      )
      .all(ctx.tenantId, policyId),
  );
}

export function listItemsForAccount(db: Db, ctx: TenantCtx, accountId: string): InvoiceItemRow[] {
  return many<InvoiceItemRow>(
    db
      .prepare(
        'SELECT * FROM invoice_items WHERE tenant_id = ? AND account_id = ? ORDER BY event_date ASC',
      )
      .all(ctx.tenantId, accountId),
  );
}

export function setItemPaid(db: Db, ctx: TenantCtx, itemId: string, paidCents: number): void {
  db.prepare('UPDATE invoice_items SET paid_cents = ? WHERE tenant_id = ? AND id = ?').run(
    paidCents,
    ctx.tenantId,
    itemId,
  );
}

// ─── Item applications ───────────────────────────────────────────────────

export function insertItemApplication(
  db: Db,
  ctx: TenantCtx,
  input: Omit<ItemApplicationRow, 'id' | 'tenant_id' | 'created_at' | 'reversed_by'>,
): ItemApplicationRow {
  const row: ItemApplicationRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    reversed_by: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO item_applications
       (id, tenant_id, payment_id, item_id, amount_cents, reversed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.payment_id,
    row.item_id,
    row.amount_cents,
    row.reversed_by,
    row.created_at,
  );
  return row;
}

export function listItemApplicationsForPayment(
  db: Db,
  ctx: TenantCtx,
  paymentId: string,
): ItemApplicationRow[] {
  return many<ItemApplicationRow>(
    db
      .prepare(
        'SELECT * FROM item_applications WHERE tenant_id = ? AND payment_id = ? ORDER BY created_at ASC',
      )
      .all(ctx.tenantId, paymentId),
  );
}
