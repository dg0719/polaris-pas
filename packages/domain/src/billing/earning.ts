import { daysBetween, prorate } from '../proration.ts';

/**
 * Premium earned by the start of `asOf`, daily pro rata across the term. The
 * term is inclusive of its end: on and after `termEnd` the whole written
 * premium is earned, and nothing is earned on or before `termStart`.
 */
export function earnedCents(writtenCents: number, termStart: string, termEnd: string, asOf: string): number {
  if (asOf <= termStart) return 0;
  if (asOf >= termEnd) return writtenCents;
  return prorate(writtenCents, daysBetween(termStart, asOf), daysBetween(termStart, termEnd));
}
