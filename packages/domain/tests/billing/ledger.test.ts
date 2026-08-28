import { describe, expect, test } from 'vitest';
import { assertBalanced, LEDGER_ACCOUNTS, postingsFor } from '../../src/billing/ledger.ts';

const base = { effectiveDate: '2026-09-01', accountId: 'a1', policyId: 'p1' };

describe('posting rules', () => {
  test('the chart names every account the rules use', () => {
    expect(LEDGER_ACCOUNTS['1100']!.name).toBe('Premium receivable');
    expect(Object.keys(LEDGER_ACCOUNTS)).toHaveLength(13);
  });

  test('a premium charge debits receivable and credits unearned premium', () => {
    const entry = postingsFor({ type: 'chargeBilled', category: 'premium', amountCents: 120_000, chargeId: 'c1', province: 'ON', ...base });
    expect(entry.lines).toEqual([
      { account: '1100', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 120_000, creditCents: 0 },
      { account: '2200', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 0, creditCents: 120_000 },
    ]);
  });

  test('a negative premium charge reverses the direction', () => {
    const entry = postingsFor({ type: 'chargeBilled', category: 'premium', amountCents: -5_000, chargeId: 'c2', province: 'ON', ...base });
    expect(entry.lines[0]).toMatchObject({ account: '2200', debitCents: 5_000 });
    expect(entry.lines[1]).toMatchObject({ account: '1100', creditCents: 5_000 });
  });

  test('tax goes to tax payable by province and fees to fee income', () => {
    const tax = postingsFor({ type: 'chargeBilled', category: 'tax', amountCents: 800, chargeId: 'c3', province: 'ON', ...base });
    expect(tax.lines[1]).toMatchObject({ account: '2300', dimension: { accountId: 'a1', policyId: 'p1', province: 'ON' } });
    const fee = postingsFor({ type: 'chargeBilled', category: 'fee', amountCents: 300, chargeId: 'c4', province: 'ON', ...base });
    expect(fee.lines[1]).toMatchObject({ account: '4200' });
  });

  test('earning moves unearned to earned', () => {
    const e = postingsFor({ type: 'earning', amountCents: 10_000, effectiveDate: '2026-09-30', policyId: 'p1', accountId: 'a1', versionId: 'v1' });
    expect(e.lines).toEqual([
      { account: '2200', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 10_000, creditCents: 0 },
      { account: '4100', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 0, creditCents: 10_000 },
    ]);
  });

  test('a payment lands in unapplied cash; distribution moves it to receivable', () => {
    const p = postingsFor({ type: 'paymentReceived', amountCents: 10_000, effectiveDate: '2026-09-01', paymentId: 'pay1', accountId: 'a1', method: 'eft' });
    expect(p.lines[0]).toMatchObject({ account: '1200', dimension: { accountId: 'a1', method: 'eft' }, debitCents: 10_000 });
    expect(p.lines[1]).toMatchObject({ account: '2100', creditCents: 10_000 });
    const d = postingsFor({ type: 'distribution', amountCents: 10_000, effectiveDate: '2026-09-01', applicationId: 'ap1', accountId: 'a1', policyId: 'p1' });
    expect(d.lines[0]).toMatchObject({ account: '2100', debitCents: 10_000 });
    expect(d.lines[1]).toMatchObject({ account: '1100', creditCents: 10_000 });
  });

  test('every rule balances and an unbalanced entry is refused', () => {
    for (const ev of [
      { type: 'chargeBilled', category: 'premium', amountCents: 7, chargeId: 'x', province: 'ON', ...base },
      { type: 'earning', amountCents: 7, effectiveDate: '2026-09-02', policyId: 'p1', accountId: 'a1', versionId: 'v1' },
    ] as const) {
      expect(() => assertBalanced(postingsFor(ev))).not.toThrow();
    }
    expect(() => assertBalanced({ effectiveDate: '2026-01-01', eventType: 'x', referenceKind: 'x', referenceId: 'x', reason: null,
      lines: [{ account: '1100', dimension: {}, debitCents: 1, creditCents: 0 }] })).toThrow(/does not balance/);
  });
});
