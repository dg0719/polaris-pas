import { randomUUID } from 'node:crypto';
import type {
  InstallmentPlan,
  JobStatus,
  JobType,
  PolicyStatus,
  Role,
} from '@polaris/domain';

// Re-exported so sibling repo modules import their vocabulary from one place.
export type { InstallmentPlan, JobStatus, JobType, PolicyStatus, Role };

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Identity for every request. All repository calls are scoped to `tenantId`. */
export interface TenantCtx {
  tenantId: string;
  userId: string;
  role: Role;
}

export interface TenantRow {
  id: string;
  name: string;
  policy_prefix: string;
  claim_prefix: string;
  next_policy_seq: number;
  next_account_seq: number;
  next_claim_seq: number;
  created_at: string;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  username: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  password_salt: string;
  api_key: string;
  authority_limit_cents: number;
  created_at: string;
}

export interface AccountRow {
  id: string;
  tenant_id: string;
  account_number: string;
  account_type: 'person' | 'organization';
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  province: string;
  postal_code: string;
  producer_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyRow {
  id: string;
  tenant_id: string;
  account_id: string;
  policy_number: string;
  product_code: string;
  status: PolicyStatus;
  billing_plan: InstallmentPlan;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  tenant_id: string;
  account_id: string;
  amount_cents: number;
  method: 'card' | 'eft' | 'cheque' | 'cash';
  reference: string | null;
  received_at: string;
  created_at: string;
  status: 'pending' | 'cleared' | 'returned' | 'reversed';
  created_by: string | null;
  policy_id: string | null;
}

export interface PolicyVersionRow {
  id: string;
  tenant_id: string;
  policy_id: string;
  version_number: number;
  term_number: number;
  transaction_type: string;
  effective_date: string;
  term_start: string;
  term_end: string;
  risk_json: string;
  quote_json: string;
  annual_premium_cents: number;
  job_id: string;
  created_at: string;
}

export interface JobRow {
  id: string;
  tenant_id: string;
  account_id: string;
  job_type: JobType;
  status: JobStatus;
  policy_id: string | null;
  product_code: string;
  billing_plan: InstallmentPlan;
  effective_date: string;
  term_start: string;
  term_end: string;
  risk_json: string;
  quote_json: string | null;
  uw_approved: number;
  uw_note: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface JobEventRow {
  id: string;
  tenant_id: string;
  job_id: string;
  action: string;
  from_status: string;
  to_status: string;
  actor_user_id: string;
  actor_role: string;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  tenant_id: string;
  policy_id: string;
  policy_version_id: string;
  job_id: string;
  type: string;
  effective_date: string;
  amount_cents: number;
  created_at: string;
}

// ─── Billing rows (journal, catalogue-derived items) ───────────────────────
// Charge patterns, payment plans and tax rates are mapped straight to the
// domain `*Def` types inside `repo/billingConfig.ts`, so they have no row
// type here — snake_case config never leaves that module.

export interface JournalEntryRow {
  id: string;
  tenant_id: string;
  posted_at: string;
  effective_date: string;
  event_type: string;
  reference_kind: string;
  reference_id: string;
  actor_user_id: string | null;
  reversal_of: string | null;
  reason: string | null;
}

export interface JournalLineRow {
  id: string;
  tenant_id: string;
  entry_id: string;
  account_code: string;
  account_id: string | null;
  policy_id: string | null;
  producer_id: string | null;
  province: string | null;
  method: string | null;
  debit_cents: number;
  credit_cents: number;
}

export interface BillingInstructionRow {
  id: string;
  tenant_id: string;
  policy_id: string;
  policy_version_id: string;
  transaction_id: string | null;
  type: string;
  payment_plan_code: string;
  billing_method: string;
  effective_date: string;
  created_at: string;
}

export interface ChargeRow {
  id: string;
  tenant_id: string;
  instruction_id: string;
  account_id: string;
  policy_id: string;
  pattern_code: string;
  amount_cents: number;
  effective_date: string;
  province: string;
  line: string;
  created_at: string;
}

export interface InvoiceStreamRow {
  id: string;
  tenant_id: string;
  account_id: string;
  policy_id: string | null;
  anchor_date: string;
  periodicity: string;
  lead_days: number;
  created_at: string;
}

export interface BillingInvoiceRow {
  id: string;
  tenant_id: string;
  account_id: string;
  policy_id: string;
  stream_id: string;
  invoice_number: string;
  sequence: number;
  term_number: number;
  event_date: string;
  bill_date: string;
  due_date: string;
  status: 'planned' | 'billed' | 'paid' | 'void';
  created_at: string;
  updated_at: string;
}

export interface InvoiceItemRow {
  id: string;
  tenant_id: string;
  charge_id: string;
  invoice_id: string;
  account_id: string;
  policy_id: string;
  kind: 'downPayment' | 'installment' | 'oneTime' | 'fee' | 'tax';
  pattern_code: string;
  amount_cents: number;
  event_date: string;
  sequence: number;
  paid_cents: number;
  offsets_item_id: string | null;
  created_at: string;
}

export interface ItemApplicationRow {
  id: string;
  tenant_id: string;
  payment_id: string;
  item_id: string;
  amount_cents: number;
  reversed_by: string | null;
  created_at: string;
}

export interface BillingRunRow {
  id: string;
  tenant_id: string;
  run_date: string;
  started_at: string;
  finished_at: string | null;
  summary_json: string;
}

export function one<T>(row: unknown): T | null {
  return (row as T | undefined) ?? null;
}

export function many<T>(rows: unknown[]): T[] {
  return rows as T[];
}

// ─── Claims rows ────────────────────────────────────────────────────────────

export interface ClaimRow {
  id: string;
  tenant_id: string;
  account_id: string;
  policy_id: string;
  policy_version_id: string;
  claim_number: string;
  status: 'Open' | 'Closed';
  loss_date: string;
  reported_date: string;
  loss_cause: string;
  description: string;
  loss_location: string | null;
  assigned_user_id: string | null;
  fraud_flags_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ClaimExposureRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  coverage_code: string;
  coverage_name: string;
  risk_item_id: string | null;
  risk_item_label: string | null;
  claimant_name: string;
  claimant_kind: 'insured' | 'thirdParty';
  deductible_cents: number;
  status: 'Open' | 'Closed';
  created_at: string;
  updated_at: string;
}

export interface ReserveMovementRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  exposure_id: string;
  category: 'indemnity' | 'expense';
  amount_cents: number;
  reason: string;
  actor_user_id: string;
  created_at: string;
}

export interface ClaimPaymentRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  exposure_id: string;
  category: 'indemnity' | 'expense';
  amount_cents: number;
  deductible_applied_cents: number;
  payee_name: string;
  payee_kind: 'insured' | 'claimant' | 'vendor' | 'other';
  method: 'cheque' | 'eft';
  memo: string | null;
  status: 'Requested' | 'Approved' | 'Issued' | 'Rejected' | 'Voided';
  requested_by: string;
  approved_by: string | null;
  decision_note: string | null;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimRecoveryRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  exposure_id: string;
  recovery_type: 'subrogation' | 'salvage' | 'deductible';
  category: 'indemnity' | 'expense';
  counterparty: string;
  expected_cents: number;
  received_cents: number;
  status: 'Open' | 'Recovered' | 'Closed';
  created_at: string;
  updated_at: string;
}

export interface ClaimEventRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  detail: string | null;
  actor_user_id: string;
  actor_role: string;
  actor_name: string | null;
  created_at: string;
}

export interface ClaimNoteRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  body: string;
  author_user_id: string;
  author_name: string | null;
  created_at: string;
}

export interface ClaimTaskRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  subject: string;
  due_date: string;
  assigned_user_id: string;
  status: 'open' | 'done';
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── The billing day ───────────────────────────────────────────────────────

export interface BillingRunRow {
  id: string;
  tenant_id: string;
  run_date: string;
  started_at: string;
  finished_at: string | null;
  summary_json: string;
}

/** What one policy version had earned as at `as_of`. Cumulative, never a
 * delta: the billing day posts the difference between two of these. */
export interface EarningSnapshotRow {
  id: string;
  tenant_id: string;
  policy_version_id: string;
  policy_id: string;
  as_of: string;
  written_cents: number;
  earned_cents: number;
  created_at: string;
}
