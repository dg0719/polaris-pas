import { expect, test } from 'vitest';
import { addDays, addMonths } from '../src/dates.ts';

test('addMonths clamps to the end of a shorter month', () => {
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2026-09-01', 12)).toBe('2027-09-01');
});
test('addDays crosses a year boundary', () => {
  expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
});
