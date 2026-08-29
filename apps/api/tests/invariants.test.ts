import type { RiskData } from '@polaris/domain';
import { beforeEach, describe, expect, test } from 'vitest';
import { recordPayment } from '../src/billing/payments.ts';
import { assertBillingInvariants } from '../src/billing/readModel.ts';
import type { Db } from '../src/db.ts';
import { issueJob } from '../src/issue.ts';
import {
  bindJob,
  createCancellation,
  createPolicyChange,
  createRenewal,
  createSubmission,
  quoteJob,
} from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { InstallmentPlan, TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

// ─── The three billing invariants, exercised by every job type ─────────────
// Spec §2 replaced the old single billing invariant with three: every
// journal entry balances, every charge is covered by its items, and the
// premium receivable in the ledger equals what the live items still owe.
// `assertBillingInvariants` is the one place that checks all three, so it is
// worth proving both that it passes on real work and that each of its three
// checks actually fires when the thing it guards is broken.

const TERM_START = '2026-09-01';

let db: Db;
let csr: TenantCtx;
let accountId: string;

beforeEach(() => {
  db = testDb();
  const tenant = makeTenant(db);
  csr = tenant.ctx.csr;
  accountId = makeAccount(db, csr).id;
});

function issue(plan: string, risk = cleanRisk()) {
  const job = createSubmission(db, csr, {
    accountId,
    productCode: 'ON_PA',
    effectiveDate: TERM_START,
    billingPlan: plan as InstallmentPlan,
    risk,
  });
  return runJob(job.id);
}

function runJob(jobId: string) {
  quoteJob(db, csr, jobId);
  bindJob(db, csr, jobId);
  return issueJob(db, csr, jobId);
}

/** The same risk with collision added — a mid-term addition of premium. */
function withCollision(risk: RiskData): RiskData {
  risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });
  return risk;
}

describe('billing invariants', () => {
  test('hold after a submission, a change, a payment, a renewal and a cancellation', () => {
    const { policy } = issue('monthly');
    assertBillingInvariants(db, csr, accountId);

    const change = createPolicyChange(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-01-15',
      risk: withCollision(cleanRisk()),
    });
    expect(runJob(change.id).transaction.amount_cents).toBeGreaterThan(0);
    assertBillingInvariants(db, csr, accountId);

    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    const firstTotal = repo
      .listItemsForInvoice(db, csr, first.id)
      .reduce((sum, i) => sum + i.amount_cents, 0);
    recordPayment(db, csr, {
      accountId,
      amountCents: firstTotal,
      method: 'eft',
      receivedAt: TERM_START,
    });
    assertBillingInvariants(db, csr, accountId);

    const renewal = createRenewal(db, csr, { policyId: policy.id });
    runJob(renewal.id);
    assertBillingInvariants(db, csr, accountId);

    // Mid-way through the renewal term, which runs 2027-09-01 to 2028-09-01.
    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2028-03-01',
      reason: 'insured request',
    });
    expect(runJob(cancel.id).transaction.amount_cents).toBeLessThan(0);
    assertBillingInvariants(db, csr, accountId);
  });

  test('hold across two policies on one account, one of them paid in full', () => {
    const { policy: first } = issue('full');
    issue('quarterly');
    const total = repo
      .listItemsForPolicy(db, csr, first.id)
      .reduce((sum, i) => sum + i.amount_cents, 0);
    recordPayment(db, csr, {
      accountId,
      amountCents: total,
      method: 'cheque',
      receivedAt: TERM_START,
    });
    assertBillingInvariants(db, csr, accountId);
  });

  test('an unbalanced journal entry is caught and named', () => {
    issue('monthly');
    const entry = db
      .prepare('SELECT id FROM journal_entries WHERE tenant_id = ? LIMIT 1')
      .get(csr.tenantId) as { id: string };
    // A line nothing offsets: exactly what `postEntry` refuses, forced past it.
    db.prepare(
      `INSERT INTO journal_lines
         (id, tenant_id, entry_id, account_code, account_id, policy_id,
          producer_id, province, method, debit_cents, credit_cents)
       VALUES ('bad-line', ?, ?, '1100', NULL, NULL, NULL, NULL, NULL, 1, 0)`,
    ).run(csr.tenantId, entry.id);

    expect(() => assertBillingInvariants(db, csr, accountId)).toThrow(/ledger balance/i);
  });

  test('a charge no longer covered by its items is caught and named', () => {
    issue('monthly');
    const item = repo.listItemsForAccount(db, csr, accountId)[0]!;
    db.prepare('UPDATE invoice_items SET amount_cents = ? WHERE id = ?').run(
      item.amount_cents + 1,
      item.id,
    );

    expect(() => assertBillingInvariants(db, csr, accountId)).toThrow(/charge coverage/i);
  });

  test('a receivable that no longer matches the live items is caught and named', () => {
    issue('monthly');
    const item = repo.listItemsForAccount(db, csr, accountId)[0]!;
    // Money marked settled with no distribution posted behind it.
    repo.setItemPaid(db, csr, item.id, item.amount_cents);

    expect(() => assertBillingInvariants(db, csr, accountId)).toThrow(/receivable/i);
  });
});
