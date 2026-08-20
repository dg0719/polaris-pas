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
  next_policy_seq: number;
  next_account_seq: number;
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

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  account_id: string;
  policy_id: string;
  invoice_number: string;
  sequence: number;
  term_number: number;
  due_date: string;
  amount_cents: number;
  paid_cents: number;
  status: 'open' | 'paid' | 'void';
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
}

export interface PaymentApplicationRow {
  id: string;
  tenant_id: string;
  payment_id: string;
  invoice_id: string;
  amount_cents: number;
  created_at: string;
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

export function one<T>(row: unknown): T | null {
  return (row as T | undefined) ?? null;
}

export function many<T>(rows: unknown[]): T[] {
  return rows as T[];
}
