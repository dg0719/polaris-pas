import type { ClaimLedger, Financials } from './types.ts';

/**
 * Claim financial arithmetic. All integer cents; pure sums with no rounding,
 * because every input is already a whole number of cents.
 *
 *   reserveCents     = sum of movement deltas (signed, append-only)
 *   paidCents        = sum of Issued payments
 *   pendingCents     = sum of Requested and Approved payments
 *   recoveredCents   = sum of amounts actually received
 *   outstandingCents = max(0, reserve − paid)
 *   incurredCents    = paid + outstanding
 *   netIncurredCents = incurred − recovered
 */
export function exposureFinancials(ledger: ClaimLedger, exposureId: string): Financials {
  const reserveCents = ledger.movements
    .filter((m) => m.exposureId === exposureId)
    .reduce((sum, m) => sum + m.amountCents, 0);

  const payments = ledger.payments.filter((p) => p.exposureId === exposureId);
  const paidCents = payments
    .filter((p) => p.status === 'Issued')
    .reduce((sum, p) => sum + p.amountCents, 0);
  const pendingCents = payments
    .filter((p) => p.status === 'Requested' || p.status === 'Approved')
    .reduce((sum, p) => sum + p.amountCents, 0);

  const recoveredCents = ledger.recoveries
    .filter((r) => r.exposureId === exposureId)
    .reduce((sum, r) => sum + r.receivedCents, 0);

  const outstandingCents = Math.max(0, reserveCents - paidCents);
  const incurredCents = paidCents + outstandingCents;

  return {
    reserveCents,
    paidCents,
    pendingCents,
    recoveredCents,
    outstandingCents,
    incurredCents,
    netIncurredCents: incurredCents - recoveredCents,
  };
}

/**
 * Roll exposures up to the claim. Outstanding is summed per exposure rather
 * than recomputed from the totals, so an over-paid exposure cannot mask
 * another exposure's remaining reserve.
 */
export function claimFinancials(ledger: ClaimLedger, exposureIds: string[]): Financials {
  return exposureIds.map((id) => exposureFinancials(ledger, id)).reduce(
    (total, f) => ({
      reserveCents: total.reserveCents + f.reserveCents,
      paidCents: total.paidCents + f.paidCents,
      pendingCents: total.pendingCents + f.pendingCents,
      recoveredCents: total.recoveredCents + f.recoveredCents,
      outstandingCents: total.outstandingCents + f.outstandingCents,
      incurredCents: total.incurredCents + f.incurredCents,
      netIncurredCents: total.netIncurredCents + f.netIncurredCents,
    }),
    {
      reserveCents: 0,
      paidCents: 0,
      pendingCents: 0,
      recoveredCents: 0,
      outstandingCents: 0,
      incurredCents: 0,
      netIncurredCents: 0,
    },
  );
}
