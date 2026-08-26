import type { FraudRuleDef, ProductDefinition } from '../types.ts';
import type { FraudFlag, FraudSubject } from './types.ts';

function compare(actual: number, op: FraudRuleDef['op'], value: number): boolean {
  switch (op) {
    case 'gt': return actual > value;
    case 'gte': return actual >= value;
    case 'lt': return actual < value;
    case 'lte': return actual <= value;
    case 'eq': return actual === value;
  }
}

/**
 * Evaluate the product's fraud indicators against the facts of a reported
 * loss. Indicators, not verdicts: a flag asks an adjuster to look, it never
 * decides anything by itself.
 */
export function evaluateFraudRules(subject: FraudSubject, product: ProductDefinition): FraudFlag[] {
  const flags: FraudFlag[] = [];
  for (const rule of product.fraudRules) {
    const actual = subject[rule.field];
    if (compare(actual, rule.op, rule.value)) {
      flags.push({
        ruleCode: rule.code,
        description: rule.description,
        detail: rule.valueLabel ? `${actual} ${rule.valueLabel}` : String(actual),
      });
    }
  }
  return flags;
}
