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

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Add whole months to an ISO date, clamping the day to the last day of the
 * target month (2026-01-31 + 1 month → 2026-02-28).
 */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = toIsoDate(isoDate).split('-').map(Number) as [number, number, number];
  const zeroBasedMonth = m - 1 + months;
  const year = y + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${toIsoDate(isoDate)}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

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
