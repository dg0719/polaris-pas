import type { RiskData } from '@polaris/domain';
import { expect } from 'vitest';
import { createAccount } from '../src/accounts.ts';
import { assertBillingInvariants } from '../src/billing/readModel.ts';
import type { Db } from '../src/db.ts';
import { issueJob } from '../src/issue.ts';
import { bindJob, createSubmission, quoteJob } from '../src/jobs.ts';
import * as repo from '../src/repo.ts';
import type { AccountRow, PolicyRow, TenantCtx } from '../src/repo.ts';

// ─── Shared scaffolding for the billing test files ─────────────────────────
// `billing.test.ts` and `billingCancellation.test.ts` drive the same product
// through the same job workflow; only the scenarios differ. Everything they
// both need lives here so the two files cannot drift apart.

export const TERM_START = '2026-09-01';

/**
 * The plans these tests drive. The server accepts any code the catalogue
 * holds; naming them here keeps a typo in a test from quietly becoming a
 * different scenario.
 */
export type PlanCode = 'full' | 'monthly' | 'quarterly' | 'monthly-2down';

/** Quote, bind and issue a job that already exists. */
export function runJob(db: Db, ctx: TenantCtx, jobId: string) {
  quoteJob(db, ctx, jobId);
  bindJob(db, ctx, jobId);
  return issueJob(db, ctx, jobId);
}

/** A new policy on the given account, issued and billed. */
export function issueSubmission(
  db: Db,
  ctx: TenantCtx,
  input: { accountId: string; plan: PlanCode; risk: RiskData },
) {
  const job = createSubmission(db, ctx, {
    accountId: input.accountId,
    productCode: 'ON_PA',
    effectiveDate: TERM_START,
    billingPlan: input.plan,
    risk: input.risk,
  });
  return runJob(db, ctx, job.id);
}

/** The same risk with collision added — a mid-term addition of premium. */
export function withCollision(risk: RiskData): RiskData {
  risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });
  return risk;
}

/**
 * An account in a province that taxes the line. Ontario exempts automobile
 * from retail sales tax, so this is the only way to reach the tax path
 * today. The tax rate comes from the `tax_rates` catalogue keyed on the
 * account's province and the product's line — configuration, not code. (The
 * rating tables are still Ontario's; a Quebec product arrives with the
 * second product.)
 */
export function quebecAccount(db: Db, ctx: TenantCtx): AccountRow {
  return createAccount(db, ctx, {
    account_type: 'person',
    name: 'Marie Tremblay',
    email: null,
    phone: null,
    address_line1: '1 rue Sainte-Catherine',
    address_line2: null,
    city: 'Montréal',
    province: 'QC',
    postal_code: 'H3B 1A1',
    producer_code: null,
  });
}

/** What an invoice is worth: the sum of the items placed on it. */
export function invoiceTotal(db: Db, ctx: TenantCtx, invoiceId: string): number {
  return repo.listItemsForInvoice(db, ctx, invoiceId).reduce((sum, i) => sum + i.amount_cents, 0);
}

/** The signed premium items on one invoice, in the order they were written. */
export function premiumItemsOn(db: Db, ctx: TenantCtx, invoiceId: string): number[] {
  return repo
    .listItemsForInvoice(db, ctx, invoiceId)
    .filter((i) => i.pattern_code === 'PREMIUM')
    .map((i) => i.amount_cents);
}

/** The signed fee items on one invoice, in the order they were written. */
export function feeItemsOn(db: Db, ctx: TenantCtx, invoiceId: string): number[] {
  return repo
    .listItemsForInvoice(db, ctx, invoiceId)
    .filter((i) => i.kind === 'fee')
    .map((i) => i.amount_cents);
}

/**
 * The three invariants of spec §2 (ledger balance, charge coverage,
 * receivable truth), plus the one thing they cannot know: that the premium
 * charges together equal the written premium of record in `transactions`.
 */
export function assertInvariants(db: Db, ctx: TenantCtx, policy: PolicyRow): void {
  assertBillingInvariants(db, ctx, policy.account_id);
  const premiumBilled = repo
    .listChargesForPolicy(db, ctx, policy.id)
    .filter((c) => c.pattern_code === 'PREMIUM')
    .reduce((s, c) => s + c.amount_cents, 0);
  const written = repo.listTransactions(db, ctx, policy.id).reduce((s, t) => s + t.amount_cents, 0);
  expect(premiumBilled).toBe(written);
}
