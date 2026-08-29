import type { RiskData } from '@polaris/domain';
import { beforeEach, describe, expect, test } from 'vitest';
import { createAccount } from '../src/accounts.ts';
import { recordPayment, unappliedCents } from '../src/billing/payments.ts';
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
import type { InstallmentPlan, PolicyRow, TenantCtx } from '../src/repo.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

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

/**
 * Any code in the payment-plan catalogue. Task 15 widens `InstallmentPlan` to
 * exactly this; until then the cast is the only way to reach a plan the old
 * three-value union never knew about.
 */
type PlanCode = 'full' | 'monthly' | 'quarterly' | 'monthly-2down';

function issue(plan: PlanCode, risk = cleanRisk(), onAccountId = accountId) {
  const job = createSubmission(db, csr, {
    accountId: onAccountId,
    productCode: 'ON_PA',
    effectiveDate: TERM_START,
    billingPlan: plan as InstallmentPlan,
    risk,
  });
  quoteJob(db, csr, job.id);
  bindJob(db, csr, job.id);
  return issueJob(db, csr, job.id);
}

/** The same risk with collision added — a mid-term addition of premium. */
function withCollision(risk: RiskData): RiskData {
  risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });
  return risk;
}

function runJob(jobId: string) {
  quoteJob(db, csr, jobId);
  bindJob(db, csr, jobId);
  return issueJob(db, csr, jobId);
}

/**
 * An account in a province that taxes the line. Ontario exempts automobile
 * from retail sales tax, so this is the only way to reach the tax path
 * today. The tax rate comes from the `tax_rates` catalogue keyed on the
 * account's province and the product's line — configuration, not code. (The
 * rating tables are still Ontario's; a Quebec product arrives with the
 * second product.)
 */
function quebecAccount() {
  return createAccount(db, csr, {
    account_type: 'person',
    name: 'Marie Tremblay',
    email: null,
    phone: null,
    address_line1: '1 rue Sainte-Catherine',
    address_line2: null,
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H3B 1A1',
    producer_code: null,
  });
}

/** What an invoice is worth: the sum of the items placed on it. */
function invoiceTotal(invoiceId: string): number {
  return repo.listItemsForInvoice(db, csr, invoiceId).reduce((sum, i) => sum + i.amount_cents, 0);
}

/**
 * Charge coverage — every charge's items sum to the charge — plus the premium
 * charges together equalling the written premium of record. Task 12 replaces
 * this with `assertBillingInvariants`.
 */
function invariants(policy: PolicyRow): void {
  const charges = repo.listChargesForPolicy(db, csr, policy.id);
  const items = repo.listItemsForPolicy(db, csr, policy.id);
  expect(charges.length).toBeGreaterThan(0);
  for (const c of charges) {
    expect(items.filter((i) => i.charge_id === c.id).reduce((s, i) => s + i.amount_cents, 0)).toBe(
      c.amount_cents,
    );
  }
  const premiumBilled = charges
    .filter((c) => c.pattern_code === 'PREMIUM')
    .reduce((s, c) => s + c.amount_cents, 0);
  const written = repo.listTransactions(db, csr, policy.id).reduce((s, t) => s + t.amount_cents, 0);
  expect(premiumBilled).toBe(written);
}

describe('schedule generation', () => {
  test('a monthly plan bills twelve invoices, each with premium and fee lines, summing to premium plus fee', () => {
    const { policy, transaction } = issue('monthly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(12);
    expect(invoices[0]!.due_date).toBe('2026-09-01');
    expect(invoices[0]!.bill_date).toBe('2026-08-11'); // 21 days of lead
    expect(invoices[0]!.status).toBe('planned');
    expect(invoices[0]!.invoice_number).toBe(`${policy.policy_number}-01`);
    expect(invoices[11]!.due_date).toBe('2027-08-01');

    const items = repo.listItemsForPolicy(db, csr, policy.id);
    expect(
      items.filter((i) => i.kind === 'installment').reduce((s, i) => s + i.amount_cents, 0),
    ).toBe(transaction.amount_cents);
    expect(items.filter((i) => i.kind === 'fee').reduce((s, i) => s + i.amount_cents, 0)).toBe(
      Math.round((transaction.amount_cents * 130) / 10_000),
    );
    expect(items.some((i) => i.kind === 'tax')).toBe(false); // Ontario auto is exempt
    expect(repo.listItemsForInvoice(db, csr, invoices[0]!.id).map((i) => i.kind)).toEqual([
      'installment',
      'fee',
    ]);
    expect(invoices.reduce((s, i) => s + invoiceTotal(i.id), 0)).toBe(
      items.reduce((s, i) => s + i.amount_cents, 0),
    );
    invariants(policy);
  });

  test('two months down bills the down payment at inception and ten installments after', () => {
    const { policy } = issue('monthly-2down');
    const items = repo
      .listItemsForPolicy(db, csr, policy.id)
      .filter((i) => i.pattern_code === 'PREMIUM');
    expect(items[0]!.kind).toBe('downPayment');
    expect(items[0]!.event_date).toBe(TERM_START);
    expect(items.filter((i) => i.kind === 'installment')).toHaveLength(10);
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(11);
    expect(invoices.at(-1)!.due_date).toBe('2027-07-01');
    invariants(policy);
  });

  test('a quarterly plan bills four invoices on the plan cadence', () => {
    const { policy } = issue('quarterly');
    expect(repo.listInvoicesForPolicy(db, csr, policy.id).map((i) => i.due_date)).toEqual([
      '2026-09-01',
      '2026-12-01',
      '2027-03-01',
      '2027-06-01',
    ]);
    invariants(policy);
  });

  test('a six-month term bills six monthly invoices, all inside the term', () => {
    // The plan catalogue states its installment count for a 12-month term.
    const halfYear = cleanRisk();
    halfYear.termMonths = 6;
    const { job, policy } = issue('monthly', halfYear);
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(6);
    expect(invoices[0]!.due_date).toBe('2026-09-01');
    expect(invoices.at(-1)!.due_date).toBe('2027-02-01');
    expect(invoices.at(-1)!.due_date < job.term_end).toBe(true);
    invariants(policy);
  });

  test('the premium charge posts receivable against unearned premium', () => {
    const { policy, transaction } = issue('full');
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBe(
      transaction.amount_cents,
    );
    expect(repo.accountBalance(db, csr, '2200', { policyId: policy.id })).toBe(
      -transaction.amount_cents,
    );
    // Pay in full carries no installment fee, so nothing reaches fee income.
    expect(repo.accountBalance(db, csr, '4200', { policyId: policy.id })).toBe(0);
    invariants(policy);
  });

  test('the installment fee posts to fee income, separately from premium', () => {
    const { policy, transaction } = issue('monthly');
    const fee = Math.round((transaction.amount_cents * 130) / 10_000);
    expect(repo.accountBalance(db, csr, '4200', { policyId: policy.id })).toBe(-fee);
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBe(
      transaction.amount_cents + fee,
    );
  });

  test('where the province taxes the line, tax is its own charge and posts to tax payable', () => {
    const { policy, transaction } = issue('full', cleanRisk(), quebecAccount().id);
    const expected = Math.round((transaction.amount_cents * 900) / 10_000);

    const items = repo.listItemsForPolicy(db, csr, policy.id);
    const premium = items.filter((i) => i.kind === 'installment');
    const taxItems = items.filter((i) => i.kind === 'tax');
    expect(premium).toHaveLength(1);
    expect(taxItems).toHaveLength(1);
    expect(taxItems[0]!.amount_cents).toBe(expected);
    expect(taxItems[0]!.pattern_code).toBe('TAX-QC');
    // It rides on the same invoice as the premium it is charged on.
    expect(taxItems[0]!.invoice_id).toBe(premium[0]!.invoice_id);
    // ... but on a charge of its own, so charge coverage holds per charge.
    expect(taxItems[0]!.charge_id).not.toBe(premium[0]!.charge_id);
    expect(repo.accountBalance(db, csr, '2300', { policyId: policy.id })).toBe(-expected);
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBe(
      transaction.amount_cents + expected,
    );
    invariants(policy);
  });
});

describe('endorsements move the schedule', () => {
  test('additional premium spreads over planned invoices as new items; nothing is edited', () => {
    const { policy } = issue('monthly');
    const before = repo
      .listItemsForPolicy(db, csr, policy.id)
      .map((i) => [i.id, i.amount_cents] as const);

    const change = createPolicyChange(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-01-15',
      risk: withCollision(cleanRisk()),
    });
    const { transaction } = runJob(change.id);
    expect(transaction.amount_cents).toBeGreaterThan(0);

    const after = repo.listItemsForPolicy(db, csr, policy.id);
    for (const [id, amount] of before) {
      expect(after.find((i) => i.id === id)!.amount_cents).toBe(amount);
    }
    expect(after.length).toBeGreaterThan(before.length);

    // The seven invoices from the change date on carry the additional premium;
    // the five before it are untouched and no new invoice was needed.
    expect(repo.listInvoicesForPolicy(db, csr, policy.id)).toHaveLength(12);
    const added = after.filter((i) => !before.some(([id]) => id === i.id));
    expect(added).toHaveLength(7);
    expect(added.every((i) => i.kind === 'installment' && i.amount_cents > 0)).toBe(true);
    expect(added.every((i) => i.event_date >= '2027-01-15')).toBe(true);
    expect(added.reduce((s, i) => s + i.amount_cents, 0)).toBe(transaction.amount_cents);
    invariants(policy);
  });

  test('a change that alters nothing writes no items and posts nothing', () => {
    const { policy } = issue('monthly');
    const itemsBefore = repo.listItemsForPolicy(db, csr, policy.id).length;
    const change = createPolicyChange(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-01-15',
      risk: cleanRisk(),
    });
    const { transaction } = runJob(change.id);
    expect(transaction.amount_cents).toBe(0);
    expect(repo.listItemsForPolicy(db, csr, policy.id)).toHaveLength(itemsBefore);

    // A zero charge is still recorded — the instruction happened — but a
    // zero-amount journal entry would be noise, so none is posted.
    const zeroCharge = repo
      .listChargesForPolicy(db, csr, policy.id)
      .find((c) => c.amount_cents === 0)!;
    expect(zeroCharge).toBeDefined();
    expect(repo.listEntries(db, csr, { kind: 'charge', id: zeroCharge.id })).toEqual([]);
    invariants(policy);
  });

  test('return premium the schedule cannot absorb becomes a credit note', () => {
    // Pay in full leaves one invoice at inception; a mid-term reduction has
    // nothing planned after the change date to come off, so it is credited.
    const { policy } = issue('full', withCollision(cleanRisk()));
    const change = createPolicyChange(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-03-01',
      risk: cleanRisk(),
    });
    const { transaction } = runJob(change.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(2);
    const credit = invoices.at(-1)!;
    expect(credit.status).toBe('billed');
    expect(credit.due_date).toBe('2027-03-15'); // effective date plus 14 days
    const creditItems = repo.listItemsForInvoice(db, csr, credit.id);
    expect(creditItems).toHaveLength(1);
    expect(creditItems[0]!.kind).toBe('oneTime');
    expect(creditItems[0]!.amount_cents).toBe(transaction.amount_cents);
    invariants(policy);
  });
});


describe('cancellation', () => {
  function cancelMidTerm(policyId: string) {
    const cancel = createCancellation(db, csr, {
      policyId,
      effectiveDate: '2027-03-01',
      reason: 'insured request',
    });
    return runJob(cancel.id);
  }

  test('planned invoices are emptied latest-first and their fees reversed with them', () => {
    const { policy } = issue('monthly');
    const beforeItems = repo
      .listItemsForPolicy(db, csr, policy.id)
      .map((i) => [i.id, i.amount_cents] as const);
    const beforeTotals = new Map(
      repo.listInvoicesForPolicy(db, csr, policy.id).map((i) => [i.id, invoiceTotal(i.id)]),
    );

    const { transaction } = cancelMidTerm(policy.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    // Nothing is edited: every item written before the cancellation stands.
    const after = repo.listItemsForPolicy(db, csr, policy.id);
    for (const [id, amount] of beforeItems) {
      expect(after.find((i) => i.id === id)!.amount_cents).toBe(amount);
    }

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    const survivors = invoices.filter((i) => i.event_date < '2027-03-01');
    const voided = invoices.filter((i) => i.status === 'void');

    // Every invoice from the cancellation date on is emptied — return premium
    // now takes only premium, so the six remaining installments cover the
    // refund exactly and none is left standing.
    expect(voided.map((i) => i.event_date)).toEqual([
      '2027-03-01',
      '2027-04-01',
      '2027-05-01',
      '2027-06-01',
      '2027-07-01',
      '2027-08-01',
    ]);
    for (const invoice of voided) expect(invoiceTotal(invoice.id)).toBe(0);

    // Each voided invoice carries a negative fee line equal to its own fee:
    // the installment fee buys an installment, and there is no longer one.
    for (const invoice of voided) {
      const fees = repo.listItemsForInvoice(db, csr, invoice.id).filter((i) => i.kind === 'fee');
      expect(fees).toHaveLength(2);
      expect(fees[1]!.amount_cents).toBe(-fees[0]!.amount_cents);
    }

    // The invoices before the cancellation date keep everything, fee included.
    for (const invoice of survivors) {
      expect(invoice.status).toBe('planned');
      expect(invoiceTotal(invoice.id)).toBe(beforeTotals.get(invoice.id));
    }
    const liveFees = survivors.reduce(
      (sum, invoice) =>
        sum +
        repo
          .listItemsForInvoice(db, csr, invoice.id)
          .filter((i) => i.kind === 'fee')
          .reduce((s, i) => s + i.amount_cents, 0),
      0,
    );
    expect(liveFees).toBeGreaterThan(0);
    expect(after.filter((i) => i.kind === 'fee').reduce((s, i) => s + i.amount_cents, 0)).toBe(
      liveFees,
    );

    // Nothing planned is left owing a negative amount.
    for (const invoice of invoices.filter((i) => i.status === 'planned')) {
      expect(invoiceTotal(invoice.id)).toBeGreaterThan(0);
    }

    // What the six installments could not absorb becomes a credit note.
    const credit = invoices.at(-1)!;
    expect(credit.status).toBe('billed');
    expect(credit.due_date).toBe('2027-03-15');
    expect(invoiceTotal(credit.id)).toBeLessThan(0);

    // The premium the cancellation removed is exactly the transaction.
    const added = after.filter((i) => !beforeItems.some(([id]) => id === i.id));
    expect(
      added.filter((i) => i.pattern_code === 'PREMIUM').reduce((s, i) => s + i.amount_cents, 0),
    ).toBe(transaction.amount_cents);
    invariants(policy);
  });

  test('where the line is taxed, the tax on an emptied invoice goes with it', () => {
    const { policy } = issue('monthly', cleanRisk(), quebecAccount().id);
    const { transaction } = cancelMidTerm(policy.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    const voided = invoices.filter((i) => i.status === 'void');
    expect(voided).toHaveLength(6);

    const sumOf = (invoiceId: string, kind: string) =>
      repo
        .listItemsForInvoice(db, csr, invoiceId)
        .filter((i) => i.kind === kind)
        .reduce((s, i) => s + i.amount_cents, 0);

    // A voided invoice collects nothing at all: no premium, no fee, no tax.
    for (const invoice of voided) {
      expect(sumOf(invoice.id, 'installment')).toBe(0);
      expect(sumOf(invoice.id, 'fee')).toBe(0);
      expect(sumOf(invoice.id, 'tax')).toBe(0);
      expect(invoiceTotal(invoice.id)).toBe(0);
    }

    // No invoice is left planned with a negative total.
    for (const invoice of invoices.filter((i) => i.status === 'planned')) {
      expect(invoiceTotal(invoice.id)).toBeGreaterThan(0);
      expect(sumOf(invoice.id, 'tax')).toBeGreaterThan(0);
    }

    // Every tax charge is still covered by its own items, reversals included.
    const items = repo.listItemsForPolicy(db, csr, policy.id);
    const taxCharges = repo
      .listChargesForPolicy(db, csr, policy.id)
      .filter((c) => c.pattern_code === 'TAX-QC');
    expect(taxCharges.length).toBeGreaterThan(1);
    for (const charge of taxCharges) {
      expect(
        items.filter((i) => i.charge_id === charge.id).reduce((s, i) => s + i.amount_cents, 0),
      ).toBe(charge.amount_cents);
    }
    invariants(policy);
  });
});

describe('payments', () => {
  test('a payment is applied oldest invoice first and the rest stays in unapplied cash', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    const firstTotal = invoiceTotal(first.id);
    const result = recordPayment(db, csr, {
      accountId,
      amountCents: firstTotal + 100,
      method: 'eft',
      receivedAt: '2026-09-01',
    });

    expect(result.appliedCents).toBe(firstTotal + 100); // 100 flows into invoice 2
    expect(result.unappliedCents).toBe(0);
    expect(repo.getInvoice(db, csr, first.id)!.status).toBe('paid');
    expect(unappliedCents(db, csr, accountId)).toBe(0);

    // The second invoice took the overflow onto its premium, not its fee.
    const second = repo.listInvoicesForPolicy(db, csr, policy.id)[1]!;
    const secondItems = repo.listItemsForInvoice(db, csr, second.id);
    expect(secondItems.find((i) => i.kind === 'installment')!.paid_cents).toBe(100);
    expect(secondItems.find((i) => i.kind === 'fee')!.paid_cents).toBe(0);
    expect(repo.getInvoice(db, csr, second.id)!.status).toBe('planned');

    // What the account still owes is what the ledger says it owes.
    expect(repo.accountBalance(db, csr, '1100', { accountId })).toBe(
      repo
        .listItemsForAccount(db, csr, accountId)
        .reduce((s, i) => s + i.amount_cents - i.paid_cents, 0),
    );
    expect(repo.listItemApplicationsForPayment(db, csr, result.payment.id)).toHaveLength(3);
  });

  test('overpaying everything leaves a real unapplied cash balance in the ledger', () => {
    const { policy } = issue('full');
    const total = repo
      .listItemsForPolicy(db, csr, policy.id)
      .reduce((s, i) => s + i.amount_cents, 0);
    const result = recordPayment(db, csr, {
      accountId,
      amountCents: total + 5_000,
      method: 'cheque',
      receivedAt: '2026-09-01',
    });

    expect(result.appliedCents).toBe(total);
    expect(unappliedCents(db, csr, accountId)).toBe(5_000);
    expect(repo.accountBalance(db, csr, '1100', { accountId })).toBe(0);
    // Cash clearing holds the whole payment; only the applied part left 2100.
    expect(repo.accountBalance(db, csr, '1200', { accountId })).toBe(total + 5_000);
  });

  test('fee items are settled after the premium on the same invoice', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    const items = repo.listItemsForInvoice(db, csr, first.id);
    const premium = items.find((i) => i.kind === 'installment')!;
    recordPayment(db, csr, {
      accountId,
      amountCents: premium.amount_cents,
      method: 'eft',
      receivedAt: '2026-09-01',
    });

    const after = repo.listItemsForInvoice(db, csr, first.id);
    expect(after.find((i) => i.kind === 'installment')!.paid_cents).toBe(premium.amount_cents);
    expect(after.find((i) => i.kind === 'fee')!.paid_cents).toBe(0);
    expect(repo.getInvoice(db, csr, first.id)!.status).toBe('planned');
  });

  test('a payment targeted at one policy leaves another policy on the account alone', () => {
    const { policy: first } = issue('monthly');
    const { policy: second } = issue('monthly');
    const target = repo.listInvoicesForPolicy(db, csr, second.id)[0]!;

    recordPayment(db, csr, {
      accountId,
      amountCents: invoiceTotal(target.id),
      method: 'eft',
      receivedAt: '2026-09-01',
      policyId: second.id,
    });

    expect(repo.getInvoice(db, csr, target.id)!.status).toBe('paid');
    expect(
      repo.listItemsForPolicy(db, csr, first.id).every((i) => i.paid_cents === 0),
    ).toBe(true);
  });

  test('a zero or negative payment is refused', () => {
    expect(() =>
      recordPayment(db, csr, { accountId, amountCents: 0, method: 'cash', receivedAt: '2026-09-01' }),
    ).toThrow(ApiError);
    expect(() =>
      recordPayment(db, csr, {
        accountId,
        amountCents: -1,
        method: 'cash',
        receivedAt: '2026-09-01',
      }),
    ).toThrow(ApiError);
    expect(repo.listPayments(db, csr, accountId)).toHaveLength(0);
  });

  test('a credit note from a cancellation is a negative receivable, not unapplied cash', () => {
    const { policy } = issue('full');
    const total = repo
      .listItemsForPolicy(db, csr, policy.id)
      .reduce((s, i) => s + i.amount_cents, 0);
    recordPayment(db, csr, {
      accountId,
      amountCents: total,
      method: 'eft',
      receivedAt: '2026-09-01',
    });
    expect(unappliedCents(db, csr, accountId)).toBe(0);
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBe(0);

    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-03-01',
      reason: 'insured request',
    });
    const { transaction } = runJob(cancel.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(2);
    const credit = invoices.at(-1)!;
    expect(credit.status).toBe('billed');
    const creditItems = repo.listItemsForInvoice(db, csr, credit.id);
    expect(creditItems).toHaveLength(1);
    expect(creditItems[0]!.kind).toBe('oneTime');
    expect(creditItems[0]!.amount_cents).toBe(transaction.amount_cents);

    // The refund owed sits as a negative premium receivable on the policy.
    // Money the customer paid was applied, so no unapplied cash was created.
    expect(unappliedCents(db, csr, accountId)).toBe(0);
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBe(
      invoiceTotal(credit.id),
    );
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBeLessThan(0);
  });
});
