import { describe, expect, test } from 'vitest';
import {
  coverageInForce,
  deductibleFor,
  respondingCoverages,
} from '../../src/claims/coverageInForce.ts';
import type { PolicyVersionSnapshot } from '../../src/claims/coverageInForce.ts';
import { ontarioAutoV1 } from '../../src/product.ts';

function version(input: Partial<PolicyVersionSnapshot> & { id: string }): PolicyVersionSnapshot {
  return {
    versionNumber: 1,
    transactionType: 'NewBusiness',
    effectiveDate: '2026-01-01',
    termStart: '2026-01-01',
    termEnd: '2027-01-01',
    coverages: [],
    ...input,
  };
}

describe('coverageInForce', () => {
  test('no versions → nothing in force', () => {
    expect(coverageInForce([], '2026-06-01')).toBeNull();
  });

  test('a loss inside the term hits the issued version', () => {
    const v1 = version({ id: 'v1' });
    expect(coverageInForce([v1], '2026-06-01')?.id).toBe('v1');
  });

  test('term boundaries: first day is covered, expiry day is not', () => {
    const v1 = version({ id: 'v1' });
    expect(coverageInForce([v1], '2026-01-01')?.id).toBe('v1');
    expect(coverageInForce([v1], '2027-01-01')).toBeNull();
    expect(coverageInForce([v1], '2025-12-31')).toBeNull();
  });

  test('a mid-term endorsement responds only from its effective date', () => {
    const v1 = version({ id: 'v1' });
    const v2 = version({
      id: 'v2',
      versionNumber: 2,
      transactionType: 'Endorsement',
      effectiveDate: '2026-07-01',
    });
    expect(coverageInForce([v1, v2], '2026-06-30')?.id).toBe('v1');
    expect(coverageInForce([v1, v2], '2026-07-01')?.id).toBe('v2');
  });

  test('a loss after cancellation finds no coverage', () => {
    const v1 = version({ id: 'v1' });
    const v2 = version({
      id: 'v2',
      versionNumber: 2,
      transactionType: 'Cancellation',
      effectiveDate: '2026-08-15',
    });
    expect(coverageInForce([v1, v2], '2026-08-14')?.id).toBe('v1');
    expect(coverageInForce([v1, v2], '2026-08-15')).toBeNull();
    expect(coverageInForce([v1, v2], '2026-12-01')).toBeNull();
  });

  test('across renewal terms the right term answers', () => {
    const v1 = version({ id: 'v1' });
    const v2 = version({
      id: 'v2',
      versionNumber: 2,
      transactionType: 'Renewal',
      effectiveDate: '2027-01-01',
      termStart: '2027-01-01',
      termEnd: '2028-01-01',
    });
    expect(coverageInForce([v1, v2], '2026-12-31')?.id).toBe('v1');
    expect(coverageInForce([v1, v2], '2027-01-01')?.id).toBe('v2');
  });
});

describe('respondingCoverages', () => {
  const snapshot = version({
    id: 'v1',
    coverages: [
      { coverageCode: 'LIAB', vehicleId: 'veh1', limitCents: 100_000_000 },
      { coverageCode: 'DCPD', vehicleId: 'veh1' },
      { coverageCode: 'COLL', vehicleId: 'veh1', deductibleCents: 100_000 },
    ],
  });

  test('collision offers only the carried coverages that respond', () => {
    const codes = respondingCoverages(snapshot, 'COLLISION', ontarioAutoV1).map(
      (c) => c.coverageCode,
    );
    expect(codes).toContain('COLL');
    expect(codes).toContain('DCPD');
    expect(codes).toContain('LIAB');
    expect(codes).not.toContain('COMP'); // responds to theft, and not carried anyway
  });

  test('theft finds nothing when comprehensive is not carried', () => {
    expect(respondingCoverages(snapshot, 'THEFT', ontarioAutoV1)).toEqual([]);
  });

  test('unknown loss cause responds with nothing', () => {
    expect(respondingCoverages(snapshot, 'NOT_A_CAUSE', ontarioAutoV1)).toEqual([]);
  });
});

describe('deductibleFor', () => {
  const snapshot = version({
    id: 'v1',
    coverages: [
      { coverageCode: 'COLL', vehicleId: 'veh1', deductibleCents: 100_000 },
      { coverageCode: 'COLL', vehicleId: 'veh2', deductibleCents: 50_000 },
      { coverageCode: 'LIAB', vehicleId: 'veh1', limitCents: 100_000_000 },
    ],
  });

  test('reads the deductible for the right vehicle', () => {
    expect(deductibleFor(snapshot, 'COLL', 'veh1')).toBe(100_000);
    expect(deductibleFor(snapshot, 'COLL', 'veh2')).toBe(50_000);
  });

  test('liability has no deductible', () => {
    expect(deductibleFor(snapshot, 'LIAB', 'veh1')).toBe(0);
  });

  test('a coverage not on the version has no deductible', () => {
    expect(deductibleFor(snapshot, 'COMP', 'veh1')).toBe(0);
  });
});
