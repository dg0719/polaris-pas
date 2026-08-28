import { splitRemainderLast } from './split.ts';

export interface OpenInvoice { invoiceId: string; eventDate: string; outstandingCents: number }
export interface RespreadResult {
  onInvoices: { invoiceId: string; eventDate: string; amountCents: number }[];
  unabsorbedCents: number;
}

/**
 * Additional premium spreads evenly over the planned invoices; return
 * premium comes off the latest first so the next payment drops before the
 * last one does. Nothing here edits an item: the caller writes these as new
 * offsetting items.
 */
export function respreadOnChange(deltaCents: number, planned: OpenInvoice[]): RespreadResult {
  if (deltaCents === 0 || planned.length === 0) return { onInvoices: [], unabsorbedCents: deltaCents };
  if (deltaCents > 0) {
    const parts = splitRemainderLast(deltaCents, planned.length);
    return { onInvoices: planned.map((p, i) => ({ invoiceId: p.invoiceId, eventDate: p.eventDate, amountCents: parts[i]! })), unabsorbedCents: 0 };
  }
  let remaining = -deltaCents;
  const onInvoices: RespreadResult['onInvoices'] = [];
  for (const p of [...planned].sort((a, b) => b.eventDate.localeCompare(a.eventDate))) {
    if (remaining === 0) break;
    const take = Math.min(p.outstandingCents, remaining);
    if (take > 0) { onInvoices.push({ invoiceId: p.invoiceId, eventDate: p.eventDate, amountCents: -take }); remaining -= take; }
  }
  return { onInvoices, unabsorbedCents: remaining === 0 ? 0 : -remaining };
}
