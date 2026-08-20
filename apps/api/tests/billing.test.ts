import { beforeEach, describe, expect, test } from 'vitest';
import { accountRollup } from '../src/accounts.ts';
import { policyBilling, recordPayment } from '../src/billing.ts';
import type { Db } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import { issueJob } from '../src/issue.ts';
import {
  bindJob,
  createCancellation,
  createPolicyChange,
  createSubmission,
  quoteJob,
} from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { PolicyRow, TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

const TERM_START = '2026-09-01';
const TODAY = '2027-01-15'; // four and a half months into the term

let db: Db;
let csr: TenantCtx;
let accountId: string;

beforeEach(() => {
  db = testDb();
  const tenant = makeTenant(db);
  csr = tenant.ctx.csr;
  accountId = makeAccount(db, csr).id;
});

function issue(plan: 'full' | 'monthly' | 'quarterly', risk = cleanRisk()) {
  const job = createSubmission(db, csr, {
    accountId,
    productCode: 'ON_PA',
    effectiveDate: TERM_START,
    billingPlan: plan,
    risk,
  });
  quoteJob(db, csr, job.id);
  bindJob(db, csr, job.id);
  return issueJob(db, csr, job.id);
}

/** The one invariant billing must never break. */
function assertScheduleMatchesLedger(policy: PolicyRow): void {
  const transactions = repo
    .listTransactions(db, csr, policy.id)
    .reduce((sum, tx) => sum + tx.amount_cents, 0);
  const invoiced = repo
    .listInvoicesForPolicy(db, csr, policy.id)
    .filter((i) => i.status !== 'void')
    .reduce((sum, i) => sum + i.amount_cents, 0);
  expect(invoiced).toBe(transactions);
}

describe('schedule generation', () => {
  test('a monthly plan bills twelve installments that sum to the premium', () => {
    const { policy, transaction } = issue('monthly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(12);
    expect(invoices.reduce((s, i) => s + i.amount_cents, 0)).toBe(transaction.amount_cents);
    expect(invoices[0]!.due_date).toBe('2026-09-01');
    expect(invoices[11]!.due_date).toBe('2027-08-01');
    assertScheduleMatchesLedger(policy);
  });

  test('a quarterly plan bills four installments', () => {
    const { policy } = issue('quarterly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices.map((i) => i.due_date)).toEqual([
      '2026-09-01',
      '2026-12-01',
      '2027-03-01',
      '2027-06-01',
    ]);
  });

  test('pay in full bills once at inception', () => {
    const { policy, transaction } = issue('full');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.amount_cents).toBe(transaction.amount_cents);
  });

  test('invoice numbers are derived from the policy number', () => {
    const { policy } = issue('quarterly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices[0]!.invoice_number).toBe(`${policy.policy_number}-01`);
    expect(invoices[3]!.invoice_number).toBe(`${policy.policy_number}-04`);
  });
});

describe('endorsements move the schedule', () => {
  function endorse(policyId: string, effectiveDate: string) {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });
    const job = createPolicyChange(db, csr, { policyId, effectiveDate, risk });
    quoteJob(db, csr, job.id);
    bindJob(db, csr, job.id);
    return issueJob(db, csr, job.id);
  }

  test('additional premium spreads across untouched installments', () => {
    const { policy } = issue('monthly');
    const before = repo.listInvoicesForPolicy(db, csr, policy.id);
    recordPayment(db, csr, {
      accountId,
      amountCents: before[0]!.amount_cents,
      method: 'eft',
      receivedAt: '2026-09-01',
    });

    const { transaction } = endorse(policy.id, '2027-03-01');
    expect(transaction.amount_cents).toBeGreaterThan(0);

    const after = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(after).toHaveLength(12); // no extra invoice needed
    expect(after[0]!.amount_cents).toBe(before[0]!.amount_cents); // paid one untouched
    expect(after[5]!.amount_cents).toBeGreaterThan(before[5]!.amount_cents);
    assertScheduleMatchesLedger(policy);
  });

  test('an endorsement on a fully paid policy raises a new invoice', () => {
    const { policy, transaction } = issue('full');
    recordPayment(db, csr, {
      accountId,
      amountCents: transaction.amount_cents,
      method: 'card',
      receivedAt: '2026-09-01',
    });

    endorse(policy.id, '2027-03-01');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(2);
    expect(invoices[1]!.amount_cents).toBeGreaterThan(0);
    expect(invoices[1]!.due_date).toBe('2027-03-15'); // effective + 14 days
    assertScheduleMatchesLedger(policy);
  });
});

describe('cancellation', () => {
  function cancel(policyId: string, effectiveDate: string) {
    const job = createCancellation(db, csr, {
      policyId,
      effectiveDate,
      reason: 'Vehicle sold',
    });
    quoteJob(db, csr, job.id);
    bindJob(db, csr, job.id);
    return issueJob(db, csr, job.id);
  }

  test('unpaid installments are voided rather than left standing', () => {
    const { policy } = issue('monthly');
    recordPayment(db, csr, {
      accountId,
      amountCents: repo.listInvoicesForPolicy(db, csr, policy.id)[0]!.amount_cents,
      method: 'eft',
      receivedAt: '2026-09-01',
    });

    cancel(policy.id, '2026-11-01');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices.filter((i) => i.status === 'void').length).toBeGreaterThan(0);
    assertScheduleMatchesLedger(policy);
  });

  test('a customer who paid in full is left holding a credit', () => {
    const { policy, transaction } = issue('full');
    recordPayment(db, csr, {
      accountId,
      amountCents: transaction.amount_cents,
      method: 'card',
      receivedAt: '2026-09-01',
    });

    cancel(policy.id, '2027-03-01');

    const billing = policyBilling(db, csr, repo.getPolicy(db, csr, policy.id)!, TODAY);
    const credit = billing.invoices.find((i) => i.amount_cents < 0);
    expect(credit).toBeDefined();
    expect(credit!.displayStatus).toBe('credit');
    expect(billing.balanceCents).toBeLessThan(0); // the insurer owes the customer
    assertScheduleMatchesLedger(policy);
  });
});

describe('payments', () => {
  test('a payment is applied to the oldest invoice first', () => {
    const { policy } = issue('monthly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    const result = recordPayment(db, csr, {
      accountId,
      amountCents: invoices[0]!.amount_cents,
      method: 'eft',
      receivedAt: '2026-09-01',
    });

    expect(result.appliedCents).toBe(invoices[0]!.amount_cents);
    expect(result.unappliedCents).toBe(0);
    const after = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(after[0]!.status).toBe('paid');
    expect(after[1]!.status).toBe('open');
    expect(repo.listPaymentApplications(db, csr, after[0]!.id)).toHaveLength(1);
  });

  test('a partial payment leaves the invoice open', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    recordPayment(db, csr, {
      accountId,
      amountCents: 1000,
      method: 'cash',
      receivedAt: '2026-09-01',
    });
    const after = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    expect(after.paid_cents).toBe(1000);
    expect(after.status).toBe('open');
    expect(after.amount_cents).toBe(first.amount_cents);
  });

  test('a payment spanning several installments settles them in order', () => {
    const { policy } = issue('monthly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    const twoAndABit = invoices[0]!.amount_cents + invoices[1]!.amount_cents + 500;
    recordPayment(db, csr, {
      accountId,
      amountCents: twoAndABit,
      method: 'eft',
      receivedAt: '2026-09-01',
    });
    const after = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(after[0]!.status).toBe('paid');
    expect(after[1]!.status).toBe('paid');
    expect(after[2]!.paid_cents).toBe(500);
  });

  test('overpayment is kept as account credit rather than refused', () => {
    const { policy, transaction } = issue('full');
    const result = recordPayment(db, csr, {
      accountId,
      amountCents: transaction.amount_cents + 25_000,
      method: 'cheque',
      receivedAt: '2026-09-01',
    });
    expect(result.unappliedCents).toBe(25_000);
    const rollup = accountRollup(db, csr, accountId, TODAY);
    expect(rollup.balanceCents).toBe(-25_000);
    expect(policy.status).toBe('InForce');
  });

  test('a zero or negative payment is refused', () => {
    issue('full');
    expect(() =>
      recordPayment(db, csr, { accountId, amountCents: 0, method: 'cash', receivedAt: TODAY }),
    ).toThrow(ApiError);
  });
});

describe('read models', () => {
  test('an unpaid installment past its due date reads as overdue', () => {
    const { policy } = issue('monthly');
    const billing = policyBilling(db, csr, policy, TODAY);
    const overdue = billing.invoices.filter((i) => i.displayStatus === 'overdue');
    const planned = billing.invoices.filter((i) => i.displayStatus === 'planned');
    expect(overdue.length).toBe(5); // Sep through Jan
    expect(planned.length).toBe(7);
    expect(billing.pastDueCents).toBe(
      overdue.reduce((s, i) => s + i.amount_cents - i.paid_cents, 0),
    );
  });

  test('nextDue points at the earliest outstanding installment', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    recordPayment(db, csr, {
      accountId,
      amountCents: first.amount_cents,
      method: 'eft',
      receivedAt: '2026-09-01',
    });
    const billing = policyBilling(db, csr, repo.getPolicy(db, csr, policy.id)!, TODAY);
    expect(billing.nextDue?.dueDate).toBe('2026-10-01');
  });

  test('the account rollup adds up every policy on the account', () => {
    issue('monthly');
    issue('full');
    const rollup = accountRollup(db, csr, accountId, TODAY);
    expect(rollup.policyCount).toBe(2);
    expect(rollup.inForceCount).toBe(2);
    expect(rollup.balanceCents).toBe(rollup.billedCents - rollup.paidCents);
    expect(rollup.annualPremiumCents).toBeGreaterThan(0);
  });
});
