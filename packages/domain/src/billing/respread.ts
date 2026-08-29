import { splitRemainderLast } from './split.ts';

export interface OpenInvoice {
  invoiceId: string;
  eventDate: string;
  outstandingCents: number;
  /** True when the customer has already been sent this invoice. Spec §4
   * orders a reduction planned-first, then billed-but-unpaid; and additional
   * premium never lands on a billed one at all. */
  billed?: boolean;
}
export interface RespreadResult {
  onInvoices: { invoiceId: string; eventDate: string; amountCents: number }[];
  unabsorbedCents: number;
}

/**
 * Additional premium spreads evenly over the invoices not yet sent out;
 * return premium comes off the latest first so the next payment drops before
 * the last one does, taking planned invoices before billed ones. Nothing here
 * edits an item: the caller writes these as new offsetting items.
 */
export function respreadOnChange(deltaCents: number, open: OpenInvoice[]): RespreadResult {
  if (deltaCents === 0 || open.length === 0) return { onInvoices: [], unabsorbedCents: deltaCents };
  if (deltaCents > 0) {
    // Adding to an invoice the customer is already holding would ask for
    // money the document they were sent does not mention, so only the
    // invoices still planned can take it.
    const planned = open.filter((p) => p.billed !== true);
    if (planned.length === 0) return { onInvoices: [], unabsorbedCents: deltaCents };
    const parts = splitRemainderLast(deltaCents, planned.length);
    return { onInvoices: planned.map((p, i) => ({ invoiceId: p.invoiceId, eventDate: p.eventDate, amountCents: parts[i]! })), unabsorbedCents: 0 };
  }
  let remaining = -deltaCents;
  const onInvoices: RespreadResult['onInvoices'] = [];
  // Planned before billed, and within each group the latest event date first.
  const order = [...open].sort(
    (a, b) => Number(a.billed === true) - Number(b.billed === true) || b.eventDate.localeCompare(a.eventDate),
  );
  for (const p of order) {
    if (remaining === 0) break;
    const take = Math.min(p.outstandingCents, remaining);
    if (take > 0) { onInvoices.push({ invoiceId: p.invoiceId, eventDate: p.eventDate, amountCents: -take }); remaining -= take; }
  }
  return { onInvoices, unabsorbedCents: remaining === 0 ? 0 : -remaining };
}
