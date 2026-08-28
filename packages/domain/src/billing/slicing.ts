import { addMonths } from '../dates.ts';
import { bpsOf, splitRemainderLast } from './split.ts';
import type { ChargePatternDef, InstructionType, PaymentPlanDef, Periodicity, SlicedItem } from './types.ts';

const MONTHS: Record<Periodicity, number> = { monthly: 1, quarterly: 3, annual: 12 };

export class PlanCapError extends Error {}

export interface SliceInput {
  amountCents: number;
  patternCode: string;
  termStart: string;
  plan: PaymentPlanDef;
  instructionType: InstructionType;
  feePattern: ChargePatternDef | null;
}

/**
 * Slice a charge into invoice items: a down payment at inception (if the
 * plan has one), equal installments on the plan's cadence with the rounding
 * remainder on the last, and the installment fee spread over the
 * installments. Fees are never charged on a down payment.
 */
export function sliceCharge(input: SliceInput): SlicedItem[] {
  const { plan } = input;
  const downBps = input.instructionType === 'renewal' && plan.renewalDownPaymentBps !== null
    ? plan.renewalDownPaymentBps : plan.downPaymentBps;
  const items: SlicedItem[] = [];
  let sequence = 1;

  const down = downBps > 0 ? bpsOf(input.amountCents, downBps) : 0;
  if (down !== 0) {
    items.push({ kind: 'downPayment', patternCode: input.patternCode, amountCents: down, eventDate: input.termStart, sequence: sequence++ });
  }

  const firstOffset = down !== 0 ? 1 : 0;
  const parts = splitRemainderLast(input.amountCents - down, plan.installments);
  const dates = parts.map((_, i) => addMonths(input.termStart, (i + firstOffset) * MONTHS[plan.periodicity]));
  parts.forEach((amountCents, i) => {
    items.push({ kind: 'installment', patternCode: input.patternCode, amountCents, eventDate: dates[i]!, sequence: sequence++ });
  });

  if (input.feePattern && plan.feeBps > 0 && input.amountCents > 0) {
    if (plan.feeCapBps !== null && plan.feeBps > plan.feeCapBps) {
      throw new PlanCapError(`Plan ${plan.code} fee ${plan.feeBps} bps exceeds the cap of ${plan.feeCapBps} bps`);
    }
    const fee = bpsOf(input.amountCents, plan.feeBps);
    splitRemainderLast(fee, parts.length).forEach((amountCents, i) => {
      items.push({ kind: 'fee', patternCode: input.feePattern!.code, amountCents, eventDate: dates[i]!, sequence: sequence++ });
    });
  }
  return items;
}
