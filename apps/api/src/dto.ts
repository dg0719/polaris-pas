import type { InvoiceView, PolicyBilling } from './billing/readModel.ts';
import { readQuote, readRisk } from './jobs.ts';
import type {
  AccountRow,
  JobEventRow,
  JobRow,
  PaymentRow,
  PolicyRow,
  PolicyVersionRow,
  TransactionRow,
} from './repo.ts';

/** Row → API shape. Keeps snake_case storage details out of the HTTP surface. */

export function accountDto(account: AccountRow) {
  return {
    id: account.id,
    accountNumber: account.account_number,
    accountType: account.account_type,
    name: account.name,
    email: account.email,
    phone: account.phone,
    address: {
      line1: account.address_line1,
      line2: account.address_line2,
      city: account.city,
      province: account.province,
      postalCode: account.postal_code,
    },
    producerCode: account.producer_code,
    createdAt: account.created_at,
    updatedAt: account.updated_at,
  };
}

export function jobDto(job: JobRow) {
  return {
    id: job.id,
    accountId: job.account_id,
    jobType: job.job_type,
    status: job.status,
    policyId: job.policy_id,
    productCode: job.product_code,
    billingPlan: job.billing_plan,
    effectiveDate: job.effective_date,
    termStart: job.term_start,
    termEnd: job.term_end,
    risk: readRisk(job),
    quote: readQuote(job),
    uwApproved: job.uw_approved === 1,
    uwNote: job.uw_note,
    cancelReason: job.cancel_reason,
    createdBy: job.created_by,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export function jobEventDto(event: JobEventRow) {
  return {
    id: event.id,
    action: event.action,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    actorUserId: event.actor_user_id,
    actorRole: event.actor_role,
    actorName: event.actor_name,
    note: event.note,
    createdAt: event.created_at,
  };
}

export function policyDto(policy: PolicyRow) {
  return {
    id: policy.id,
    accountId: policy.account_id,
    policyNumber: policy.policy_number,
    productCode: policy.product_code,
    status: policy.status,
    billingPlan: policy.billing_plan,
    createdAt: policy.created_at,
    updatedAt: policy.updated_at,
  };
}

export function policyVersionDto(version: PolicyVersionRow) {
  return {
    id: version.id,
    versionNumber: version.version_number,
    termNumber: version.term_number,
    transactionType: version.transaction_type,
    effectiveDate: version.effective_date,
    termStart: version.term_start,
    termEnd: version.term_end,
    annualPremiumCents: version.annual_premium_cents,
    risk: JSON.parse(version.risk_json),
    jobId: version.job_id,
    createdAt: version.created_at,
  };
}

export function transactionDto(tx: TransactionRow) {
  return {
    id: tx.id,
    type: tx.type,
    effectiveDate: tx.effective_date,
    amountCents: tx.amount_cents,
    policyVersionId: tx.policy_version_id,
    jobId: tx.job_id,
    createdAt: tx.created_at,
  };
}

/**
 * An invoice is worth the sum of its lines, so the total is derived, never
 * stored. `amountCents` is the name the web client still reads for it; Task
 * 14 moves the client onto `totalCents` and the alias goes with it.
 */
export function invoiceDto(invoice: InvoiceView) {
  return {
    id: invoice.id,
    policyId: invoice.policy_id,
    invoiceNumber: invoice.invoice_number,
    sequence: invoice.sequence,
    termNumber: invoice.term_number,
    eventDate: invoice.event_date,
    billDate: invoice.bill_date,
    dueDate: invoice.due_date,
    status: invoice.displayStatus,
    totalCents: invoice.totalCents,
    amountCents: invoice.totalCents,
    paidCents: invoice.paidCents,
    outstandingCents: invoice.outstandingCents,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      patternCode: line.pattern_code,
      amountCents: line.amount_cents,
      paidCents: line.paid_cents,
    })),
  };
}

export function paymentDto(payment: PaymentRow) {
  return {
    id: payment.id,
    amountCents: payment.amount_cents,
    method: payment.method,
    reference: payment.reference,
    receivedAt: payment.received_at,
    status: payment.status,
    policyId: payment.policy_id,
  };
}

export function policyBillingDto(billing: PolicyBilling) {
  return {
    plan: billing.plan,
    billedCents: billing.billedCents,
    paidCents: billing.paidCents,
    balanceCents: billing.balanceCents,
    pastDueCents: billing.pastDueCents,
    nextDue: billing.nextDue,
    invoices: billing.invoices.map(invoiceDto),
  };
}
