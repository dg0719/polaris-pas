// ─── Installment billing maths (pure) ───────────────────────────────────────

export type InstallmentPlan = 'full' | 'monthly' | 'quarterly';

export interface Installment {
  sequence: number;
  /** Months after term start that this installment is due. */
  monthsFromStart: number;
  amountCents: number;
}

const PLAN_INTERVAL_MONTHS: Record<InstallmentPlan, number> = {
  full: 0,
  monthly: 1,
  quarterly: 3,
};

export function isInstallmentPlan(value: unknown): value is InstallmentPlan {
  return value === 'full' || value === 'monthly' || value === 'quarterly';
}

/** How many installments a plan produces over a term of `termMonths`. */
export function installmentCount(plan: InstallmentPlan, termMonths: number): number {
  if (plan === 'full') return 1;
  const interval = PLAN_INTERVAL_MONTHS[plan];
  return Math.max(1, Math.floor(termMonths / interval));
}

/**
 * Split `totalCents` into equal installments, giving the rounding remainder to
 * the first one so the schedule always sums exactly to the total.
 */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);
  const base = Math.floor(magnitude / count);
  const remainder = magnitude - base * count;
  return Array.from({ length: count }, (_, i) => sign * (base + (i === 0 ? remainder : 0)));
}

/** Build the installment schedule for a term's premium. */
export function buildSchedule(
  totalCents: number,
  plan: InstallmentPlan,
  termMonths: number,
): Installment[] {
  const count = installmentCount(plan, termMonths);
  const interval = plan === 'full' ? 0 : PLAN_INTERVAL_MONTHS[plan];
  return splitEvenly(totalCents, count).map((amountCents, i) => ({
    sequence: i + 1,
    monthsFromStart: i * interval,
    amountCents,
  }));
}

export interface AdjustableInstallment {
  sequence: number;
  amountCents: number;
}

export interface SpreadResult<T extends AdjustableInstallment> {
  /** Installments with their new amounts, in the order supplied. */
  adjusted: T[];
  /** Amount that could not be absorbed: positive = still owed, negative = credit due. */
  unabsorbedCents: number;
}

/**
 * Spread `deltaCents` across open installments.
 *
 * Additional premium is distributed evenly across all of them. Return premium
 * is taken off the latest installments first, so the customer's next payment
 * drops before their last one does, and an installment can never go negative.
 */
export function spreadDelta<T extends AdjustableInstallment>(
  deltaCents: number,
  open: T[],
): SpreadResult<T> {
  if (deltaCents === 0 || open.length === 0) {
    return { adjusted: open.map((i) => ({ ...i })), unabsorbedCents: deltaCents };
  }

  if (deltaCents > 0) {
    const shares = splitEvenly(deltaCents, open.length);
    return {
      adjusted: open.map((inst, i) => ({ ...inst, amountCents: inst.amountCents + shares[i]! })),
      unabsorbedCents: 0,
    };
  }

  let remaining = -deltaCents;
  const adjusted = open.map((inst) => ({ ...inst }));
  for (let i = adjusted.length - 1; i >= 0 && remaining > 0; i--) {
    const inst = adjusted[i]!;
    const reduction = Math.min(inst.amountCents, remaining);
    inst.amountCents -= reduction;
    remaining -= reduction;
  }
  return { adjusted, unabsorbedCents: remaining === 0 ? 0 : -remaining };
}
