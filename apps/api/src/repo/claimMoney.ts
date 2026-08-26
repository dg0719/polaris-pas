import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type {
  ClaimPaymentRow,
  ClaimRecoveryRow,
  ReserveMovementRow,
  TenantCtx,
} from './shared.ts';

// ─── Reserve movements (append-only; there is deliberately no update) ───────

export function insertReserveMovement(
  db: Db,
  ctx: TenantCtx,
  input: {
    claimId: string;
    exposureId: string;
    category: ReserveMovementRow['category'];
    amountCents: number;
    reason: string;
  },
): ReserveMovementRow {
  const row: ReserveMovementRow = {
    id: newId(),
    tenant_id: ctx.tenantId,
    claim_id: input.claimId,
    exposure_id: input.exposureId,
    category: input.category,
    amount_cents: input.amountCents,
    reason: input.reason,
    actor_user_id: ctx.userId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO claim_reserve_movements
       (id, tenant_id, claim_id, exposure_id, category, amount_cents, reason,
        actor_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.claim_id,
    row.exposure_id,
    row.category,
    row.amount_cents,
    row.reason,
    row.actor_user_id,
    row.created_at,
  );
  return row;
}

export function listReserveMovements(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
): ReserveMovementRow[] {
  return many<ReserveMovementRow>(
    db
      .prepare(
        `SELECT * FROM claim_reserve_movements
          WHERE tenant_id = ? AND claim_id = ?
          ORDER BY created_at ASC`,
      )
      .all(ctx.tenantId, claimId),
  );
}

// ─── Claim payments ─────────────────────────────────────────────────────────

export function insertClaimPayment(
  db: Db,
  ctx: TenantCtx,
  input: Omit<ClaimPaymentRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
): ClaimPaymentRow {
  const ts = nowIso();
  const row: ClaimPaymentRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO claim_payments
       (id, tenant_id, claim_id, exposure_id, category, amount_cents,
        deductible_applied_cents, payee_name, payee_kind, method, memo, status,
        requested_by, approved_by, decision_note, issued_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.claim_id,
    row.exposure_id,
    row.category,
    row.amount_cents,
    row.deductible_applied_cents,
    row.payee_name,
    row.payee_kind,
    row.method,
    row.memo,
    row.status,
    row.requested_by,
    row.approved_by,
    row.decision_note,
    row.issued_at,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getClaimPayment(
  db: Db,
  ctx: TenantCtx,
  paymentId: string,
): ClaimPaymentRow | null {
  return one<ClaimPaymentRow>(
    db
      .prepare('SELECT * FROM claim_payments WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, paymentId),
  );
}

export function listClaimPayments(db: Db, ctx: TenantCtx, claimId: string): ClaimPaymentRow[] {
  return many<ClaimPaymentRow>(
    db
      .prepare(
        'SELECT * FROM claim_payments WHERE tenant_id = ? AND claim_id = ? ORDER BY created_at ASC',
      )
      .all(ctx.tenantId, claimId),
  );
}

/** Payments awaiting a decision across the tenant, largest first. */
export function listPaymentsAwaitingApproval(db: Db, ctx: TenantCtx): ClaimPaymentRow[] {
  return many<ClaimPaymentRow>(
    db
      .prepare(
        `SELECT * FROM claim_payments
          WHERE tenant_id = ? AND status = 'Requested'
          ORDER BY amount_cents DESC`,
      )
      .all(ctx.tenantId),
  );
}

export function updateClaimPayment(
  db: Db,
  ctx: TenantCtx,
  paymentId: string,
  patch: Partial<Pick<ClaimPaymentRow, 'status' | 'approved_by' | 'decision_note' | 'issued_at'>>,
): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => patch[f as keyof typeof patch] ?? null);
  db.prepare(
    `UPDATE claim_payments SET ${assignments}, updated_at = ? WHERE tenant_id = ? AND id = ?`,
  ).run(...(values as string[]), nowIso(), ctx.tenantId, paymentId);
}

// ─── Recoveries ─────────────────────────────────────────────────────────────

export function insertClaimRecovery(
  db: Db,
  ctx: TenantCtx,
  input: Omit<ClaimRecoveryRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
): ClaimRecoveryRow {
  const ts = nowIso();
  const row: ClaimRecoveryRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO claim_recoveries
       (id, tenant_id, claim_id, exposure_id, recovery_type, category,
        counterparty, expected_cents, received_cents, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.claim_id,
    row.exposure_id,
    row.recovery_type,
    row.category,
    row.counterparty,
    row.expected_cents,
    row.received_cents,
    row.status,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getClaimRecovery(
  db: Db,
  ctx: TenantCtx,
  recoveryId: string,
): ClaimRecoveryRow | null {
  return one<ClaimRecoveryRow>(
    db
      .prepare('SELECT * FROM claim_recoveries WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, recoveryId),
  );
}

export function listClaimRecoveries(db: Db, ctx: TenantCtx, claimId: string): ClaimRecoveryRow[] {
  return many<ClaimRecoveryRow>(
    db
      .prepare(
        'SELECT * FROM claim_recoveries WHERE tenant_id = ? AND claim_id = ? ORDER BY created_at ASC',
      )
      .all(ctx.tenantId, claimId),
  );
}

export function updateClaimRecovery(
  db: Db,
  ctx: TenantCtx,
  recoveryId: string,
  patch: Partial<Pick<ClaimRecoveryRow, 'status' | 'received_cents'>>,
): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => patch[f as keyof typeof patch] ?? null);
  db.prepare(
    `UPDATE claim_recoveries SET ${assignments}, updated_at = ? WHERE tenant_id = ? AND id = ?`,
  ).run(...(values as string[]), nowIso(), ctx.tenantId, recoveryId);
}
