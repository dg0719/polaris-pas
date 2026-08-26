// ─── Claims domain types (pure, dependency-free) ─────────────────────────────

export type ClaimStatus = 'Open' | 'Closed';

export type ExposureStatus = 'Open' | 'Closed';

export type ClaimPaymentStatus = 'Requested' | 'Approved' | 'Issued' | 'Rejected' | 'Voided';

export type RecoveryStatus = 'Open' | 'Recovered' | 'Closed';

/** Indemnity is money paid on the loss itself; expense is the cost of handling it. */
export type ReserveCategory = 'indemnity' | 'expense';

export type ClaimantKind = 'insured' | 'thirdParty';

export type PayeeKind = 'insured' | 'claimant' | 'vendor' | 'other';

export type RecoveryType = 'subrogation' | 'salvage' | 'deductible';

export type ClaimPaymentMethod = 'cheque' | 'eft';

// ─── Ledger inputs ───────────────────────────────────────────────────────────

/**
 * A single, immutable movement of a reserve. Never edited: the current reserve
 * is the sum of its movements, which is what makes the history an audit trail
 * rather than a series of overwrites.
 */
export interface ReserveMovement {
  exposureId: string;
  category: ReserveCategory;
  /** Signed delta in cents. Negative movements reduce the reserve. */
  amountCents: number;
}

export interface ClaimPaymentRecord {
  exposureId: string;
  category: ReserveCategory;
  amountCents: number;
  status: ClaimPaymentStatus;
}

export interface RecoveryRecord {
  exposureId: string;
  category: ReserveCategory;
  receivedCents: number;
  status: RecoveryStatus;
}

/** Everything the financial arithmetic needs, and nothing else. */
export interface ClaimLedger {
  movements: ReserveMovement[];
  payments: ClaimPaymentRecord[];
  recoveries: RecoveryRecord[];
}

export interface Financials {
  /** Sum of reserve movements. */
  reserveCents: number;
  /** Money actually out the door. */
  paidCents: number;
  /** Requested or approved, but not yet issued. */
  pendingCents: number;
  recoveredCents: number;
  /** Reserve not yet spent. */
  outstandingCents: number;
  /** What the claim is expected to cost in total. */
  incurredCents: number;
  /** Incurred, less what has been recovered from someone else. */
  netIncurredCents: number;
}

// ─── Fraud indicators ────────────────────────────────────────────────────────

/** Shaped like `UwReferral`, and read the same way by a human. */
export interface FraudFlag {
  ruleCode: string;
  description: string;
  detail: string;
}

/**
 * The facts a fraud rule can be written against. Derived once at first notice
 * of loss so the rules stay pure comparisons rather than date arithmetic.
 */
export interface FraudSubject {
  /** Days between the loss and it being reported. */
  daysToReport: number;
  /** Days between the term starting and the loss. */
  daysSinceInception: number;
  /** Days between the policy being cancelled and the loss; -1 if not cancelled. */
  daysSinceCancellation: number;
  /** At-fault claims already on the drivers of record. */
  priorAtFaultClaims: number;
}
