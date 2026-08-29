import { postingsFor, taxRateFor } from '@polaris/domain';
import type {
  ChargeCategory,
  LedgerAccountCode,
  ChargePatternDef,
  InstructionType,
  PaymentPlanDef,
  ProductDefinition,
  SlicedItem,
  TaxRateDef,
} from '@polaris/domain';
import type { Db } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type {
  BillingInstructionRow,
  BillingInvoiceRow,
  ChargeRow,
  InvoiceStreamRow,
  JobRow,
  PolicyRow,
  PolicyVersionRow,
  TenantCtx,
  TransactionRow,
} from '../repo.ts';

// ─── Shared plumbing for turning an issued job into billing ────────────────
// The pieces both branches of `instructions.ts` need: the resolved context,
// the charge/invoice/item writers, and the one place a charge reaches the
// ledger. Kept here so neither branch has to import the other.

export const INSTRUCTION_TYPE: Record<JobRow['job_type'], InstructionType> = {
  Submission: 'newBusiness',
  PolicyChange: 'change',
  Renewal: 'renewal',
  Cancellation: 'cancellation',
};

/**
 * The two ledger accounts the billing services read balances from by name.
 * The codes themselves are the chart of accounts in
 * `packages/domain/src/billing/ledger.ts`; naming them here keeps a bare
 * four-digit literal out of the services that ask what an account holds.
 */
export const PREMIUM_RECEIVABLE: LedgerAccountCode = '1100';
export const UNAPPLIED_CASH: LedgerAccountCode = '2100';

/** How far ahead of its due date an invoice is sent. */
export const LEAD_DAYS = 21;

/** How long a customer has to settle a one-off invoice raised mid-term. */
export const DAYS_UNTIL_DUE = 14;

export interface ApplyIssuedJobInput {
  job: JobRow;
  policy: PolicyRow;
  version: PolicyVersionRow;
  transaction: TransactionRow;
  termNumber: number;
}

export interface ApplyIssuedJobResult {
  instruction: BillingInstructionRow;
  invoices: BillingInvoiceRow[];
}

/** Everything the two branches need, resolved once. */
export interface Context extends ApplyIssuedJobInput {
  instructionType: InstructionType;
  plan: PaymentPlanDef;
  product: ProductDefinition;
  province: string;
  /** Length of the term being billed, from the job's risk. */
  termMonths: number;
}

/** An item, the charge it belongs to, and the invoice it is placed on. */
export interface Placed {
  invoiceId: string;
  charge: ChargeRow;
  item: SlicedItem;
  /** The item this one takes off, when it takes off exactly one. A fee or
   * tax reversal names the line it cancels; a premium re-spread item offsets
   * an invoice rather than a single item, so it leaves this unset. */
  offsetsItemId?: string;
}

export function total(items: SlicedItem[]): number {
  return items.reduce((sum, i) => sum + i.amountCents, 0);
}

export function totalOn(db: Db, ctx: TenantCtx, invoiceId: string): number {
  return repo.listItemsForInvoice(db, ctx, invoiceId).reduce((sum, i) => sum + i.amount_cents, 0);
}

/**
 * What an invoice's premium can still give up: its premium items less what
 * has been paid against them. Return premium may only reduce premium — the
 * installment fee and the tax on it are reversed separately, and only when
 * the premium is gone altogether — so the fee must not appear here or a
 * refund would silently eat it.
 */
export function premiumOutstandingOn(
  db: Db,
  ctx: TenantCtx,
  invoiceId: string,
  premiumPatternCode: string,
): number {
  return repo
    .listItemsForInvoice(db, ctx, invoiceId)
    .filter((i) => i.pattern_code === premiumPatternCode)
    .reduce((sum, i) => sum + i.amount_cents - i.paid_cents, 0);
}

export function ensureStream(db: Db, ctx: TenantCtx, c: Context): InvoiceStreamRow {
  return (
    repo.getStreamForPolicy(db, ctx, c.policy.id) ??
    repo.insertStream(db, ctx, {
      account_id: c.policy.account_id,
      policy_id: c.policy.id,
      anchor_date: c.job.term_start,
      periodicity: c.plan.periodicity,
      lead_days: LEAD_DAYS,
    })
  );
}

/** The plan's installment fee, if the product allows that pattern. */
export function feePatternFor(db: Db, ctx: TenantCtx, c: Context): ChargePatternDef | null {
  const code = c.plan.feePatternCode;
  if (code === null) return null;
  if (!c.product.billing.allowedFeePatterns.includes(code)) {
    throw ApiError.badRequest(
      `Product ${c.product.productCode} does not allow fee pattern ${code}`,
      'fee_pattern_not_allowed',
    );
  }
  return requirePattern(db, ctx, code);
}

/**
 * Which charge patterns this tenant's catalogue says are taxable. Product
 * configuration decides it, not the item's kind: a carrier that files a
 * taxable fee gets it taxed without a line of code changing here.
 */
export function taxableOn(db: Db, ctx: TenantCtx): (patternCode: string) => boolean {
  const taxable = new Set(
    repo
      .listChargePatterns(db, ctx)
      .filter((pattern) => pattern.taxable)
      .map((pattern) => pattern.code),
  );
  return (patternCode: string) => taxable.has(patternCode);
}

/** The tax in force for this policy's province and line, if any. */
export function taxRateOn(db: Db, ctx: TenantCtx, c: Context): TaxRateDef | null {
  return taxRateFor(
    repo.listTaxRates(db, ctx),
    c.province,
    c.product.billing.line,
    c.job.effective_date,
  );
}

export function requirePattern(db: Db, ctx: TenantCtx, code: string): ChargePatternDef {
  const pattern = repo.getChargePattern(db, ctx, code);
  if (!pattern) {
    throw ApiError.badRequest(`Unknown charge pattern ${code}`, 'unknown_charge_pattern');
  }
  return pattern;
}

export function insertCharge(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  instructionId: string,
  patternCode: string,
  amountCents: number,
): ChargeRow {
  requirePattern(db, ctx, patternCode);
  return repo.insertCharge(db, ctx, {
    instruction_id: instructionId,
    account_id: c.policy.account_id,
    policy_id: c.policy.id,
    pattern_code: patternCode,
    amount_cents: amountCents,
    effective_date: c.job.effective_date,
    province: c.province,
    line: c.product.billing.line,
  });
}

export function createInvoice(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  input: { streamId: string; eventDate: string; billDate: string; status: BillingInvoiceRow['status'] },
): BillingInvoiceRow {
  const sequence = repo.nextInvoiceSequence(db, ctx, c.policy.id);
  return repo.insertInvoice(db, ctx, {
    account_id: c.policy.account_id,
    policy_id: c.policy.id,
    stream_id: input.streamId,
    invoice_number: `${c.policy.policy_number}-${String(sequence).padStart(2, '0')}`,
    sequence,
    term_number: c.termNumber,
    event_date: input.eventDate,
    bill_date: input.billDate,
    due_date: input.eventDate,
    status: input.status,
  });
}

/** Write the items. Sequences continue from whatever the invoice already holds. */
export function writeItems(db: Db, ctx: TenantCtx, c: Context, placed: Placed[]): void {
  const nextSequence = new Map<string, number>();
  for (const p of placed) {
    const highest = repo
      .listItemsForInvoice(db, ctx, p.invoiceId)
      .reduce((max, i) => Math.max(max, i.sequence), 0);
    const sequence = nextSequence.get(p.invoiceId) ?? highest + 1;
    nextSequence.set(p.invoiceId, sequence + 1);
    repo.insertItem(db, ctx, {
      charge_id: p.charge.id,
      invoice_id: p.invoiceId,
      account_id: c.policy.account_id,
      policy_id: c.policy.id,
      kind: p.item.kind,
      pattern_code: p.item.patternCode,
      amount_cents: p.item.amountCents,
      event_date: p.item.eventDate,
      sequence,
      offsets_item_id: p.offsetsItemId ?? null,
    });
  }
}

/** A charge reaching the ledger. Nothing is posted for a zero amount. */
export function postCharge(db: Db, ctx: TenantCtx, charge: ChargeRow): void {
  if (charge.amount_cents === 0) return;
  const category: ChargeCategory = requirePattern(db, ctx, charge.pattern_code).category;
  repo.postEntry(
    db,
    ctx,
    postingsFor({
      type: 'chargeBilled',
      category,
      amountCents: charge.amount_cents,
      effectiveDate: charge.effective_date,
      chargeId: charge.id,
      accountId: charge.account_id,
      policyId: charge.policy_id,
      province: charge.province,
    }),
  );
}
