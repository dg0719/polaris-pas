import { ClaimTransitionError, claimTransition, exposureTransition } from '@polaris/domain';
import type { Db } from '../db.ts';
import { inTransaction } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type { ClaimExposureRow, ClaimRow, TenantCtx } from '../repo.ts';
import { exposureReserveByCategory } from './reserves.ts';

/**
 * Claim and exposure lifecycle. Every status change goes through the domain
 * state machine and lands in claim_events; nothing sets a status directly.
 */

export function requireClaim(db: Db, ctx: TenantCtx, claimId: string): ClaimRow {
  const claim = repo.getClaim(db, ctx, claimId);
  if (!claim) throw ApiError.notFound(`Claim ${claimId} not found`);
  return claim;
}

export function requireExposure(
  db: Db,
  ctx: TenantCtx,
  claim: ClaimRow,
  exposureId: string,
): ClaimExposureRow {
  const exposure = repo.getExposure(db, ctx, exposureId);
  if (!exposure || exposure.claim_id !== claim.id) {
    throw ApiError.notFound(`Exposure ${exposureId} not found on this claim`);
  }
  return exposure;
}

function translate(err: unknown): never {
  if (err instanceof ClaimTransitionError) throw ApiError.conflict(err.message, 'invalid_transition');
  throw err;
}

/** Roles that work claims. CSRs can report and read, never decide. */
export function requireClaimsRole(ctx: TenantCtx): void {
  if (ctx.role !== 'adjuster' && ctx.role !== 'claims_supervisor' && ctx.role !== 'admin') {
    throw ApiError.forbidden('Requires a claims role: adjuster, claims supervisor or admin');
  }
}

export function assignClaim(db: Db, ctx: TenantCtx, claimId: string, userId: string): ClaimRow {
  return inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    const user = repo.getUserInTenant(db, ctx, userId);
    if (!user) throw ApiError.badRequest(`No such user ${userId}`);
    if (user.role !== 'adjuster' && user.role !== 'claims_supervisor' && user.role !== 'admin') {
      throw ApiError.badRequest(`${user.name} does not hold a claims role`);
    }
    repo.updateClaim(db, ctx, claimId, { assigned_user_id: userId });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'assigned',
      subjectKind: 'claim',
      subjectId: claimId,
      detail: `Assigned to ${user.name}`,
    });
    return requireClaim(db, ctx, claimId);
  });
}

export function closeClaim(db: Db, ctx: TenantCtx, claimId: string): ClaimRow {
  return inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);

    const exposures = repo.listExposures(db, ctx, claimId);
    const payments = repo.listClaimPayments(db, ctx, claimId);
    let next: ClaimRow['status'];
    try {
      next = claimTransition(claim.status, 'close', {
        openExposures: exposures.filter((e) => e.status === 'Open').length,
        undecidedPayments: payments.filter(
          (p) => p.status === 'Requested' || p.status === 'Approved',
        ).length,
      });
    } catch (err) {
      translate(err);
    }

    repo.updateClaim(db, ctx, claimId, { status: next });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'closed',
      subjectKind: 'claim',
      subjectId: claimId,
    });
    return requireClaim(db, ctx, claimId);
  });
}

export function reopenClaim(db: Db, ctx: TenantCtx, claimId: string): ClaimRow {
  return inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    let next: ClaimRow['status'];
    try {
      next = claimTransition(claim.status, 'reopen', { openExposures: 0, undecidedPayments: 0 });
    } catch (err) {
      translate(err);
    }

    repo.updateClaim(db, ctx, claimId, { status: next });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'reopened',
      subjectKind: 'claim',
      subjectId: claimId,
    });
    return requireClaim(db, ctx, claimId);
  });
}

/**
 * Close an exposure. Whatever reserve is left is taken down to zero by
 * appending the offsetting movements — the history stays intact.
 */
export function closeExposure(db: Db, ctx: TenantCtx, claimId: string, exposureId: string): void {
  inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const exposure = requireExposure(db, ctx, claim, exposureId);

    const pending = repo
      .listClaimPayments(db, ctx, claimId)
      .filter(
        (p) =>
          p.exposure_id === exposureId && (p.status === 'Requested' || p.status === 'Approved'),
      );
    if (pending.length > 0) {
      throw ApiError.conflict(
        'Cannot close an exposure while a payment on it is awaiting a decision',
        'payments_pending',
      );
    }

    let next: ClaimExposureRow['status'];
    try {
      next = exposureTransition(exposure.status, 'close');
    } catch (err) {
      translate(err);
    }

    const remaining = exposureReserveByCategory(db, ctx, claimId, exposureId);
    for (const [category, reserveCents] of Object.entries(remaining)) {
      if (reserveCents !== 0) {
        repo.insertReserveMovement(db, ctx, {
          claimId,
          exposureId,
          category: category as 'indemnity' | 'expense',
          amountCents: -reserveCents,
          reason: 'Exposure closed; remaining reserve taken down',
        });
      }
    }

    repo.setExposureStatus(db, ctx, exposureId, next);
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'exposureClosed',
      subjectKind: 'exposure',
      subjectId: exposureId,
      detail: exposure.coverage_name,
    });
  });
}

export function reopenExposure(db: Db, ctx: TenantCtx, claimId: string, exposureId: string): void {
  inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    if (claim.status !== 'Open') {
      throw ApiError.conflict('Reopen the claim before reopening an exposure', 'claim_closed');
    }
    const exposure = requireExposure(db, ctx, claim, exposureId);
    let next: ClaimExposureRow['status'];
    try {
      next = exposureTransition(exposure.status, 'reopen');
    } catch (err) {
      translate(err);
    }
    repo.setExposureStatus(db, ctx, exposureId, next);
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'exposureReopened',
      subjectKind: 'exposure',
      subjectId: exposureId,
      detail: exposure.coverage_name,
    });
  });
}

/** Re-read fraud flags stored at FNOL. */
export function claimFraudFlags(claim: ClaimRow): unknown[] {
  try {
    const parsed = JSON.parse(claim.fraud_flags_json) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** File note; any authenticated role may write one. */
export function addClaimNote(db: Db, ctx: TenantCtx, claimId: string, body: string): void {
  requireClaim(db, ctx, claimId);
  repo.insertClaimNote(db, ctx, { claimId, body });
}
