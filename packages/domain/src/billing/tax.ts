import { bpsOf } from './split.ts';
import type { SlicedItem, TaxRateDef } from './types.ts';

export function taxRateFor(rates: TaxRateDef[], province: string, line: string, date: string): TaxRateDef | null {
  return rates.find((r) => r.province === province && r.line === line && r.effectiveFrom <= date && (r.effectiveTo === null || date <= r.effectiveTo)) ?? null;
}

/** A tax item beside every premium item — never beside a fee. Rounded per item, as the invoice will show it. */
export function taxItemsFor(items: SlicedItem[], rate: TaxRateDef, nextSequence: number): SlicedItem[] {
  let sequence = nextSequence;
  return items
    .filter((i) => i.kind === 'downPayment' || i.kind === 'installment' || i.kind === 'oneTime')
    .map((i) => ({ kind: 'tax' as const, patternCode: rate.patternCode, amountCents: bpsOf(i.amountCents, rate.rateBps), eventDate: i.eventDate, sequence: sequence++ }));
}
