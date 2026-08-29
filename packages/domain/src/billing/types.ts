// ─── Billing domain types (pure) ────────────────────────────────────────────
// Catalogue shapes (charge patterns, payment plans, tax rates), the inputs to
// slicing a charge into billable items, and the chart-of-accounts / journal
// shapes that `ledger.ts` turns billing events into. No I/O here; later tasks
// persist these.

/** How a charge pattern behaves over the term: spread over it, billed once at
 * a point in time, or passed through from a third party. */
export type ChargeKind = 'prorata' | 'immediate' | 'passthrough';
export type ChargeCategory = 'premium' | 'tax' | 'fee' | 'other';

export interface ChargePatternDef {
  code: string;
  name: string;
  kind: ChargeKind;
  category: ChargeCategory;
  invoicing: 'spread' | 'single';
  priority: number;
  commissionable: boolean;
  taxable: boolean;
  filingReference: string | null;
}

export type Periodicity = 'monthly' | 'quarterly' | 'annual';

export interface PaymentPlanDef {
  code: string;
  name: string;
  downPaymentBps: number; // share of the charge billed at inception
  installments: number; // count after the down payment
  periodicity: Periodicity;
  feePatternCode: string | null; // charge pattern for the installment fee
  feeBps: number; // fee as share of the charge
  feeCapBps: number | null; // regulatory cap (Ontario auto: 130)
  renewalDownPaymentBps: number | null;
  products: string[];
  provinces: string[];
}

export interface TaxRateDef {
  code: string;
  province: string;
  line: string; // 'auto' | 'property' | 'liability'
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  appliesOn: 'billed' | 'paid';
  patternCode: string;
}

export type InstructionType = 'newBusiness' | 'change' | 'cancellation' | 'reinstatement' | 'renewal' | 'adjustment';

export interface ChargeInput {
  patternCode: string;
  amountCents: number;
  effectiveDate: string;
  province: string;
  line: string;
}

export type ItemKind = 'downPayment' | 'installment' | 'oneTime' | 'fee' | 'tax';

export interface SlicedItem {
  kind: ItemKind;
  patternCode: string;
  amountCents: number;
  eventDate: string;
  sequence: number;
}

/** The chart of accounts. Every code the posting rules in `ledger.ts` use. */
export type LedgerAccountCode =
  | '1100' | '1150' | '1200' | '2100' | '2200' | '2300' | '2400' | '2500' | '2600'
  | '4100' | '4200' | '5100' | '5200';

/** Free-form dimensions carried on a journal line for later reporting; every
 * key is optional because different posting rules populate different subsets. */
export interface Dimension {
  accountId?: string;
  policyId?: string;
  producerId?: string;
  province?: string;
  method?: string;
}

export interface JournalLineInput {
  account: LedgerAccountCode;
  dimension: Dimension;
  debitCents: number;
  creditCents: number;
}

export interface JournalEntryInput {
  effectiveDate: string;
  eventType: string;
  referenceKind: string;
  referenceId: string;
  reason: string | null;
  lines: JournalLineInput[];
}

/** A billing event as the API observes it; `postingsFor` turns each into a
 * balanced double-entry journal entry. */
export type BillingEvent =
  | { type: 'chargeBilled'; category: ChargeCategory; amountCents: number; effectiveDate: string; chargeId: string; accountId: string; policyId: string; province: string }
  | { type: 'earning'; amountCents: number; effectiveDate: string; policyId: string; accountId: string; versionId: string }
  | { type: 'paymentReceived'; amountCents: number; effectiveDate: string; paymentId: string; accountId: string; method: string }
  | { type: 'distribution'; amountCents: number; effectiveDate: string; applicationId: string; accountId: string; policyId: string };
