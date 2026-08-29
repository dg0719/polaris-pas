import { respreadOnChange, taxItemsFor } from '@polaris/domain';
import { addDays } from '../dates.ts';
import type { Db } from '../db.ts';
import * as repo from '../repo.ts';
import type { BillingInvoiceRow, ChargeRow, TenantCtx } from '../repo.ts';
import {
  createInvoice,
  DAYS_UNTIL_DUE,
  ensureStream,
  insertCharge,
  outstandingOn,
  postCharge,
  taxRateOn,
  total,
  totalOn,
  writeItems,
  type Context,
  type Placed,
} from './shared.ts';

// ─── Endorsements and cancellations ────────────────────────────────────────
// A change moves an existing schedule rather than laying down a new one.
// Nothing already written is edited: the delta becomes new, signed items
// beside the old ones, and an invoice they empty is voided.

/**
 * Additional premium spreads over the invoices still planned from the change
 * date; return premium comes off the latest of them first, so the customer's
 * next payment falls before the last one does. What the schedule cannot
 * absorb is billed on its own invoice — negative, that is a credit note.
 *
 * Returns the invoices this change raised (none, when the schedule absorbed
 * the whole delta).
 */
export function respreadSchedule(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  instructionId: string,
  premiumCharge: ChargeRow,
): BillingInvoiceRow[] {
  const planned = repo
    .listInvoicesForPolicy(db, ctx, c.policy.id)
    .filter((i) => i.status === 'planned' && i.event_date >= c.job.effective_date);
  const { onInvoices, unabsorbedCents } = respreadOnChange(
    c.transaction.amount_cents,
    planned.map((i) => ({
      invoiceId: i.id,
      eventDate: i.event_date,
      outstandingCents: outstandingOn(db, ctx, i.id),
    })),
  );

  const premiumSlices: Placed[] = onInvoices.map((on, index) => ({
    invoiceId: on.invoiceId,
    charge: premiumCharge,
    item: {
      kind: 'installment',
      patternCode: premiumCharge.pattern_code,
      amountCents: on.amountCents,
      eventDate: on.eventDate,
      sequence: index + 1,
    },
  }));

  const raised: BillingInvoiceRow[] = [];
  if (unabsorbedCents !== 0) {
    const eventDate = addDays(c.job.effective_date, DAYS_UNTIL_DUE);
    // Billed straight away rather than planned: this invoice (or, when
    // negative, credit note) is raised by the change itself, so its bill date
    // is the change's effective date, not one lead period before it falls due.
    const invoice = createInvoice(db, ctx, c, {
      streamId: ensureStream(db, ctx, c).id,
      eventDate,
      billDate: c.job.effective_date,
      status: 'billed',
    });
    raised.push(invoice);
    premiumSlices.push({
      invoiceId: invoice.id,
      charge: premiumCharge,
      item: {
        kind: 'oneTime',
        patternCode: premiumCharge.pattern_code,
        amountCents: unabsorbedCents,
        eventDate,
        sequence: premiumSlices.length + 1,
      },
    });
  }

  const placed = [...premiumSlices, ...taxSlicesFor(db, ctx, c, instructionId, premiumSlices)];
  writeItems(db, ctx, c, placed);

  // An invoice the change emptied has nothing left to collect.
  for (const invoiceId of new Set(placed.map((p) => p.invoiceId))) {
    const invoice = repo.getInvoice(db, ctx, invoiceId);
    if (invoice && invoice.status !== 'void' && totalOn(db, ctx, invoiceId) === 0) {
      repo.updateInvoiceStatus(db, ctx, invoiceId, 'void');
    }
  }

  // A zero-delta change writes no items and no charges; `postCharge` skips
  // the zero-amount premium charge for the same reason.
  postCharge(db, ctx, premiumCharge);
  for (const charge of new Map(placed.map((p) => [p.charge.id, p.charge])).values()) {
    if (charge.id !== premiumCharge.id) postCharge(db, ctx, charge);
  }
  return raised;
}

/** The tax due on the delta's premium slices, on a charge of its own. */
function taxSlicesFor(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  instructionId: string,
  premiumSlices: Placed[],
): Placed[] {
  const rate = taxRateOn(db, ctx, c);
  if (!rate) return [];
  const slices = premiumSlices
    .map((p, index) => ({ ...p, item: taxItemsFor([p.item], rate, index + 1)[0]! }))
    .filter((p) => p.item.amountCents !== 0);
  if (slices.length === 0) return [];
  const charge = insertCharge(
    db,
    ctx,
    c,
    instructionId,
    rate.patternCode,
    total(slices.map((p) => p.item)),
  );
  return slices.map((p) => ({ ...p, charge }));
}
