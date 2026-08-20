import {
  type InstallmentPlan,
  RatingError,
  TransitionError,
  cancellationRefundCents,
  daysBetween,
  midTermDeltaCents,
  prorate,
  rateRisk,
  transition,
  type JobStatus,
  type QuoteResult,
  type RiskData,
  type UwReferral,
} from '@polaris/domain';
import type { JobAction } from '@polaris/domain';
import type { Db } from './db.ts';
import { addMonths, isBefore, termFor } from './dates.ts';
import { ApiError } from './errors.ts';
import { getProduct } from './products.ts';
import * as repo from './repo.ts';
import type { JobRow, TenantCtx } from './repo.ts';

// ─── Quote shapes stored on a job ───────────────────────────────────────────

interface QuoteCommon {
  effectiveDate: string;
  termStart: string;
  termEnd: string;
  /** Money the customer owes (positive) or is owed (negative) for this job. */
  changeAmountCents: number;
  referrals: UwReferral[];
  quotedAt: string;
}

export interface RiskQuote extends QuoteCommon {
  kind: 'risk';
  annualPremiumCents: number;
  priorAnnualPremiumCents: number;
  rating: QuoteResult;
}

export interface CancellationQuote extends QuoteCommon {
  kind: 'cancellation';
  annualPremiumCents: number;
  refundCents: number;
}

export type JobQuote = RiskQuote | CancellationQuote;

export function readQuote(job: JobRow): JobQuote | null {
  return job.quote_json ? (JSON.parse(job.quote_json) as JobQuote) : null;
}

export function readRisk(job: JobRow): RiskData {
  return JSON.parse(job.risk_json) as RiskData;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Domain errors carry no HTTP semantics; translate them at the service edge. */
function translate(err: unknown): never {
  if (err instanceof TransitionError) throw ApiError.conflict(err.message, 'invalid_transition');
  if (err instanceof RatingError) throw ApiError.badRequest(err.message, 'rating_error');
  throw err;
}

function requireJob(db: Db, ctx: TenantCtx, jobId: string): JobRow {
  const job = repo.getJob(db, ctx, jobId);
  if (!job) throw ApiError.notFound(`Job ${jobId} not found`);
  return job;
}

function requireInForcePolicy(db: Db, ctx: TenantCtx, policyId: string) {
  const policy = repo.getPolicy(db, ctx, policyId);
  if (!policy) throw ApiError.notFound(`Policy ${policyId} not found`);
  if (policy.status !== 'InForce') {
    throw ApiError.conflict(`Policy ${policy.policy_number} is ${policy.status}`);
  }
  const version = repo.currentPolicyVersion(db, ctx, policyId);
  if (!version) throw ApiError.conflict(`Policy ${policy.policy_number} has no issued version`);
  return { policy, version };
}

function applyTransition(
  db: Db,
  ctx: TenantCtx,
  job: JobRow,
  action: JobAction,
  note?: string,
): JobStatus {
  const quote = readQuote(job);
  let next: JobStatus;
  try {
    next = transition(job.status, action, {
      requiresUw: (quote?.referrals.length ?? 0) > 0,
      uwApproved: job.uw_approved === 1,
      actorRole: ctx.role,
    });
  } catch (err) {
    translate(err);
  }
  repo.appendJobEvent(db, ctx, {
    jobId: job.id,
    action,
    fromStatus: job.status,
    toStatus: next,
    note,
  });
  return next;
}

// ─── Job creation ───────────────────────────────────────────────────────────

export function createSubmission(
  db: Db,
  ctx: TenantCtx,
  input: {
    accountId: string;
    productCode: string;
    effectiveDate: string;
    billingPlan: InstallmentPlan;
    risk: RiskData;
  },
): JobRow {
  const product = getProduct(input.productCode);
  const account = repo.getAccount(db, ctx, input.accountId);
  if (!account) throw ApiError.notFound(`Account ${input.accountId} not found`);
  const { termStart, termEnd } = termFor(input.effectiveDate, input.risk.termMonths);
  const job = repo.insertJob(db, ctx, {
    account_id: account.id,
    job_type: 'Submission',
    status: 'Draft',
    policy_id: null,
    product_code: product.productCode,
    billing_plan: input.billingPlan,
    effective_date: termStart,
    term_start: termStart,
    term_end: termEnd,
    risk_json: JSON.stringify(input.risk),
    quote_json: null,
    uw_approved: 0,
    uw_note: null,
    cancel_reason: null,
    created_by: ctx.userId,
  });
  repo.appendJobEvent(db, ctx, {
    jobId: job.id,
    action: 'create',
    fromStatus: 'None',
    toStatus: 'Draft',
  });
  return job;
}

export function createPolicyChange(
  db: Db,
  ctx: TenantCtx,
  input: { policyId: string; effectiveDate: string; risk?: RiskData },
): JobRow {
  const { policy, version } = requireInForcePolicy(db, ctx, input.policyId);
  if (
    isBefore(input.effectiveDate, version.term_start) ||
    !isBefore(input.effectiveDate, version.term_end)
  ) {
    throw ApiError.badRequest(
      `Effective date must fall inside the current term ` +
        `(${version.term_start} to ${version.term_end})`,
      'effective_date_out_of_term',
    );
  }
  const risk = input.risk ?? (JSON.parse(version.risk_json) as RiskData);
  const job = repo.insertJob(db, ctx, {
    account_id: policy.account_id,
    job_type: 'PolicyChange',
    status: 'Draft',
    policy_id: policy.id,
    product_code: policy.product_code,
    billing_plan: policy.billing_plan,
    effective_date: input.effectiveDate,
    term_start: version.term_start,
    term_end: version.term_end,
    risk_json: JSON.stringify(risk),
    quote_json: null,
    uw_approved: 0,
    uw_note: null,
    cancel_reason: null,
    created_by: ctx.userId,
  });
  repo.appendJobEvent(db, ctx, {
    jobId: job.id,
    action: 'create',
    fromStatus: 'None',
    toStatus: 'Draft',
  });
  return job;
}

export function createRenewal(
  db: Db,
  ctx: TenantCtx,
  input: { policyId: string; risk?: RiskData; billingPlan?: InstallmentPlan },
): JobRow {
  const { policy, version } = requireInForcePolicy(db, ctx, input.policyId);
  const risk = input.risk ?? (JSON.parse(version.risk_json) as RiskData);
  const termStart = version.term_end;
  const termEnd = addMonths(termStart, risk.termMonths);
  const job = repo.insertJob(db, ctx, {
    account_id: policy.account_id,
    job_type: 'Renewal',
    status: 'Draft',
    policy_id: policy.id,
    product_code: policy.product_code,
    billing_plan: input.billingPlan ?? policy.billing_plan,
    effective_date: termStart,
    term_start: termStart,
    term_end: termEnd,
    risk_json: JSON.stringify(risk),
    quote_json: null,
    uw_approved: 0,
    uw_note: null,
    cancel_reason: null,
    created_by: ctx.userId,
  });
  repo.appendJobEvent(db, ctx, {
    jobId: job.id,
    action: 'create',
    fromStatus: 'None',
    toStatus: 'Draft',
  });
  return job;
}

export function createCancellation(
  db: Db,
  ctx: TenantCtx,
  input: { policyId: string; effectiveDate: string; reason: string },
): JobRow {
  const { policy, version } = requireInForcePolicy(db, ctx, input.policyId);
  if (isBefore(input.effectiveDate, version.term_start)) {
    throw ApiError.badRequest(
      `Cancellation cannot pre-date the term start ${version.term_start}`,
      'effective_date_out_of_term',
    );
  }
  const job = repo.insertJob(db, ctx, {
    account_id: policy.account_id,
    job_type: 'Cancellation',
    status: 'Draft',
    policy_id: policy.id,
    product_code: policy.product_code,
    billing_plan: policy.billing_plan,
    effective_date: input.effectiveDate,
    term_start: version.term_start,
    term_end: version.term_end,
    risk_json: version.risk_json,
    quote_json: null,
    uw_approved: 0,
    uw_note: null,
    cancel_reason: input.reason,
    created_by: ctx.userId,
  });
  repo.appendJobEvent(db, ctx, {
    jobId: job.id,
    action: 'create',
    fromStatus: 'None',
    toStatus: 'Draft',
  });
  return job;
}

// ─── Workflow actions ───────────────────────────────────────────────────────

export function updateRisk(db: Db, ctx: TenantCtx, jobId: string, risk: RiskData): JobRow {
  const job = requireJob(db, ctx, jobId);
  if (job.job_type === 'Cancellation') {
    throw ApiError.badRequest('A cancellation job carries no editable risk', 'not_editable');
  }
  const next = applyTransition(db, ctx, job, 'editData');
  const patch: Parameters<typeof repo.updateJob>[3] = {
    status: next,
    risk_json: JSON.stringify(risk),
    quote_json: null,
    uw_approved: 0,
  };
  // A submission's term follows its own risk; a change/renewal keeps the policy term.
  if (job.job_type === 'Submission') {
    const { termStart, termEnd } = termFor(job.effective_date, risk.termMonths);
    patch.term_start = termStart;
    patch.term_end = termEnd;
  }
  repo.updateJob(db, ctx, jobId, patch);
  return requireJob(db, ctx, jobId);
}

export function quoteJob(db: Db, ctx: TenantCtx, jobId: string): { job: JobRow; quote: JobQuote } {
  const job = requireJob(db, ctx, jobId);
  const quote =
    job.job_type === 'Cancellation' ? buildCancellationQuote(db, ctx, job) : buildRiskQuote(db, ctx, job);
  const next = applyTransition(db, ctx, job, 'quote');
  repo.updateJob(db, ctx, jobId, {
    status: next,
    quote_json: JSON.stringify(quote),
    // Re-quoting invalidates any prior underwriting decision.
    uw_approved: 0,
  });
  return { job: requireJob(db, ctx, jobId), quote };
}

function buildRiskQuote(db: Db, ctx: TenantCtx, job: JobRow): RiskQuote {
  const product = getProduct(job.product_code);
  const risk = readRisk(job);
  let rating: QuoteResult;
  try {
    rating = rateRisk(product, risk);
  } catch (err) {
    translate(err);
  }

  const priorAnnual =
    job.job_type === 'PolicyChange' && job.policy_id
      ? (repo.currentPolicyVersion(db, ctx, job.policy_id)?.annual_premium_cents ?? 0)
      : 0;

  const termDays = daysBetween(job.term_start, job.term_end);
  const changeAmountCents =
    job.job_type === 'PolicyChange'
      ? midTermDeltaCents(
          priorAnnual,
          rating.totalAnnualPremiumCents,
          job.effective_date,
          job.term_end,
          job.term_start,
        )
      : prorate(
          rating.totalAnnualPremiumCents,
          daysBetween(job.effective_date, job.term_end),
          termDays,
        );

  return {
    kind: 'risk',
    effectiveDate: job.effective_date,
    termStart: job.term_start,
    termEnd: job.term_end,
    annualPremiumCents: rating.totalAnnualPremiumCents,
    priorAnnualPremiumCents: priorAnnual,
    changeAmountCents,
    rating,
    referrals: rating.referrals,
    quotedAt: repo.nowIso(),
  };
}

function buildCancellationQuote(db: Db, ctx: TenantCtx, job: JobRow): CancellationQuote {
  if (!job.policy_id) throw ApiError.conflict('Cancellation job has no policy');
  const version = repo.currentPolicyVersion(db, ctx, job.policy_id);
  if (!version) throw ApiError.conflict('Policy has no issued version');
  const refundCents = cancellationRefundCents(
    version.annual_premium_cents,
    job.effective_date,
    job.term_start,
    job.term_end,
  );
  return {
    kind: 'cancellation',
    effectiveDate: job.effective_date,
    termStart: job.term_start,
    termEnd: job.term_end,
    annualPremiumCents: version.annual_premium_cents,
    refundCents,
    changeAmountCents: -refundCents,
    referrals: [],
    quotedAt: repo.nowIso(),
  };
}

export function underwriteJob(
  db: Db,
  ctx: TenantCtx,
  jobId: string,
  decision: 'approve' | 'decline',
  note?: string,
): JobRow {
  const job = requireJob(db, ctx, jobId);
  const action: JobAction = decision === 'approve' ? 'uwApprove' : 'uwDecline';
  const next = applyTransition(db, ctx, job, action, note);
  repo.updateJob(db, ctx, jobId, {
    status: next,
    uw_approved: decision === 'approve' ? 1 : 0,
    uw_note: note ?? null,
  });
  return requireJob(db, ctx, jobId);
}

export function bindJob(db: Db, ctx: TenantCtx, jobId: string): JobRow {
  const job = requireJob(db, ctx, jobId);
  if (!job.quote_json) throw ApiError.conflict('Job must be quoted before it can be bound');
  const next = applyTransition(db, ctx, job, 'bind');
  repo.updateJob(db, ctx, jobId, { status: next });
  return requireJob(db, ctx, jobId);
}

export function withdrawJob(db: Db, ctx: TenantCtx, jobId: string, note?: string): JobRow {
  const job = requireJob(db, ctx, jobId);
  const next = applyTransition(db, ctx, job, 'withdraw', note);
  repo.updateJob(db, ctx, jobId, { status: next });
  return requireJob(db, ctx, jobId);
}

export { requireJob, applyTransition };
