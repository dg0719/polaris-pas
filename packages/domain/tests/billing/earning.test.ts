import { expect, test } from 'vitest';
import { earnedCents } from '../../src/billing/earning.ts';

test('earned premium accrues daily pro rata', () => {
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2025-12-31')).toBe(0);
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2026-01-02')).toBe(1_000);
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2026-07-02')).toBe(182_000);
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2028-01-01')).toBe(365_000);
});
