import { cancellationRefundCents, daysBetween, midTermDeltaCents } from '@polaris/domain';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import { issueJob } from '../src/issue.ts';
import {
  bindJob,
  createCancellation,
  createPolicyChange,
  createRenewal,
  createSubmission,
  quoteJob,
  underwriteJob,
  updateRisk,
  withdrawJob,
  type RiskQuote,
} from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, referralRisk, testDb } from './helpers.ts';

const EFFECTIVE = '2026-09-01';

let db: Db;
let csr: TenantCtx;
let uw: TenantCtx;
let accountId: string;

beforeEach(() => {
  db = testDb();
  const tenant = makeTenant(db);
  csr = tenant.ctx.csr;
  uw = tenant.ctx.underwriter;
  accountId = makeAccount(db, csr).id;
});

function newBusiness(ctx: TenantCtx = csr, risk = cleanRisk()) {
  return createSubmission(db, ctx, {
    accountId,
    productCode: 'ON_PA',
    effectiveDate: EFFECTIVE,
    billingPlan: 'full',
    risk,
  });
}

/** Drive a submission all the way to an issued policy. */
function issueNewBusiness() {
  const job = newBusiness();
  quoteJob(db, csr, job.id);
  bindJob(db, csr, job.id);
  return issueJob(db, csr, job.id);
}

describe('new business', () => {
  test('quote → bind → issue creates a policy, version and transaction', () => {
    const job = newBusiness();
    expect(job.status).toBe('Draft');

    const { quote } = quoteJob(db, csr, job.id);
    expect(quote.kind).toBe('risk');
    expect(quote.changeAmountCents).toBe((quote as RiskQuote).annualPremiumCents);
    expect(quote.referrals).toHaveLength(0);

    bindJob(db, csr, job.id);
    const result = issueJob(db, csr, job.id);

    expect(result.job.status).toBe('Issued');
    expect(result.policy.status).toBe('InForce');
    expect(result.policy.policy_number).toMatch(/^ACME-\d{6}$/);
    expect(result.version.version_number).toBe(1);
    expect(result.version.term_number).toBe(1);
    expect(result.version.term_end).toBe('2027-09-01');
    expect(result.transaction.type).toBe('NewBusiness');
    expect(result.transaction.amount_cents).toBe(result.version.annual_premium_cents);
  });

  test('policy numbers increment per tenant', () => {
    const first = issueNewBusiness().policy.policy_number;
    const second = issueNewBusiness().policy.policy_number;
    expect(first).toBe('ACME-000001');
    expect(second).toBe('ACME-000002');
  });

  test('every action is recorded on the job audit trail', () => {
    const { job } = issueNewBusiness();
    const actions = repo.listJobEvents(db, csr, job.id).map((e) => e.action);
    expect(actions).toEqual(['create', 'quote', 'bind', 'issue']);
  });

  test('cannot bind before quoting', () => {
    const job = newBusiness();
    expect(() => bindJob(db, csr, job.id)).toThrow(ApiError);
  });

  test('editing the risk clears the quote and returns the job to Draft', () => {
    const job = newBusiness();
    quoteJob(db, csr, job.id);
    const edited = updateRisk(db, csr, job.id, cleanRisk());
    expect(edited.status).toBe('Draft');
    expect(edited.quote_json).toBeNull();
    expect(() => bindJob(db, csr, job.id)).toThrow(/quoted/);
  });

  test('a six-month term ends six months out', () => {
    const risk = cleanRisk();
    risk.termMonths = 6;
    const job = newBusiness(csr, risk);
    expect(job.term_end).toBe('2027-03-01');
  });

  test('withdrawn jobs cannot be quoted again', () => {
    const job = newBusiness();
    withdrawJob(db, csr, job.id, 'customer went elsewhere');
    expect(() => quoteJob(db, csr, job.id)).toThrow(ApiError);
  });
});

describe('underwriting referrals', () => {
  test('a referred job cannot be bound until an underwriter approves', () => {
    const job = newBusiness(csr, referralRisk());
    const { quote } = quoteJob(db, csr, job.id);
    expect(quote.referrals.map((r) => r.ruleCode).sort()).toEqual(['UW-CLAIMS', 'UW-NEWDRIVER']);

    expect(() => bindJob(db, csr, job.id)).toThrow(/underwriter approval/);
    expect(() => underwriteJob(db, csr, job.id, 'approve')).toThrow(/Only an underwriter/);

    underwriteJob(db, uw, job.id, 'approve', 'accepted with surcharge');
    const bound = bindJob(db, csr, job.id);
    expect(bound.status).toBe('Bound');
  });

  test('an underwriter can decline, which is terminal', () => {
    const job = newBusiness(csr, referralRisk());
    quoteJob(db, csr, job.id);
    const declined = underwriteJob(db, uw, job.id, 'decline', 'outside appetite');
    expect(declined.status).toBe('Declined');
    expect(() => bindJob(db, csr, job.id)).toThrow(ApiError);
  });

  test('re-quoting invalidates a prior approval', () => {
    const job = newBusiness(csr, referralRisk());
    quoteJob(db, csr, job.id);
    underwriteJob(db, uw, job.id, 'approve');
    quoteJob(db, csr, job.id);
    expect(() => bindJob(db, csr, job.id)).toThrow(/underwriter approval/);
  });
});

describe('mid-term policy change', () => {
  test('adding collision produces a prorated additional premium', () => {
    const issued = issueNewBusiness();
    const priorAnnual = issued.version.annual_premium_cents;

    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });

    const change = createPolicyChange(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
      risk,
    });
    const { quote } = quoteJob(db, csr, change.id);
    const riskQuote = quote as RiskQuote;

    expect(riskQuote.priorAnnualPremiumCents).toBe(priorAnnual);
    expect(riskQuote.annualPremiumCents).toBeGreaterThan(priorAnnual);
    expect(riskQuote.changeAmountCents).toBe(
      midTermDeltaCents(
        priorAnnual,
        riskQuote.annualPremiumCents,
        '2027-03-01',
        '2027-09-01',
        '2026-09-01',
      ),
    );
    // Half a term of a full-year difference costs less than the annual delta.
    expect(riskQuote.changeAmountCents).toBeLessThan(
      riskQuote.annualPremiumCents - priorAnnual,
    );

    bindJob(db, csr, change.id);
    const result = issueJob(db, csr, change.id);
    expect(result.version.version_number).toBe(2);
    expect(result.version.term_number).toBe(1);
    expect(result.transaction.type).toBe('Endorsement');
    expect(result.transaction.amount_cents).toBe(riskQuote.changeAmountCents);
  });

  test('removing coverage produces a return premium', () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COMP', deductibleCents: 100_000 });
    const job = newBusiness(csr, risk);
    quoteJob(db, csr, job.id);
    bindJob(db, csr, job.id);
    const issued = issueJob(db, csr, job.id);

    const change = createPolicyChange(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
      risk: cleanRisk(),
    });
    const { quote } = quoteJob(db, csr, change.id);
    expect(quote.changeAmountCents).toBeLessThan(0);
  });

  test('an effective date outside the term is rejected', () => {
    const issued = issueNewBusiness();
    expect(() =>
      createPolicyChange(db, csr, {
        policyId: issued.policy.id,
        effectiveDate: '2028-01-01',
        risk: cleanRisk(),
      }),
    ).toThrow(/current term/);
  });

  test('omitting the risk carries the in-force risk forward unchanged', () => {
    const issued = issueNewBusiness();
    const change = createPolicyChange(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
    });
    const { quote } = quoteJob(db, csr, change.id);
    expect((quote as RiskQuote).annualPremiumCents).toBe(issued.version.annual_premium_cents);
    expect(quote.changeAmountCents).toBe(0);
  });
});

describe('renewal', () => {
  test('renewal starts a new term at the old term end', () => {
    const issued = issueNewBusiness();
    const renewal = createRenewal(db, csr, { policyId: issued.policy.id });
    expect(renewal.term_start).toBe('2027-09-01');
    expect(renewal.term_end).toBe('2028-09-01');

    const { quote } = quoteJob(db, csr, renewal.id);
    expect(quote.changeAmountCents).toBe((quote as RiskQuote).annualPremiumCents);

    bindJob(db, csr, renewal.id);
    const result = issueJob(db, csr, renewal.id);
    expect(result.version.version_number).toBe(2);
    expect(result.version.term_number).toBe(2);
    expect(result.transaction.type).toBe('Renewal');
  });
});

describe('cancellation', () => {
  test('mid-term cancellation refunds the unused premium and closes the policy', () => {
    const issued = issueNewBusiness();
    const annual = issued.version.annual_premium_cents;

    const job = createCancellation(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
      reason: 'vehicle sold',
    });
    const { quote } = quoteJob(db, csr, job.id);
    expect(quote.kind).toBe('cancellation');
    const expectedRefund = cancellationRefundCents(annual, '2027-03-01', '2026-09-01', '2027-09-01');
    expect(quote.changeAmountCents).toBe(-expectedRefund);
    expect(expectedRefund).toBeGreaterThan(0);

    bindJob(db, csr, job.id);
    const result = issueJob(db, csr, job.id);
    expect(result.policy.status).toBe('Cancelled');
    expect(result.transaction.type).toBe('Cancellation');
    expect(result.transaction.amount_cents).toBe(-expectedRefund);
  });

  test('written premium nets to the earned amount after cancellation', () => {
    const issued = issueNewBusiness();
    const job = createCancellation(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
      reason: 'vehicle sold',
    });
    quoteJob(db, csr, job.id);
    bindJob(db, csr, job.id);
    issueJob(db, csr, job.id);

    const net = repo
      .listTransactions(db, csr, issued.policy.id)
      .reduce((sum, tx) => sum + tx.amount_cents, 0);
    const annual = issued.version.annual_premium_cents;
    const earnedDays = daysBetween('2026-09-01', '2027-03-01');
    const termDays = daysBetween('2026-09-01', '2027-09-01');
    expect(net).toBe(annual - Math.round((annual * (termDays - earnedDays)) / termDays));
  });

  test('a cancelled policy accepts no further jobs', () => {
    const issued = issueNewBusiness();
    const job = createCancellation(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
      reason: 'vehicle sold',
    });
    quoteJob(db, csr, job.id);
    bindJob(db, csr, job.id);
    issueJob(db, csr, job.id);

    expect(() =>
      createPolicyChange(db, csr, {
        policyId: issued.policy.id,
        effectiveDate: '2027-04-01',
        risk: cleanRisk(),
      }),
    ).toThrow(/Cancelled/);
  });

  test('a failed issue leaves no partial writes behind', () => {
    const issued = issueNewBusiness();
    const change = createPolicyChange(db, csr, {
      policyId: issued.policy.id,
      effectiveDate: '2027-03-01',
      risk: cleanRisk(),
    });
    quoteJob(db, csr, change.id);
    // Not bound — issue must fail and roll back.
    expect(() => issueJob(db, csr, change.id)).toThrow(ApiError);
    expect(repo.listPolicyVersions(db, csr, issued.policy.id)).toHaveLength(1);
    expect(repo.listTransactions(db, csr, issued.policy.id)).toHaveLength(1);
  });
});
