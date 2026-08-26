import type { Db } from '../db.ts';
import { inTransaction } from '../db.ts';
import { ApiError } from '../errors.ts';
import * as repo from '../repo.ts';
import type { ClaimTaskRow, TenantCtx } from '../repo.ts';
import { requireClaim, requireClaimsRole } from './lifecycle.ts';

/** The adjuster's diary: dated follow-ups on a claim file. */

export function addTask(
  db: Db,
  ctx: TenantCtx,
  claimId: string,
  input: { subject: string; dueDate: string; assignedUserId?: string },
): ClaimTaskRow {
  return inTransaction(db, () => {
    const claim = requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    if (claim.status !== 'Open') {
      throw ApiError.conflict('Cannot add diary items to a closed claim', 'claim_closed');
    }
    const assignee = input.assignedUserId ?? claim.assigned_user_id ?? ctx.userId;
    if (!repo.getUserInTenant(db, ctx, assignee)) {
      throw ApiError.badRequest(`No such user ${assignee}`);
    }
    const task = repo.insertClaimTask(db, ctx, {
      claimId,
      subject: input.subject,
      dueDate: input.dueDate,
      assignedUserId: assignee,
    });
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'taskAdded',
      subjectKind: 'task',
      subjectId: task.id,
      detail: `${input.subject}, due ${input.dueDate}`,
    });
    return task;
  });
}

export function completeTask(db: Db, ctx: TenantCtx, claimId: string, taskId: string): void {
  inTransaction(db, () => {
    requireClaim(db, ctx, claimId);
    requireClaimsRole(ctx);
    const task = repo.getClaimTask(db, ctx, taskId);
    if (!task || task.claim_id !== claimId) {
      throw ApiError.notFound(`Task ${taskId} not found on this claim`);
    }
    if (task.status === 'done') {
      throw ApiError.conflict('Task is already done', 'task_done');
    }
    repo.setClaimTaskStatus(db, ctx, taskId, 'done');
    repo.appendClaimEvent(db, ctx, {
      claimId,
      action: 'taskCompleted',
      subjectKind: 'task',
      subjectId: taskId,
      detail: task.subject,
    });
  });
}
