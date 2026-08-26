import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type {
  ClaimEventRow,
  ClaimExposureRow,
  ClaimNoteRow,
  ClaimRow,
  TenantCtx,
} from './shared.ts';

// ─── Claims ─────────────────────────────────────────────────────────────────

export function insertClaim(
  db: Db,
  ctx: TenantCtx,
  input: Omit<ClaimRow, 'id' | 'tenant_id' | 'created_by' | 'created_at' | 'updated_at'>,
): ClaimRow {
  const ts = nowIso();
  const row: ClaimRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_by: ctx.userId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO claims
       (id, tenant_id, account_id, policy_id, policy_version_id, claim_number,
        status, loss_date, reported_date, loss_cause, description, loss_location,
        assigned_user_id, fraud_flags_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.policy_id,
    row.policy_version_id,
    row.claim_number,
    row.status,
    row.loss_date,
    row.reported_date,
    row.loss_cause,
    row.description,
    row.loss_location,
    row.assigned_user_id,
    row.fraud_flags_json,
    row.created_by,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getClaim(db: Db, ctx: TenantCtx, claimId: string): ClaimRow | null {
  return one<ClaimRow>(
    db.prepare('SELECT * FROM claims WHERE tenant_id = ? AND id = ?').get(ctx.tenantId, claimId),
  );
}

export interface ClaimFilter {
  status?: 'Open' | 'Closed';
  policyId?: string;
  accountId?: string;
  assignedUserId?: string;
}

export function listClaims(db: Db, ctx: TenantCtx, filter: ClaimFilter = {}): ClaimRow[] {
  const clauses = ['tenant_id = ?'];
  const args: unknown[] = [ctx.tenantId];
  if (filter.status) {
    clauses.push('status = ?');
    args.push(filter.status);
  }
  if (filter.policyId) {
    clauses.push('policy_id = ?');
    args.push(filter.policyId);
  }
  if (filter.accountId) {
    clauses.push('account_id = ?');
    args.push(filter.accountId);
  }
  if (filter.assignedUserId) {
    clauses.push('assigned_user_id = ?');
    args.push(filter.assignedUserId);
  }
  return many<ClaimRow>(
    db
      .prepare(`SELECT * FROM claims WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
      .all(...(args as string[])),
  );
}

export function updateClaim(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  patch: Partial<Pick<ClaimRow, 'status' | 'assigned_user_id' | 'fraud_flags_json'>>,
): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => patch[f as keyof typeof patch] ?? null);
  db.prepare(`UPDATE claims SET ${assignments}, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
    ...(values as string[]),
    nowIso(),
    ctx.tenantId,
    claimId,
  );
}

// ─── Exposures ──────────────────────────────────────────────────────────────

export function insertExposure(
  db: Db,
  ctx: TenantCtx,
  input: Omit<ClaimExposureRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
): ClaimExposureRow {
  const ts = nowIso();
  const row: ClaimExposureRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO claim_exposures
       (id, tenant_id, claim_id, coverage_code, coverage_name, risk_item_id,
        risk_item_label, claimant_name, claimant_kind, deductible_cents, status,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.claim_id,
    row.coverage_code,
    row.coverage_name,
    row.risk_item_id,
    row.risk_item_label,
    row.claimant_name,
    row.claimant_kind,
    row.deductible_cents,
    row.status,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getExposure(db: Db, ctx: TenantCtx, exposureId: string): ClaimExposureRow | null {
  return one<ClaimExposureRow>(
    db
      .prepare('SELECT * FROM claim_exposures WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, exposureId),
  );
}

export function listExposures(db: Db, ctx: TenantCtx, claimId: string): ClaimExposureRow[] {
  return many<ClaimExposureRow>(
    db
      .prepare(
        'SELECT * FROM claim_exposures WHERE tenant_id = ? AND claim_id = ? ORDER BY created_at ASC',
      )
      .all(ctx.tenantId, claimId),
  );
}

export function setExposureStatus(
  db: Db,
  ctx: TenantCtx,
  exposureId: string,
  status: ClaimExposureRow['status'],
): void {
  db.prepare(
    'UPDATE claim_exposures SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
  ).run(status, nowIso(), ctx.tenantId, exposureId);
}

// ─── Events and notes ───────────────────────────────────────────────────────

export function appendClaimEvent(
  db: Db,
  ctx: TenantCtx,
  input: {
    claimId: string;
    action: string;
    subjectKind: 'claim' | 'exposure' | 'payment' | 'recovery' | 'task';
    subjectId: string;
    detail?: string;
  },
): void {
  db.prepare(
    `INSERT INTO claim_events
       (id, tenant_id, claim_id, action, subject_kind, subject_id, detail,
        actor_user_id, actor_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    ctx.tenantId,
    input.claimId,
    input.action,
    input.subjectKind,
    input.subjectId,
    input.detail ?? null,
    ctx.userId,
    ctx.role,
    nowIso(),
  );
}

export function listClaimEvents(db: Db, ctx: TenantCtx, claimId: string): ClaimEventRow[] {
  return many<ClaimEventRow>(
    db
      .prepare(
        `SELECT e.*, u.name AS actor_name
           FROM claim_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.tenant_id = ? AND e.claim_id = ?
          ORDER BY e.created_at ASC`,
      )
      .all(ctx.tenantId, claimId),
  );
}

export function insertClaimNote(
  db: Db,
  ctx: TenantCtx,
  input: { claimId: string; body: string },
): ClaimNoteRow {
  const row = {
    id: newId(),
    tenant_id: ctx.tenantId,
    claim_id: input.claimId,
    body: input.body,
    author_user_id: ctx.userId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO claim_notes (id, tenant_id, claim_id, body, author_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.tenant_id, row.claim_id, row.body, row.author_user_id, row.created_at);
  return { ...row, author_name: null };
}

export function listClaimNotes(db: Db, ctx: TenantCtx, claimId: string): ClaimNoteRow[] {
  return many<ClaimNoteRow>(
    db
      .prepare(
        `SELECT n.*, u.name AS author_name
           FROM claim_notes n
           LEFT JOIN users u ON u.id = n.author_user_id
          WHERE n.tenant_id = ? AND n.claim_id = ?
          ORDER BY n.created_at DESC`,
      )
      .all(ctx.tenantId, claimId),
  );
}
