import {
  ClaimTransitionError,
  approvalGuard,
  paymentTransition,
  requiresApproval,
} from '@polaris/domain';
import type { Db } from '../db.ts';
import { inTransaction } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type { ClaimPaymentRow, TenantCtx } from '../repo.ts';
import { requireClaim, requireClaimsRole, requireExposure } from './lifecycle.ts';

/**
 * Claim payments: request → approve → issue, with an authority gate.
 *
 * A payment within the requester's own limit is authorized by them; one above
 * it waits in Requested for a second person whose authority covers it. Nobody
 * approves their own over-limit payment. Only Approved payments can be Issued,
 * so no payment leaves without someone having had the authority to let it.
 */

export interface ClaimPaymentInput {
  exposureId: string;
  category: 'indemnity' | 'expense';
  /** Gross amount before the deductible. */
  amountCents: number;
  payeeName: string;
  payeeKind: ClaimPaymentRow['payee_kind'];
  method: ClaimPaymentRow['method'];
  memo?: string;
}

function requireActor(db: Db, ctx: TenantCtx) {
  const actor = repo.getUserInTenant(db, ctx, ctx.userId);
  if (!actor) throw ApiError.unauthorized();
  return actor;
}

function translate(err: unknown): never {
  if (err instanceof ClaimTransitionError) throw ApiError.conflict(err.message, 'invalid_transition');
  throw err;
}

export function requirePayment(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  paymentId: string,
): ClaimPaymentRow {
  const payment = repo.getClaimPayment(db, ctx, paymentId);
  if (!payment || payment.claim_id !== claimId) {
    throw ApiError.notFound(`Payment ${paymentId} not found on this claim`);
  }
  return payment;
}

/**
 * The deductible comes off the first indemnity payment on an exposure, once.
 * Rejected and voided payments never applied it, so it stays available.
 */
function deductibleToApply(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  exposureId: string,
  category: 'indemnity' | 'expense',
  deductibleCents: number,
): number {
  if (category !== 'indemnity' || deductibleCents === 0) return 0;
  const alreadyApplied = repo
    .listClaimPayments(db, ctx, claimId)
    .some(
      (p) =>
        p.exposure_id === exposureId &&
        p.deductible_applied_cents > 0 &&
        p.status !== 'Rejected' &&
        p.status !== 'Voided',
    );
  return alreadyApplied ? 0 : deductibleCents;
}

export function requestPayment(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  input: ClaimPaymentInput,
): ClaimPaymentRow {
  return inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    if (claim.status !== 'Open') {
      throw ApiError.conflict('Cannot pay on a closed claim', 'claim_closed');
    }
    const exposure = requireExposure(db, ctx, claim, input.exposureId);
    if (exposure.status !== 'Open') {
      throw ApiError.conflict('Cannot pay on a closed exposure', 'exposure_closed');
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw ApiError.badRequest('Payment amount must be a positive whole number of cents');
    }

    const deductible = deductibleToApply(
      db,
      ctx,
      claimId,
      input.exposureId,
      input.category,
      exposure.deductible_cents,
    );
    const netCents = input.amountCents - deductible;
    if (netCents <= 0) {
      throw ApiError.conflict(
        `The loss amount is within the ${exposure.coverage_name} deductible; nothing is payable`,
        'below_deductible',
      );
    }

    const actor = requireActor(db, ctx);
    const withinAuthority = !requiresApproval(netCents, actor.authority_limit_cents);

    const payment = repo.insertClaimPayment(db, ctx, {
      claim_id: claimId,
      exposure_id: input.exposureId,
      category: input.category,
      amount_cents: netCents,
      deductible_applied_cents: deductible,
      payee_name: input.payeeName,
      payee_kind: input.payeeKind,
      method: input.method,
      memo: input.memo ?? null,
      status: withinAuthority ? 'Approved' : 'Requested',
      requested_by: ctx.userId,
      approved_by: withinAuthority ? ctx.userId : null,
      decision_note: withinAuthority ? 'Within own authority' : null,
      issued_at: null,
    });

    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: withinAuthority ? 'paymentApproved' : 'paymentRequested',
      subjectKind: 'payment',
      subjectId: payment.id,
      detail: withinAuthority
        ? `${payment.payee_name}, within authority`
        : `${payment.payee_name}, needs approval above authority`,
    });
    return payment;
  });
}

export function approvePayment(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  paymentId: string,
  note?: string,
): ClaimPaymentRow {
  return inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    const payment = requirePayment(db, ctx, claimId, paymentId);
    const actor = requireActor(db, ctx);

    const denial = approvalGuard({
      amountCents: payment.amount_cents,
      requestedByUserId: payment.requested_by,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      actorLimitCents: actor.authority_limit_cents,
    });
    if (denial) throw ApiError.forbidden(denial);

    let next: ClaimPaymentRow['status'];
    try {
      next = paymentTransition(payment.status, 'approve');
    } catch (err) {
      translate(err);
    }
    repo.updateClaimPayment(db, ctx, paymentId, {
      status: next,
      approved_by: ctx.userId,
      decision_note: note ?? null,
    });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'paymentApproved',
      subjectKind: 'payment',
      subjectId: paymentId,
      detail: note,
    });
    return requirePayment(db, ctx, claimId, paymentId);
  });
}

export function rejectPayment(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  paymentId: string,
  note?: string,
): ClaimPaymentRow {
  return inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const payment = requirePayment(db, ctx, claimId, paymentId);
    let next: ClaimPaymentRow['status'];
    try {
      next = paymentTransition(payment.status, 'reject');
    } catch (err) {
      translate(err);
    }
    repo.updateClaimPayment(db, ctx, paymentId, {
      status: next,
      decision_note: note ?? null,
    });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'paymentRejected',
      subjectKind: 'payment',
      subjectId: paymentId,
      detail: note,
    });
    return requirePayment(db, ctx, claimId, paymentId);
  });
}

export function issuePayment(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  paymentId: string,
): ClaimPaymentRow {
  return inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const payment = requirePayment(db, ctx, claimId, paymentId);
    let next: ClaimPaymentRow['status'];
    try {
      next = paymentTransition(payment.status, 'issue');
    } catch (err) {
      translate(err);
    }
    repo.updateClaimPayment(db, ctx, paymentId, {
      status: next,
      issued_at: new Date().toISOString(),
    });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'paymentIssued',
      subjectKind: 'payment',
      subjectId: paymentId,
      detail: `${payment.method} to ${payment.payee_name}`,
    });
    return requirePayment(db, ctx, claimId, paymentId);
  });
}

export function voidPayment(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  paymentId: string,
  note?: string,
): ClaimPaymentRow {
  return inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const payment = requirePayment(db, ctx, claimId, paymentId);
    let next: ClaimPaymentRow['status'];
    try {
      next = paymentTransition(payment.status, 'void');
    } catch (err) {
      translate(err);
    }
    repo.updateClaimPayment(db, ctx, paymentId, {
      status: next,
      decision_note: note ?? null,
    });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'paymentVoided',
      subjectKind: 'payment',
      subjectId: paymentId,
      detail: note,
    });
    return requirePayment(db, ctx, claimId, paymentId);
  });
}
