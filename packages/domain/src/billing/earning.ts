import { daysBetween, prorate } from '../proration.ts';

/** Premium earned by the start of `asOf`, daily pro rata over [termStart, termEnd). */
export function earnedCents(writtenCents: number, termStart: string, termEnd: string, asOf: string): number {
  if (asOf <= termStart) return 0;
  if (asOf >= termEnd) return writtenCents;
  return prorate(writtenCents, daysBetween(termStart, asOf), daysBetween(termStart, termEnd));
}
