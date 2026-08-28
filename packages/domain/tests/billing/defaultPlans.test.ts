import { expect, test } from 'vitest';
import { DEFAULT_CHARGE_PATTERNS, DEFAULT_PAYMENT_PLANS, DEFAULT_TAX_RATES } from '../../src/billing/defaultPlans.ts';
import { ontarioAutoV1 } from '../../src/product.ts';

test('the three legacy plan codes survive as real plans', () => {
  expect(DEFAULT_PAYMENT_PLANS.map((p) => p.code)).toEqual(expect.arrayContaining(['full', 'monthly', 'quarterly', 'monthly-2down']));
});
test('every plan fee pattern and every tax pattern exists', () => {
  const codes = new Set(DEFAULT_CHARGE_PATTERNS.map((p) => p.code));
  for (const p of DEFAULT_PAYMENT_PLANS) if (p.feePatternCode) expect(codes.has(p.feePatternCode)).toBe(true);
  for (const r of DEFAULT_TAX_RATES) expect(codes.has(r.patternCode)).toBe(true);
});
test('Ontario auto plans respect the 1.3% cap and the product names its billing', () => {
  for (const p of DEFAULT_PAYMENT_PLANS.filter((p) => p.products.includes('ON_PA'))) expect(p.feeBps).toBeLessThanOrEqual(130);
  expect(ontarioAutoV1.billing).toEqual({ premiumPatternCode: 'PREMIUM', line: 'auto', defaultPaymentPlan: 'monthly', allowedFeePatterns: ['FEE-INST', 'FEE-NSF', 'FEE-REINSTATE'] });
});
test('Ontario auto is RST-exempt and Ontario property is not', () => {
  expect(DEFAULT_TAX_RATES.find((r) => r.province === 'ON' && r.line === 'auto')).toBeUndefined();
  expect(DEFAULT_TAX_RATES.find((r) => r.province === 'ON' && r.line === 'property')?.rateBps).toBe(800);
});
