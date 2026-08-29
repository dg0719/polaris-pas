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
  postCharge,
  premiumOutstandingOn,
  taxableOn,
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
 * The invoices from the change date on that the delta can move against.
 * Spec §4 orders a reduction planned first, then billed but still unpaid,
 * then credit; additional premium only ever lands on the planned ones,
 * which `respreadOnChange` enforces. A billed invoice is a candidate only
 * while it still has premium to give up — one already settled, or already
 * emptied by an earlier change, has nothing to offer.
 */
function candidatesFrom(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  premiumCharge: ChargeRow,
): { invoice: BillingInvoiceRow; outstandingCents: number }[] {
  return repo
    .listInvoicesForPolicy(db, ctx, c.policy.id)
    .filter((i) => i.event_date >= c.job.effective_date)
    .filter((i) => i.status === 'planned' || i.status === 'billed')
    .map((invoice) => ({
      invoice,
      outstandingCents: premiumOutstandingOn(db, ctx, invoice.id, premiumCharge.pattern_code),
    }))
    .filter((x) => x.invoice.status === 'planned' || x.outstandingCents > 0);
}

/**
 * Additional premium spreads over the invoices still planned from the change
 * date; return premium comes off the latest of them first, so the customer's
 * next payment falls before the last one does, and reaches the billed but
 * unpaid invoices once the planned ones are exhausted. What the schedule
 * cannot absorb is billed on its own invoice — negative, that is a credit
 * note.
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
  const candidates = candidatesFrom(db, ctx, c, premiumCharge);
  const { onInvoices, unabsorbedCents } = respreadOnChange(
    c.transaction.amount_cents,
    candidates.map((x) => ({
      invoiceId: x.invoice.id,
      eventDate: x.invoice.event_date,
      outstandingCents: x.outstandingCents,
      billed: x.invoice.status === 'billed',
    })),
  );

  // A premium re-spread item offsets an invoice, not one line on it: the
  // reduction is spread across whatever that invoice's premium still holds,
  // so `offsetsItemId` stays unset. Only the fee and tax reversals below
  // cancel a single, named item.
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

  const touched = [...new Set(placed.map((p) => p.invoiceId))];
  const reversals = reverseEmptiedInvoices(db, ctx, c, instructionId, touched, premiumCharge);
  writeItems(db, ctx, c, reversals);

  // An invoice the change emptied has nothing left to collect — whether it
  // was still planned or had already been sent out.
  for (const invoiceId of touched) {
    const invoice = repo.getInvoice(db, ctx, invoiceId);
    if (invoice && invoice.status !== 'void' && totalOn(db, ctx, invoiceId) === 0) {
      repo.updateInvoiceStatus(db, ctx, invoiceId, 'void');
    }
  }

  // A zero-delta change writes no items and no charges; `postCharge` skips
  // the zero-amount premium charge for the same reason.
  postCharge(db, ctx, premiumCharge);
  const written = [...placed, ...reversals];
  for (const charge of new Map(written.map((p) => [p.charge.id, p.charge])).values()) {
    if (charge.id !== premiumCharge.id) postCharge(db, ctx, charge);
  }
  return raised;
}

/** One reversal row, before it is given a charge. */
interface Reversal {
  invoiceId: string;
  kind: 'fee' | 'tax';
  patternCode: string;
  amountCents: number;
  eventDate: string;
  offsetsItemId: string;
}

/**
 * An invoice whose premium has been reduced to nothing collects no
 * installment fee and no tax either: the fee buys an installment, and there
 * is no longer one to buy. Reverse whatever those lines still hold so the
 * invoice nets to zero and can be voided. An invoice only partly reduced
 * keeps its fee and its tax.
 *
 * One row per original line, carrying `offsets_item_id` so the reversal names
 * exactly what it takes off. The rows are capped by what the pattern still
 * holds on the invoice, because `taxSlicesFor` has already written the tax on
 * the premium reduction — reversing every original line in full would take
 * that same tax off twice.
 */
function reverseEmptiedInvoices(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  instructionId: string,
  invoiceIds: string[],
  premiumCharge: ChargeRow,
): Placed[] {
  const reversals: Reversal[] = [];

  for (const invoiceId of invoiceIds) {
    const items = repo.listItemsForInvoice(db, ctx, invoiceId);
    const premiumLeft = items
      .filter((i) => i.pattern_code === premiumCharge.pattern_code)
      .reduce((sum, i) => sum + i.amount_cents - i.paid_cents, 0);
    if (premiumLeft !== 0) continue;

    for (const kind of ['fee', 'tax'] as const) {
      const lines = items.filter((i) => i.kind === kind);
      for (const patternCode of new Set(lines.map((i) => i.pattern_code))) {
        const ofPattern = lines.filter((i) => i.pattern_code === patternCode);
        let remaining = ofPattern.reduce((sum, i) => sum + i.amount_cents - i.paid_cents, 0);
        if (remaining === 0) continue;
        // Take the reversal from the lines on the side that is carrying the
        // balance, oldest first, so each row cancels a real line rather than
        // a netted figure with nothing to point at.
        const sign = Math.sign(remaining);
        for (const item of ofPattern) {
          if (remaining === 0) break;
          const held = item.amount_cents - item.paid_cents;
          if (Math.sign(held) !== sign) continue;
          const take = sign > 0 ? Math.min(held, remaining) : Math.max(held, remaining);
          reversals.push({
            invoiceId,
            kind,
            patternCode,
            amountCents: -take,
            eventDate: item.event_date,
            offsetsItemId: item.id,
          });
          remaining -= take;
        }
      }
    }
  }

  // One charge per pattern being reversed, so charge coverage still holds
  // per charge. Nothing to reverse means no charge at all — never a zero one.
  const charges = new Map<string, ChargeRow>();
  for (const patternCode of new Set(reversals.map((r) => r.patternCode))) {
    const amount = reversals
      .filter((r) => r.patternCode === patternCode)
      .reduce((sum, r) => sum + r.amountCents, 0);
    charges.set(patternCode, insertCharge(db, ctx, c, instructionId, patternCode, amount));
  }

  return reversals.map((r) => ({
    invoiceId: r.invoiceId,
    charge: charges.get(r.patternCode)!,
    offsetsItemId: r.offsetsItemId,
    item: {
      kind: r.kind,
      patternCode: r.patternCode,
      amountCents: r.amountCents,
      eventDate: r.eventDate,
      sequence: 1, // `writeItems` assigns the real sequence on the invoice
    },
  }));
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
  const isTaxable = taxableOn(db, ctx);
  const slices: Placed[] = [];
  for (const p of premiumSlices) {
    // `writeItems` assigns the real sequence on the invoice; this one only
    // has to be stable within the batch.
    const item = taxItemsFor([p.item], rate, slices.length + 1, isTaxable)[0];
    if (item && item.amountCents !== 0) slices.push({ ...p, item });
  }
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
