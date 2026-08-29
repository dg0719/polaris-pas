import { addDays, addMonths } from '@polaris/domain';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalise an ISO date-time or date string to `YYYY-MM-DD` (UTC). */
export function toIsoDate(value: string): string {
  if (ISO_DATE.test(value)) return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid date: ${value}`);
  return new Date(parsed).toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

export { addDays, addMonths };

/** Today in UTC as `YYYY-MM-DD`. Callers pass it in so behaviour stays testable. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Term boundaries for a policy starting on `effectiveDate`. */
export function termFor(effectiveDate: string, termMonths: number): {
  termStart: string;
  termEnd: string;
} {
  const termStart = toIsoDate(effectiveDate);
  return { termStart, termEnd: addMonths(termStart, termMonths) };
}

/** True when `a` is strictly before `b`. */
export function isBefore(a: string, b: string): boolean {
  return Date.parse(a) < Date.parse(b);
}
