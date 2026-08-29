import type { ChargePatternDef, PaymentPlanDef, TaxRateDef } from './types.ts';

/**
 * Illustrative configuration. A carrier replaces these with its filed
 * values; the filing references below are placeholders, not filings.
 */
export const DEFAULT_CHARGE_PATTERNS: ChargePatternDef[] = [
  { code: 'PREMIUM', name: 'Premium', kind: 'prorata', category: 'premium', invoicing: 'spread', priority: 50, commissionable: true, taxable: true, filingReference: null },
  { code: 'FEE-INST', name: 'Installment fee', kind: 'immediate', category: 'fee', invoicing: 'spread', priority: 10, commissionable: false, taxable: false, filingReference: 'SAMPLE-FILING' },
  { code: 'FEE-NSF', name: 'Returned payment fee', kind: 'immediate', category: 'fee', invoicing: 'single', priority: 5, commissionable: false, taxable: false, filingReference: 'SAMPLE-FILING' },
  { code: 'FEE-REINSTATE', name: 'Reinstatement fee', kind: 'immediate', category: 'fee', invoicing: 'single', priority: 5, commissionable: false, taxable: false, filingReference: 'SAMPLE-FILING' },
  { code: 'TAX-RST', name: 'Retail sales tax', kind: 'passthrough', category: 'tax', invoicing: 'spread', priority: 40, commissionable: false, taxable: false, filingReference: null },
  { code: 'TAX-QC', name: 'Quebec tax on insurance premiums', kind: 'passthrough', category: 'tax', invoicing: 'spread', priority: 40, commissionable: false, taxable: false, filingReference: null },
];

const ALL = ['ON_PA'];
const ON = ['ON'];

export const DEFAULT_PAYMENT_PLANS: PaymentPlanDef[] = [
  { code: 'full', name: 'Pay in full', downPaymentBps: 0, installments: 1, periodicity: 'annual', feePatternCode: null, feeBps: 0, feeCapBps: 130, renewalDownPaymentBps: null, products: ALL, provinces: ON },
  { code: 'monthly', name: '12 monthly payments', downPaymentBps: 0, installments: 12, periodicity: 'monthly', feePatternCode: 'FEE-INST', feeBps: 130, feeCapBps: 130, renewalDownPaymentBps: null, products: ALL, provinces: ON },
  { code: 'monthly-2down', name: 'Two months down, 10 monthly', downPaymentBps: 1667, installments: 10, periodicity: 'monthly', feePatternCode: 'FEE-INST', feeBps: 130, feeCapBps: 130, renewalDownPaymentBps: 0, products: ALL, provinces: ON },
  { code: 'quarterly', name: '4 quarterly payments', downPaymentBps: 0, installments: 4, periodicity: 'quarterly', feePatternCode: 'FEE-INST', feeBps: 65, feeCapBps: 130, renewalDownPaymentBps: null, products: ALL, provinces: ON },
];

export const DEFAULT_TAX_RATES: TaxRateDef[] = [
  { code: 'ON-RST-PROPERTY', province: 'ON', line: 'property', rateBps: 800, effectiveFrom: '2000-01-01', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
  { code: 'QC-IPT', province: 'QC', line: 'auto', rateBps: 900, effectiveFrom: '2000-01-01', effectiveTo: '2026-12-31', appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'QC-IPT-2027', province: 'QC', line: 'auto', rateBps: 998, effectiveFrom: '2027-01-01', effectiveTo: null, appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'QC-IPT-PROPERTY', province: 'QC', line: 'property', rateBps: 900, effectiveFrom: '2000-01-01', effectiveTo: '2026-12-31', appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'SK-PST', province: 'SK', line: 'auto', rateBps: 600, effectiveFrom: '2017-08-01', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
  { code: 'MB-RST-LIAB', province: 'MB', line: 'liability', rateBps: 700, effectiveFrom: '2012-07-15', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
];
