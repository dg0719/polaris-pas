import { ClaimTransitionError, recoveryTransition } from '@polaris/domain';
import type { Db } from '../db.ts';
import { inTransaction } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type { ClaimRecoveryRow, TenantCtx } from '../repo.ts';
import { requireClaim, requireClaimsRole, requireExposure } from './lifecycle.ts';

/**
 * Money coming back: subrogation (a liable third party), salvage (what is
 * left of the property), or the insured's deductible recovered on their
 * behalf. A recovery is opened with an expectation, receives money over time,
 * and is closed — fully recovered or written off.
 */

export interface RecoveryInput {
  exposureId: string;
  recoveryType: ClaimRecoveryRow['recovery_type'];
  category: 'indemnity' | 'expense';
  counterparty: string;
  expectedCents: number;
}

function translate(err: unknown): never {
  if (err instanceof ClaimTransitionError) throw ApiError.conflict(err.message, 'invalid_transition');
  throw err;
}

export function requireRecovery(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  recoveryId: string,
): ClaimRecoveryRow {
  const recovery = repo.getClaimRecovery(db, ctx, recoveryId);
  if (!recovery || recovery.claim_id !== claimId) {
    throw ApiError.notFound(`Recovery ${recoveryId} not found on this claim`);
  }
  return recovery;
}

export function openRecovery(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  input: RecoveryInput,
): ClaimRecoveryRow {
  return inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    if (claim.status !== 'Open') {
      throw ApiError.conflict('Cannot open a recovery on a closed claim', 'claim_closed');
    }
    requireExposure(db, ctx, claim, input.exposureId);
    if (!Number.isInteger(input.expectedCents) || input.expectedCents <= 0) {
      throw ApiError.badRequest('Expected recovery must be a positive whole number of cents');
    }
    if (input.counterparty.trim() === '') {
      throw ApiError.badRequest('A recovery needs a counterparty');
    }

    const recovery = repo.insertClaimRecovery(db, ctx, {
      claim_id: claimId,
      exposure_id: input.exposureId,
      recovery_type: input.recoveryType,
      category: input.category,
      counterparty: input.counterparty,
      expected_cents: input.expectedCents,
      received_cents: 0,
      status: 'Open',
    });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'recoveryOpened',
      subjectKind: 'recovery',
      subjectId: recovery.id,
      detail: `${input.recoveryType} from ${input.counterparty}`,
    });
    return recovery;
  });
}

/** Record money received against a recovery; fully received marks it Recovered. */
export function receiveRecovery(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  recoveryId: string,
  amountCents: number,
): ClaimRecoveryRow {
  return inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const recovery = requireRecovery(db, ctx, claimId, recoveryId);
    if (recovery.status === 'Closed') {
      throw ApiError.conflict('Recovery is closed', 'recovery_closed');
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw ApiError.badRequest('Received amount must be a positive whole number of cents');
    }

    const received = recovery.received_cents + amountCents;
    const fullyReceived = received >= recovery.expected_cents;
    let status: ClaimRecoveryRow['status'] = recovery.status;
    if (fullyReceived && recovery.status === 'Open') {
      try {
        status = recoveryTransition(recovery.status, 'markRecovered');
      } catch (err) {
        translate(err);
      }
    }

    repo.updateClaimRecovery(db, ctx, recoveryId, { received_cents: received, status });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'recoveryReceived',
      subjectKind: 'recovery',
      subjectId: recoveryId,
      detail: `Received ${amountCents} of ${recovery.expected_cents} expected`,
    });
    return requireRecovery(db, ctx, claimId, recoveryId);
  });
}

export function closeRecovery(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  recoveryId: string,
): ClaimRecoveryRow {
  return inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const recovery = requireRecovery(db, ctx, claimId, recoveryId);
    let next: ClaimRecoveryRow['status'];
    try {
      next = recoveryTransition(recovery.status, 'close');
    } catch (err) {
      translate(err);
    }
    repo.updateClaimRecovery(db, ctx, recoveryId, { status: next });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'recoveryClosed',
      subjectKind: 'recovery',
      subjectId: recoveryId,
    });
    return requireRecovery(db, ctx, claimId, recoveryId);
  });
}
