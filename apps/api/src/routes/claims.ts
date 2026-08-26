import type { ClaimantKind } from '@polaris/domain';
import { requireAccount } from '../accounts.ts';
import { coverageAtDate, createExposure, reportClaim } from '../claims/fnol.ts';
import {
  addClaimNote,
  assignClaim,
  closeClaim,
  closeExposure,
  reopenClaim,
  reopenExposure,
  requireClaim,
  requireExposure,
} from '../claims/lifecycle.ts';
import {
  approvePayment,
  issuePayment,
  rejectPayment,
  requestPayment,
  voidPayment,
} from '../claims/payments.ts';
import { claimsWorklist } from '../claims/queues.ts';
import { claimFinancialView } from '../claims/readModel.ts';
import { postReserve } from '../claims/reserves.ts';
import { closeRecovery, openRecovery, receiveRecovery } from '../claims/recovery.ts';
import { addTask, completeTask } from '../claims/tasks.ts';
import {
  claimDto,
  claimEventDto,
  claimNoteDto,
  claimPaymentDto,
  claimTaskDto,
  exposureDto,
  recoveryDto,
  reserveMovementDto,
} from '../claimsDto.ts';
import type { Db } from '../db.ts';
import { accountDto, policyDto, policyVersionDto } from '../dto.ts';
import { ApiError } from '../errors.ts';
import { created, type Router } from '../http.ts';
import { getProduct } from '../products.ts';
import * as repo from '../repo.ts';
import type { TenantCtx } from '../repo.ts';
import {
  requireIsoDate,
  requireOneOf,
  requirePositiveCents,
  requireCentsDelta,
  requireString,
} from '../validation.ts';
import { authenticated, body, param } from './context.ts';

const CATEGORIES = ['indemnity', 'expense'] as const;
const CLAIMANT_KINDS: readonly ClaimantKind[] = ['insured', 'thirdParty'] as const;
const PAYEE_KINDS = ['insured', 'claimant', 'vendor', 'other'] as const;
const PAY_METHODS = ['cheque', 'eft'] as const;
const RECOVERY_TYPES = ['subrogation', 'salvage', 'deductible'] as const;

/** The full claim payload every claim screen renders from. */
function claimResponse(db: Db, tenant: TenantCtx, claimId: string) {
  const claim = requireClaim(db, tenant, claimId);
  const financials = claimFinancialView(db, tenant, claim);
  const policy = repo.getPolicy(db, tenant, claim.policy_id);
  const version = repo
    .listPolicyVersions(db, tenant, claim.policy_id)
    .find((v) => v.id === claim.policy_version_id);
  const assigned = claim.assigned_user_id
    ? repo.getUserInTenant(db, tenant, claim.assigned_user_id)
    : null;

  return {
    claim: claimDto(claim),
    account: accountDto(requireAccount(db, tenant, claim.account_id)),
    policy: policy ? policyDto(policy) : null,
    policyVersion: version ? policyVersionDto(version) : null,
    assignedUserName: assigned?.name ?? null,
    financials: financials.claim,
    exposures: repo
      .listExposures(db, tenant, claimId)
      .map((e) => exposureDto(e, financials.byExposure.get(e.id))),
    reserveMovements: repo.listReserveMovements(db, tenant, claimId).map(reserveMovementDto),
    payments: repo.listClaimPayments(db, tenant, claimId).map(claimPaymentDto),
    recoveries: repo.listClaimRecoveries(db, tenant, claimId).map(recoveryDto),
    tasks: repo.listClaimTasks(db, tenant, claimId).map(claimTaskDto),
    notes: repo.listClaimNotes(db, tenant, claimId).map(claimNoteDto),
    events: repo.listClaimEvents(db, tenant, claimId).map(claimEventDto),
  };
}

export function registerClaimRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  // Literal segments must be registered before /claims/:id captures them.
  router.get(
    '/claims/queues',
    authed((ctx, tenant) => claimsWorklist(db, tenant)),
  );

  router.get(
    '/claims',
    authed((ctx, tenant) => {
      const status = ctx.query.get('status');
      const claims = repo.listClaims(db, tenant, {
        status: status === 'Open' || status === 'Closed' ? status : undefined,
        policyId: ctx.query.get('policyId') ?? undefined,
        accountId: ctx.query.get('accountId') ?? undefined,
        assignedUserId: ctx.query.get('adjuster') ?? undefined,
      });
      return {
        claims: claims.map((claim) => {
          const financials = claimFinancialView(db, tenant, claim);
          const account = repo.getAccount(db, tenant, claim.account_id);
          const policy = repo.getPolicy(db, tenant, claim.policy_id);
          const assigned = claim.assigned_user_id
            ? repo.getUserInTenant(db, tenant, claim.assigned_user_id)
            : null;
          return {
            ...claimDto(claim),
            accountName: account?.name ?? '',
            policyNumber: policy?.policy_number ?? '',
            assignedUserName: assigned?.name ?? null,
            incurredCents: financials.claim.incurredCents,
            outstandingCents: financials.claim.outstandingCents,
            paidCents: financials.claim.paidCents,
          };
        }),
      };
    }),
  );

  router.get(
    '/claims/:id',
    authed((ctx, tenant) => claimResponse(db, tenant, param(ctx, 'id'))),
  );

  router.post(
    '/claims',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const exposures = Array.isArray(input['exposures'])
        ? (input['exposures'] as unknown[]).map((raw, i) => {
            if (typeof raw !== 'object' || raw === null) {
              throw ApiError.badRequest(`exposures[${i}] must be an object`);
            }
            const e = raw as Record<string, unknown>;
            return {
              coverageCode: requireString(e['coverageCode'], `exposures[${i}].coverageCode`),
              riskItemId:
                e['riskItemId'] === undefined || e['riskItemId'] === null
                  ? undefined
                  : requireString(e['riskItemId'], `exposures[${i}].riskItemId`),
              claimantName:
                e['claimantName'] === undefined || e['claimantName'] === null
                  ? undefined
                  : requireString(e['claimantName'], `exposures[${i}].claimantName`),
              claimantKind:
                e['claimantKind'] === undefined || e['claimantKind'] === null
                  ? undefined
                  : requireOneOf(e['claimantKind'], `exposures[${i}].claimantKind`, CLAIMANT_KINDS),
            };
          })
        : undefined;

      const result = reportClaim(db, tenant, {
        policyId: requireString(input['policyId'], 'policyId'),
        lossDate: requireIsoDate(input['lossDate'], 'lossDate'),
        reportedDate: requireIsoDate(input['reportedDate'], 'reportedDate'),
        lossCause: requireString(input['lossCause'], 'lossCause'),
        description: requireString(input['description'], 'description'),
        lossLocation:
          input['lossLocation'] === undefined || input['lossLocation'] === null
            ? undefined
            : requireString(input['lossLocation'], 'lossLocation'),
        exposures,
      });
      return created(claimResponse(db, tenant, result.claim.id));
    }),
  );

  router.post(
    '/claims/:id/assign',
    authed((ctx, tenant) => {
      const input = body(ctx);
      assignClaim(db, tenant, param(ctx, 'id'), requireString(input['userId'], 'userId'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/close',
    authed((ctx, tenant) => {
      closeClaim(db, tenant, param(ctx, 'id'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/reopen',
    authed((ctx, tenant) => {
      reopenClaim(db, tenant, param(ctx, 'id'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/notes',
    authed((ctx, tenant) => {
      const input = body(ctx);
      addClaimNote(db, tenant, param(ctx, 'id'), requireString(input['body'], 'body'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  // ── Exposures ─────────────────────────────────────────────────────────────

  router.post(
    '/claims/:id/exposures',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const claim = requireClaim(db, tenant, param(ctx, 'id'));
      if (claim.status !== 'Open') {
        throw ApiError.conflict('Cannot add exposures to a closed claim', 'claim_closed');
      }
      const version = repo
        .listPolicyVersions(db, tenant, claim.policy_id)
        .find((v) => v.id === claim.policy_version_id);
      if (!version) throw ApiError.conflict('Claim has no pinned policy version');
      const account = requireAccount(db, tenant, claim.account_id);
      createExposure(
        db,
        tenant,
        claim,
        version,
        {
          coverageCode: requireString(input['coverageCode'], 'coverageCode'),
          riskItemId:
            input['riskItemId'] === undefined || input['riskItemId'] === null
              ? undefined
              : requireString(input['riskItemId'], 'riskItemId'),
          claimantName:
            input['claimantName'] === undefined || input['claimantName'] === null
              ? undefined
              : requireString(input['claimantName'], 'claimantName'),
          claimantKind:
            input['claimantKind'] === undefined || input['claimantKind'] === null
              ? undefined
              : requireOneOf(input['claimantKind'], 'claimantKind', CLAIMANT_KINDS),
        },
        account.name,
      );
      return created(claimResponse(db, tenant, claim.id));
    }),
  );

  router.post(
    '/claims/:id/exposures/:eid/close',
    authed((ctx, tenant) => {
      closeExposure(db, tenant, param(ctx, 'id'), param(ctx, 'eid'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/exposures/:eid/reopen',
    authed((ctx, tenant) => {
      reopenExposure(db, tenant, param(ctx, 'id'), param(ctx, 'eid'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/exposures/:eid/reserves',
    authed((ctx, tenant) => {
      const input = body(ctx);
      postReserve(db, tenant, param(ctx, 'id'), {
        exposureId: param(ctx, 'eid'),
        category: requireOneOf(input['category'], 'category', CATEGORIES),
        amountCents: requireCentsDelta(input['amountCents'], 'amountCents'),
        reason: requireString(input['reason'], 'reason'),
      });
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  // ── Payments ──────────────────────────────────────────────────────────────

  router.post(
    '/claims/:id/payments',
    authed((ctx, tenant) => {
      const input = body(ctx);
      requestPayment(db, tenant, param(ctx, 'id'), {
        exposureId: requireString(input['exposureId'], 'exposureId'),
        category: requireOneOf(input['category'], 'category', CATEGORIES),
        amountCents: requirePositiveCents(input['amountCents'], 'amountCents'),
        payeeName: requireString(input['payeeName'], 'payeeName'),
        payeeKind: requireOneOf(input['payeeKind'], 'payeeKind', PAYEE_KINDS),
        method: requireOneOf(input['method'], 'method', PAY_METHODS),
        memo:
          input['memo'] === undefined || input['memo'] === null
            ? undefined
            : requireString(input['memo'], 'memo'),
      });
      return created(claimResponse(db, tenant, param(ctx, 'id')));
    }),
  );

  router.post(
    '/claims/:id/payments/:pid/approve',
    authed((ctx, tenant) => {
      const input = body(ctx);
      approvePayment(
        db,
        tenant,
        param(ctx, 'id'),
        param(ctx, 'pid'),
        typeof input['note'] === 'string' ? input['note'] : undefined,
      );
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/payments/:pid/reject',
    authed((ctx, tenant) => {
      const input = body(ctx);
      rejectPayment(
        db,
        tenant,
        param(ctx, 'id'),
        param(ctx, 'pid'),
        typeof input['note'] === 'string' ? input['note'] : undefined,
      );
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/payments/:pid/issue',
    authed((ctx, tenant) => {
      issuePayment(db, tenant, param(ctx, 'id'), param(ctx, 'pid'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/payments/:pid/void',
    authed((ctx, tenant) => {
      const input = body(ctx);
      voidPayment(
        db,
        tenant,
        param(ctx, 'id'),
        param(ctx, 'pid'),
        typeof input['note'] === 'string' ? input['note'] : undefined,
      );
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  // ── Recoveries ────────────────────────────────────────────────────────────

  router.post(
    '/claims/:id/recoveries',
    authed((ctx, tenant) => {
      const input = body(ctx);
      openRecovery(db, tenant, param(ctx, 'id'), {
        exposureId: requireString(input['exposureId'], 'exposureId'),
        recoveryType: requireOneOf(input['recoveryType'], 'recoveryType', RECOVERY_TYPES),
        category: requireOneOf(input['category'], 'category', CATEGORIES),
        counterparty: requireString(input['counterparty'], 'counterparty'),
        expectedCents: requirePositiveCents(input['expectedCents'], 'expectedCents'),
      });
      return created(claimResponse(db, tenant, param(ctx, 'id')));
    }),
  );

  router.post(
    '/claims/:id/recoveries/:rid/receive',
    authed((ctx, tenant) => {
      const input = body(ctx);
      receiveRecovery(
        db,
        tenant,
        param(ctx, 'id'),
        param(ctx, 'rid'),
        requirePositiveCents(input['amountCents'], 'amountCents'),
      );
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  router.post(
    '/claims/:id/recoveries/:rid/close',
    authed((ctx, tenant) => {
      closeRecovery(db, tenant, param(ctx, 'id'), param(ctx, 'rid'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  // ── Diary ─────────────────────────────────────────────────────────────────

  router.post(
    '/claims/:id/tasks',
    authed((ctx, tenant) => {
      const input = body(ctx);
      addTask(db, tenant, param(ctx, 'id'), {
        subject: requireString(input['subject'], 'subject'),
        dueDate: requireIsoDate(input['dueDate'], 'dueDate'),
        assignedUserId:
          input['assignedUserId'] === undefined || input['assignedUserId'] === null
            ? undefined
            : requireString(input['assignedUserId'], 'assignedUserId'),
      });
      return created(claimResponse(db, tenant, param(ctx, 'id')));
    }),
  );

  router.post(
    '/claims/:id/tasks/:tid/complete',
    authed((ctx, tenant) => {
      completeTask(db, tenant, param(ctx, 'id'), param(ctx, 'tid'));
      return claimResponse(db, tenant, param(ctx, 'id'));
    }),
  );

  // ── Coverage verification for the FNOL wizard ─────────────────────────────

  router.get(
    '/policies/:id/coverage-at',
    authed((ctx, tenant) => {
      const policy = repo.getPolicy(db, tenant, param(ctx, 'id'));
      if (!policy) throw ApiError.notFound(`Policy ${param(ctx, 'id')} not found`);
      const date = ctx.query.get('date');
      if (!date) throw ApiError.badRequest('Query parameter date is required');
      const cover = coverageAtDate(db, tenant, policy.id, date);
      const product = getProduct(policy.product_code);
      return {
        inForce: cover.inForce,
        reason: cover.reason,
        version: cover.version ? policyVersionDto(cover.version) : null,
        lossCauses: product.lossCauses,
      };
    }),
  );

  // Users an adjuster can assign or hand work to.
  router.get(
    '/claims-users',
    authed((ctx, tenant) => ({
      users: repo
        .listUsersByRole(db, tenant, ['adjuster', 'claims_supervisor', 'admin'])
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          authorityLimitCents: u.authority_limit_cents,
        })),
    })),
  );
}
