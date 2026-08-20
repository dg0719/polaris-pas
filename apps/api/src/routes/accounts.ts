import { accountRollup, createAccount, requireAccount, updateAccount } from '../accounts.ts';
import { invoiceDisplayStatus, policyBilling, recordPayment } from '../billing.ts';
import { todayIso } from '../dates.ts';
import type { Db } from '../db.ts';
import {
  accountDto,
  invoiceDto,
  jobDto,
  paymentDto,
  policyDto,
} from '../dto.ts';
import { created, type Router } from '../http.ts';
import { createSubmission } from '../jobs.ts';
import * as repo from '../repo.ts';
import {
  parseAccountInput,
  parsePaymentInput,
  parseRiskData,
  requireInstallmentPlan,
  requireIsoDate,
  requireString,
} from '../validation.ts';
import { authenticated, body, param } from './context.ts';

export function registerAccountRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  router.get(
    '/accounts',
    authed((ctx, tenant) => ({
      accounts: repo
        .listAccounts(db, tenant, ctx.query.get('q') ?? undefined)
        .map((account) => ({
          ...accountDto(account),
          rollup: accountRollup(db, tenant, account.id, todayIso()),
        })),
    })),
  );

  router.post(
    '/accounts',
    authed((ctx, tenant) =>
      created({ account: accountDto(createAccount(db, tenant, parseAccountInput(body(ctx)))) }),
    ),
  );

  router.get(
    '/accounts/:id',
    authed((ctx, tenant) => {
      const accountId = param(ctx, 'id');
      const account = requireAccount(db, tenant, accountId);
      const today = todayIso();
      const policies = repo.listPolicies(db, tenant, { accountId });
      return {
        account: accountDto(account),
        rollup: accountRollup(db, tenant, accountId, today),
        policies: policies.map((policy) => {
          const version = repo.currentPolicyVersion(db, tenant, policy.id);
          const billing = policyBilling(db, tenant, policy, today);
          return {
            ...policyDto(policy),
            termStart: version?.term_start ?? null,
            termEnd: version?.term_end ?? null,
            annualPremiumCents: version?.annual_premium_cents ?? 0,
            balanceCents: billing.balanceCents,
            pastDueCents: billing.pastDueCents,
            nextDue: billing.nextDue,
          };
        }),
        jobs: repo.listJobs(db, tenant, { accountId }).map(jobDto),
      };
    }),
  );

  router.put(
    '/accounts/:id',
    authed((ctx, tenant) => ({
      account: accountDto(
        updateAccount(db, tenant, param(ctx, 'id'), parseAccountInput(body(ctx))),
      ),
    })),
  );

  // A submission always starts from an account, so the insured is never retyped.
  router.post(
    '/accounts/:id/submissions',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const job = createSubmission(db, tenant, {
        accountId: param(ctx, 'id'),
        productCode: requireString(input['productCode'], 'productCode'),
        effectiveDate: requireIsoDate(input['effectiveDate'], 'effectiveDate'),
        billingPlan: requireInstallmentPlan(input['billingPlan'], 'billingPlan'),
        risk: parseRiskData(input['risk']),
      });
      return created({ job: jobDto(job) });
    }),
  );

  router.get(
    '/accounts/:id/billing',
    authed((ctx, tenant) => {
      const accountId = param(ctx, 'id');
      requireAccount(db, tenant, accountId);
      const today = todayIso();
      return {
        rollup: accountRollup(db, tenant, accountId, today),
        invoices: repo
          .listInvoicesForAccount(db, tenant, accountId)
          .map((invoice) => invoiceDto({ ...invoice, displayStatus: invoiceDisplayStatus(invoice, today) })),
        payments: repo.listPayments(db, tenant, accountId).map(paymentDto),
      };
    }),
  );

  router.post(
    '/accounts/:id/payments',
    authed((ctx, tenant) => {
      const accountId = param(ctx, 'id');
      requireAccount(db, tenant, accountId);
      const input = parsePaymentInput(body(ctx));
      const result = recordPayment(db, tenant, { accountId, ...input });
      return created({
        payment: paymentDto(result.payment),
        appliedCents: result.appliedCents,
        unappliedCents: result.unappliedCents,
        rollup: accountRollup(db, tenant, accountId, todayIso()),
      });
    }),
  );
}
