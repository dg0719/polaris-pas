import { beforeEach, describe, expect, test } from 'vitest';
import { reportClaim } from '../src/claims/fnol.ts';
import {
  approvePayment,
  issuePayment,
  rejectPayment,
  requestPayment,
  voidPayment,
} from '../src/claims/payments.ts';
import { claimFinancialView } from '../src/claims/readModel.ts';
import { closeRecovery, openRecovery, receiveRecovery } from '../src/claims/recovery.ts';
import { postReserve } from '../src/claims/reserves.ts';
import { addTask, completeTask } from '../src/claims/tasks.ts';
import { claimsWorklist } from '../src/claims/queues.ts';
import type { Db } from '../src/db.ts';
import { issueJob } from '../src/issue.ts';
import { bindJob, createSubmission, quoteJob } from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { ClaimExposureRow, ClaimRow, TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, testDb, type TestTenant } from './helpers.ts';

const EFFECTIVE = '2026-01-01';
const LOSS = '2026-05-10';

let db: Db;
let tenant: TestTenant;
let csr: TenantCtx;
let adjuster: TenantCtx;
let supervisor: TenantCtx;
let claim: ClaimRow;
let exposure: ClaimExposureRow; // DCPD on the insured's vehicle, $0 deductible
let collision: ClaimExposureRow | undefined;

function issuePolicyWithCollision(): string {
  const account = makeAccount(db, csr);
  const risk = cleanRisk();
  risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });
  const job = createSubmission(db, csr, {
    accountId: account.id,
    productCode: 'ON_PA',
    effectiveDate: EFFECTIVE,
    billingPlan: 'full',
    risk,
  });
  quoteJob(db, csr, job.id);
  bindJob(db, csr, job.id);
  return issueJob(db, csr, job.id).policy.id;
}

beforeEach(() => {
  db = testDb();
  tenant = makeTenant(db);
  csr = tenant.ctx.csr;
  adjuster = tenant.ctx.adjuster;
  supervisor = tenant.ctx.claims_supervisor;

  const policyId = issuePolicyWithCollision();
  claim = reportClaim(db, adjuster, {
    policyId,
    lossDate: LOSS,
    reportedDate: LOSS,
    lossCause: 'COLLISION',
    description: 'Single-vehicle collision',
  }).claim;
  const exposures = repo.listExposures(db, adjuster, claim.id);
  exposure = exposures.find((e) => e.coverage_code === 'DCPD')!;
  collision = exposures.find((e) => e.coverage_code === 'COLL');

  postReserve(db, adjuster, claim.id, {
    exposureId: exposure.id,
    category: 'indemnity',
    amountCents: 5_000_000,
    reason: 'Initial estimate',
  });
});

function pay(amountCents: number, ctx: TenantCtx = adjuster, exp: ClaimExposureRow = exposure) {
  return requestPayment(db, ctx, claim.id, {
    exposureId: exp.id,
    category: 'indemnity',
    amountCents,
    payeeName: 'Jane Doe',
    payeeKind: 'insured',
    method: 'eft',
  });
}

describe('payment authority', () => {
  test('within the adjuster limit: auto-approved, then issued', () => {
    const payment = pay(500_000); // $5,000 ≤ $10,000 limit
    expect(payment.status).toBe('Approved');
    expect(payment.approved_by).toBe(adjuster.userId);
    const issued = issuePayment(db, adjuster, claim.id, payment.id);
    expect(issued.status).toBe('Issued');
    expect(issued.issued_at).not.toBeNull();
  });

  test('above the limit: waits as Requested and cannot be issued', () => {
    const payment = pay(2_000_000); // $20,000 > $10,000
    expect(payment.status).toBe('Requested');
    expect(() => issuePayment(db, adjuster, claim.id, payment.id)).toThrow(/Cannot issue/);
  });

  test('the requester cannot approve their own payment', () => {
    const payment = pay(2_000_000);
    expect(() => approvePayment(db, adjuster, claim.id, payment.id)).toThrow(/own payment/);
  });

  test('a supervisor within their authority approves; then it issues', () => {
    const payment = pay(2_000_000);
    const approved = approvePayment(db, supervisor, claim.id, payment.id, 'Estimate verified');
    expect(approved.status).toBe('Approved');
    expect(approved.approved_by).toBe(supervisor.userId);
    expect(issuePayment(db, adjuster, claim.id, payment.id).status).toBe('Issued');
  });

  test('a payment above even the supervisor authority is refused', () => {
    postReserve(db, adjuster, claim.id, {
      exposureId: exposure.id,
      category: 'indemnity',
      amountCents: 20_000_000,
      reason: 'Severe loss',
    });
    const payment = pay(15_000_000); // $150,000 > supervisor's $100,000
    expect(() => approvePayment(db, supervisor, claim.id, payment.id)).toThrow(
      /your own payment authority/,
    );
  });

  test('a CSR can neither request nor approve', () => {
    expect(() => pay(100_000, csr)).toThrow(/claims role/);
    const payment = pay(2_000_000);
    expect(() => approvePayment(db, csr, claim.id, payment.id)).toThrow(/cannot approve/);
  });

  test('an underwriter cannot approve claim payments', () => {
    const payment = pay(2_000_000);
    expect(() => approvePayment(db, tenant.ctx.underwriter, claim.id, payment.id)).toThrow(
      /cannot approve/,
    );
  });

  test('reject ends a requested payment', () => {
    const payment = pay(2_000_000);
    const rejected = rejectPayment(db, supervisor, claim.id, payment.id, 'Estimate not supported');
    expect(rejected.status).toBe('Rejected');
    expect(() => issuePayment(db, adjuster, claim.id, payment.id)).toThrow(/Cannot issue/);
  });

  test('void reverses an issued payment in the financials', () => {
    const payment = pay(500_000);
    issuePayment(db, adjuster, claim.id, payment.id);
    let view = claimFinancialView(db, adjuster, repo.getClaim(db, adjuster, claim.id)!);
    expect(view.claim.paidCents).toBe(500_000);
    voidPayment(db, adjuster, claim.id, payment.id, 'Cheque lost');
    view = claimFinancialView(db, adjuster, repo.getClaim(db, adjuster, claim.id)!);
    expect(view.claim.paidCents).toBe(0);
    expect(view.claim.outstandingCents).toBe(5_000_000);
  });
});

describe('deductible', () => {
  test('applied once, on the first indemnity payment, and recorded', () => {
    postReserve(db, adjuster, claim.id, {
      exposureId: collision!.id,
      category: 'indemnity',
      amountCents: 800_000,
      reason: 'Repair estimate',
    });
    // $6,000 gross repair, $1,000 deductible → $5,000 net.
    const first = pay(600_000, adjuster, collision!);
    expect(first.deductible_applied_cents).toBe(100_000);
    expect(first.amount_cents).toBe(500_000);

    // The second payment on the same exposure applies nothing.
    const second = pay(200_000, adjuster, collision!);
    expect(second.deductible_applied_cents).toBe(0);
    expect(second.amount_cents).toBe(200_000);
  });

  test('a rejected payment gives the deductible back', () => {
    const first = pay(600_000, adjuster, collision!);
    expect(first.deductible_applied_cents).toBe(100_000);
    rejectPayment(db, supervisor, claim.id, first.id, 'Wrong payee');
    const retry = pay(600_000, adjuster, collision!);
    expect(retry.deductible_applied_cents).toBe(100_000);
  });

  test('a loss within the deductible pays nothing', () => {
    expect(() => pay(90_000, adjuster, collision!)).toThrow(/within the .* deductible/);
  });

  test('no deductible on expense payments', () => {
    const payment = requestPayment(db, adjuster, claim.id, {
      exposureId: collision!.id,
      category: 'expense',
      amountCents: 50_000,
      payeeName: 'Ottawa Appraisals Inc',
      payeeKind: 'vendor',
      method: 'cheque',
    });
    expect(payment.deductible_applied_cents).toBe(0);
  });
});

describe('recoveries', () => {
  test('subrogation: opened, received in parts, marked recovered', () => {
    const recovery = openRecovery(db, adjuster, claim.id, {
      exposureId: exposure.id,
      recoveryType: 'subrogation',
      category: 'indemnity',
      counterparty: 'Third-party insurer',
      expectedCents: 300_000,
    });
    expect(recovery.status).toBe('Open');
    let updated = receiveRecovery(db, adjuster, claim.id, recovery.id, 100_000);
    expect(updated.status).toBe('Open');
    updated = receiveRecovery(db, adjuster, claim.id, recovery.id, 200_000);
    expect(updated.status).toBe('Recovered');
    expect(updated.received_cents).toBe(300_000);
  });

  test('received money reduces net incurred', () => {
    const payment = pay(500_000);
    issuePayment(db, adjuster, claim.id, payment.id);
    const recovery = openRecovery(db, adjuster, claim.id, {
      exposureId: exposure.id,
      recoveryType: 'salvage',
      category: 'indemnity',
      counterparty: 'Salvage buyer',
      expectedCents: 120_000,
    });
    receiveRecovery(db, adjuster, claim.id, recovery.id, 120_000);
    const view = claimFinancialView(db, adjuster, repo.getClaim(db, adjuster, claim.id)!);
    expect(view.claim.recoveredCents).toBe(120_000);
    expect(view.claim.netIncurredCents).toBe(view.claim.incurredCents - 120_000);
  });

  test('an open recovery can be closed as written off', () => {
    const recovery = openRecovery(db, adjuster, claim.id, {
      exposureId: exposure.id,
      recoveryType: 'deductible',
      category: 'indemnity',
      counterparty: 'At-fault driver',
      expectedCents: 100_000,
    });
    expect(closeRecovery(db, adjuster, claim.id, recovery.id).status).toBe('Closed');
    expect(() => receiveRecovery(db, adjuster, claim.id, recovery.id, 1)).toThrow(/closed/i);
  });
});

describe('diary and worklist', () => {
  test('tasks are added, listed and completed', () => {
    const task = addTask(db, adjuster, claim.id, {
      subject: 'Request police report',
      dueDate: '2026-05-20',
    });
    expect(task.assigned_user_id).toBe(adjuster.userId);
    completeTask(db, adjuster, claim.id, task.id);
    expect(repo.getClaimTask(db, adjuster, task.id)!.status).toBe('done');
  });

  test('the worklist shows approvals, diary and flags where they belong', () => {
    pay(2_000_000); // needs approval
    addTask(db, adjuster, claim.id, { subject: 'Old follow-up', dueDate: '2020-01-01' });

    const supervisorList = claimsWorklist(db, supervisor);
    expect(supervisorList.approvals).toHaveLength(1);
    expect(supervisorList.approvals[0]!.amountCents).toBe(2_000_000);

    const adjusterList = claimsWorklist(db, adjuster);
    expect(adjusterList.counts.overdueDiary).toBe(1);
    expect(adjusterList.unassigned.map((c) => c.claimId)).toContain(claim.id);
  });
});
