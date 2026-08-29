import { beforeEach, describe, expect, test } from 'vitest';
import { accountRollup } from '../src/accounts.ts';
import { recordPayment, unappliedCents } from '../src/billing/payments.ts';
import { assertBillingInvariants, displayStatus, policyBilling } from '../src/billing/readModel.ts';
import type { Db } from '../src/db.ts';
import { ApiError } from '../src/errors.ts';
import { createCancellation, createPolicyChange } from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { PolicyRow, TenantCtx } from '../src/repo.ts';
import {
  assertInvariants,
  invoiceTotal as invoiceTotalOf,
  issueSubmission,
  quebecAccount as quebecAccountOn,
  runJob as runJobOn,
  withCollision,
  TERM_START,
  type PlanCode,
} from './billingHelpers.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

// Cancellation lives in `billingCancellation.test.ts`; this file covers
// schedule generation, endorsements, payments and the read model.

let db: Db;
let csr: TenantCtx;
let accountId: string;

beforeEach(() => {
  db = testDb();
  const tenant = makeTenant(db);
  csr = tenant.ctx.csr;
  accountId = makeAccount(db, csr).id;
});

function issue(plan: PlanCode, risk = cleanRisk(), onAccountId = accountId) {
  return issueSubmission(db, csr, { accountId: onAccountId, plan, risk });
}

function runJob(jobId: string) {
  return runJobOn(db, csr, jobId);
}

function quebecAccount() {
  return quebecAccountOn(db, csr);
}

function invoiceTotal(invoiceId: string): number {
  return invoiceTotalOf(db, csr, invoiceId);
}

function invariants(policy: PolicyRow): void {
  assertInvariants(db, csr, policy);
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

  test('a partly reduced invoice keeps its fee; only an emptied one has it reversed', () => {
    // A reducing endorsement is the case that leaves an invoice standing at a
    // smaller amount: the return premium is less than the schedule still to
    // be billed, so the latest invoice is emptied and the one before it is
    // only partly reduced. (A cancellation cannot reach this state — a
    // pro-rata refund always exceeds what is still to be billed.)
    const { policy } = issue('monthly', withCollision(cleanRisk()));
    const before = new Map(
      repo.listInvoicesForPolicy(db, csr, policy.id).map((i) => [i.id, invoiceTotal(i.id)]),
    );

    const change = createPolicyChange(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-01-15',
      risk: cleanRisk(),
    });
    const { transaction } = runJob(change.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    // The schedule absorbed the whole reduction: no credit note was needed.
    expect(invoices).toHaveLength(12);

    const premiumOn = (invoiceId: string) =>
      repo
        .listItemsForInvoice(db, csr, invoiceId)
        .filter((i) => i.pattern_code === 'PREMIUM')
        .map((i) => i.amount_cents);
    const feesOn = (invoiceId: string) =>
      repo
        .listItemsForInvoice(db, csr, invoiceId)
        .filter((i) => i.kind === 'fee')
        .map((i) => i.amount_cents);

    const emptied = invoices.filter((i) => i.status === 'void');
    const reduced = invoices.filter((i) => i.status !== 'void' && premiumOn(i.id).length > 1);

    // Return premium comes off the latest invoice first, so the last one is
    // emptied and the one before it takes what is left of the reduction.
    expect(emptied.map((i) => i.event_date)).toEqual(['2027-08-01']);
    expect(reduced.map((i) => i.event_date)).toEqual(['2027-07-01']);

    // The partly reduced invoice still buys an installment, so it still
    // carries the fee that bought it — untouched, and not reversed.
    const partly = reduced[0]!;
    expect(invoiceTotal(partly.id)).toBeGreaterThan(0);
    expect(invoiceTotal(partly.id)).toBeLessThan(before.get(partly.id)!);
    expect(premiumOn(partly.id).reduce((s, a) => s + a, 0)).toBeGreaterThan(0);
    expect(feesOn(partly.id)).toHaveLength(1);
    expect(feesOn(partly.id)[0]).toBeGreaterThan(0);

    // The emptied one loses its fee with its premium.
    const gone = emptied[0]!;
    expect(invoiceTotal(gone.id)).toBe(0);
    expect(feesOn(gone.id)).toHaveLength(2);
    expect(feesOn(gone.id)[1]).toBe(-feesOn(gone.id)[0]!);

    // Every other invoice is exactly as it was, fee included.
    for (const invoice of invoices) {
      if (invoice.id === partly.id || invoice.id === gone.id) continue;
      expect(invoiceTotal(invoice.id)).toBe(before.get(invoice.id));
      expect(feesOn(invoice.id)).toHaveLength(1);
    }

    // The premium the endorsement removed is exactly the transaction.
    expect(
      repo
        .listItemsForPolicy(db, csr, policy.id)
        .filter((i) => i.pattern_code === 'PREMIUM' && i.amount_cents < 0)
        .reduce((sum, i) => sum + i.amount_cents, 0),
    ).toBe(transaction.amount_cents);

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

describe('the read model', () => {
  /** The display status of every invoice on a policy, in schedule order. */
  function statusesAt(policy: PolicyRow, today: string): string[] {
    return policyBilling(db, csr, policy, today).invoices.map((i) => i.displayStatus);
  }

  test('an invoice reads planned, then due on its date, then overdue after it', () => {
    const { policy } = issue('monthly');
    // Nothing has been billed yet: the first invoice is not even printed
    // until 2026-08-11, three weeks before it falls due.
    expect(statusesAt(policy, '2026-08-01')[0]).toBe('planned');
    expect(statusesAt(policy, '2026-09-01')[0]).toBe('due');
    expect(statusesAt(policy, '2026-10-05').slice(0, 3)).toEqual(['overdue', 'overdue', 'planned']);
  });

  test('an invoice settled in full reads paid, whatever the date', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    recordPayment(db, csr, {
      accountId,
      amountCents: invoiceTotal(first.id),
      method: 'eft',
      receivedAt: '2026-09-01',
    });
    expect(statusesAt(policy, '2026-10-05')[0]).toBe('paid');
  });

  test('a cancellation leaves voided invoices and a credit note, each named as such', () => {
    const { policy } = issue('monthly');
    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-03-01',
      reason: 'insured request',
    });
    runJob(cancel.id);

    const billing = policyBilling(db, csr, policy, '2027-03-02');
    expect(billing.invoices.filter((i) => i.displayStatus === 'void')).toHaveLength(6);
    expect(billing.invoices.at(-1)!.displayStatus).toBe('credit');
    expect(billing.invoices.at(-1)!.totalCents).toBeLessThan(0);
    // A voided invoice is not money the customer owes.
    expect(billing.billedCents).toBe(
      billing.invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + i.totalCents, 0),
    );
  });

  test('every invoice carries its own lines, and they sum to its total', () => {
    const { policy } = issue('monthly');
    for (const invoice of policyBilling(db, csr, policy, '2026-09-01').invoices) {
      expect(invoice.lines.map((l) => l.kind)).toEqual(['installment', 'fee']);
      expect(invoice.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(invoice.totalCents);
    }
  });

  test('an invoice with nothing positive on it does not read as paid', () => {
    // A schedule line whose items have not been written yet has collected
    // nothing, so it is waiting, not settled. Without the guard an empty
    // `every` returns true and the invoice would read 'paid'.
    const { policy } = issue('monthly');
    const invoice = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    expect(displayStatus(invoice, [], '2026-08-01')).toBe('planned');
    expect(displayStatus(invoice, [], '2026-10-05')).toBe('overdue');
    expect(displayStatus({ ...invoice, status: 'billed' }, [], '2026-08-01')).toBe('due');
  });

  test('the policy balance is the receivable the ledger holds for that policy', () => {
    const { policy } = issue('monthly');
    const ledger = () => repo.accountBalance(db, csr, '1100', { policyId: policy.id });
    expect(policyBilling(db, csr, policy, '2026-09-01').balanceCents).toBe(ledger());

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    recordPayment(db, csr, {
      accountId,
      amountCents: invoiceTotal(invoices[0]!.id),
      method: 'eft',
      receivedAt: '2026-09-01',
    });
    const after = policyBilling(db, csr, policy, '2026-10-05');
    expect(after.balanceCents).toBe(ledger());
    expect(after.paidCents).toBe(invoiceTotal(invoices[0]!.id));
    // Only the second invoice is past due; the first was settled.
    expect(after.pastDueCents).toBe(invoiceTotal(invoices[1]!.id));
    expect(after.nextDue).toEqual({
      dueDate: '2026-10-01',
      amountCents: invoiceTotal(invoices[1]!.id),
    });
  });

  test('the account rollup agrees with the ledger and reports unapplied cash', () => {
    const { policy } = issue('full');
    const total = repo
      .listItemsForPolicy(db, csr, policy.id)
      .reduce((s, i) => s + i.amount_cents, 0);
    recordPayment(db, csr, {
      accountId,
      amountCents: total + 2_500,
      method: 'cheque',
      receivedAt: '2026-09-01',
    });

    const rollup = accountRollup(db, csr, accountId, '2026-09-02');
    expect(rollup.balanceCents).toBe(repo.accountBalance(db, csr, '1100', { accountId }));
    expect(rollup.balanceCents).toBe(0);
    expect(rollup.paidCents).toBe(total);
    expect(rollup.unappliedCents).toBe(2_500);
    expect(rollup.pastDueCents).toBe(0);
  });

  test('a cancellation late in the term leaves the earlier invoices, fees included, intact', () => {
    const { policy } = issue('monthly');
    const before = new Map(
      repo.listInvoicesForPolicy(db, csr, policy.id).map((i) => [i.id, invoiceTotal(i.id)]),
    );
    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-07-01',
      reason: 'insured request',
    });
    runJob(cancel.id);

    const invoices = policyBilling(db, csr, policy, '2027-07-02').invoices;
    // Only the installments still to fall due are emptied.
    expect(invoices.filter((i) => i.displayStatus === 'void').map((i) => i.due_date)).toEqual([
      '2027-07-01',
      '2027-08-01',
    ]);
    // Every invoice that survives keeps exactly what it held, fee included:
    // its installment was bought, so the fee that bought it stands.
    for (const invoice of invoices.filter((i) => i.status === 'planned')) {
      expect(invoice.totalCents).toBe(before.get(invoice.id));
      expect(
        invoice.lines.filter((l) => l.kind === 'fee').reduce((s, l) => s + l.amount_cents, 0),
      ).toBeGreaterThan(0);
    }
    invariants(policy);
  });

  test('a payment with nothing outstanding is held as unapplied cash in full', () => {
    const { policy } = issue('full');
    const total = repo
      .listItemsForPolicy(db, csr, policy.id)
      .reduce((s, i) => s + i.amount_cents, 0);
    recordPayment(db, csr, { accountId, amountCents: total, method: 'eft', receivedAt: '2026-09-01' });

    const second = recordPayment(db, csr, {
      accountId,
      amountCents: 4_000,
      method: 'eft',
      receivedAt: '2026-09-02',
    });
    expect(second.appliedCents).toBe(0);
    expect(second.unappliedCents).toBe(4_000);
    expect(repo.listItemApplicationsForPayment(db, csr, second.payment.id)).toEqual([]);
    assertBillingInvariants(db, csr, accountId);
  });

  test('a payment targeted at a policy with nothing due leaves the other policy alone', () => {
    const { policy: settled } = issue('full');
    const { policy: other } = issue('monthly');
    const settledTotal = repo
      .listItemsForPolicy(db, csr, settled.id)
      .reduce((s, i) => s + i.amount_cents, 0);
    recordPayment(db, csr, {
      accountId,
      amountCents: settledTotal,
      method: 'eft',
      receivedAt: '2026-09-01',
      policyId: settled.id,
    });

    const result = recordPayment(db, csr, {
      accountId,
      amountCents: 10_000,
      method: 'eft',
      receivedAt: '2026-09-02',
      policyId: settled.id,
    });
    expect(result.appliedCents).toBe(0);
    expect(result.unappliedCents).toBe(10_000);
    expect(repo.listItemsForPolicy(db, csr, other.id).every((i) => i.paid_cents === 0)).toBe(true);
    assertBillingInvariants(db, csr, accountId);
  });

  test('a later payment does not settle a credit note', () => {
    const { policy } = issue('full');
    const total = repo
      .listItemsForPolicy(db, csr, policy.id)
      .reduce((s, i) => s + i.amount_cents, 0);
    recordPayment(db, csr, { accountId, amountCents: total, method: 'eft', receivedAt: '2026-09-01' });
    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-03-01',
      reason: 'insured request',
    });
    runJob(cancel.id);

    const credit = repo.listInvoicesForPolicy(db, csr, policy.id).at(-1)!;
    expect(repo.listItemsForInvoice(db, csr, credit.id)[0]!.amount_cents).toBeLessThan(0);

    const result = recordPayment(db, csr, {
      accountId,
      amountCents: 3_000,
      method: 'eft',
      receivedAt: '2027-03-02',
    });

    // Cash never settles money the carrier owes the customer.
    expect(result.appliedCents).toBe(0);
    expect(result.unappliedCents).toBe(3_000);
    expect(repo.listItemsForInvoice(db, csr, credit.id)[0]!.paid_cents).toBe(0);
    assertBillingInvariants(db, csr, accountId);
  });
});
