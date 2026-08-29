import { beforeEach, describe, expect, test } from 'vitest';
import { runBillingDay } from '../src/billing/billingDay.ts';
import type { Db } from '../src/db.ts';
import { createCancellation, createSubmission } from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { PolicyRow, TenantCtx } from '../src/repo.ts';
import {
  assertInvariants,
  feeItemsOn,
  invoiceTotal as invoiceTotalOf,
  issueSubmission,
  premiumItemsOn,
  quebecAccount as quebecAccountOn,
  runJob as runJobOn,
  type PlanCode,
} from './billingHelpers.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

// ─── What a cancellation does to a schedule ────────────────────────────────
// Split out of `billing.test.ts`, which was approaching the file-size
// ceiling. The shared scaffolding lives in `billingHelpers.ts`.

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

describe('a cancellation mid-period', () => {
  /**
   * Cancelled on the 15th, between two installment dates. Only the invoices
   * whose event date has not yet arrived are in scope, so the schedule is cut
   * short rather than wiped, and the invoice covering the period the
   * cancellation falls inside keeps everything it holds.
   */
  test('empties only the invoices still to fall due and credits the rest', () => {
    const { policy } = issue('monthly');
    const before = new Map(
      repo.listInvoicesForPolicy(db, csr, policy.id).map((i) => [i.id, invoiceTotal(i.id)]),
    );

    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-07-15',
      reason: 'insured request',
    });
    const { transaction } = runJob(cancel.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    const voided = invoices.filter((i) => i.status === 'void');

    // Only 2027-08-01 has an event date on or after the cancellation; the
    // invoice for the period the cancellation falls inside was already due.
    expect(voided.map((i) => i.event_date)).toEqual(['2027-08-01']);
    for (const invoice of voided) {
      expect(invoiceTotal(invoice.id)).toBe(0);
      // The installment fee bought an installment, and there is no longer
      // one: it is reversed by exactly what it charged.
      const fees = feeItemsOn(db, csr, invoice.id);
      expect(fees).toHaveLength(2);
      expect(fees[1]).toBe(-fees[0]!);
    }

    // Every invoice that survives is untouched, fee included.
    const survivors = invoices.filter((i) => i.status === 'planned');
    expect(survivors).toHaveLength(11);
    for (const invoice of survivors) {
      expect(invoiceTotal(invoice.id)).toBe(before.get(invoice.id));
      expect(premiumItemsOn(db, csr, invoice.id)).toHaveLength(1);
      expect(feeItemsOn(db, csr, invoice.id)).toHaveLength(1);
    }

    // Nothing is left partly reduced. A pro-rata refund on a schedule billed
    // in advance always exceeds the premium still to be billed, so a
    // cancellation empties whole invoices and credits the difference; it is
    // a reducing endorsement, not a cancellation, that leaves an invoice
    // standing at a smaller amount (see `billing.test.ts`).
    const partlyReduced = invoices.filter(
      (i) => i.status === 'planned' && premiumItemsOn(db, csr, i.id).length > 1,
    );
    expect(partlyReduced.map((i) => i.event_date)).toEqual([]);

    // What the one emptied invoice could not absorb becomes a credit note.
    const credit = invoices.at(-1)!;
    expect(credit.status).toBe('billed');
    expect(credit.due_date).toBe('2027-07-29'); // effective date plus 14 days
    expect(invoiceTotal(credit.id)).toBeLessThan(0);

    // Every negative premium item the cancellation wrote, on the emptied
    // invoice and on the credit note together, is exactly the transaction.
    const removed = repo
      .listItemsForPolicy(db, csr, policy.id)
      .filter((i) => i.pattern_code === 'PREMIUM' && i.amount_cents < 0)
      .reduce((sum, i) => sum + i.amount_cents, 0);
    expect(removed).toBe(transaction.amount_cents);

    invariants(policy);
  });
});

describe('a cancellation reaches invoices already sent out', () => {
  // Every date here is in the past, because `runBillingDay` refuses a date
  // later than today. The shared fixtures start their term in the future, so
  // this block issues its own submission.
  const PAST_TERM_START = '2024-09-01';

  function issuePast() {
    const job = createSubmission(db, csr, {
      accountId,
      productCode: 'ON_PA',
      effectiveDate: PAST_TERM_START,
      billingPlan: 'monthly',
      risk: cleanRisk(),
    });
    return runJob(job.id);
  }

  test('a billed but unpaid invoice gives up its premium too, after the planned ones', () => {
    const { policy } = issuePast();
    // Invoices are sent 21 days before they fall due, so a run on the 10th of
    // September has already sent out the September and October ones.
    expect(runBillingDay(db, csr, '2024-09-10').billedInvoices).toBe(2);

    const before = repo.listInvoicesForPolicy(db, csr, policy.id);
    const second = before[1]!;
    expect(second.status).toBe('billed');
    expect(second.due_date).toBe('2024-10-01');
    expect(invoiceTotal(second.id)).toBeGreaterThan(0);

    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: second.due_date,
      reason: 'insured request',
    });
    const { transaction } = runJob(cancel.id);
    expect(transaction.amount_cents).toBeLessThan(0);

    // The invoice already in the customer's hands was reduced and emptied,
    // not left standing because it had been sent.
    expect(invoiceTotal(second.id)).toBe(0);
    expect(repo.getInvoice(db, csr, second.id)!.status).toBe('void');

    // Nothing is left asking the customer for cover after the cancellation
    // date: the only billed invoice from that date on is the credit note.
    const after = repo.listInvoicesForPolicy(db, csr, policy.id);
    for (const invoice of after.filter(
      (i) => i.status === 'billed' && i.event_date >= second.due_date,
    )) {
      expect(invoiceTotal(invoice.id)).toBeLessThanOrEqual(0);
    }

    // The September invoice, for cover the customer actually had, stands.
    expect(repo.getInvoice(db, csr, before[0]!.id)!.status).toBe('billed');
    expect(invoiceTotal(before[0]!.id)).toBeGreaterThan(0);

    // Every negative premium item the cancellation wrote sums to exactly the
    // return premium of record.
    const removed = repo
      .listItemsForPolicy(db, csr, policy.id)
      .filter((i) => i.pattern_code === 'PREMIUM' && i.amount_cents < 0)
      .reduce((sum, i) => sum + i.amount_cents, 0);
    expect(removed).toBe(transaction.amount_cents);

    invariants(policy);
  });
});

describe('reversal items name what they take off', () => {
  test('every fee and tax reversal offsets an item on the same invoice, opposite in sign', () => {
    // Quebec, so the tax path is exercised as well as the fee path.
    const { policy } = issue('monthly', cleanRisk(), quebecAccount().id);
    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2027-03-01',
      reason: 'insured request',
    });
    runJob(cancel.id);

    const items = repo.listItemsForPolicy(db, csr, policy.id);
    const byId = new Map(items.map((i) => [i.id, i]));
    const linked = items.filter((i) => i.offsets_item_id !== null);
    expect(linked.length).toBeGreaterThan(0);

    for (const reversal of linked) {
      expect(reversal.kind === 'fee' || reversal.kind === 'tax').toBe(true);
      const original = byId.get(reversal.offsets_item_id!);
      expect(original).toBeDefined();
      expect(original!.invoice_id).toBe(reversal.invoice_id);
      expect(original!.pattern_code).toBe(reversal.pattern_code);
      expect(Math.sign(original!.amount_cents)).toBe(-Math.sign(reversal.amount_cents));
    }

    // A premium re-spread item offsets an invoice rather than a single line,
    // so it never claims to cancel one.
    expect(
      items.filter((i) => i.pattern_code === 'PREMIUM').every((i) => i.offsets_item_id === null),
    ).toBe(true);
  });
});
