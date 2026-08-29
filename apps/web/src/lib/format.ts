import type { PaymentPlan } from './types.ts';

const CURRENCY = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
});

/** Money is never abbreviated and always shows both decimals. */
export function money(cents: number): string {
  return CURRENCY.format(cents / 100);
}

/**
 * A change in money, where the direction is the point: an endorsement that adds
 * premium reads "+", a return premium reads "−".
 */
export function deltaMoney(cents: number): string {
  const formatted = CURRENCY.format(Math.abs(cents) / 100);
  if (cents < 0) return `−${formatted}`;
  if (cents > 0) return `+${formatted}`;
  return formatted;
}

/** A balance: plain when owed, marked as credit when the insurer owes it. */
export function balanceMoney(cents: number): string {
  if (cents < 0) return `${CURRENCY.format(Math.abs(cents) / 100)} CR`;
  return CURRENCY.format(cents / 100);
}

const DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso.length > 10 ? iso : `${iso}T00:00:00Z`);
  if (Number.isNaN(parsed)) return '—';
  return DATE.format(new Date(parsed));
}

export function dateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "3 days ago", "in 2 weeks" — for queue recency, never for money. */
export function relativeDays(iso: string): string {
  const then = Date.parse(iso.length > 10 ? iso : `${iso}T00:00:00Z`);
  const days = Math.round((then - Date.now()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/**
 * Payment plans are carrier configuration: the name and the terms come from
 * the billing catalogue. These helpers take the catalogue when a screen has
 * loaded it and fall back to the shipped codes when it has not.
 */
export function planName(plan: string, catalogue?: PlanShape[]): string {
  const configured = catalogue?.find((entry) => entry.code === plan);
  if (configured) return configured.name;
  if (plan === 'full') return 'Paid in full';
  if (plan === 'monthly') return 'Monthly';
  if (plan === 'quarterly') return 'Quarterly';
  return plan;
}

export function planLabel(plan: string, catalogue?: PlanShape[]): string {
  const configured = catalogue?.find((entry) => entry.code === plan);
  if (configured) return planNote(configured);
  if (plan === 'full') return 'One payment when cover starts';
  if (plan === 'monthly') return '12 payments, first when cover starts';
  if (plan === 'quarterly') return '4 payments, first when cover starts';
  return plan;
}

type PlanShape = Pick<
  PaymentPlan,
  'code' | 'name' | 'downPaymentBps' | 'installments' | 'periodicity' | 'feeBps'
>;

const CADENCE: Record<string, string> = {
  annual: 'yearly',
  semiannual: 'half-yearly',
  quarterly: 'quarterly',
  monthly: 'monthly',
};

/** How a plan reads to the person choosing it: what is due, when, and the fee. */
export function planNote(plan: PlanShape): string {
  const cadence = CADENCE[plan.periodicity] ?? plan.periodicity;
  const parts: string[] = [];

  if (plan.downPaymentBps > 0) {
    parts.push(
      `${percent(plan.downPaymentBps)} down when cover starts, then ${plan.installments} ${cadence} payments`,
    );
  } else if (plan.installments <= 1) {
    parts.push('One payment when cover starts');
  } else {
    parts.push(`${plan.installments} ${cadence} payments, the first when cover starts`);
  }

  if (plan.feeBps > 0) parts.push(`${percent(plan.feeBps)} installment fee`);
  return `${parts.join('. ')}.`;
}

/** Basis points as people read them: 1667 → 16.67%, 130 → 1.3%. */
export function percent(bps: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

const FEE_NAMES: Record<string, string> = {
  'FEE-INST': 'Installment fee',
  'FEE-NSF': 'Returned payment fee',
  'FEE-REINSTATE': 'Reinstatement fee',
};

const TAX_NAMES: Record<string, string> = {
  'TAX-RST': 'Retail sales tax',
  'TAX-QC': 'Tax on premiums',
};

/**
 * What one line of an invoice is, in a word: the kind carries the meaning and
 * the charge pattern names the specific fee or tax.
 */
export function lineLabel(line: { kind: string; patternCode: string }): string {
  if (line.kind === 'fee') return FEE_NAMES[line.patternCode] ?? 'Fee';
  if (line.kind === 'tax') return TAX_NAMES[line.patternCode] ?? 'Tax';
  if (line.kind === 'downPayment') return 'Down payment';
  return 'Premium';
}

export function useLabel(value: string): string {
  if (value === 'pleasure') return 'Pleasure';
  if (value === 'commute') return 'Commute';
  if (value === 'business') return 'Business';
  return value;
}

export function jobTypeLabel(type: string): string {
  if (type === 'PolicyChange') return 'Policy change';
  return type;
}

/** Transaction types are stored as codes; nobody says "NewBusiness" out loud. */
export function transactionLabel(type: string): string {
  if (type === 'NewBusiness') return 'New business';
  return type;
}

export function kilometres(km: number): string {
  return `${new Intl.NumberFormat('en-CA').format(km)} km/yr`;
}

/** Loss causes are stored as codes; read them as words. */
export function lossCauseLabel(code: string): string {
  const words = code.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function claimantKindLabel(kind: string): string {
  return kind === 'thirdParty' ? 'Third party' : 'Insured';
}

export function roleLabel(role: string): string {
  if (role === 'csr') return 'CSR';
  if (role === 'claims_supervisor') return 'Claims supervisor';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function recoveryTypeLabel(type: string): string {
  if (type === 'subrogation') return 'Subrogation';
  if (type === 'salvage') return 'Salvage';
  if (type === 'deductible') return 'Deductible recovery';
  return type;
}

export function payMethodLabel(method: string): string {
  if (method === 'eft') return 'EFT';
  if (method === 'cheque') return 'Cheque';
  return method;
}
