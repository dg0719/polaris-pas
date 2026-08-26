import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type { ClaimTaskRow, TenantCtx } from './shared.ts';

// ─── Diary tasks ────────────────────────────────────────────────────────────

export function insertClaimTask(
  db: Db,
  ctx: TenantCtx,
  input: { claimId: string; subject: string; dueDate: string; assignedUserId: string },
): ClaimTaskRow {
  const ts = nowIso();
  const row: ClaimTaskRow = {
    id: newId(),
    tenant_id: ctx.tenantId,
    claim_id: input.claimId,
    subject: input.subject,
    due_date: input.dueDate,
    assigned_user_id: input.assignedUserId,
    status: 'open',
    created_by: ctx.userId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO claim_tasks
       (id, tenant_id, claim_id, subject, due_date, assigned_user_id, status,
        created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.claim_id,
    row.subject,
    row.due_date,
    row.assigned_user_id,
    row.status,
    row.created_by,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getClaimTask(db: Db, ctx: TenantCtx, taskId: string): ClaimTaskRow | null {
  return one<ClaimTaskRow>(
    db.prepare('SELECT * FROM claim_tasks WHERE tenant_id = ? AND id = ?').get(ctx.tenantId, taskId),
  );
}

export function listClaimTasks(db: Db, ctx: TenantCtx, claimId: string): ClaimTaskRow[] {
  return many<ClaimTaskRow>(
    db
      .prepare(
        'SELECT * FROM claim_tasks WHERE tenant_id = ? AND claim_id = ? ORDER BY due_date ASC',
      )
      .all(ctx.tenantId, claimId),
  );
}

/** One user's open diary, soonest due first. */
export function listOpenTasksForUser(db: Db, ctx: TenantCtx, userId: string): ClaimTaskRow[] {
  return many<ClaimTaskRow>(
    db
      .prepare(
        `SELECT * FROM claim_tasks
          WHERE tenant_id = ? AND assigned_user_id = ? AND status = 'open'
          ORDER BY due_date ASC`,
      )
      .all(ctx.tenantId, userId),
  );
}

export function setClaimTaskStatus(
  db: Db,
  ctx: TenantCtx,
  taskId: string,
  status: ClaimTaskRow['status'],
): void {
  db.prepare('UPDATE claim_tasks SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(
    status,
    nowIso(),
    ctx.tenantId,
    taskId,
  );
}
