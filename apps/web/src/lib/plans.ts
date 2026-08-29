import { useQuery } from './api.ts';
import type { PaymentPlan } from './types.ts';

/**
 * The payment plans a carrier has configured for this product and province.
 * Plans are data: a carrier adding one has to reach the quote wizard without
 * a code change, so nothing here knows any plan code.
 */
export function usePaymentPlans(productCode: string | undefined, province: string | undefined) {
  const query = useQuery<{ paymentPlans: PaymentPlan[] }>(
    productCode && province
      ? `/billing/plans?productCode=${encodeURIComponent(productCode)}&province=${encodeURIComponent(province)}`
      : null,
  );
  return { plans: query.data?.paymentPlans, loading: query.loading, error: query.error };
}

export function findPlan(plans: PaymentPlan[] | undefined, code: string): PaymentPlan | undefined {
  return plans?.find((plan) => plan.code === code);
}

/** A share of an amount in basis points, rounded once. */
export function bpsOf(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

/**
 * What is due when cover starts, as the review screen previews it: the down
 * payment where the plan has one, otherwise the first of equal installments.
 * The billed figure comes from the schedule the API writes at issue; this is
 * the estimate shown before the policy exists.
 */
export function firstPaymentCents(annualCents: number, plan: PaymentPlan | undefined): number {
  if (!plan) return annualCents;
  if (plan.downPaymentBps > 0) return bpsOf(annualCents, plan.downPaymentBps);
  return Math.round(annualCents / Math.max(1, plan.installments));
}
