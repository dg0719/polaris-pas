import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type { BillingInvoiceRow, TenantCtx } from './shared.ts';

// ─── Billing invoices ────────────────────────────────────────────────────
// One row per invoice on a policy's schedule (`billing_invoices`); split
// from `billingItems.ts` to keep both files under the project's size
// ceiling. Line items live in `billingItems.ts`.

export function insertInvoice(
  db: Db,
  ctx: TenantCtx,
  input: Omit<BillingInvoiceRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
): BillingInvoiceRow {
  const ts = nowIso();
  const row: BillingInvoiceRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO billing_invoices
       (id, tenant_id, account_id, policy_id, stream_id, invoice_number, sequence,
        term_number, event_date, bill_date, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.policy_id,
    row.stream_id,
    row.invoice_number,
    row.sequence,
    row.term_number,
    row.event_date,
    row.bill_date,
    row.due_date,
    row.status,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getInvoice(db: Db, ctx: TenantCtx, id: string): BillingInvoiceRow | null {
  return one<BillingInvoiceRow>(
    db.prepare('SELECT * FROM billing_invoices WHERE tenant_id = ? AND id = ?').get(ctx.tenantId, id),
  );
}

export function listInvoicesForPolicy(db: Db, ctx: TenantCtx, policyId: string): BillingInvoiceRow[] {
  return many<BillingInvoiceRow>(
    db
      .prepare(
        'SELECT * FROM billing_invoices WHERE tenant_id = ? AND policy_id = ? ORDER BY sequence ASC',
      )
      .all(ctx.tenantId, policyId),
  );
}

export function listInvoicesForAccount(db: Db, ctx: TenantCtx, accountId: string): BillingInvoiceRow[] {
  return many<BillingInvoiceRow>(
    db
      .prepare(
        'SELECT * FROM billing_invoices WHERE tenant_id = ? AND account_id = ? ORDER BY due_date ASC',
      )
      .all(ctx.tenantId, accountId),
  );
}

/**
 * Planned invoices whose bill date has arrived, oldest first — what the
 * billing day sends out. Limited: the caller repeats until nothing is left,
 * so a carrier's whole book never lands in memory at once.
 */
export function listInvoicesToBill(
  db: Db,
  ctx: TenantCtx,
  date: string,
  limit: number,
): BillingInvoiceRow[] {
  return many<BillingInvoiceRow>(
    db
      .prepare(
        `SELECT * FROM billing_invoices
          WHERE tenant_id = ? AND status = 'planned' AND bill_date <= ?
          ORDER BY bill_date ASC, sequence ASC LIMIT ?`,
      )
      .all(ctx.tenantId, date, limit),
  );
}

export function updateInvoiceStatus(
  db: Db,
  ctx: TenantCtx,
  id: string,
  status: BillingInvoiceRow['status'],
): void {
  db.prepare(
    'UPDATE billing_invoices SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
  ).run(status, nowIso(), ctx.tenantId, id);
}

/** The next `sequence` for a new invoice on this policy's schedule. */
export function nextInvoiceSequence(db: Db, ctx: TenantCtx, policyId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM billing_invoices WHERE tenant_id = ? AND policy_id = ?',
    )
    .get(ctx.tenantId, policyId) as { max_seq: number };
  return row.max_seq + 1;
}
