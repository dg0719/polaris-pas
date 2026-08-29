import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type { BillingRunRow, EarningSnapshotRow, TenantCtx } from './shared.ts';

// ─── Billing runs and earning snapshots ────────────────────────────────────
// The record of what the time-driven billing day did, and the cumulative
// earned premium it derives each day's posting from. `billing_runs` carries a
// unique index on (tenant_id, run_date), which is what makes the run
// idempotent per date rather than a check the caller has to remember.

/** Newest first. Capped: a carrier accumulates one row a day forever. */
const RUN_PAGE_LIMIT = 100;

export function insertBillingRun(db: Db, ctx: TenantCtx, runDate: string): BillingRunRow {
  const row: BillingRunRow = {
    id: newId(),
    tenant_id: ctx.tenantId,
    run_date: runDate,
    started_at: nowIso(),
    finished_at: null,
    summary_json: '{}',
  };
  db.prepare(
    `INSERT INTO billing_runs (id, tenant_id, run_date, started_at, finished_at, summary_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.tenant_id, row.run_date, row.started_at, row.finished_at, row.summary_json);
  return row;
}

export function getBillingRun(db: Db, ctx: TenantCtx, runDate: string): BillingRunRow | null {
  return one<BillingRunRow>(
    db
      .prepare('SELECT * FROM billing_runs WHERE tenant_id = ? AND run_date = ?')
      .get(ctx.tenantId, runDate),
  );
}

export function listBillingRuns(db: Db, ctx: TenantCtx, limit = RUN_PAGE_LIMIT): BillingRunRow[] {
  return many<BillingRunRow>(
    db
      .prepare(
        `SELECT * FROM billing_runs WHERE tenant_id = ?
          ORDER BY run_date DESC, started_at DESC LIMIT ?`,
      )
      .all(ctx.tenantId, Math.min(limit, RUN_PAGE_LIMIT)),
  );
}

/** Close a run out with what it did. */
export function finishBillingRun(
  db: Db,
  ctx: TenantCtx,
  runId: string,
  summary: Record<string, unknown>,
): void {
  db.prepare(
    'UPDATE billing_runs SET finished_at = ?, summary_json = ? WHERE tenant_id = ? AND id = ?',
  ).run(nowIso(), JSON.stringify(summary), ctx.tenantId, runId);
}

export function insertEarningSnapshot(
  db: Db,
  ctx: TenantCtx,
  input: Omit<EarningSnapshotRow, 'id' | 'tenant_id' | 'created_at'>,
): EarningSnapshotRow {
  const row: EarningSnapshotRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO earning_snapshots
       (id, tenant_id, policy_version_id, policy_id, as_of, written_cents, earned_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.policy_version_id,
    row.policy_id,
    row.as_of,
    row.written_cents,
    row.earned_cents,
    row.created_at,
  );
  return row;
}

/** The most recent snapshot for a version: what the ledger has already been
 * told this version earned. Ordered by `as_of` because that is the day the
 * earning belongs to, not the wall-clock moment the row was written. */
export function latestEarningSnapshot(
  db: Db,
  ctx: TenantCtx,
  policyVersionId: string,
): EarningSnapshotRow | null {
  return one<EarningSnapshotRow>(
    db
      .prepare(
        `SELECT * FROM earning_snapshots
          WHERE tenant_id = ? AND policy_version_id = ?
          ORDER BY as_of DESC, created_at DESC LIMIT 1`,
      )
      .get(ctx.tenantId, policyVersionId),
  );
}
