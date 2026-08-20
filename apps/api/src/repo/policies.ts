import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type {
  InstallmentPlan,
  PolicyRow,
  PolicyStatus,
  PolicyVersionRow,
  TenantCtx,
} from './shared.ts';

// --- Policies ---------------------------------------------------------------─

export function insertPolicy(
  db: Db,
  ctx: TenantCtx,
  input: {
    accountId: string;
    policyNumber: string;
    productCode: string;
    billingPlan: InstallmentPlan;
  },
): PolicyRow {
  const ts = nowIso();
  const row: PolicyRow = {
    id: newId(),
    tenant_id: ctx.tenantId,
    account_id: input.accountId,
    policy_number: input.policyNumber,
    product_code: input.productCode,
    status: 'InForce',
    billing_plan: input.billingPlan,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO policies
       (id, tenant_id, account_id, policy_number, product_code, status,
        billing_plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_id,
    row.policy_number,
    row.product_code,
    row.status,
    row.billing_plan,
    ts,
    ts,
  );
  return row;
}

export function getPolicy(db: Db, ctx: TenantCtx, policyId: string): PolicyRow | null {
  return one<PolicyRow>(
    db.prepare('SELECT * FROM policies WHERE tenant_id = ? AND id = ?').get(ctx.tenantId, policyId),
  );
}

export function listPolicies(
  db: Db,
  ctx: TenantCtx,
  filter: { accountId?: string } = {},
): PolicyRow[] {
  if (filter.accountId) {
    return many<PolicyRow>(
      db
        .prepare(
          'SELECT * FROM policies WHERE tenant_id = ? AND account_id = ? ORDER BY created_at DESC',
        )
        .all(ctx.tenantId, filter.accountId),
    );
  }
  return many<PolicyRow>(
    db
      .prepare('SELECT * FROM policies WHERE tenant_id = ? ORDER BY created_at DESC')
      .all(ctx.tenantId),
  );
}

export function setPolicyStatus(
  db: Db,
  ctx: TenantCtx,
  policyId: string,
  status: PolicyStatus,
): void {
  db.prepare('UPDATE policies SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(
    status,
    nowIso(),
    ctx.tenantId,
    policyId,
  );
}

// ─── Policy versions ────────────────────────────────────────────────────────

export function insertPolicyVersion(
  db: Db,
  ctx: TenantCtx,
  input: Omit<PolicyVersionRow, 'id' | 'tenant_id' | 'created_at'>,
): PolicyVersionRow {
  const row: PolicyVersionRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO policy_versions
       (id, tenant_id, policy_id, version_number, term_number, transaction_type,
        effective_date, term_start, term_end, risk_json, quote_json,
        annual_premium_cents, job_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.policy_id,
    row.version_number,
    row.term_number,
    row.transaction_type,
    row.effective_date,
    row.term_start,
    row.term_end,
    row.risk_json,
    row.quote_json,
    row.annual_premium_cents,
    row.job_id,
    row.created_at,
  );
  return row;
}

export function currentPolicyVersion(
  db: Db,
  ctx: TenantCtx,
  policyId: string,
): PolicyVersionRow | null {
  return one<PolicyVersionRow>(
    db
      .prepare(
        `SELECT * FROM policy_versions
          WHERE tenant_id = ? AND policy_id = ?
          ORDER BY version_number DESC LIMIT 1`,
      )
      .get(ctx.tenantId, policyId),
  );
}

export function listPolicyVersions(db: Db, ctx: TenantCtx, policyId: string): PolicyVersionRow[] {
  return many<PolicyVersionRow>(
    db
      .prepare(
        `SELECT * FROM policy_versions
          WHERE tenant_id = ? AND policy_id = ?
          ORDER BY version_number ASC`,
      )
      .all(ctx.tenantId, policyId),
  );
}
