import type { Db } from '../db.ts';
import { many, newId, nowIso } from './shared.ts';
import type { PaymentRow, TenantCtx, TransactionRow } from './shared.ts';

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

// --- Payments -----------------------------------------------------------
// Invoices and payment applications moved to `repo/billingItems.ts` and
// `repo/billingInvoices.ts` (migration 002); this module keeps only the
// ledger-agnostic transaction and payment records.

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
       (id, tenant_id, account_id, amount_cents, method, reference, received_at,
        created_at, status, created_by, policy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.amount_cents,
    row.method,
    row.reference,
    row.received_at,
    row.created_at,
    row.status,
    row.created_by,
    row.policy_id,
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
