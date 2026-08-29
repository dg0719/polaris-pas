import { accountBillingTotals } from './billing/readModel.ts';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';
import * as repo from './repo.ts';
import type { AccountInput, AccountRow, TenantCtx } from './repo.ts';

export function createAccount(db: Db, ctx: TenantCtx, input: AccountInput): AccountRow {
  const accountNumber = repo.nextAccountNumber(db, ctx.tenantId);
  return repo.insertAccount(db, ctx, accountNumber, input);
}

export function requireAccount(db: Db, ctx: TenantCtx, accountId: string): AccountRow {
  const account = repo.getAccount(db, ctx, accountId);
  if (!account) throw ApiError.notFound(`Account ${accountId} not found`);
  return account;
}

export function updateAccount(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  patch: Partial<AccountInput>,
): AccountRow {
  requireAccount(db, ctx, accountId);
  repo.updateAccount(db, ctx, accountId, patch);
  return requireAccount(db, ctx, accountId);
}

export interface AccountRollup {
  policyCount: number;
  inForceCount: number;
  openJobCount: number;
  /** Premium in force: the annual premium of every current, non-cancelled term. */
  annualPremiumCents: number;
  billedCents: number;
  /** What the account has settled: the paid portion of its live invoice items. */
  paidCents: number;
  /** Positive = the customer owes money; negative = they are in credit. */
  balanceCents: number;
  pastDueCents: number;
  /** Cash received that has not settled anything yet. */
  unappliedCents: number;
}

const OPEN_JOB_STATUSES = new Set(['Draft', 'Quoted', 'Bound']);

/**
 * Roll a whole account up to the numbers that belong at the top of its page.
 * The money comes from the billing read model rather than being recomputed
 * here, so the account page and the policy page can never disagree.
 */
export function accountRollup(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  today: string,
): AccountRollup {
  const policies = repo.listPolicies(db, ctx, { accountId });
  const jobs = repo.listJobs(db, ctx, { accountId });
  const { billedCents, paidCents, balanceCents, pastDueCents, unappliedCents } =
    accountBillingTotals(db, ctx, accountId, today);

  const annualPremiumCents = policies
    .filter((p) => p.status === 'InForce')
    .reduce((sum, p) => sum + (repo.currentPolicyVersion(db, ctx, p.id)?.annual_premium_cents ?? 0), 0);

  return {
    policyCount: policies.length,
    inForceCount: policies.filter((p) => p.status === 'InForce').length,
    openJobCount: jobs.filter((j) => OPEN_JOB_STATUSES.has(j.status)).length,
    annualPremiumCents,
    billedCents,
    paidCents,
    balanceCents,
    pastDueCents,
    unappliedCents,
  };
}
