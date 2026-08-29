import { bpsOf } from './split.ts';
import type { SlicedItem, TaxRateDef } from './types.ts';

export function taxRateFor(rates: TaxRateDef[], province: string, line: string, date: string): TaxRateDef | null {
  return rates.find((r) => r.province === province && r.line === line && r.effectiveFrom <= date && (r.effectiveTo === null || date <= r.effectiveTo)) ?? null;
}

/**
 * The date a rate is priced on. Both configured values answer `'billed'`
 * today: a rate marked `appliesOn: 'paid'` (Quebec) is meant to be recomputed
 * at the payment date, and that recompute is PR 2 (D-028). Until it exists a
 * `'paid'` rate is taxed at billing time — said here, in one place, so the
 * fallback is explicit rather than an omission nobody can see.
 */
export function taxBasis(rate: TaxRateDef): 'billed' {
  switch (rate.appliesOn) {
    case 'billed':
      return 'billed';
    case 'paid':
      return 'billed';
  }
}

/**
 * A tax item beside every item whose charge pattern is taxable — which the
 * product catalogue decides, not the item's kind. Rounded per item, as the
 * invoice will show it.
 */
export function taxItemsFor(
  items: SlicedItem[],
  rate: TaxRateDef,
  nextSequence: number,
  isTaxable: (patternCode: string) => boolean,
): SlicedItem[] {
  const basis = taxBasis(rate);
  // Fail loudly rather than silently dropping tax if `taxBasis` ever learns
  // to answer 'paid' and this function has not been taught to handle it.
  if (basis !== 'billed') throw new Error(`Tax rate ${rate.code} has a basis this code cannot price`);

  let sequence = nextSequence;
  return items
    .filter((i) => isTaxable(i.patternCode))
    .map((i) => ({ kind: 'tax' as const, patternCode: rate.patternCode, amountCents: bpsOf(i.amountCents, rate.rateBps), eventDate: i.eventDate, sequence: sequence++ }));
}
