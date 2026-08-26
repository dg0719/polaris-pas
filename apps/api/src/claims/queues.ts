import type { FraudFlag } from '@polaris/domain';
import type { Db } from '../db.ts';
import { todayIso } from '../dates.ts';
import * as repo from '../repo.ts';
import type { ClaimPaymentRow, ClaimRow, ClaimTaskRow, TenantCtx } from '../repo.ts';
import { claimFraudFlags } from './lifecycle.ts';
import { claimFinancialView } from './readModel.ts';

/**
 * The claims worklist: what needs a decision, ordered by how an adjuster
 * actually triages — approvals by amount, diary by due date.
 */

export interface ClaimQueueItem {
  claimId: string;
  claimNumber: string;
  status: string;
  accountName: string;
  policyNumber: string;
  lossDate: string;
  lossCause: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  fraudFlags: FraudFlag[];
  incurredCents: number;
  outstandingCents: number;
  updatedAt: string;
}

export interface ApprovalQueueItem {
  paymentId: string;
  claimId: string;
  claimNumber: string;
  accountName: string;
  exposureLabel: string;
  amountCents: number;
  payeeName: string;
  requestedByName: string;
  createdAt: string;
}

export interface DiaryItem {
  taskId: string;
  claimId: string;
  claimNumber: string;
  subject: string;
  dueDate: string;
  overdue: boolean;
}

export interface ClaimsWorklist {
  myClaims: ClaimQueueItem[];
  unassigned: ClaimQueueItem[];
  approvals: ApprovalQueueItem[];
  diary: DiaryItem[];
  flagged: ClaimQueueItem[];
  counts: {
    myClaims: number;
    unassigned: number;
    approvals: number;
    overdueDiary: number;
    flagged: number;
  };
}

function toQueueItem(db: Db, ctx: TenantCtx, claim: ClaimRow): ClaimQueueItem {
  const account = repo.getAccount(db, ctx, claim.account_id);
  const policy = repo.getPolicy(db, ctx, claim.policy_id);
  const assigned = claim.assigned_user_id
    ? repo.getUserInTenant(db, ctx, claim.assigned_user_id)
    : null;
  const financials = claimFinancialView(db, ctx, claim);
  return {
    claimId: claim.id,
    claimNumber: claim.claim_number,
    status: claim.status,
    accountName: account?.name ?? 'Unknown account',
    policyNumber: policy?.policy_number ?? '',
    lossDate: claim.loss_date,
    lossCause: claim.loss_cause,
    assignedUserId: claim.assigned_user_id,
    assignedUserName: assigned?.name ?? null,
    fraudFlags: claimFraudFlags(claim) as FraudFlag[],
    incurredCents: financials.claim.incurredCents,
    outstandingCents: financials.claim.outstandingCents,
    updatedAt: claim.updated_at,
  };
}

function toApprovalItem(db: Db, ctx: TenantCtx, payment: ClaimPaymentRow): ApprovalQueueItem {
  const claim = repo.getClaim(db, ctx, payment.claim_id);
  const account = claim ? repo.getAccount(db, ctx, claim.account_id) : null;
  const exposure = repo.getExposure(db, ctx, payment.exposure_id);
  const requester = repo.getUserInTenant(db, ctx, payment.requested_by);
  return {
    paymentId: payment.id,
    claimId: payment.claim_id,
    claimNumber: claim?.claim_number ?? '',
    accountName: account?.name ?? '',
    exposureLabel: exposure
      ? `${exposure.coverage_name} — ${exposure.claimant_name}`
      : payment.exposure_id,
    amountCents: payment.amount_cents,
    payeeName: payment.payee_name,
    requestedByName: requester?.name ?? '',
    createdAt: payment.created_at,
  };
}

function toDiaryItem(db: Db, ctx: TenantCtx, task: ClaimTaskRow, today: string): DiaryItem {
  const claim = repo.getClaim(db, ctx, task.claim_id);
  return {
    taskId: task.id,
    claimId: task.claim_id,
    claimNumber: claim?.claim_number ?? '',
    subject: task.subject,
    dueDate: task.due_date,
    overdue: task.due_date < today,
  };
}

export function claimsWorklist(db: Db, ctx: TenantCtx): ClaimsWorklist {
  const today = todayIso();
  const open = repo.listClaims(db, ctx, { status: 'Open' });

  const myClaims = open
    .filter((c) => c.assigned_user_id === ctx.userId)
    .map((c) => toQueueItem(db, ctx, c));
  const unassigned = open
    .filter((c) => c.assigned_user_id === null)
    .map((c) => toQueueItem(db, ctx, c));
  const approvals = repo
    .listPaymentsAwaitingApproval(db, ctx)
    .map((p) => toApprovalItem(db, ctx, p));
  const diary = repo
    .listOpenTasksForUser(db, ctx, ctx.userId)
    .map((t) => toDiaryItem(db, ctx, t, today));
  const flagged = open
    .filter((c) => (claimFraudFlags(c) as FraudFlag[]).length > 0)
    .map((c) => toQueueItem(db, ctx, c));

  return {
    myClaims,
    unassigned,
    approvals,
    diary,
    flagged,
    counts: {
      myClaims: myClaims.length,
      unassigned: unassigned.length,
      approvals: approvals.length,
      overdueDiary: diary.filter((d) => d.overdue).length,
      flagged: flagged.length,
    },
  };
}
