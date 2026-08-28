function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Parse YYYY-MM-DD and fail fast if format is invalid. */
function parts(iso: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Expected YYYY-MM-DD, got ${iso}`);
  }
  return iso.split('-').map(Number) as [number, number, number];
}

/**
 * Add whole months to an ISO date, clamping the day to the last day of the
 * target month (2026-01-31 + 1 month → 2026-02-28).
 * Expects input in YYYY-MM-DD format.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const zeroBasedMonth = m - 1 + months;
  const year = y + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Add days to an ISO date.
 * Expects input in YYYY-MM-DD format.
 */
export function addDays(iso: string, days: number): string {
  parts(iso);
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
