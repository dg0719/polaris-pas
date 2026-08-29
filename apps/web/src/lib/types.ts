export type Role =
  | 'csr'
  | 'underwriter'
  | 'adjuster'
  | 'claims_supervisor'
  | 'admin'
  | 'billing'
  | 'finance';
export type InstallmentPlan = 'full' | 'monthly' | 'quarterly';
export type JobStatus = 'Draft' | 'Quoted' | 'Bound' | 'Issued' | 'Declined' | 'Withdrawn';
export type JobType = 'Submission' | 'PolicyChange' | 'Renewal' | 'Cancellation';

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  licenceNumber: string;
  yearsLicensed: number;
  atFaultClaims: number;
  minorConvictions: number;
}

export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  valueCents: number;
  rateGroup: number;
  primaryUse: 'pleasure' | 'commute' | 'business';
  annualKm: number;
  postalCode: string;
  principalDriverId: string;
}

export interface CoverageSelection {
  vehicleId: string;
  coverageCode: string;
  limitCents?: number;
  deductibleCents?: number;
}

export interface RiskData {
  drivers: Driver[];
  vehicles: Vehicle[];
  coverages: CoverageSelection[];
  termMonths: number;
}

export interface CoverageDef {
  code: string;
  name: string;
  kind: 'liability' | 'accidentBenefits' | 'physicalDamage' | 'endorsement';
  mandatory: boolean;
  limitOptionsCents?: number[];
  deductibleOptionsCents?: number[];
  baseRateCents: number;
  flatPremium?: boolean;
}

export interface ProductDefinition {
  productCode: string;
  productName: string;
  province: string;
  version: number;
  effectiveDate: string;
  sample: true;
  coverages: CoverageDef[];
}

export interface UwReferral {
  ruleCode: string;
  description: string;
  detail: string;
}

export interface CoveragePremium {
  vehicleId: string;
  coverageCode: string;
  coverageName: string;
  annualPremiumCents: number;
}

export interface RatingResult {
  lines: CoveragePremium[];
  vehicleTotals: { vehicleId: string; annualPremiumCents: number }[];
  totalAnnualPremiumCents: number;
  referrals: UwReferral[];
}

export interface JobQuote {
  kind: 'risk' | 'cancellation';
  effectiveDate: string;
  termStart: string;
  termEnd: string;
  changeAmountCents: number;
  referrals: UwReferral[];
  quotedAt: string;
  annualPremiumCents: number;
  priorAnnualPremiumCents?: number;
  refundCents?: number;
  rating?: RatingResult;
}

export interface Job {
  id: string;
  accountId: string;
  jobType: JobType;
  status: JobStatus;
  policyId: string | null;
  productCode: string;
  billingPlan: InstallmentPlan;
  effectiveDate: string;
  termStart: string;
  termEnd: string;
  risk: RiskData;
  quote: JobQuote | null;
  uwApproved: boolean;
  uwNote: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEvent {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  actorRole: string;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface Address {
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postalCode: string;
}

export interface Account {
  id: string;
  accountNumber: string;
  accountType: 'person' | 'organization';
  name: string;
  email: string | null;
  phone: string | null;
  address: Address;
  producerCode: string | null;
  createdAt: string;
}

export interface AccountRollup {
  policyCount: number;
  inForceCount: number;
  openJobCount: number;
  annualPremiumCents: number;
  billedCents: number;
  paidCents: number;
  balanceCents: number;
  pastDueCents: number;
}

export interface Policy {
  id: string;
  accountId: string;
  policyNumber: string;
  productCode: string;
  status: 'InForce' | 'Cancelled' | 'Expired';
  billingPlan: InstallmentPlan;
}

export interface PolicySummary extends Policy {
  accountName?: string;
  accountNumber?: string;
  termStart: string | null;
  termEnd: string | null;
  annualPremiumCents: number;
  balanceCents: number;
  pastDueCents: number;
  nextDue?: { dueDate: string; amountCents: number } | null;
}

export interface PolicyVersion {
  id: string;
  versionNumber: number;
  termNumber: number;
  transactionType: string;
  effectiveDate: string;
  termStart: string;
  termEnd: string;
  annualPremiumCents: number;
  risk: RiskData;
  jobId: string;
  createdAt: string;
}

export interface LedgerTransaction {
  id: string;
  type: string;
  effectiveDate: string;
  amountCents: number;
  jobId: string;
  createdAt: string;
}

export type InvoiceStatus = 'planned' | 'due' | 'overdue' | 'paid' | 'void' | 'credit';

export interface Invoice {
  id: string;
  policyId: string;
  invoiceNumber: string;
  sequence: number;
  termNumber: number;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  status: InvoiceStatus;
}

export interface Payment {
  id: string;
  amountCents: number;
  method: 'card' | 'eft' | 'cheque' | 'cash';
  reference: string | null;
  receivedAt: string;
}

export interface PolicyBilling {
  plan: InstallmentPlan;
  billedCents: number;
  paidCents: number;
  balanceCents: number;
  pastDueCents: number;
  nextDue: { dueDate: string; amountCents: number } | null;
  invoices: Invoice[];
}

export interface WorklistItem {
  jobId: string;
  jobType: JobType;
  status: JobStatus;
  accountId: string;
  accountName: string;
  accountNumber: string;
  policyId: string | null;
  policyNumber: string | null;
  productCode: string;
  effectiveDate: string;
  annualPremiumCents: number;
  changeAmountCents: number;
  referrals: UwReferral[];
  uwApproved: boolean;
  updatedAt: string;
}

export interface Worklist {
  counts: { referred: number; awaitingBind: number; draft: number; bound: number };
  referrals: WorklistItem[];
  readyToBind: WorklistItem[];
}

export interface DemoCredential {
  role: Role;
  username: string;
  password: string;
}

// ─── Claims ─────────────────────────────────────────────────────────────────

export type ClaimStatus = 'Open' | 'Closed';
export type ClaimPaymentStatus = 'Requested' | 'Approved' | 'Issued' | 'Rejected' | 'Voided';
export type ReserveCategory = 'indemnity' | 'expense';
export type ClaimantKind = 'insured' | 'thirdParty';

export interface FraudFlag {
  ruleCode: string;
  description: string;
  detail: string;
}

export interface ClaimFinancials {
  reserveCents: number;
  paidCents: number;
  pendingCents: number;
  recoveredCents: number;
  outstandingCents: number;
  incurredCents: number;
  netIncurredCents: number;
}

export interface Claim {
  id: string;
  accountId: string;
  policyId: string;
  policyVersionId: string;
  claimNumber: string;
  status: ClaimStatus;
  lossDate: string;
  reportedDate: string;
  lossCause: string;
  description: string;
  lossLocation: string | null;
  assignedUserId: string | null;
  fraudFlags: FraudFlag[];
  createdAt: string;
  updatedAt: string;
}

export interface ClaimSummary extends Claim {
  accountName: string;
  policyNumber: string;
  assignedUserName: string | null;
  incurredCents: number;
  outstandingCents: number;
  paidCents: number;
}

export interface ClaimExposure {
  id: string;
  claimId: string;
  coverageCode: string;
  coverageName: string;
  riskItemId: string | null;
  riskItemLabel: string | null;
  claimantName: string;
  claimantKind: ClaimantKind;
  deductibleCents: number;
  status: 'Open' | 'Closed';
  financials: ClaimFinancials | null;
  createdAt: string;
}

export interface ReserveMovement {
  id: string;
  exposureId: string;
  category: ReserveCategory;
  amountCents: number;
  reason: string;
  actorUserId: string;
  createdAt: string;
}

export interface ClaimPayment {
  id: string;
  claimId: string;
  exposureId: string;
  category: ReserveCategory;
  amountCents: number;
  deductibleAppliedCents: number;
  payeeName: string;
  payeeKind: 'insured' | 'claimant' | 'vendor' | 'other';
  method: 'cheque' | 'eft';
  memo: string | null;
  status: ClaimPaymentStatus;
  requestedBy: string;
  approvedBy: string | null;
  decisionNote: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface ClaimRecovery {
  id: string;
  claimId: string;
  exposureId: string;
  recoveryType: 'subrogation' | 'salvage' | 'deductible';
  category: ReserveCategory;
  counterparty: string;
  expectedCents: number;
  receivedCents: number;
  status: 'Open' | 'Recovered' | 'Closed';
  createdAt: string;
}

export interface ClaimEvent {
  id: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  detail: string | null;
  actorUserId: string;
  actorRole: string;
  actorName: string | null;
  createdAt: string;
}

export interface ClaimNote {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string | null;
  createdAt: string;
}

export interface ClaimTask {
  id: string;
  claimId: string;
  subject: string;
  dueDate: string;
  assignedUserId: string;
  status: 'open' | 'done';
  createdAt: string;
}

export interface ClaimPage {
  claim: Claim;
  account: Account;
  policy: Policy | null;
  policyVersion: PolicyVersion | null;
  assignedUserName: string | null;
  financials: ClaimFinancials;
  exposures: ClaimExposure[];
  reserveMovements: ReserveMovement[];
  payments: ClaimPayment[];
  recoveries: ClaimRecovery[];
  tasks: ClaimTask[];
  notes: ClaimNote[];
  events: ClaimEvent[];
}

export interface LossCauseDef {
  code: string;
  name: string;
  coverageCodes: string[];
  claimantKinds: ClaimantKind[];
}

export interface CoverageAtDate {
  inForce: boolean;
  reason: string | null;
  version: PolicyVersion | null;
  lossCauses: LossCauseDef[];
}

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

export interface ClaimsUser {
  id: string;
  name: string;
  role: Role;
  authorityLimitCents: number;
}
