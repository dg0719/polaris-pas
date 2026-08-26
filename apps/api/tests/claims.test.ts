import { beforeEach, describe, expect, test } from 'vitest';
import { coverageAtDate, createExposure, reportClaim } from '../src/claims/fnol.ts';
import {
  addClaimNote,
  assignClaim,
  closeClaim,
  closeExposure,
  reopenClaim,
} from '../src/claims/lifecycle.ts';
import { requestPayment } from '../src/claims/payments.ts';
import { claimFinancialView } from '../src/claims/readModel.ts';
import { postReserve } from '../src/claims/reserves.ts';
import type { Db } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import { issueJob } from '../src/issue.ts';
import { bindJob, createCancellation, createSubmission, quoteJob } from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { ClaimRow, TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, testDb, type TestTenant } from './helpers.ts';

const EFFECTIVE = '2026-01-01';
const LOSS = '2026-05-10';

let db: Db;
let tenant: TestTenant;
let csr: TenantCtx;
let adjuster: TenantCtx;
let policyId: string;

function issuePolicy(): string {
  const account = makeAccount(db, csr);
  const job = createSubmission(db, csr, {
    accountId: account.id,
    productCode: 'ON_PA',
    effectiveDate: EFFECTIVE,
    billingPlan: 'full',
    risk: cleanRisk(),
  });
  quoteJob(db, csr, job.id);
  bindJob(db, csr, job.id);
  return issueJob(db, csr, job.id).policy.id;
}

function report(overrides: Partial<Parameters<typeof reportClaim>[2]> = {}): ClaimRow {
  return reportClaim(db, adjuster, {
    policyId,
    lossDate: LOSS,
    reportedDate: LOSS,
    lossCause: 'COLLISION',
    description: 'Rear-ended at a stop light',
    ...overrides,
  }).claim;
}

beforeEach(() => {
  db = testDb();
  tenant = makeTenant(db);
  csr = tenant.ctx.csr;
  adjuster = tenant.ctx.adjuster;
  policyId = issuePolicy();
});

describe('first notice of loss', () => {
  test('opens a claim pinned to the version in force on the loss date', () => {
    const claim = report();
    expect(claim.status).toBe('Open');
    expect(claim.claim_number).toMatch(/^ACMEC-\d{6}$/);
    const version = repo
      .listPolicyVersions(db, adjuster, policyId)
      .find((v) => v.id === claim.policy_version_id);
    expect(version?.transaction_type).toBe('NewBusiness');
  });

  test('seeds one exposure per responding carried coverage', () => {
    const claim = report();
    const exposures = repo.listExposures(db, adjuster, claim.id);
    // Collision responds via COLL/DCPD/LIAB/AB; this policy carries DCPD, LIAB, AB.
    expect(exposures.map((e) => e.coverage_code).sort()).toEqual(['AB', 'DCPD', 'LIAB']);
  });

  test('a loss date before the term is refused with a reason', () => {
    expect(() => report({ lossDate: '2025-12-31', reportedDate: '2026-01-05' })).toThrow(
      /No coverage was in force/,
    );
  });

  test('a loss date on or after expiry is refused', () => {
    expect(() => report({ lossDate: '2027-01-01', reportedDate: '2027-01-02' })).toThrow(
      /No coverage was in force/,
    );
  });

  test('a loss after cancellation is refused', () => {
    const cancel = createCancellation(db, csr, {
      policyId,
      effectiveDate: '2026-03-01',
      reason: 'Customer request',
    });
    quoteJob(db, csr, cancel.id);
    bindJob(db, csr, cancel.id);
    issueJob(db, csr, cancel.id);
    expect(() => report({ lossDate: '2026-04-01', reportedDate: '2026-04-02' })).toThrow(
      /No coverage was in force/,
    );
    // …but a loss before the cancellation date is covered.
    expect(report({ lossDate: '2026-02-15', reportedDate: '2026-02-16' }).status).toBe('Open');
  });

  test('reported date cannot precede the loss date', () => {
    expect(() => report({ reportedDate: '2026-05-09' })).toThrow(/cannot be before/);
  });

  test('a cause nothing carried responds to is refused', () => {
    // The clean risk carries no COMP, and theft responds only through COMP.
    expect(() => report({ lossCause: 'THEFT' })).toThrow(/No coverage on this policy responds/);
  });

  test('coverageAtDate answers the FNOL wizard', () => {
    expect(coverageAtDate(db, adjuster, policyId, LOSS).inForce).toBe(true);
    const out = coverageAtDate(db, adjuster, policyId, '2030-01-01');
    expect(out.inForce).toBe(false);
    expect(out.reason).toContain('2030-01-01');
  });

  test('late reporting trips a fraud flag', () => {
    const claim = report({ reportedDate: '2026-07-15' });
    const flags = JSON.parse(claim.fraud_flags_json) as { ruleCode: string }[];
    expect(flags.map((f) => f.ruleCode)).toContain('FR-LATE');
  });

  test('an exposure cannot be added for a coverage not in force', () => {
    const claim = report();
    const version = repo
      .listPolicyVersions(db, adjuster, policyId)
      .find((v) => v.id === claim.policy_version_id)!;
    expect(() =>
      createExposure(db, adjuster, claim, version, { coverageCode: 'COLL' }, 'Jane Doe'),
    ).toThrow(/not in force/);
  });
});

describe('claim lifecycle', () => {
  test('assign writes the adjuster and an event', () => {
    const claim = report();
    const updated = assignClaim(db, adjuster, claim.id, adjuster.userId);
    expect(updated.assigned_user_id).toBe(adjuster.userId);
    const events = repo.listClaimEvents(db, adjuster, claim.id);
    expect(events.map((e) => e.action)).toContain('assigned');
  });

  test('a claim with open exposures cannot close', () => {
    const claim = report();
    expect(() => closeClaim(db, adjuster, claim.id)).toThrow(/open exposure/);
  });

  test('closing every exposure zeroes reserves and lets the claim close', () => {
    const claim = report();
    const exposures = repo.listExposures(db, adjuster, claim.id);
    postReserve(db, adjuster, claim.id, {
      exposureId: exposures[0]!.id,
      category: 'indemnity',
      amountCents: 250_000,
      reason: 'Initial estimate',
    });
    for (const exposure of exposures) closeExposure(db, adjuster, claim.id, exposure.id);

    const financials = claimFinancialView(db, adjuster, repo.getClaim(db, adjuster, claim.id)!);
    expect(financials.claim.outstandingCents).toBe(0);

    const closed = closeClaim(db, adjuster, claim.id);
    expect(closed.status).toBe('Closed');
    // Reserve history is intact: the set-up and the take-down.
    const movements = repo.listReserveMovements(db, adjuster, claim.id);
    expect(movements.map((m) => m.amount_cents)).toEqual([250_000, -250_000]);
  });

  test('reopen returns a closed claim to Open', () => {
    const claim = report();
    for (const exposure of repo.listExposures(db, adjuster, claim.id)) {
      closeExposure(db, adjuster, claim.id, exposure.id);
    }
    closeClaim(db, adjuster, claim.id);
    expect(reopenClaim(db, adjuster, claim.id).status).toBe('Open');
  });

  test('a CSR cannot close a claim', () => {
    const claim = report();
    for (const exposure of repo.listExposures(db, adjuster, claim.id)) {
      closeExposure(db, adjuster, claim.id, exposure.id);
    }
    expect(() => closeClaim(db, csr, claim.id)).toThrow(ApiError);
    expect(() => closeClaim(db, csr, claim.id)).toThrow(/claims role/);
  });

  test('notes attach to the file', () => {
    const claim = report();
    addClaimNote(db, adjuster, claim.id, 'Spoke with the insured; photos requested.');
    const notes = repo.listClaimNotes(db, adjuster, claim.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('photos requested');
  });
});

describe('reserves', () => {
  test('movements accumulate and never edit', () => {
    const claim = report();
    const exposure = repo.listExposures(db, adjuster, claim.id)[0]!;
    postReserve(db, adjuster, claim.id, {
      exposureId: exposure.id,
      category: 'indemnity',
      amountCents: 500_000,
      reason: 'Initial estimate',
    });
    postReserve(db, adjuster, claim.id, {
      exposureId: exposure.id,
      category: 'indemnity',
      amountCents: -100_000,
      reason: 'Estimate revised down',
    });
    const financials = claimFinancialView(db, adjuster, repo.getClaim(db, adjuster, claim.id)!);
    expect(financials.byExposure.get(exposure.id)!.reserveCents).toBe(400_000);
    expect(repo.listReserveMovements(db, adjuster, claim.id)).toHaveLength(2);
  });

  test('a movement below zero is refused', () => {
    const claim = report();
    const exposure = repo.listExposures(db, adjuster, claim.id)[0]!;
    expect(() =>
      postReserve(db, adjuster, claim.id, {
        exposureId: exposure.id,
        category: 'indemnity',
        amountCents: -1,
        reason: 'Bad math',
      }),
    ).toThrow(/below zero/);
  });

  test('a CSR cannot move reserves', () => {
    const claim = report();
    const exposure = repo.listExposures(db, adjuster, claim.id)[0]!;
    expect(() =>
      postReserve(db, csr, claim.id, {
        exposureId: exposure.id,
        category: 'indemnity',
        amountCents: 100_000,
        reason: 'Should not work',
      }),
    ).toThrow(/claims role/);
  });

  test('a claim with an undecided payment cannot close', () => {
    const claim = report();
    const exposure = repo.listExposures(db, adjuster, claim.id)[0]!;
    postReserve(db, adjuster, claim.id, {
      exposureId: exposure.id,
      category: 'indemnity',
      amountCents: 5_000_000,
      reason: 'Estimate',
    });
    requestPayment(db, adjuster, claim.id, {
      exposureId: exposure.id,
      category: 'indemnity',
      amountCents: 2_000_000, // above the $10k adjuster authority
      payeeName: 'Jane Doe',
      payeeKind: 'insured',
      method: 'eft',
    });
    expect(() => closeExposure(db, adjuster, claim.id, exposure.id)).toThrow(/awaiting a decision/);
  });
});
