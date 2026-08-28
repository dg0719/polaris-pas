import { describe, expect, test } from 'vitest';
import { taxItemsFor, taxRateFor } from '../../src/billing/tax.ts';
import type { SlicedItem, TaxRateDef } from '../../src/billing/types.ts';

const RATES: TaxRateDef[] = [
  { code: 'ON-RST-PROP', province: 'ON', line: 'property', rateBps: 800, effectiveFrom: '2000-01-01', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
  { code: 'QC-IPT', province: 'QC', line: 'auto', rateBps: 900, effectiveFrom: '2000-01-01', effectiveTo: '2026-12-31', appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'QC-IPT-2027', province: 'QC', line: 'auto', rateBps: 998, effectiveFrom: '2027-01-01', effectiveTo: null, appliesOn: 'paid', patternCode: 'TAX-QC' },
];

describe('taxRateFor', () => {
  test('Ontario auto is exempt; Ontario property is taxed at 8%', () => {
    expect(taxRateFor(RATES, 'ON', 'auto', '2026-09-01')).toBeNull();
    expect(taxRateFor(RATES, 'ON', 'property', '2026-09-01')?.rateBps).toBe(800);
  });
  test('Quebec picks the rate in force on the date', () => {
    expect(taxRateFor(RATES, 'QC', 'auto', '2026-12-31')?.rateBps).toBe(900);
    expect(taxRateFor(RATES, 'QC', 'auto', '2027-01-01')?.rateBps).toBe(998);
  });
});

describe('taxItemsFor', () => {
  test('one tax item per premium item, rounded per item, same event date', () => {
    const premium: SlicedItem[] = [
      { kind: 'downPayment', patternCode: 'PREMIUM', amountCents: 20_005, eventDate: '2026-09-01', sequence: 1 },
      { kind: 'installment', patternCode: 'PREMIUM', amountCents: 10_000, eventDate: '2026-10-01', sequence: 2 },
    ];
    const tax = taxItemsFor(premium, RATES[0]!, 3);
    expect(tax).toEqual([
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 1_600, eventDate: '2026-09-01', sequence: 3 },
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 800, eventDate: '2026-10-01', sequence: 4 },
    ]);
  });
  test('fee items are never taxed', () => {
    const fee: SlicedItem[] = [{ kind: 'fee', patternCode: 'FEE-INST', amountCents: 100, eventDate: '2026-10-01', sequence: 1 }];
    expect(taxItemsFor(fee, RATES[0]!, 2)).toEqual([]);
  });
});
