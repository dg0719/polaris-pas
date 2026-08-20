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
  paidCents: number;
  /** Positive = the customer owes money; negative = they are in credit. */
  balanceCents: number;
  pastDueCents: number;
}

const OPEN_JOB_STATUSES = new Set(['Draft', 'Quoted', 'Bound']);

/** Roll a whole account up to the numbers that belong at the top of its page. */
export function accountRollup(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  today: string,
): AccountRollup {
  const policies = repo.listPolicies(db, ctx, { accountId });
  const jobs = repo.listJobs(db, ctx, { accountId });
  const invoices = repo.listInvoicesForAccount(db, ctx, accountId).filter((i) => i.status !== 'void');
  const payments = repo.listPayments(db, ctx, accountId);

  const annualPremiumCents = policies
    .filter((p) => p.status === 'InForce')
    .reduce((sum, p) => sum + (repo.currentPolicyVersion(db, ctx, p.id)?.annual_premium_cents ?? 0), 0);

  const billedCents = invoices.reduce((sum, i) => sum + i.amount_cents, 0);
  const paidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);
  const pastDueCents = invoices
    .filter((i) => i.due_date <= today && i.paid_cents < i.amount_cents)
    .reduce((sum, i) => sum + (i.amount_cents - i.paid_cents), 0);

  return {
    policyCount: policies.length,
    inForceCount: policies.filter((p) => p.status === 'InForce').length,
    openJobCount: jobs.filter((j) => OPEN_JOB_STATUSES.has(j.status)).length,
    annualPremiumCents,
    billedCents,
    paidCents,
    balanceCents: billedCents - paidCents,
    pastDueCents,
  };
}
