import { describe, expect, test } from 'vitest';
import {
  buildSchedule,
  installmentCount,
  spreadDelta,
  splitEvenly,
} from '../src/billing.ts';

describe('installment counts', () => {
  test('pay in full is a single installment', () => {
    expect(installmentCount('full', 12)).toBe(1);
  });

  test('monthly and quarterly follow the term length', () => {
    expect(installmentCount('monthly', 12)).toBe(12);
    expect(installmentCount('quarterly', 12)).toBe(4);
    expect(installmentCount('monthly', 6)).toBe(6);
    expect(installmentCount('quarterly', 6)).toBe(2);
  });
});

describe('splitEvenly', () => {
  test('the parts always sum to the total', () => {
    for (const total of [100000, 177768, 1, 99999]) {
      const parts = splitEvenly(total, 7);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  test('the rounding remainder lands on the first installment', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
  });

  test('negative totals split without losing a cent', () => {
    expect(splitEvenly(-1000, 3)).toEqual([-334, -333, -333]);
  });
});

describe('buildSchedule', () => {
  test('a monthly schedule bills every month and sums to the premium', () => {
    const schedule = buildSchedule(177768, 'monthly', 12);
    expect(schedule).toHaveLength(12);
    expect(schedule.map((i) => i.monthsFromStart)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(schedule.reduce((s, i) => s + i.amountCents, 0)).toBe(177768);
  });

  test('a quarterly schedule bills every three months', () => {
    const schedule = buildSchedule(120000, 'quarterly', 12);
    expect(schedule.map((i) => i.monthsFromStart)).toEqual([0, 3, 6, 9]);
    expect(schedule.every((i) => i.amountCents === 30000)).toBe(true);
  });

  test('pay in full is one installment due at inception', () => {
    expect(buildSchedule(177768, 'full', 12)).toEqual([
      { sequence: 1, monthsFromStart: 0, amountCents: 177768 },
    ]);
  });
});

describe('spreadDelta', () => {
  const open = [
    { sequence: 3, amountCents: 10000 },
    { sequence: 4, amountCents: 10000 },
    { sequence: 5, amountCents: 10000 },
  ];

  test('additional premium spreads evenly with nothing left over', () => {
    const result = spreadDelta(3000, open);
    expect(result.adjusted.map((i) => i.amountCents)).toEqual([11000, 11000, 11000]);
    expect(result.unabsorbedCents).toBe(0);
  });

  test('return premium comes off the last installment first', () => {
    const result = spreadDelta(-12000, open);
    expect(result.adjusted.map((i) => i.amountCents)).toEqual([10000, 8000, 0]);
    expect(result.unabsorbedCents).toBe(0);
  });

  test('an installment is never driven negative; the rest is reported back', () => {
    const result = spreadDelta(-45000, open);
    expect(result.adjusted.map((i) => i.amountCents)).toEqual([0, 0, 0]);
    expect(result.unabsorbedCents).toBe(-15000);
  });

  test('with no open installments the whole delta is unabsorbed', () => {
    expect(spreadDelta(5000, []).unabsorbedCents).toBe(5000);
  });

  test('a zero delta leaves the schedule untouched', () => {
    expect(spreadDelta(0, open).adjusted.map((i) => i.amountCents)).toEqual([10000, 10000, 10000]);
  });

  test('spreading does not mutate the input', () => {
    spreadDelta(-45000, open);
    expect(open.map((i) => i.amountCents)).toEqual([10000, 10000, 10000]);
  });
});
