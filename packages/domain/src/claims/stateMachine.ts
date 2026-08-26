import type {
  ClaimPaymentStatus,
  ClaimStatus,
  ExposureStatus,
  RecoveryStatus,
} from './types.ts';

export class ClaimTransitionError extends Error {}

// ─── Claim ───────────────────────────────────────────────────────────────────

export type ClaimAction = 'close' | 'reopen';

export interface ClaimGuardContext {
  openExposures: number;
  /** Payments still Requested or Approved. */
  undecidedPayments: number;
}

/**
 * Claim lifecycle. The same pure shape as the job state machine:
 * (status, action, ctx) → next status, or throws.
 */
export function claimTransition(
  current: ClaimStatus,
  action: ClaimAction,
  ctx: ClaimGuardContext,
): ClaimStatus {
  if (action === 'close') {
    if (current !== 'Open') throw new ClaimTransitionError('Claim is already closed');
    if (ctx.openExposures > 0) {
      throw new ClaimTransitionError(
        `Cannot close a claim with ${ctx.openExposures} open exposure${ctx.openExposures === 1 ? '' : 's'}`,
      );
    }
    if (ctx.undecidedPayments > 0) {
      throw new ClaimTransitionError(
        'Cannot close a claim while a payment is awaiting a decision',
      );
    }
    return 'Closed';
  }
  // reopen
  if (current !== 'Closed') throw new ClaimTransitionError('Only a closed claim can be reopened');
  return 'Open';
}

// ─── Exposure ────────────────────────────────────────────────────────────────

export type ExposureAction = 'close' | 'reopen';

export function exposureTransition(current: ExposureStatus, action: ExposureAction): ExposureStatus {
  if (action === 'close') {
    if (current !== 'Open') throw new ClaimTransitionError('Exposure is already closed');
    return 'Closed';
  }
  if (current !== 'Closed') {
    throw new ClaimTransitionError('Only a closed exposure can be reopened');
  }
  return 'Open';
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export type ClaimPaymentAction = 'approve' | 'reject' | 'issue' | 'void';

const PAYMENT_TRANSITIONS: Record<ClaimPaymentAction, { from: ClaimPaymentStatus[]; to: ClaimPaymentStatus }> = {
  approve: { from: ['Requested'], to: 'Approved' },
  reject: { from: ['Requested', 'Approved'], to: 'Rejected' },
  issue: { from: ['Approved'], to: 'Issued' },
  void: { from: ['Issued'], to: 'Voided' },
};

export function paymentTransition(
  current: ClaimPaymentStatus,
  action: ClaimPaymentAction,
): ClaimPaymentStatus {
  const rule = PAYMENT_TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new ClaimTransitionError(`Cannot ${action} a payment in status ${current}`);
  }
  return rule.to;
}

// ─── Recovery ────────────────────────────────────────────────────────────────

export type RecoveryAction = 'markRecovered' | 'close';

export function recoveryTransition(current: RecoveryStatus, action: RecoveryAction): RecoveryStatus {
  if (action === 'markRecovered') {
    if (current !== 'Open') {
      throw new ClaimTransitionError(`Cannot mark a ${current} recovery as recovered`);
    }
    return 'Recovered';
  }
  // close: from Open (written off) or Recovered
  if (current === 'Closed') throw new ClaimTransitionError('Recovery is already closed');
  return 'Closed';
}
