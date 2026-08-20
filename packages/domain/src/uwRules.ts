import type { ProductDefinition, RiskData, UwReferral, UwRule } from './types.ts';

function compare(actual: number, op: UwRule['op'], value: number): boolean {
  switch (op) {
    case 'gt': return actual > value;
    case 'gte': return actual >= value;
    case 'lt': return actual < value;
    case 'lte': return actual <= value;
    case 'eq': return actual === value;
  }
}

const MONEY = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });

/**
 * The value that tripped the rule, as an underwriter would say it out loud.
 * Never a raw field name, and never a bare count of cents.
 */
function describeValue(actual: number, rule: UwRule): string {
  if (rule.unit === 'money') return MONEY.format(actual / 100);
  if (rule.valueLabel) return `${actual} ${rule.valueLabel}`;
  return String(actual);
}

/** Evaluate data-driven underwriting referral rules against a risk. */
export function evaluateUwRules(product: ProductDefinition, risk: RiskData): UwReferral[] {
  const referrals: UwReferral[] = [];
  for (const rule of product.uwRules) {
    const subjects: Record<string, unknown>[] =
      rule.subject === 'driver' ? (risk.drivers as unknown as Record<string, unknown>[])
                                : (risk.vehicles as unknown as Record<string, unknown>[]);
    for (const subject of subjects) {
      const actual = subject[rule.field];
      if (typeof actual !== 'number') continue;
      if (compare(actual, rule.op, rule.value)) {
        const label =
          rule.subject === 'driver'
            ? `${(subject as { firstName?: string }).firstName ?? ''} ${(subject as { lastName?: string }).lastName ?? ''}`.trim()
            : `${(subject as { year?: number }).year ?? ''} ${(subject as { make?: string }).make ?? ''} ${(subject as { model?: string }).model ?? ''}`.trim();
        referrals.push({
          ruleCode: rule.code,
          description: rule.description,
          detail: `${label}: ${describeValue(actual, rule)}`,
        });
      }
    }
  }
  return referrals;
}
