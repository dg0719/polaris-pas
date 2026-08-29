import { requireAccount } from '../accounts.ts';
import { policyBilling } from '../billing/readModel.ts';
import { todayIso } from '../dates.ts';
import type { Db } from '../db.ts';
import {
  accountDto,
  jobDto,
  policyBillingDto,
  policyDto,
  policyVersionDto,
  transactionDto,
} from '../dto.ts';
import { ApiError } from '../errors.ts';
import { created, type Router } from '../http.ts';
import { createCancellation, createPolicyChange, createRenewal } from '../jobs.ts';
import * as repo from '../repo.ts';
import type { PolicyRow, TenantCtx } from '../repo.ts';
import {
  parseRiskData,
  requireInstallmentPlan,
  requireIsoDate,
  requireString,
} from '../validation.ts';
import { authenticated, body, param } from './context.ts';

function requirePolicy(db: Db, tenant: TenantCtx, policyId: string): PolicyRow {
  const policy = repo.getPolicy(db, tenant, policyId);
  if (!policy) throw ApiError.notFound(`Policy ${policyId} not found`);
  return policy;
}

export function registerPolicyRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  router.get(
    '/policies',
    authed((ctx, tenant) => {
      const accountId = ctx.query.get('accountId') ?? undefined;
      const today = todayIso();
      return {
        policies: repo.listPolicies(db, tenant, { accountId }).map((policy) => {
          const version = repo.currentPolicyVersion(db, tenant, policy.id);
          const account = repo.getAccount(db, tenant, policy.account_id);
          const billing = policyBilling(db, tenant, policy, today);
          return {
            ...policyDto(policy),
            accountName: account?.name ?? '',
            accountNumber: account?.account_number ?? '',
            termStart: version?.term_start ?? null,
            termEnd: version?.term_end ?? null,
            annualPremiumCents: version?.annual_premium_cents ?? 0,
            balanceCents: billing.balanceCents,
            pastDueCents: billing.pastDueCents,
          };
        }),
      };
    }),
  );

  router.get(
    '/policies/:id',
    authed((ctx, tenant) => {
      const policyId = param(ctx, 'id');
      const policy = requirePolicy(db, tenant, policyId);
      const current = repo.currentPolicyVersion(db, tenant, policyId);
      return {
        policy: policyDto(policy),
        account: accountDto(requireAccount(db, tenant, policy.account_id)),
        currentVersion: current ? policyVersionDto(current) : null,
        versions: repo.listPolicyVersions(db, tenant, policyId).map(policyVersionDto),
        transactions: repo.listTransactions(db, tenant, policyId).map(transactionDto),
        billing: policyBillingDto(policyBilling(db, tenant, policy, todayIso())),
        jobs: repo
          .listJobs(db, tenant, { accountId: policy.account_id })
          .filter((job) => job.policy_id === policyId)
          .map(jobDto),
      };
    }),
  );

  router.get(
    '/policies/:id/billing',
    authed((ctx, tenant) => {
      const policy = requirePolicy(db, tenant, param(ctx, 'id'));
      return { billing: policyBillingDto(policyBilling(db, tenant, policy, todayIso())) };
    }),
  );

  router.post(
    '/policies/:id/changes',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const job = createPolicyChange(db, tenant, {
        policyId: param(ctx, 'id'),
        effectiveDate: requireIsoDate(input['effectiveDate'], 'effectiveDate'),
        risk: input['risk'] === undefined ? undefined : parseRiskData(input['risk']),
      });
      return created({ job: jobDto(job) });
    }),
  );

  router.post(
    '/policies/:id/renewal',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const job = createRenewal(db, tenant, {
        policyId: param(ctx, 'id'),
        risk: input['risk'] === undefined ? undefined : parseRiskData(input['risk']),
        billingPlan:
          input['billingPlan'] === undefined
            ? undefined
            : requireInstallmentPlan(input['billingPlan'], 'billingPlan'),
      });
      return created({ job: jobDto(job) });
    }),
  );

  router.post(
    '/policies/:id/cancellation',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const job = createCancellation(db, tenant, {
        policyId: param(ctx, 'id'),
        effectiveDate: requireIsoDate(input['effectiveDate'], 'effectiveDate'),
        reason: requireString(input['reason'], 'reason'),
      });
      return created({ job: jobDto(job) });
    }),
  );
}
