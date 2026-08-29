import { applyIssuedJob } from './billing/instructions.ts';
import type { Db } from './db.ts';
import { inTransaction } from './db.ts';
import { ApiError } from './errors.ts';
import { applyTransition, readQuote, requireJob } from './jobs.ts';
import * as repo from './repo.ts';
import type { JobRow, PolicyRow, PolicyVersionRow, TenantCtx, TransactionRow } from './repo.ts';

export interface IssueResult {
  job: JobRow;
  policy: PolicyRow;
  version: PolicyVersionRow;
  transaction: TransactionRow;
}

const TRANSACTION_TYPE = {
  Submission: 'NewBusiness',
  PolicyChange: 'Endorsement',
  Renewal: 'Renewal',
  Cancellation: 'Cancellation',
} as const;

/**
 * Issue a bound job: append an immutable policy version, record the financial
 * transaction, update billing, and move the job to Issued. All-or-nothing.
 */
export function issueJob(db: Db, ctx: TenantCtx, jobId: string): IssueResult {
  return inTransaction(db, () => {
    const job = requireJob(db, ctx, jobId);
    const quote = readQuote(job);
    if (!quote) throw ApiError.conflict('Job has no quote to issue');

    // Validates status/role and writes the audit event; throws if not bindable.
    const nextStatus = applyTransition(db, ctx, job, 'issue');

    const { policy, versionNumber, termNumber } = resolveTarget(db, ctx, job);

    const version = repo.insertPolicyVersion(db, ctx, {
      policy_id: policy.id,
      version_number: versionNumber,
      term_number: termNumber,
      transaction_type: TRANSACTION_TYPE[job.job_type],
      effective_date: job.effective_date,
      term_start: job.term_start,
      term_end: job.term_end,
      risk_json: job.risk_json,
      quote_json: job.quote_json ?? '{}',
      annual_premium_cents: quote.kind === 'cancellation' ? 0 : quote.annualPremiumCents,
      job_id: job.id,
    });

    if (job.job_type === 'Cancellation') {
      repo.setPolicyStatus(db, ctx, policy.id, 'Cancelled');
    }

    const transaction = repo.insertTransaction(db, ctx, {
      policy_id: policy.id,
      policy_version_id: version.id,
      job_id: job.id,
      type: TRANSACTION_TYPE[job.job_type],
      effective_date: job.effective_date,
      amount_cents: quote.changeAmountCents,
    });

    applyIssuedJob(db, ctx, { job, policy, version, transaction, termNumber });

    repo.updateJob(db, ctx, jobId, { status: nextStatus, policy_id: policy.id });

    return {
      job: requireJob(db, ctx, jobId),
      policy: repo.getPolicy(db, ctx, policy.id)!,
      version,
      transaction,
    };
  });
}

/** New business creates the policy shell; every other job type appends to it. */
function resolveTarget(
  db: Db,
  ctx: TenantCtx,
  job: JobRow,
): { policy: PolicyRow; versionNumber: number; termNumber: number } {
  if (job.job_type === 'Submission') {
    const policyNumber = repo.nextPolicyNumber(db, ctx.tenantId);
    const policy = repo.insertPolicy(db, ctx, {
      accountId: job.account_id,
      policyNumber,
      productCode: job.product_code,
      billingPlan: job.billing_plan,
    });
    return { policy, versionNumber: 1, termNumber: 1 };
  }

  if (!job.policy_id) throw ApiError.conflict(`${job.job_type} job is not linked to a policy`);
  const policy = repo.getPolicy(db, ctx, job.policy_id);
  if (!policy) throw ApiError.notFound(`Policy ${job.policy_id} not found`);
  if (policy.status !== 'InForce') {
    throw ApiError.conflict(`Policy ${policy.policy_number} is ${policy.status}`);
  }

  const current = repo.currentPolicyVersion(db, ctx, policy.id);
  if (!current) throw ApiError.conflict(`Policy ${policy.policy_number} has no issued version`);

  return {
    policy,
    versionNumber: current.version_number + 1,
    termNumber: job.job_type === 'Renewal' ? current.term_number + 1 : current.term_number,
  };
}
