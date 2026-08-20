import { describe, expect, test } from 'vitest';
import {
  cancellationRefundCents,
  daysBetween,
  midTermDeltaCents,
  prorate,
} from '../src/proration.ts';

describe('proration', () => {
  test('daysBetween handles a standard annual term', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  test('prorate half a term is half the premium', () => {
    expect(prorate(100000, 182, 364)).toBe(50000);
  });

  test('mid-term endorsement delta prorates the annual difference', () => {
    // +$120.00/yr change at exactly half term → +$60.00
    const delta = midTermDeltaCents(100000, 112000, '2026-07-02', '2027-01-01', '2026-01-01');
    const termDays = daysBetween('2026-01-01', '2027-01-01');
    const remaining = daysBetween('2026-07-02', '2027-01-01');
    expect(delta).toBe(Math.round((12000 * remaining) / termDays));
  });

  test('coverage reduction produces a negative (return) delta', () => {
    const delta = midTermDeltaCents(112000, 100000, '2026-07-02', '2027-01-01', '2026-01-01');
    expect(delta).toBeLessThan(0);
  });

  test('cancellation refund is pro-rata for the unused period', () => {
    const refund = cancellationRefundCents(146000, '2026-07-02', '2026-01-01', '2027-01-01');
    const termDays = daysBetween('2026-01-01', '2027-01-01');
    const remaining = daysBetween('2026-07-02', '2027-01-01');
    expect(refund).toBe(Math.round((146000 * remaining) / termDays));
  });

  test('cancellation at term end refunds nothing', () => {
    expect(cancellationRefundCents(146000, '2027-01-01', '2026-01-01', '2027-01-01')).toBe(0);
  });

  test('zero-length term yields zero', () => {
    expect(prorate(100000, 10, 0)).toBe(0);
  });
});
