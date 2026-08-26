import type { FraudFlag, Financials } from '@polaris/domain';
import { claimFraudFlags } from './claims/lifecycle.ts';
import type {
  ClaimEventRow,
  ClaimExposureRow,
  ClaimNoteRow,
  ClaimPaymentRow,
  ClaimRecoveryRow,
  ClaimRow,
  ClaimTaskRow,
  ReserveMovementRow,
} from './repo.ts';

/** Claims rows → API shapes. Premium billing has `paymentDto`; this is claims money. */

export function claimDto(claim: ClaimRow) {
  return {
    id: claim.id,
    accountId: claim.account_id,
    policyId: claim.policy_id,
    policyVersionId: claim.policy_version_id,
    claimNumber: claim.claim_number,
    status: claim.status,
    lossDate: claim.loss_date,
    reportedDate: claim.reported_date,
    lossCause: claim.loss_cause,
    description: claim.description,
    lossLocation: claim.loss_location,
    assignedUserId: claim.assigned_user_id,
    fraudFlags: claimFraudFlags(claim) as FraudFlag[],
    createdAt: claim.created_at,
    updatedAt: claim.updated_at,
  };
}

export function exposureDto(exposure: ClaimExposureRow, financials?: Financials) {
  return {
    id: exposure.id,
    claimId: exposure.claim_id,
    coverageCode: exposure.coverage_code,
    coverageName: exposure.coverage_name,
    riskItemId: exposure.risk_item_id,
    riskItemLabel: exposure.risk_item_label,
    claimantName: exposure.claimant_name,
    claimantKind: exposure.claimant_kind,
    deductibleCents: exposure.deductible_cents,
    status: exposure.status,
    financials: financials ?? null,
    createdAt: exposure.created_at,
  };
}

export function reserveMovementDto(movement: ReserveMovementRow & { actor_name?: string | null }) {
  return {
    id: movement.id,
    exposureId: movement.exposure_id,
    category: movement.category,
    amountCents: movement.amount_cents,
    reason: movement.reason,
    actorUserId: movement.actor_user_id,
    createdAt: movement.created_at,
  };
}

export function claimPaymentDto(payment: ClaimPaymentRow) {
  return {
    id: payment.id,
    claimId: payment.claim_id,
    exposureId: payment.exposure_id,
    category: payment.category,
    amountCents: payment.amount_cents,
    deductibleAppliedCents: payment.deductible_applied_cents,
    payeeName: payment.payee_name,
    payeeKind: payment.payee_kind,
    method: payment.method,
    memo: payment.memo,
    status: payment.status,
    requestedBy: payment.requested_by,
    approvedBy: payment.approved_by,
    decisionNote: payment.decision_note,
    issuedAt: payment.issued_at,
    createdAt: payment.created_at,
  };
}

export function recoveryDto(recovery: ClaimRecoveryRow) {
  return {
    id: recovery.id,
    claimId: recovery.claim_id,
    exposureId: recovery.exposure_id,
    recoveryType: recovery.recovery_type,
    category: recovery.category,
    counterparty: recovery.counterparty,
    expectedCents: recovery.expected_cents,
    receivedCents: recovery.received_cents,
    status: recovery.status,
    createdAt: recovery.created_at,
  };
}

export function claimEventDto(event: ClaimEventRow) {
  return {
    id: event.id,
    action: event.action,
    subjectKind: event.subject_kind,
    subjectId: event.subject_id,
    detail: event.detail,
    actorUserId: event.actor_user_id,
    actorRole: event.actor_role,
    actorName: event.actor_name,
    createdAt: event.created_at,
  };
}

export function claimNoteDto(note: ClaimNoteRow) {
  return {
    id: note.id,
    body: note.body,
    authorUserId: note.author_user_id,
    authorName: note.author_name,
    createdAt: note.created_at,
  };
}

export function claimTaskDto(task: ClaimTaskRow) {
  return {
    id: task.id,
    claimId: task.claim_id,
    subject: task.subject,
    dueDate: task.due_date,
    assignedUserId: task.assigned_user_id,
    status: task.status,
    createdAt: task.created_at,
  };
}
