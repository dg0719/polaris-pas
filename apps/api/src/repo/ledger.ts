import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type {
  InvoiceRow,
  PaymentApplicationRow,
  PaymentRow,
  TenantCtx,
  TransactionRow,
} from './shared.ts';

// ─── Transactions ───────────────────────────────────────────────────────────

export function insertTransaction(
  db: Db,
  ctx: TenantCtx,
  input: Omit<TransactionRow, 'id' | 'tenant_id' | 'created_at'>,
): TransactionRow {
  const row: TransactionRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO transactions
       (id, tenant_id, policy_id, policy_version_id, job_id, type,
        effective_date, amount_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.policy_id,
    row.policy_version_id,
    row.job_id,
    row.type,
    row.effective_date,
    row.amount_cents,
    row.created_at,
  );
  return row;
}

export function listTransactions(db: Db, ctx: TenantCtx, policyId: string): TransactionRow[] {
  return many<TransactionRow>(
    db
      .prepare(
        'SELECT * FROM transactions WHERE tenant_id = ? AND policy_id = ? ORDER BY created_at ASC',
      )
      .all(ctx.tenantId, policyId),
  );
}

// --- Invoices ---------------------------------------------------------------

export function insertInvoice(
  db: Db,
  ctx: TenantCtx,
  input: Omit<InvoiceRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
): InvoiceRow {
  const ts = nowIso();
  const row: InvoiceRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO invoices
       (id, tenant_id, account_id, policy_id, invoice_number, sequence, term_number,
        due_date, amount_cents, paid_cents, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.policy_id,
    row.invoice_number,
    row.sequence,
    row.term_number,
    row.due_date,
    row.amount_cents,
    row.paid_cents,
    row.status,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function listInvoicesForPolicy(db: Db, ctx: TenantCtx, policyId: string): InvoiceRow[] {
  return many<InvoiceRow>(
    db
      .prepare('SELECT * FROM invoices WHERE tenant_id = ? AND policy_id = ? ORDER BY sequence ASC')
      .all(ctx.tenantId, policyId),
  );
}

export function listInvoicesForAccount(db: Db, ctx: TenantCtx, accountId: string): InvoiceRow[] {
  return many<InvoiceRow>(
    db
      .prepare('SELECT * FROM invoices WHERE tenant_id = ? AND account_id = ? ORDER BY due_date ASC')
      .all(ctx.tenantId, accountId),
  );
}

export function updateInvoice(
  db: Db,
  ctx: TenantCtx,
  invoiceId: string,
  patch: Partial<Pick<InvoiceRow, 'amount_cents' | 'paid_cents' | 'status' | 'due_date'>>,
): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k] as string | number);
  db.prepare(`UPDATE invoices SET ${sets}, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
    ...values,
    nowIso(),
    ctx.tenantId,
    invoiceId,
  );
}

// --- Payments ---------------------------------------------------------------

export function insertPayment(
  db: Db,
  ctx: TenantCtx,
  input: Omit<PaymentRow, 'id' | 'tenant_id' | 'created_at'>,
): PaymentRow {
  const row: PaymentRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO payments
       (id, tenant_id, account_id, amount_cents, method, reference, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.amount_cents,
    row.method,
    row.reference,
    row.received_at,
    row.created_at,
  );
  return row;
}

export function listPayments(db: Db, ctx: TenantCtx, accountId: string): PaymentRow[] {
  return many<PaymentRow>(
    db
      .prepare(
        'SELECT * FROM payments WHERE tenant_id = ? AND account_id = ? ORDER BY received_at DESC',
      )
      .all(ctx.tenantId, accountId),
  );
}

export function insertPaymentApplication(
  db: Db,
  ctx: TenantCtx,
  input: { paymentId: string; invoiceId: string; amountCents: number },
): PaymentApplicationRow {
  const row: PaymentApplicationRow = {
    id: newId(),
    tenant_id: ctx.tenantId,
    payment_id: input.paymentId,
    invoice_id: input.invoiceId,
    amount_cents: input.amountCents,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO payment_applications
       (id, tenant_id, payment_id, invoice_id, amount_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.tenant_id, row.payment_id, row.invoice_id, row.amount_cents, row.created_at);
  return row;
}

export function listPaymentApplications(
  db: Db,
  ctx: TenantCtx,
  invoiceId: string,
): PaymentApplicationRow[] {
  return many<PaymentApplicationRow>(
    db
      .prepare(
        `SELECT * FROM payment_applications
          WHERE tenant_id = ? AND invoice_id = ? ORDER BY created_at ASC`,
      )
      .all(ctx.tenantId, invoiceId),
  );
}
