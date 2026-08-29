import type { Db } from '../db.ts';
import * as repo from '../repo.ts';
import type { BillingInvoiceRow, InvoiceItemRow, PolicyRow, TenantCtx } from '../repo.ts';
import { unappliedCents } from './payments.ts';
import { PREMIUM_RECEIVABLE } from './shared.ts';

// ─── Reading billing back ──────────────────────────────────────────────────
// Nothing here writes. An invoice row carries no amount of its own: what it
// is worth is the sum of the immutable items placed on it, and what has been
// settled is the sum of their `paid_cents`. Every number a screen shows is
// derived that way, so the read model can never drift from the items — and
// `assertBillingInvariants` proves it has not drifted from the ledger either.

export type InvoiceDisplayStatus = 'planned' | 'due' | 'overdue' | 'paid' | 'void' | 'credit';

export interface InvoiceView extends BillingInvoiceRow {
  totalCents: number;
  paidCents: number;
  /** What is still to collect. Negative on a credit note: money owed back. */
  outstandingCents: number;
  displayStatus: InvoiceDisplayStatus;
  lines: InvoiceItemRow[];
}

export interface BillingTotals {
  billedCents: number;
  paidCents: number;
  /** Positive = the customer owes money; negative = they are in credit. */
  balanceCents: number;
  pastDueCents: number;
  nextDue: { dueDate: string; amountCents: number } | null;
}

export interface PolicyBilling extends BillingTotals {
  plan: string;
  invoices: InvoiceView[];
}

/**
 * What an invoice says on the customer's statement today. The stored status
 * records where the invoice is in its own lifecycle; this adds what only the
 * date and the money can say — that it has fallen due, or gone past due, or
 * been settled, or is a credit note rather than a bill.
 */
export function displayStatus(
  invoice: BillingInvoiceRow,
  lines: InvoiceItemRow[],
  today: string,
): InvoiceDisplayStatus {
  if (invoice.status === 'void') return 'void';
  const totalCents = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  if (totalCents < 0) return 'credit';
  const positive = lines.filter((line) => line.amount_cents > 0);
  // An invoice with nothing positive on it has collected nothing, so it is
  // not paid — it is a schedule line waiting for its items.
  if (positive.length > 0 && positive.every((line) => line.paid_cents >= line.amount_cents)) {
    return 'paid';
  }
  if (invoice.due_date < today) return 'overdue';
  if (invoice.status === 'billed' || invoice.due_date <= today) return 'due';
  return 'planned';
}

function viewOf(invoice: BillingInvoiceRow, lines: InvoiceItemRow[], today: string): InvoiceView {
  const totalCents = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  const paidCents = lines.reduce((sum, line) => sum + line.paid_cents, 0);
  return {
    ...invoice,
    totalCents,
    paidCents,
    outstandingCents: totalCents - paidCents,
    displayStatus: displayStatus(invoice, lines, today),
    lines,
  };
}

/** One read of the items, indexed by the invoice they sit on. */
function linesByInvoice(items: InvoiceItemRow[]): Map<string, InvoiceItemRow[]> {
  const byInvoice = new Map<string, InvoiceItemRow[]>();
  for (const item of items) {
    const lines = byInvoice.get(item.invoice_id);
    if (lines) lines.push(item);
    else byInvoice.set(item.invoice_id, [item]);
  }
  for (const lines of byInvoice.values()) lines.sort((a, b) => a.sequence - b.sequence);
  return byInvoice;
}

function viewsOf(
  invoices: BillingInvoiceRow[],
  items: InvoiceItemRow[],
  today: string,
): InvoiceView[] {
  const byInvoice = linesByInvoice(items);
  return invoices.map((invoice) => viewOf(invoice, byInvoice.get(invoice.id) ?? [], today));
}

/**
 * The money a set of invoices adds up to. A voided invoice is left out of
 * every total: it collects nothing and owes nothing.
 */
function totalsOf(views: InvoiceView[], today: string): BillingTotals {
  const live = views.filter((view) => view.status !== 'void');
  const upcoming = live
    .filter((view) => view.totalCents > 0 && view.outstandingCents > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  return {
    billedCents: live.reduce((sum, view) => sum + view.totalCents, 0),
    paidCents: live.reduce((sum, view) => sum + view.paidCents, 0),
    balanceCents: live.reduce((sum, view) => sum + view.outstandingCents, 0),
    // Strictly before today: an invoice due today is due, not late.
    pastDueCents: live
      .filter((view) => view.due_date < today && view.outstandingCents > 0)
      .reduce((sum, view) => sum + view.outstandingCents, 0),
    nextDue: upcoming
      ? { dueDate: upcoming.due_date, amountCents: upcoming.outstandingCents }
      : null,
  };
}

export function policyBilling(
  db: Db,
  ctx: TenantCtx,
  policy: PolicyRow,
  today: string,
): PolicyBilling {
  const invoices = viewsOf(
    repo.listInvoicesForPolicy(db, ctx, policy.id),
    repo.listItemsForPolicy(db, ctx, policy.id),
    today,
  );
  return { plan: policy.billing_plan, invoices, ...totalsOf(invoices, today) };
}

/** Every invoice on an account, newest schedule last, ready for a statement. */
export function accountInvoices(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  today: string,
): InvoiceView[] {
  return viewsOf(
    repo.listInvoicesForAccount(db, ctx, accountId),
    repo.listItemsForAccount(db, ctx, accountId),
    today,
  );
}

export interface AccountBillingTotals extends BillingTotals {
  /** Cash the account holds that has not settled anything yet. */
  unappliedCents: number;
}

export function accountBillingTotals(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  today: string,
): AccountBillingTotals {
  return {
    ...totalsOf(accountInvoices(db, ctx, accountId, today), today),
    unappliedCents: unappliedCents(db, ctx, accountId),
  };
}

/**
 * The three invariants of the billing design, checked against the database
 * as it actually stands. Throws naming the first one that fails.
 *
 * 1. **Ledger balance** — every journal entry's debits equal its credits.
 * 2. **Charge coverage** — every charge's items sum to the charge.
 * 3. **Receivable truth** — the premium receivable the ledger holds for the
 *    account equals what its live items still owe.
 *
 * Tests call this after every billing operation. It is deliberately a
 * function rather than a set of assertions in one test file: a new job type
 * or a new payment path must be provable against the same three rules
 * without restating them.
 */
export function assertBillingInvariants(db: Db, ctx: TenantCtx, accountId: string): void {
  const unbalanced = repo.unbalancedEntryIds(db, ctx);
  if (unbalanced.length > 0) {
    throw new Error(
      `Ledger balance violated: ${unbalanced.length} journal entr${
        unbalanced.length === 1 ? 'y does' : 'ies do'
      } not balance (first: ${unbalanced[0]})`,
    );
  }

  const items = repo.listItemsForAccount(db, ctx, accountId);
  const byCharge = new Map<string, number>();
  for (const item of items) {
    byCharge.set(item.charge_id, (byCharge.get(item.charge_id) ?? 0) + item.amount_cents);
  }
  for (const charge of repo.listChargesForAccount(db, ctx, accountId)) {
    const covered = byCharge.get(charge.id) ?? 0;
    if (covered !== charge.amount_cents) {
      throw new Error(
        `Charge coverage violated: charge ${charge.id} (${charge.pattern_code}) is ` +
          `${charge.amount_cents} cents but its items sum to ${covered}`,
      );
    }
  }

  const live = new Set(
    repo
      .listInvoicesForAccount(db, ctx, accountId)
      .filter((invoice) => invoice.status !== 'void')
      .map((invoice) => invoice.id),
  );
  const owed = items
    .filter((item) => live.has(item.invoice_id))
    .reduce((sum, item) => sum + item.amount_cents - item.paid_cents, 0);
  const receivable = repo.accountBalance(db, ctx, PREMIUM_RECEIVABLE, { accountId });
  if (owed !== receivable) {
    throw new Error(
      `Receivable truth violated: the ledger holds ${receivable} cents of premium ` +
        `receivable for account ${accountId} but its live items owe ${owed}`,
    );
  }
}
