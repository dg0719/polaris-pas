const MS_PER_DAY = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}

/**
 * Pro-rata share of an annual premium for the period [effective, expiry)
 * within a term of `termDays` days. Integer cents, banker-safe rounding.
 */
export function prorate(annualPremiumCents: number, periodDays: number, termDays: number): number {
  if (termDays <= 0) return 0;
  return Math.round((annualPremiumCents * periodDays) / termDays);
}

/**
 * Mid-term change: additional (or return, if negative) premium for switching
 * from oldAnnual to newAnnual at `effective`, within [termStart, termEnd).
 */
export function midTermDeltaCents(
  oldAnnualCents: number,
  newAnnualCents: number,
  effectiveIso: string,
  termEndIso: string,
  termStartIso: string,
): number {
  const termDays = daysBetween(termStartIso, termEndIso);
  const remainingDays = daysBetween(effectiveIso, termEndIso);
  return prorate(newAnnualCents - oldAnnualCents, remainingDays, termDays);
}

/**
 * Pro-rata refund for cancellation at `effective` within [termStart, termEnd).
 * Returns a non-negative refund amount in cents.
 */
export function cancellationRefundCents(
  annualPremiumCents: number,
  effectiveIso: string,
  termStartIso: string,
  termEndIso: string,
): number {
  const termDays = daysBetween(termStartIso, termEndIso);
  const remainingDays = daysBetween(effectiveIso, termEndIso);
  return Math.max(0, prorate(annualPremiumCents, remainingDays, termDays));
}
