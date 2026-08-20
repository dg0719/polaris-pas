import type { JobStatus, Role } from './types.ts';

export type JobAction =
  | 'editData'
  | 'quote'
  | 'uwApprove'
  | 'uwDecline'
  | 'bind'
  | 'issue'
  | 'withdraw';

export interface JobGuardContext {
  requiresUw: boolean;
  uwApproved: boolean;
  actorRole: Role;
}

export class TransitionError extends Error {}

interface TransitionRule {
  from: JobStatus[];
  to: JobStatus;
  guard?: (ctx: JobGuardContext) => string | null; // returns error message or null
}

const TRANSITIONS: Record<JobAction, TransitionRule> = {
  editData: { from: ['Draft', 'Quoted'], to: 'Draft' },
  quote: { from: ['Draft', 'Quoted'], to: 'Quoted' },
  uwApprove: {
    from: ['Quoted'],
    to: 'Quoted',
    guard: (ctx) =>
      ctx.actorRole === 'underwriter' || ctx.actorRole === 'admin'
        ? null
        : 'Only an underwriter can approve a referral',
  },
  uwDecline: {
    from: ['Quoted'],
    to: 'Declined',
    guard: (ctx) =>
      ctx.actorRole === 'underwriter' || ctx.actorRole === 'admin'
        ? null
        : 'Only an underwriter can decline a referral',
  },
  bind: {
    from: ['Quoted'],
    to: 'Bound',
    guard: (ctx) =>
      ctx.requiresUw && !ctx.uwApproved
        ? 'Job has underwriting referrals and requires underwriter approval before bind'
        : null,
  },
  issue: { from: ['Bound'], to: 'Issued' },
  withdraw: { from: ['Draft', 'Quoted', 'Bound'], to: 'Withdrawn' },
};

/**
 * Uniform job state machine (Submission, PolicyChange, Renewal, Cancellation).
 * Pure: (status, action, ctx) → next status, or throws TransitionError.
 */
export function transition(
  current: JobStatus,
  action: JobAction,
  ctx: JobGuardContext,
): JobStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new TransitionError(`Cannot ${action} a job in status ${current}`);
  }
  if (rule.guard) {
    const err = rule.guard(ctx);
    if (err) throw new TransitionError(err);
  }
  return rule.to;
}
