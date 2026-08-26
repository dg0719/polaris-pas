import { beforeEach, describe, expect, test } from 'vitest';
import { authenticate } from '../src/auth.ts';
import { reportClaim } from '../src/claims/fnol.ts';
import { closeClaim } from '../src/claims/lifecycle.ts';
import type { Db } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import { issueJob } from '../src/issue.ts';
import { bindJob, createPolicyChange, createSubmission, quoteJob } from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

/**
 * Tenant isolation is the load-bearing property of a multi-tenant PAS.
 * Every read path must be scoped, not just the ones the UI happens to call.
 */

let db: Db;
let acme: TenantCtx;
let northstar: TenantCtx;
let acmeKeys: Record<string, string>;

beforeEach(() => {
  db = testDb();
  const a = makeTenant(db, 'Acme Insurance', 'ACME');
  const n = makeTenant(db, 'Northstar Mutual', 'NSTR');
  acme = a.ctx.csr;
  northstar = n.ctx.csr;
  acmeKeys = a.keys;
});

function issueFor(ctx: TenantCtx) {
  const job = createSubmission(db, ctx, {
    accountId: makeAccount(db, ctx).id,
    productCode: 'ON_PA',
    effectiveDate: '2026-09-01',
    billingPlan: 'monthly',
    risk: cleanRisk(),
  });
  quoteJob(db, ctx, job.id);
  bindJob(db, ctx, job.id);
  return issueJob(db, ctx, job.id);
}

describe('tenant isolation', () => {
  test('a job is invisible to another tenant', () => {
    const job = createSubmission(db, acme, {
      accountId: makeAccount(db, acme).id,
      productCode: 'ON_PA',
      effectiveDate: '2026-09-01',
      billingPlan: 'monthly',
      risk: cleanRisk(),
    });
    expect(repo.getJob(db, acme, job.id)).not.toBeNull();
    expect(repo.getJob(db, northstar, job.id)).toBeNull();
    expect(repo.listJobs(db, northstar)).toHaveLength(0);
  });

  test('a policy and its history are invisible to another tenant', () => {
    const issued = issueFor(acme);
    expect(repo.getPolicy(db, northstar, issued.policy.id)).toBeNull();
    expect(repo.listPolicies(db, northstar)).toHaveLength(0);
    expect(repo.listAccounts(db, northstar)).toHaveLength(0);
    expect(repo.listPolicyVersions(db, northstar, issued.policy.id)).toHaveLength(0);
    expect(repo.listTransactions(db, northstar, issued.policy.id)).toHaveLength(0);
    expect(repo.currentPolicyVersion(db, northstar, issued.policy.id)).toBeNull();
  });

  test('another tenant cannot endorse a policy it does not own', () => {
    const issued = issueFor(acme);
    expect(() =>
      createPolicyChange(db, northstar, {
        policyId: issued.policy.id,
        effectiveDate: '2027-03-01',
        risk: cleanRisk(),
      }),
    ).toThrow(ApiError);
  });

  test('policy number sequences are independent per tenant', () => {
    expect(issueFor(acme).policy.policy_number).toBe('ACME-000001');
    expect(issueFor(northstar).policy.policy_number).toBe('NSTR-000001');
    expect(issueFor(acme).policy.policy_number).toBe('ACME-000002');
  });

  test('the audit trail of one tenant is not readable by another', () => {
    const issued = issueFor(acme);
    expect(repo.listJobEvents(db, acme, issued.job.id).length).toBeGreaterThan(0);
    expect(repo.listJobEvents(db, northstar, issued.job.id)).toHaveLength(0);
  });

  test('an API key resolves to exactly one tenant', () => {
    const req = { headers: { authorization: `Bearer ${acmeKeys['csr']}` } };
    const { ctx } = authenticate(db, req as never);
    expect(ctx.tenantId).toBe(acme.tenantId);
    expect(ctx.role).toBe('csr');
  });

  test('an unknown API key is rejected', () => {
    const req = { headers: { authorization: 'Bearer nope' } };
    expect(() => authenticate(db, req as never)).toThrow(ApiError);
  });
});

describe('tenant isolation: claims', () => {
  function claimFor(ctx: TenantCtx) {
    const issued = issueFor(ctx);
    const adjusterCtx: TenantCtx = { ...ctx, role: 'adjuster' };
    return reportClaim(db, adjusterCtx, {
      policyId: issued.policy.id,
      lossDate: '2026-10-01',
      reportedDate: '2026-10-02',
      lossCause: 'COLLISION',
      description: 'Isolation test loss',
    }).claim;
  }

  test('a claim and everything on it are invisible to another tenant', () => {
    const claim = claimFor(acme);
    expect(repo.getClaim(db, northstar, claim.id)).toBeNull();
    expect(repo.listClaims(db, northstar)).toHaveLength(0);
    expect(repo.listExposures(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listReserveMovements(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listClaimPayments(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listClaimRecoveries(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listClaimEvents(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listClaimNotes(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listClaimTasks(db, northstar, claim.id)).toHaveLength(0);
    expect(repo.listPaymentsAwaitingApproval(db, northstar)).toHaveLength(0);
  });

  test('another tenant cannot act on a claim it does not own', () => {
    const claim = claimFor(acme);
    const northstarAdjuster: TenantCtx = { ...northstar, role: 'adjuster' };
    expect(() => closeClaim(db, northstarAdjuster, claim.id)).toThrow(/not found/);
    expect(() =>
      reportClaim(db, northstarAdjuster, {
        policyId: claim.policy_id,
        lossDate: '2026-10-01',
        reportedDate: '2026-10-02',
        lossCause: 'COLLISION',
        description: 'Cross-tenant attempt',
      }),
    ).toThrow(/not found/);
  });

  test('claim number sequences are independent per tenant', () => {
    expect(claimFor(acme).claim_number).toBe('ACMEC-000001');
    expect(claimFor(northstar).claim_number).toBe('NSTRC-000001');
  });
});
