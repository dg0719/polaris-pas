import type { UwReferral } from '@polaris/domain';
import type { Db } from './db.ts';
import { readQuote } from './jobs.ts';
import * as repo from './repo.ts';
import type { TenantCtx } from './repo.ts';

/**
 * The underwriter's landing screen. A referral is a quoted job whose rating
 * tripped at least one underwriting rule and which nobody has decided yet.
 */

export interface WorklistItem {
  jobId: string;
  jobType: string;
  status: string;
  accountId: string;
  accountName: string;
  accountNumber: string;
  policyId: string | null;
  policyNumber: string | null;
  productCode: string;
  effectiveDate: string;
  annualPremiumCents: number;
  changeAmountCents: number;
  referrals: UwReferral[];
  uwApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorklistCounts {
  referred: number;
  awaitingBind: number;
  draft: number;
  bound: number;
}

function toItem(db: Db, ctx: TenantCtx, job: repo.JobRow): WorklistItem | null {
  const quote = readQuote(job);
  if (!quote) return null;
  const account = repo.getAccount(db, ctx, job.account_id);
  const policy = job.policy_id ? repo.getPolicy(db, ctx, job.policy_id) : null;
  return {
    jobId: job.id,
    jobType: job.job_type,
    status: job.status,
    accountId: job.account_id,
    accountName: account?.name ?? 'Unknown account',
    accountNumber: account?.account_number ?? '',
    policyId: job.policy_id,
    policyNumber: policy?.policy_number ?? null,
    productCode: job.product_code,
    effectiveDate: job.effective_date,
    annualPremiumCents: quote.annualPremiumCents,
    changeAmountCents: quote.changeAmountCents,
    referrals: quote.referrals,
    uwApproved: job.uw_approved === 1,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

/** Quoted jobs carrying referrals that no underwriter has approved yet. */
export function referralQueue(db: Db, ctx: TenantCtx): WorklistItem[] {
  return repo
    .listJobs(db, ctx, { status: 'Quoted' })
    .map((job) => toItem(db, ctx, job))
    .filter((item): item is WorklistItem => item !== null)
    .filter((item) => item.referrals.length > 0 && !item.uwApproved)
    .sort((a, b) => b.changeAmountCents - a.changeAmountCents);
}

/** Quoted jobs that are clear to bind: either no referrals, or already approved. */
export function readyToBind(db: Db, ctx: TenantCtx): WorklistItem[] {
  return repo
    .listJobs(db, ctx, { status: 'Quoted' })
    .map((job) => toItem(db, ctx, job))
    .filter((item): item is WorklistItem => item !== null)
    .filter((item) => item.referrals.length === 0 || item.uwApproved)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

export function worklistCounts(db: Db, ctx: TenantCtx): WorklistCounts {
  const jobs = repo.listJobs(db, ctx);
  return {
    referred: referralQueue(db, ctx).length,
    awaitingBind: readyToBind(db, ctx).length,
    draft: jobs.filter((j) => j.status === 'Draft').length,
    bound: jobs.filter((j) => j.status === 'Bound').length,
  };
}
