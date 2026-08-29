import { sliceCharge, taxItemsFor, type SlicedItem } from '@polaris/domain';
import { addDays } from '../dates.ts';
import type { Db } from '../db.ts';
import { ApiError } from '../errors.ts';
import { getProduct } from '../products.ts';
import * as repo from '../repo.ts';
import type { BillingInvoiceRow, ChargeRow, JobRow, TenantCtx } from '../repo.ts';
import { respreadSchedule } from './respreadService.ts';
import {
  createInvoice,
  ensureStream,
  feePatternFor,
  INSTRUCTION_TYPE,
  insertCharge,
  postCharge,
  taxRateOn,
  total,
  writeItems,
  type ApplyIssuedJobInput,
  type ApplyIssuedJobResult,
  type Context,
  type Placed,
} from './shared.ts';

export type { ApplyIssuedJobInput, ApplyIssuedJobResult } from './shared.ts';

/**
 * Issuing a job produces a billing instruction, the charges it carries, the
 * immutable invoice items those charges slice into, the invoices holding
 * them, and a balanced journal entry per charge.
 *
 * Three properties hold after every call and are the reason the code is
 * shaped this way:
 *  - Charge coverage: a charge's items always sum to the charge. Fees and
 *    taxes therefore get charges of their own rather than riding on premium.
 *  - Items are never edited. A change writes new, signed items beside the
 *    old ones; an invoice emptied that way is voided, not rewritten.
 *  - Every posting balances, and a zero amount posts nothing at all.
 *
 * The caller (`issue.ts`) already holds a transaction open, so nothing here
 * opens one: an issuance is all-or-nothing including its billing.
 */

/** Job types that begin a term, and therefore lay down a fresh schedule. */
const STARTS_A_TERM = new Set<JobRow['job_type']>(['Submission', 'Renewal']);

export function applyIssuedJob(
  db: Db,
  ctx: TenantCtx,
  input: ApplyIssuedJobInput,
): ApplyIssuedJobResult {
  const { job, policy, version, transaction } = input;
  // A renewal may move the customer onto a different plan; every other job
  // type bills on the plan the policy already carries.
  const planCode = job.job_type === 'Renewal' ? job.billing_plan : policy.billing_plan;
  const plan = repo.getPaymentPlan(db, ctx, planCode);
  if (!plan) throw ApiError.badRequest(`Unknown payment plan ${planCode}`, 'unknown_payment_plan');
  const account = repo.getAccount(db, ctx, policy.account_id);
  if (!account) throw ApiError.notFound(`Account ${policy.account_id} not found`);

  const c: Context = {
    ...input,
    instructionType: INSTRUCTION_TYPE[job.job_type],
    plan,
    product: getProduct(policy.product_code),
    province: account.province,
  };

  const instruction = repo.insertInstruction(db, ctx, {
    policy_id: policy.id,
    policy_version_id: version.id,
    transaction_id: transaction.id,
    type: c.instructionType,
    payment_plan_code: planCode,
    billing_method: 'direct',
    effective_date: job.effective_date,
  });

  const premiumCharge = insertCharge(
    db,
    ctx,
    c,
    instruction.id,
    c.product.billing.premiumPatternCode,
    transaction.amount_cents,
  );

  const invoices = STARTS_A_TERM.has(job.job_type)
    ? scheduleTerm(db, ctx, c, instruction.id, premiumCharge)
    : respreadSchedule(db, ctx, c, instruction.id, premiumCharge);

  return { instruction, invoices };
}

/** Slice the term's premium into a schedule of invoices nobody has seen yet. */
function scheduleTerm(
  db: Db,
  ctx: TenantCtx,
  c: Context,
  instructionId: string,
  premiumCharge: ChargeRow,
): BillingInvoiceRow[] {
  const stream = ensureStream(db, ctx, c);
  const sliced = sliceCharge({
    amountCents: c.transaction.amount_cents,
    patternCode: premiumCharge.pattern_code,
    termStart: c.job.term_start,
    plan: c.plan,
    instructionType: c.instructionType,
    feePattern: feePatternFor(db, ctx, c),
  });
  const premiumItems = sliced.filter((i) => i.kind !== 'fee');
  const feeItems = sliced.filter((i) => i.kind === 'fee');
  const rate = taxRateOn(db, ctx, c);
  const taxItems = rate
    ? taxItemsFor(premiumItems, rate, sliced.length + 1).filter((i) => i.amountCents !== 0)
    : [];

  // Premium keeps the charge the instruction already raised; fee and tax get
  // charges of their own so that each one's items sum to it.
  const groups: { items: SlicedItem[]; charge: ChargeRow }[] = [
    { items: premiumItems, charge: premiumCharge },
  ];
  for (const items of [feeItems, taxItems]) {
    if (items.length === 0) continue;
    const charge = insertCharge(db, ctx, c, instructionId, items[0]!.patternCode, total(items));
    groups.push({ items, charge });
  }

  // One invoice per distinct event date, in date order, carrying its items in
  // the order they were sliced: premium, then fee, then tax.
  const dates = [...new Set(groups.flatMap((g) => g.items.map((i) => i.eventDate)))].sort();
  const invoices = dates.map((eventDate) =>
    createInvoice(db, ctx, c, {
      streamId: stream.id,
      eventDate,
      billDate: addDays(eventDate, -stream.lead_days),
      status: 'planned',
    }),
  );
  const byDate = new Map(invoices.map((i) => [i.event_date, i.id]));
  const placed: Placed[] = [];
  for (const eventDate of dates) {
    for (const group of groups) {
      for (const item of group.items.filter((i) => i.eventDate === eventDate)) {
        placed.push({ invoiceId: byDate.get(eventDate)!, charge: group.charge, item });
      }
    }
  }

  writeItems(db, ctx, c, placed);
  for (const group of groups) postCharge(db, ctx, group.charge);
  return invoices;
}
