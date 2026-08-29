import { postingsFor } from '@polaris/domain';
import type { ChargePatternDef } from '@polaris/domain';
import { inTransaction, type Db } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type { BillingInvoiceRow, InvoiceItemRow, PaymentRow, TenantCtx } from '../repo.ts';
import { UNAPPLIED_CASH } from './shared.ts';

// ─── Taking money and settling what it pays for ────────────────────────────
// A payment is cash arriving, which is a fact on its own: it reaches the
// ledger in full the moment it is recorded (debit cash clearing, credit
// unapplied cash). Working out what it settles is a second, separate step —
// each item it pays down moves that much out of unapplied cash and off the
// premium receivable. Whatever settles nothing stays as unapplied cash, a
// real credit balance the customer owns, not a rounding remainder.
//
// Nothing here edits an item's amount. Only `paid_cents` moves, and every
// movement is recorded as an `item_applications` row, so what a payment did
// can be read back line by line.

export interface PaymentInput {
  accountId: string;
  amountCents: number;
  method: PaymentRow['method'];
  reference?: string;
  receivedAt: string;
  /** Settle only this policy's items. Absent, the whole account is in scope. */
  policyId?: string;
}

export interface PaymentResult {
  payment: PaymentRow;
  appliedCents: number;
  unappliedCents: number;
}

/** Cash the account holds that has not settled anything yet. Unapplied cash
 * (2100) is a credit-side account, so a held balance reads negative. */
export function unappliedCents(db: Db, ctx: TenantCtx, accountId: string): number {
  const balance = repo.accountBalance(db, ctx, UNAPPLIED_CASH, { accountId });
  // Negating a zero balance would yield `-0`, which is a distinct value in
  // JavaScript and reads as a defect everywhere downstream.
  return balance === 0 ? 0 : -balance;
}

export function recordPayment(db: Db, ctx: TenantCtx, input: PaymentInput): PaymentResult {
  if (input.amountCents <= 0) {
    throw ApiError.badRequest('A payment must be for a positive amount', 'invalid_amount');
  }

  // Taking the money, posting it and applying it are one act: a crash between
  // them would leave cash on the ledger that settled nothing on the schedule.
  return inTransaction(db, () => {
    const payment = repo.insertPayment(db, ctx, {
      account_id: input.accountId,
      amount_cents: input.amountCents,
      method: input.method,
      reference: input.reference ?? null,
      received_at: input.receivedAt,
      status: 'cleared',
      created_by: ctx.userId,
      policy_id: input.policyId ?? null,
    });

    repo.postEntry(
      db,
      ctx,
      postingsFor({
        type: 'paymentReceived',
        amountCents: payment.amount_cents,
        effectiveDate: payment.received_at,
        paymentId: payment.id,
        accountId: payment.account_id,
        method: payment.method,
      }),
    );

    const appliedCents = applyToItems(db, ctx, payment, input.policyId ?? null);
    return { payment, appliedCents, unappliedCents: unappliedCents(db, ctx, input.accountId) };
  });
}

/** Settle as much of the schedule as the payment reaches. Returns what it
 * settled; the remainder is left sitting in unapplied cash. */
function applyToItems(
  db: Db,
  ctx: TenantCtx,
  payment: PaymentRow,
  policyId: string | null,
): number {
  const items = eligibleItems(db, ctx, payment.account_id, policyId);
  let remaining = payment.amount_cents;
  let applied = 0;
  const touched = new Set<string>();

  for (const item of items) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, item.amount_cents - item.paid_cents);
    const application = repo.insertItemApplication(db, ctx, {
      payment_id: payment.id,
      item_id: item.id,
      amount_cents: amount,
    });
    repo.setItemPaid(db, ctx, item.id, item.paid_cents + amount);
    // One posting per application, never one for the payment as a whole: the
    // receivable it relieves belongs to a particular policy, and the ledger's
    // reference for a distribution is the application that caused it. A
    // payment that settles nothing therefore posts nothing — never a zero
    // entry.
    repo.postEntry(
      db,
      ctx,
      postingsFor({
        type: 'distribution',
        amountCents: amount,
        effectiveDate: payment.received_at,
        applicationId: application.id,
        accountId: payment.account_id,
        policyId: item.policy_id,
      }),
    );
    remaining -= amount;
    applied += amount;
    touched.add(item.invoice_id);
  }

  for (const invoiceId of touched) settleInvoice(db, ctx, invoiceId);
  return applied;
}

/**
 * What this payment may settle, in the order it settles them: the oldest
 * invoice first, and within an invoice the highest-priority charge pattern
 * first — premium (50) before tax (40) before the installment fee (10) — so
 * a short payment leaves the fee outstanding rather than the cover the
 * customer bought. Sequence breaks any remaining tie, which keeps the order
 * the same on every run.
 *
 * A credit note's negative item is not eligible: cash does not settle money
 * the carrier owes the customer.
 */
function eligibleItems(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  policyId: string | null,
): InvoiceItemRow[] {
  // One read of the catalogue and one of the account's invoices for the whole
  // payment, not one per item.
  const patterns = new Map<string, ChargePatternDef>(
    repo.listChargePatterns(db, ctx).map((p) => [p.code, p]),
  );
  const invoices = new Map<string, BillingInvoiceRow>(
    repo.listInvoicesForAccount(db, ctx, accountId).map((i) => [i.id, i]),
  );
  const priorityOf = (item: InvoiceItemRow) => patterns.get(item.pattern_code)?.priority ?? 0;
  const items = policyId
    ? repo.listItemsForPolicy(db, ctx, policyId)
    : repo.listItemsForAccount(db, ctx, accountId);

  // A missing invoice means the item hangs off another account's policy,
  // which this payment must not touch — `invoices` holds only this account's.
  return items
    .filter((i) => {
      const invoice = invoices.get(i.invoice_id);
      return (
        invoice !== undefined &&
        invoice.status !== 'void' &&
        i.amount_cents > 0 &&
        i.paid_cents < i.amount_cents
      );
    })
    .sort((a, b) => {
      const dueA = invoices.get(a.invoice_id)!.due_date;
      const dueB = invoices.get(b.invoice_id)!.due_date;
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      if (priorityOf(a) !== priorityOf(b)) return priorityOf(b) - priorityOf(a);
      return a.sequence - b.sequence;
    });
}

/** An invoice whose every positive line is settled has nothing left to
 * collect. A partly paid one keeps the status it had. */
function settleInvoice(db: Db, ctx: TenantCtx, invoiceId: string): void {
  const invoice = repo.getInvoice(db, ctx, invoiceId);
  if (!invoice || invoice.status === 'void' || invoice.status === 'paid') return;
  const settled = repo
    .listItemsForInvoice(db, ctx, invoiceId)
    .filter((i) => i.amount_cents > 0)
    .every((i) => i.paid_cents >= i.amount_cents);
  if (settled) repo.updateInvoiceStatus(db, ctx, invoiceId, 'paid');
}
