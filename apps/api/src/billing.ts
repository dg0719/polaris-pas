import { buildSchedule, spreadDelta, type InstallmentPlan } from '@polaris/domain';
import type { Db } from './db.ts';
import { addDays, addMonths } from './dates.ts';
import { ApiError } from './errors.ts';
import * as repo from './repo.ts';
import type { InvoiceRow, PaymentRow, PolicyRow, TenantCtx } from './repo.ts';

/**
 * Billing invariant: for any policy,
 *
 *     sum(non-void invoice amounts) === sum(transaction amounts)
 *
 * New business and renewals lay down a schedule; endorsements and
 * cancellations move the transaction total and `reconcile` pulls the schedule
 * back onto it. No job type edits invoices directly.
 */

const DAYS_UNTIL_DUE = 14;

function nextSequence(invoices: InvoiceRow[]): number {
  return invoices.reduce((max, i) => Math.max(max, i.sequence), 0) + 1;
}

function invoiceNumber(policy: PolicyRow, sequence: number): string {
  return `${policy.policy_number}-${String(sequence).padStart(2, '0')}`;
}

/** Lay down the installment schedule for a newly issued term. */
export function scheduleTerm(
  db: Db,
  ctx: TenantCtx,
  policy: PolicyRow,
  input: {
    termNumber: number;
    termStart: string;
    termMonths: number;
    amountCents: number;
    plan: InstallmentPlan;
  },
): InvoiceRow[] {
  const existing = repo.listInvoicesForPolicy(db, ctx, policy.id);
  let sequence = nextSequence(existing);

  return buildSchedule(input.amountCents, input.plan, input.termMonths).map((installment) => {
    const invoice = repo.insertInvoice(db, ctx, {
      account_id: policy.account_id,
      policy_id: policy.id,
      invoice_number: invoiceNumber(policy, sequence),
      sequence,
      term_number: input.termNumber,
      due_date: addMonths(input.termStart, installment.monthsFromStart),
      amount_cents: installment.amountCents,
      paid_cents: 0,
      status: 'open',
    });
    sequence += 1;
    return invoice;
  });
}

/**
 * Pull the invoice schedule back onto the policy's transaction total.
 *
 * Additional premium spreads across untouched installments; return premium
 * comes off the latest ones first and, if there is nothing left to reduce,
 * lands as a credit the customer is owed.
 */
export function reconcile(
  db: Db,
  ctx: TenantCtx,
  policy: PolicyRow,
  input: { effectiveDate: string; termNumber: number },
): void {
  const target = repo
    .listTransactions(db, ctx, policy.id)
    .reduce((sum, tx) => sum + tx.amount_cents, 0);

  const invoices = repo.listInvoicesForPolicy(db, ctx, policy.id).filter((i) => i.status !== 'void');
  const billed = invoices.reduce((sum, i) => sum + i.amount_cents, 0);
  const delta = target - billed;
  if (delta === 0) return;

  // Only installments nobody has paid against can still be reshaped.
  const open = invoices.filter((i) => i.paid_cents === 0 && i.amount_cents > 0);
  const { adjusted, unabsorbedCents } = spreadDelta(
    delta,
    open.map((i) => ({ sequence: i.sequence, amountCents: i.amount_cents, id: i.id })),
  );

  for (const next of adjusted) {
    const before = open.find((i) => i.id === next.id)!;
    if (before.amount_cents === next.amountCents) continue;
    repo.updateInvoice(db, ctx, next.id, {
      amount_cents: next.amountCents,
      status: next.amountCents === 0 ? 'void' : 'open',
    });
  }

  if (unabsorbedCents !== 0) {
    const sequence = nextSequence(repo.listInvoicesForPolicy(db, ctx, policy.id));
    repo.insertInvoice(db, ctx, {
      account_id: policy.account_id,
      policy_id: policy.id,
      invoice_number: invoiceNumber(policy, sequence),
      sequence,
      term_number: input.termNumber,
      due_date: addDays(input.effectiveDate, DAYS_UNTIL_DUE),
      amount_cents: unabsorbedCents,
      paid_cents: 0,
      status: 'open',
    });
  }
}

// ─── Payments ───────────────────────────────────────────────────────────────

export interface PaymentInput {
  accountId: string;
  amountCents: number;
  method: PaymentRow['method'];
  reference?: string;
  receivedAt: string;
}

export interface PaymentResult {
  payment: PaymentRow;
  appliedCents: number;
  /** Money left over after every open invoice was satisfied. */
  unappliedCents: number;
}

/**
 * Record a payment and apply it to open invoices, oldest due date first.
 * Anything left over stays on the account as credit rather than being refused.
 */
export function recordPayment(db: Db, ctx: TenantCtx, input: PaymentInput): PaymentResult {
  if (input.amountCents <= 0) {
    throw ApiError.badRequest('Payment amount must be greater than zero', 'invalid_amount');
  }

  const payment = repo.insertPayment(db, ctx, {
    account_id: input.accountId,
    amount_cents: input.amountCents,
    method: input.method,
    reference: input.reference ?? null,
    received_at: input.receivedAt,
  });

  let remaining = input.amountCents;
  const outstanding = repo
    .listInvoicesForAccount(db, ctx, input.accountId)
    .filter((i) => i.status === 'open' && i.amount_cents > i.paid_cents);

  for (const invoice of outstanding) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, invoice.amount_cents - invoice.paid_cents);
    const paid = invoice.paid_cents + applied;
    repo.insertPaymentApplication(db, ctx, {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amountCents: applied,
    });
    repo.updateInvoice(db, ctx, invoice.id, {
      paid_cents: paid,
      status: paid >= invoice.amount_cents ? 'paid' : 'open',
    });
    remaining -= applied;
  }

  return {
    payment,
    appliedCents: input.amountCents - remaining,
    unappliedCents: remaining,
  };
}

// ─── Read models ────────────────────────────────────────────────────────────

export type InvoiceDisplayStatus = 'planned' | 'due' | 'overdue' | 'paid' | 'void' | 'credit';

export function invoiceDisplayStatus(invoice: InvoiceRow, today: string): InvoiceDisplayStatus {
  if (invoice.status === 'void') return 'void';
  if (invoice.amount_cents < 0) return 'credit';
  if (invoice.paid_cents >= invoice.amount_cents) return 'paid';
  if (invoice.due_date < today) return 'overdue';
  if (invoice.due_date <= today) return 'due';
  return 'planned';
}

export interface PolicyBilling {
  plan: InstallmentPlan;
  invoices: (InvoiceRow & { displayStatus: InvoiceDisplayStatus })[];
  billedCents: number;
  paidCents: number;
  balanceCents: number;
  pastDueCents: number;
  nextDue: { dueDate: string; amountCents: number } | null;
}

export function policyBilling(
  db: Db,
  ctx: TenantCtx,
  policy: PolicyRow,
  today: string,
): PolicyBilling {
  const invoices = repo
    .listInvoicesForPolicy(db, ctx, policy.id)
    .map((invoice) => ({ ...invoice, displayStatus: invoiceDisplayStatus(invoice, today) }));

  const live = invoices.filter((i) => i.status !== 'void');
  const billedCents = live.reduce((sum, i) => sum + i.amount_cents, 0);
  const paidCents = live.reduce((sum, i) => sum + i.paid_cents, 0);
  const pastDueCents = live
    .filter((i) => i.displayStatus === 'overdue')
    .reduce((sum, i) => sum + (i.amount_cents - i.paid_cents), 0);

  const upcoming = live
    .filter((i) => i.amount_cents > i.paid_cents && i.amount_cents > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  return {
    plan: policy.billing_plan,
    invoices,
    billedCents,
    paidCents,
    balanceCents: billedCents - paidCents,
    pastDueCents,
    nextDue: upcoming
      ? { dueDate: upcoming.due_date, amountCents: upcoming.amount_cents - upcoming.paid_cents }
      : null,
  };
}
