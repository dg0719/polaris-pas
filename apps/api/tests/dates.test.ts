import { describe, expect, test } from 'vitest';
import { addMonths, isBefore, isIsoDate, termFor, toIsoDate } from '../src/dates.ts';

describe('dates', () => {
  test('addMonths rolls the year over', () => {
    expect(addMonths('2026-09-01', 12)).toBe('2027-09-01');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  test('addMonths clamps to the last day of a short month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
  });

  test('termFor produces a 12-month term', () => {
    expect(termFor('2026-09-01', 12)).toEqual({
      termStart: '2026-09-01',
      termEnd: '2027-09-01',
    });
  });

  test('termFor supports a six-month term', () => {
    expect(termFor('2026-09-01', 6).termEnd).toBe('2027-03-01');
  });

  test('toIsoDate normalises a timestamp', () => {
    expect(toIsoDate('2026-09-01T14:30:00.000Z')).toBe('2026-09-01');
  });

  test('isIsoDate rejects junk and loose formats', () => {
    expect(isIsoDate('2026-09-01')).toBe(true);
    expect(isIsoDate('2026-9-1')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
    expect(isIsoDate(20260901)).toBe(false);
  });

  test('isBefore compares ISO dates', () => {
    expect(isBefore('2026-09-01', '2026-09-02')).toBe(true);
    expect(isBefore('2026-09-02', '2026-09-01')).toBe(false);
    expect(isBefore('2026-09-01', '2026-09-01')).toBe(false);
  });
});
