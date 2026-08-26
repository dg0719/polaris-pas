import type { Db } from '../db.ts';
import { inTransaction } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type { TenantCtx } from '../repo.ts';
import { requireClaim, requireClaimsRole, requireExposure } from './lifecycle.ts';

/**
 * Reserves move by appending signed deltas; the current reserve is their sum.
 * There is no "set the reserve" write anywhere — a correction is a movement
 * with a reason, which is exactly what an auditor wants to read.
 */

export interface ReserveInput {
  exposureId: string;
  category: 'indemnity' | 'expense';
  amountCents: number;
  reason: string;
}

/** Current reserve per category for one exposure. */
export function exposureReserveByCategory(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  exposureId: string,
): Record<'indemnity' | 'expense', number> {
  const totals: Record<'indemnity' | 'expense', number> = { indemnity: 0, expense: 0 };
  for (const movement of repo.listReserveMovements(db, ctx, claimId)) {
    if (movement.exposure_id === exposureId) {
      totals[movement.category] += movement.amount_cents;
    }
  }
  return totals;
}

export function postReserve(db: Db, ctx: TenantCtx, claimId: string, input: ReserveInput): void {
  inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    if (claim.status !== 'Open') {
      throw ApiError.conflict('Cannot move reserves on a closed claim', 'claim_closed');
    }
    const exposure = requireExposure(db, ctx, claim, input.exposureId);
    if (exposure.status !== 'Open') {
      throw ApiError.conflict('Cannot move reserves on a closed exposure', 'exposure_closed');
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
      throw ApiError.badRequest('Reserve movement must be a non-zero whole number of cents');
    }
    if (input.reason.trim() === '') {
      throw ApiError.badRequest('A reserve movement needs a reason');
    }

    const current = exposureReserveByCategory(db, ctx, claimId, input.exposureId);
    if (current[input.category] + input.amountCents < 0) {
      throw ApiError.conflict(
        'This movement would take the reserve below zero',
        'reserve_below_zero',
      );
    }

    repo.insertReserveMovement(db, ctx, {
      claimId,
      exposureId: input.exposureId,
      category: input.category,
      amountCents: input.amountCents,
      reason: input.reason,
    });
    const MONEY = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
    const signed = `${input.amountCents > 0 ? '+' : '−'}${MONEY.format(Math.abs(input.amountCents) / 100)}`;
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'reserveMoved',
      subjectKind: 'exposure',
      subjectId: input.exposureId,
      detail: `${input.category} ${signed} — ${input.reason}`,
    });
  });
}
