import type { Role } from '../types.ts';

/**
 * Payment authority. Every claims user carries a personal limit in cents; a
 * payment above the requester's limit needs a second person, and that person
 * must themselves have the authority to cover it. The same shape as the
 * underwriting referral guard: the system never blocks the request, only the
 * money leaving without the right approval.
 */

/** Roles that can decide claim payments at all. */
const APPROVING_ROLES: Role[] = ['adjuster', 'claims_supervisor', 'admin'];

export function requiresApproval(amountCents: number, requesterLimitCents: number): boolean {
  return amountCents > requesterLimitCents;
}

export interface ApprovalContext {
  amountCents: number;
  requestedByUserId: string;
  actorUserId: string;
  actorRole: Role;
  actorLimitCents: number;
}

/** Error message when the actor may not approve this payment, else null. */
export function approvalGuard(ctx: ApprovalContext): string | null {
  if (!APPROVING_ROLES.includes(ctx.actorRole)) {
    return `A ${ctx.actorRole} cannot approve claim payments`;
  }
  if (ctx.actorUserId === ctx.requestedByUserId) {
    return 'You cannot approve your own payment; it needs a second person';
  }
  if (ctx.amountCents > ctx.actorLimitCents) {
    return 'This payment exceeds your own payment authority';
  }
  return null;
}
