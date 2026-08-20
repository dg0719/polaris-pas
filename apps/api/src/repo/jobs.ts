import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type { JobEventRow, JobRow, TenantCtx } from './shared.ts';

// ─── Jobs & audit trail ─────────────────────────────────────────────────────

export function insertJob(
  db: Db,
  ctx: TenantCtx,
  input: Omit<JobRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
): JobRow {
  const ts = nowIso();
  const row: JobRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO jobs
       (id, tenant_id, account_id, job_type, status, policy_id, product_code,
        billing_plan, effective_date, term_start, term_end, risk_json, quote_json,
        uw_approved, uw_note, cancel_reason, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.job_type,
    row.status,
    row.policy_id,
    row.product_code,
    row.billing_plan,
    row.effective_date,
    row.term_start,
    row.term_end,
    row.risk_json,
    row.quote_json,
    row.uw_approved,
    row.uw_note,
    row.cancel_reason,
    row.created_by,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getJob(db: Db, ctx: TenantCtx, jobId: string): JobRow | null {
  return one<JobRow>(
    db.prepare('SELECT * FROM jobs WHERE tenant_id = ? AND id = ?').get(ctx.tenantId, jobId),
  );
}

export function listJobs(
  db: Db,
  ctx: TenantCtx,
  filter: { status?: string; accountId?: string } = {},
): JobRow[] {
  const where = ['tenant_id = ?'];
  const args: string[] = [ctx.tenantId];
  if (filter.status) {
    where.push('status = ?');
    args.push(filter.status);
  }
  if (filter.accountId) {
    where.push('account_id = ?');
    args.push(filter.accountId);
  }
  return many<JobRow>(
    db
      .prepare(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC`)
      .all(...args),
  );
}

type JobPatch = Partial<
  Pick<
    JobRow,
    | 'status'
    | 'risk_json'
    | 'quote_json'
    | 'uw_approved'
    | 'uw_note'
    | 'policy_id'
    | 'effective_date'
    | 'term_start'
    | 'term_end'
    | 'cancel_reason'
  >
>;

export function updateJob(db: Db, ctx: TenantCtx, jobId: string, patch: JobPatch): void {
  const keys = Object.keys(patch) as (keyof JobPatch)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k] as string | number | null);
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
    ...values,
    nowIso(),
    ctx.tenantId,
    jobId,
  );
}

export function appendJobEvent(
  db: Db,
  ctx: TenantCtx,
  input: { jobId: string; action: string; fromStatus: string; toStatus: string; note?: string },
): void {
  db.prepare(
    `INSERT INTO job_events
       (id, tenant_id, job_id, action, from_status, to_status,
        actor_user_id, actor_role, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    ctx.tenantId,
    input.jobId,
    input.action,
    input.fromStatus,
    input.toStatus,
    ctx.userId,
    ctx.role,
    input.note ?? null,
    nowIso(),
  );
}

export function listJobEvents(db: Db, ctx: TenantCtx, jobId: string): JobEventRow[] {
  return many<JobEventRow>(
    db
      .prepare(
        `SELECT e.*, u.name AS actor_name
           FROM job_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.tenant_id = ? AND e.job_id = ?
          ORDER BY e.created_at ASC`,
      )
      .all(ctx.tenantId, jobId),
  );
}
