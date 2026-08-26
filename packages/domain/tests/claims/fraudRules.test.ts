import { describe, expect, test } from 'vitest';
import { evaluateFraudRules } from '../../src/claims/fraudRules.ts';
import type { FraudSubject } from '../../src/claims/types.ts';
import { ontarioAutoV1 } from '../../src/product.ts';

const clean: FraudSubject = {
  daysToReport: 2,
  daysSinceInception: 200,
  daysSinceCancellation: -1,
  priorAtFaultClaims: 0,
};

describe('fraud rules', () => {
  test('a promptly reported mid-term loss raises nothing', () => {
    expect(evaluateFraudRules(clean, ontarioAutoV1)).toEqual([]);
  });

  test('late reporting is flagged', () => {
    const flags = evaluateFraudRules({ ...clean, daysToReport: 45 }, ontarioAutoV1);
    expect(flags.map((f) => f.ruleCode)).toContain('FR-LATE');
  });

  test('a loss right after inception is flagged', () => {
    const flags = evaluateFraudRules({ ...clean, daysSinceInception: 5 }, ontarioAutoV1);
    expect(flags.map((f) => f.ruleCode)).toContain('FR-NEWPOLICY');
  });

  test('a loss after cancellation is flagged', () => {
    const flags = evaluateFraudRules({ ...clean, daysSinceCancellation: 3 }, ontarioAutoV1);
    expect(flags.map((f) => f.ruleCode)).toContain('FR-POSTCANCEL');
  });

  test('a heavy prior claims history is flagged', () => {
    const flags = evaluateFraudRules({ ...clean, priorAtFaultClaims: 3 }, ontarioAutoV1);
    expect(flags.map((f) => f.ruleCode)).toContain('FR-HISTORY');
  });

  test('each flag reads like a sentence a person would say', () => {
    const [flag] = evaluateFraudRules({ ...clean, daysToReport: 45 }, ontarioAutoV1);
    expect(flag!.description.length).toBeGreaterThan(10);
    expect(flag!.detail).toContain('45');
  });
});
