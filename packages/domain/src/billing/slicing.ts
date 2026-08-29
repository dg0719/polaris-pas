import { addMonths } from '../dates.ts';
import { bpsOf, splitRemainderLast } from './split.ts';
import type { ChargePatternDef, InstructionType, PaymentPlanDef, Periodicity, SlicedItem } from './types.ts';

const MONTHS: Record<Periodicity, number> = { monthly: 1, quarterly: 3, annual: 12 };

export class PlanCapError extends Error {}

/** A plan definition that is structurally impossible to slice by, or that
 * violates a regulatory cap — distinct from `PlanCapError`'s narrower
 * "fee exceeds the cap" case only in that this covers every structural
 * defect a plan can carry, cap included, checked unconditionally. */
export class PlanDefinitionError extends Error {}

export interface SliceInput {
  amountCents: number;
  patternCode: string;
  termStart: string;
  /** Length of the term being billed. A plan's `installments` describes a
   * 12-month term, so a six-month term gets half as many. */
  termMonths: number;
  plan: PaymentPlanDef;
  instructionType: InstructionType;
  feePattern: ChargePatternDef | null;
}

/**
 * Reject a plan that cannot be sliced correctly, regardless of the charge's
 * sign or the caller's fee pattern. Checked unconditionally so a negative
 * charge or a missing fee pattern can't smuggle a bad plan past validation.
 */
function validatePlan(plan: PaymentPlanDef): void {
  if (plan.installments < 1) {
    throw new PlanDefinitionError(`Plan ${plan.code} has ${plan.installments} installments; at least 1 is required`);
  }
  if (plan.downPaymentBps < 0 || plan.downPaymentBps > 10_000) {
    throw new PlanDefinitionError(`Plan ${plan.code} down payment ${plan.downPaymentBps} bps must be between 0 and 10,000`);
  }
  if (plan.feeBps < 0) {
    throw new PlanDefinitionError(`Plan ${plan.code} fee ${plan.feeBps} bps must not be negative`);
  }
  if (plan.feeCapBps !== null && plan.feeBps > plan.feeCapBps) {
    throw new PlanCapError(`Plan ${plan.code} fee ${plan.feeBps} bps exceeds the cap of ${plan.feeCapBps} bps`);
  }
}

/**
 * How many installments this plan produces over a term of `termMonths`. The
 * catalogue states each plan's count for a 12-month term, so a six-month term
 * on the monthly plan bills six times, not twelve. Never fewer than one: a
 * term shorter than the plan's cadence still has to be billed.
 */
function installmentsFor(plan: PaymentPlanDef, termMonths: number): number {
  return Math.max(1, Math.round((plan.installments * termMonths) / 12));
}

/**
 * Slice a charge into invoice items: a down payment at inception (if the
 * plan has one), equal installments on the plan's cadence with the rounding
 * remainder on the last, and the installment fee spread over the
 * installments. Fees are never charged on a down payment.
 */
export function sliceCharge(input: SliceInput): SlicedItem[] {
  const { plan } = input;
  validatePlan(plan);
  const downBps = input.instructionType === 'renewal' && plan.renewalDownPaymentBps !== null
    ? plan.renewalDownPaymentBps : plan.downPaymentBps;
  const items: SlicedItem[] = [];
  let sequence = 1;

  const down = downBps > 0 ? bpsOf(input.amountCents, downBps) : 0;
  if (down !== 0) {
    items.push({ kind: 'downPayment', patternCode: input.patternCode, amountCents: down, eventDate: input.termStart, sequence: sequence++ });
  }

  const firstOffset = down !== 0 ? 1 : 0;
  const parts = splitRemainderLast(input.amountCents - down, installmentsFor(plan, input.termMonths));
  const dates = parts.map((_, i) => addMonths(input.termStart, (i + firstOffset) * MONTHS[plan.periodicity]));
  parts.forEach((amountCents, i) => {
    items.push({ kind: 'installment', patternCode: input.patternCode, amountCents, eventDate: dates[i]!, sequence: sequence++ });
  });

  if (input.feePattern && plan.feeBps > 0 && input.amountCents > 0) {
    const fee = bpsOf(input.amountCents, plan.feeBps);
    // A fee smaller than the installment count rounds to nothing on the
    // early ones. A zero row bills nothing and shows nothing, so it is not
    // written — the tax path has always filtered zeros the same way.
    splitRemainderLast(fee, parts.length).forEach((amountCents, i) => {
      if (amountCents === 0) return;
      items.push({ kind: 'fee', patternCode: input.feePattern!.code, amountCents, eventDate: dates[i]!, sequence: sequence++ });
    });
  }
  return items;
}
