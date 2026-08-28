import { describe, expect, test } from 'vitest';
import { sliceCharge } from '../../src/billing/slicing.ts';
import { splitRemainderLast } from '../../src/billing/split.ts';
import type { ChargePatternDef, PaymentPlanDef } from '../../src/billing/types.ts';

const FEE: ChargePatternDef = { code: 'FEE-INST', name: 'Installment fee', kind: 'immediate', category: 'fee', invoicing: 'spread', priority: 10, commissionable: false, taxable: false, filingReference: 'FSRA-2026-01' };
const monthly: PaymentPlanDef = { code: 'monthly', name: '12 monthly', downPaymentBps: 0, installments: 12, periodicity: 'monthly', feePatternCode: null, feeBps: 0, feeCapBps: null, renewalDownPaymentBps: null, products: ['ON_PA'], provinces: ['ON'] };
const twoDown: PaymentPlanDef = { ...monthly, code: 'monthly-2down', downPaymentBps: 1667, installments: 10, feePatternCode: 'FEE-INST', feeBps: 130, feeCapBps: 130 };

describe('splitRemainderLast', () => {
  test('the remainder lands on the last part', () => {
    expect(splitRemainderLast(100, 3)).toEqual([33, 33, 34]);
    expect(splitRemainderLast(-100, 3)).toEqual([-33, -33, -34]);
    expect(splitRemainderLast(5, 0)).toEqual([]);
  });
});

describe('sliceCharge', () => {
  const base = { amountCents: 120_005, patternCode: 'PREMIUM', termStart: '2026-09-01', instructionType: 'newBusiness' as const };

  test('12 monthly installments start at inception and sum to the charge', () => {
    const items = sliceCharge({ ...base, plan: monthly, feePattern: null });
    expect(items).toHaveLength(12);
    expect(items.map((i) => i.eventDate).slice(0, 2)).toEqual(['2026-09-01', '2026-10-01']);
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(120_005);
    expect(items[11]!.amountCents).toBe(10_005);
    expect(items.every((i) => i.kind === 'installment')).toBe(true);
  });

  test('a down payment is billed at inception and installments follow monthly', () => {
    const items = sliceCharge({ ...base, plan: twoDown, feePattern: FEE });
    const premium = items.filter((i) => i.patternCode === 'PREMIUM');
    expect(premium[0]).toMatchObject({ kind: 'downPayment', amountCents: 20_005, eventDate: '2026-09-01' });
    expect(premium).toHaveLength(11);
    expect(premium[1]!.eventDate).toBe('2026-10-01');
    expect(premium.reduce((s, i) => s + i.amountCents, 0)).toBe(120_005);
  });

  test('the installment fee is spread over the installments and capped', () => {
    const items = sliceCharge({ ...base, plan: twoDown, feePattern: FEE });
    const fees = items.filter((i) => i.kind === 'fee');
    expect(fees).toHaveLength(10);
    expect(fees.reduce((s, i) => s + i.amountCents, 0)).toBe(1_560); // 1.3% of 120,005 = 1560.07 → 1560
    expect(fees[0]!.eventDate).toBe('2026-10-01');
  });

  test('a fee above the regulatory cap is refused', () => {
    expect(() => sliceCharge({ ...base, plan: { ...twoDown, feeBps: 300 }, feePattern: FEE })).toThrow(/cap/);
  });

  test('a renewal uses the renewal down payment', () => {
    const items = sliceCharge({ ...base, instructionType: 'renewal', plan: { ...twoDown, renewalDownPaymentBps: 0, installments: 12 }, feePattern: null });
    expect(items[0]!.kind).toBe('installment');
    expect(items).toHaveLength(12);
  });

  test('a negative charge slices without losing a cent', () => {
    const items = sliceCharge({ ...base, amountCents: -1_001, plan: monthly, feePattern: null });
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(-1_001);
  });
});
