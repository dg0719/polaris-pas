import { describe, expect, test } from 'vitest';
import { claimFinancials, exposureFinancials } from '../../src/claims/financials.ts';
import type { ClaimLedger } from '../../src/claims/types.ts';

const empty: ClaimLedger = { movements: [], payments: [], recoveries: [] };

describe('exposure financials', () => {
  test('everything zero on an empty ledger', () => {
    const f = exposureFinancials(empty, 'e1');
    expect(f).toEqual({
      reserveCents: 0,
      paidCents: 0,
      pendingCents: 0,
      recoveredCents: 0,
      outstandingCents: 0,
      incurredCents: 0,
      netIncurredCents: 0,
    });
  });

  test('reserve is the signed sum of movements', () => {
    const ledger: ClaimLedger = {
      ...empty,
      movements: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 500_000 },
        { exposureId: 'e1', category: 'indemnity', amountCents: -150_000 },
        { exposureId: 'e1', category: 'expense', amountCents: 50_000 },
      ],
    };
    const f = exposureFinancials(ledger, 'e1');
    expect(f.reserveCents).toBe(400_000);
    expect(f.outstandingCents).toBe(400_000);
    expect(f.incurredCents).toBe(400_000);
  });

  test('only Issued payments count as paid; Requested/Approved are pending', () => {
    const ledger: ClaimLedger = {
      ...empty,
      movements: [{ exposureId: 'e1', category: 'indemnity', amountCents: 500_000 }],
      payments: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 100_000, status: 'Issued' },
        { exposureId: 'e1', category: 'indemnity', amountCents: 75_000, status: 'Approved' },
        { exposureId: 'e1', category: 'indemnity', amountCents: 25_000, status: 'Requested' },
        { exposureId: 'e1', category: 'indemnity', amountCents: 99_000, status: 'Rejected' },
        { exposureId: 'e1', category: 'indemnity', amountCents: 88_000, status: 'Voided' },
      ],
    };
    const f = exposureFinancials(ledger, 'e1');
    expect(f.paidCents).toBe(100_000);
    expect(f.pendingCents).toBe(100_000);
    expect(f.outstandingCents).toBe(400_000);
    expect(f.incurredCents).toBe(500_000);
  });

  test('paying past the reserve never leaves negative outstanding', () => {
    const ledger: ClaimLedger = {
      ...empty,
      movements: [{ exposureId: 'e1', category: 'indemnity', amountCents: 100_000 }],
      payments: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 130_000, status: 'Issued' },
      ],
    };
    const f = exposureFinancials(ledger, 'e1');
    expect(f.outstandingCents).toBe(0);
    expect(f.incurredCents).toBe(130_000);
  });

  test('recoveries reduce net incurred, not incurred', () => {
    const ledger: ClaimLedger = {
      ...empty,
      movements: [{ exposureId: 'e1', category: 'indemnity', amountCents: 200_000 }],
      payments: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 200_000, status: 'Issued' },
      ],
      recoveries: [
        { exposureId: 'e1', category: 'indemnity', receivedCents: 80_000, status: 'Recovered' },
        { exposureId: 'e1', category: 'indemnity', receivedCents: 999, status: 'Open' },
      ],
    };
    const f = exposureFinancials(ledger, 'e1');
    expect(f.incurredCents).toBe(200_000);
    // Open recoveries still count what has actually been received.
    expect(f.recoveredCents).toBe(80_999);
    expect(f.netIncurredCents).toBe(200_000 - 80_999);
  });

  test('other exposures are ignored', () => {
    const ledger: ClaimLedger = {
      ...empty,
      movements: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 100 },
        { exposureId: 'e2', category: 'indemnity', amountCents: 999_999 },
      ],
    };
    expect(exposureFinancials(ledger, 'e1').reserveCents).toBe(100);
  });
});

describe('claim financials', () => {
  test('rolls up across exposures', () => {
    const ledger: ClaimLedger = {
      movements: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 300_000 },
        { exposureId: 'e2', category: 'expense', amountCents: 40_000 },
      ],
      payments: [
        { exposureId: 'e1', category: 'indemnity', amountCents: 120_000, status: 'Issued' },
      ],
      recoveries: [
        { exposureId: 'e2', category: 'expense', receivedCents: 10_000, status: 'Recovered' },
      ],
    };
    const f = claimFinancials(ledger, ['e1', 'e2']);
    expect(f.reserveCents).toBe(340_000);
    expect(f.paidCents).toBe(120_000);
    expect(f.outstandingCents).toBe(220_000);
    expect(f.incurredCents).toBe(340_000);
    expect(f.recoveredCents).toBe(10_000);
    expect(f.netIncurredCents).toBe(330_000);
  });
});
