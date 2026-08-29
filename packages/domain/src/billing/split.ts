/** Equal parts; the rounding remainder goes to the LAST part; sign preserved. */
export function splitRemainderLast(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);
  const base = Math.floor(magnitude / count);
  const remainder = magnitude - base * count;
  return Array.from({ length: count }, (_, i) => sign * (base + (i === count - 1 ? remainder : 0)));
}

/** Basis-point share of an amount, rounded once. */
export function bpsOf(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}
