import { describe, expect, test } from 'vitest';
import { ontarioAutoV1 } from '../src/product.ts';
import { RatingError, rateRisk } from '../src/rating.ts';
import type { RiskData } from '../src/types.ts';

function cleanRisk(): RiskData {
  return {
    termMonths: 12,
    drivers: [
      {
        id: 'd1',
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-04-12',
        licenceNumber: 'D1234-56789-01234',
        yearsLicensed: 15,
        atFaultClaims: 0,
        minorConvictions: 0,
      },
    ],
    vehicles: [
      {
        id: 'v1',
        year: 2022,
        make: 'Toyota',
        model: 'RAV4',
        vin: 'JTM123456789',
        valueCents: 3800000,
        rateGroup: 10,
        primaryUse: 'commute',
        annualKm: 15000,
        postalCode: 'K1A 0A1', // Eastern ON → factor 1.0
        principalDriverId: 'd1',
      },
    ],
    coverages: [
      { vehicleId: 'v1', coverageCode: 'LIAB', limitCents: 100000000 },
      { vehicleId: 'v1', coverageCode: 'AB' },
      { vehicleId: 'v1', coverageCode: 'DCPD' },
      { vehicleId: 'v1', coverageCode: 'UA' },
    ],
  };
}

describe('rateRisk', () => {
  test('rates a clean single-vehicle risk with mandatory coverages', () => {
    const quote = rateRisk(ontarioAutoV1, cleanRisk());
    // factor chain: territory K=1.0 × class yl>=10=0.95 × record clean=0.9 × rg 10=1.18
    const factor = 1.0 * 0.95 * 0.9 * 1.18;
    const expectedLiab = Math.round(62000 * factor * 1.0); // limit $1M factor 1.0
    const liab = quote.lines.find((l) => l.coverageCode === 'LIAB')!;
    expect(liab.annualPremiumCents).toBe(expectedLiab);
    expect(quote.totalAnnualPremiumCents).toBe(
      quote.lines.reduce((s, l) => s + l.annualPremiumCents, 0),
    );
    expect(quote.referrals).toHaveLength(0);
  });

  test('applies deductible factor to physical damage coverage', () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 200000 });
    const quote = rateRisk(ontarioAutoV1, risk);
    const coll = quote.lines.find((l) => l.coverageCode === 'COLL')!;
    const factor = 1.0 * 0.95 * 0.9 * 1.18 * 0.88; // $2000 deductible → 0.88
    expect(coll.annualPremiumCents).toBe(Math.round(34000 * factor));
  });

  test('endorsements are flat premiums, not factored', () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'OPCF44R' });
    const quote = rateRisk(ontarioAutoV1, risk);
    const opcf = quote.lines.find((l) => l.coverageCode === 'OPCF44R')!;
    expect(opcf.annualPremiumCents).toBe(4200);
  });

  test('$2M liability limit costs more than $1M', () => {
    const risk1 = cleanRisk();
    const risk2 = cleanRisk();
    risk2.coverages[0].limitCents = 200000000;
    const q1 = rateRisk(ontarioAutoV1, risk1);
    const q2 = rateRisk(ontarioAutoV1, risk2);
    expect(q2.totalAnnualPremiumCents).toBeGreaterThan(q1.totalAnnualPremiumCents);
  });

  test('missing mandatory coverage throws', () => {
    const risk = cleanRisk();
    risk.coverages = risk.coverages.filter((c) => c.coverageCode !== 'DCPD');
    expect(() => rateRisk(ontarioAutoV1, risk)).toThrow(RatingError);
  });

  test('unknown coverage code throws', () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'NOPE' });
    expect(() => rateRisk(ontarioAutoV1, risk)).toThrow(/Unknown coverage/);
  });

  test('risky driver triggers UW referrals', () => {
    const risk = cleanRisk();
    risk.drivers[0].atFaultClaims = 2;
    risk.drivers[0].yearsLicensed = 0;
    const quote = rateRisk(ontarioAutoV1, risk);
    const codes = quote.referrals.map((r) => r.ruleCode).sort();
    expect(codes).toEqual(['UW-CLAIMS', 'UW-NEWDRIVER']);
  });

  test('two vehicles produce independent vehicle totals that sum to policy total', () => {
    const risk = cleanRisk();
    risk.vehicles.push({ ...risk.vehicles[0], id: 'v2', rateGroup: 5, postalCode: 'M5V 2T6' });
    for (const code of ['LIAB', 'AB', 'DCPD', 'UA']) {
      risk.coverages.push({
        vehicleId: 'v2',
        coverageCode: code,
        ...(code === 'LIAB' ? { limitCents: 100000000 } : {}),
      });
    }
    const quote = rateRisk(ontarioAutoV1, risk);
    expect(quote.vehicleTotals).toHaveLength(2);
    expect(quote.vehicleTotals.reduce((s, v) => s + v.annualPremiumCents, 0)).toBe(
      quote.totalAnnualPremiumCents,
    );
  });
  test('a limit the product does not offer is refused, not rated at 1.0', () => {
    const risk = cleanRisk();
    risk.coverages[0]!.limitCents = 500000000; // $5M is not a filed option
    expect(() => rateRisk(ontarioAutoV1, risk)).toThrow(/not offered for LIAB/);
  });

  test('a coverage with limit options requires a limit', () => {
    const risk = cleanRisk();
    delete risk.coverages[0]!.limitCents;
    expect(() => rateRisk(ontarioAutoV1, risk)).toThrow(/requires a limit/);
  });

  test('a deductible the product does not offer is refused', () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 25000 });
    expect(() => rateRisk(ontarioAutoV1, risk)).toThrow(/not offered for COLL/);
  });

  test('physical damage requires a deductible', () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COMP' });
    expect(() => rateRisk(ontarioAutoV1, risk)).toThrow(/requires a deductible/);
  });
});
