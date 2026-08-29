import { describe, expect, test } from 'vitest';
import { taxBasis, taxItemsFor, taxRateFor } from '../../src/billing/tax.ts';
import type { ChargePatternDef, SlicedItem, TaxRateDef } from '../../src/billing/types.ts';

/** The default catalogue's answer: premium is taxable, fees and taxes are not. */
const DEFAULT_TAXABLE = (patternCode: string) => patternCode === 'PREMIUM';

function pattern(code: string, taxable: boolean): ChargePatternDef {
  return { code, name: code, kind: 'immediate', category: 'fee', invoicing: 'spread', priority: 10, commissionable: false, taxable, filingReference: null };
}

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
    const tax = taxItemsFor(premium, RATES[0]!, 3, DEFAULT_TAXABLE);
    expect(tax).toEqual([
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 1_600, eventDate: '2026-09-01', sequence: 3 },
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 800, eventDate: '2026-10-01', sequence: 4 },
    ]);
  });
  test('fee items are never taxed', () => {
    const fee: SlicedItem[] = [{ kind: 'fee', patternCode: 'FEE-INST', amountCents: 100, eventDate: '2026-10-01', sequence: 1 }];
    expect(taxItemsFor(fee, RATES[0]!, 2, DEFAULT_TAXABLE)).toEqual([]);
  });
});

describe('the charge pattern decides what is taxable, not the item kind', () => {
  const items: SlicedItem[] = [
    { kind: 'installment', patternCode: 'PREMIUM', amountCents: 10_000, eventDate: '2026-10-01', sequence: 1 },
    { kind: 'fee', patternCode: 'FEE-INST', amountCents: 1_000, eventDate: '2026-10-01', sequence: 2 },
  ];

  test('a fee pattern marked taxable is taxed and a premium marked not taxable is not', () => {
    const catalogue = new Map([
      [pattern('PREMIUM', false).code, pattern('PREMIUM', false)],
      [pattern('FEE-INST', true).code, pattern('FEE-INST', true)],
    ]);
    const tax = taxItemsFor(items, RATES[0]!, 3, (code) => catalogue.get(code)?.taxable === true);
    expect(tax).toEqual([
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 80, eventDate: '2026-10-01', sequence: 3 },
    ]);
  });
});

describe('taxBasis', () => {
  test('a rate configured appliesOn paid is still billed today (D-028, PR 2)', () => {
    const qc = RATES[1]!;
    expect(qc.appliesOn).toBe('paid');
    expect(taxBasis(qc)).toBe('billed');
    // Until the payment-date recompute lands, the item is written when the
    // premium is billed, at the rate in force on that date.
    const premium: SlicedItem[] = [
      { kind: 'installment', patternCode: 'PREMIUM', amountCents: 10_000, eventDate: '2026-10-01', sequence: 1 },
    ];
    expect(taxItemsFor(premium, qc, 2, DEFAULT_TAXABLE)).toEqual([
      { kind: 'tax', patternCode: 'TAX-QC', amountCents: 900, eventDate: '2026-10-01', sequence: 2 },
    ]);
  });

  test('a rate configured appliesOn billed answers the same', () => {
    expect(taxBasis(RATES[0]!)).toBe('billed');
  });
});
