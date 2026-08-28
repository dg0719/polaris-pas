import type { ClaimantKind, FraudSubject } from './claims/types.ts';

// ─── Core domain types (pure, dependency-free) ───────────────────────────────

export type Role =
  | 'csr'
  | 'underwriter'
  | 'adjuster'
  | 'claims_supervisor'
  | 'admin';

export type JobType = 'Submission' | 'PolicyChange' | 'Renewal' | 'Cancellation';

export type JobStatus =
  | 'Draft'
  | 'Quoted'
  | 'Bound'
  | 'Issued'
  | 'Declined'
  | 'Withdrawn';

export type PolicyStatus = 'InForce' | 'Cancelled' | 'Expired';

export type PrimaryUse = 'pleasure' | 'commute' | 'business';

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date
  licenceNumber: string;
  yearsLicensed: number;
  atFaultClaims: number; // last 6 years
  minorConvictions: number; // last 3 years
}

export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  valueCents: number;
  rateGroup: number; // 1..20
  primaryUse: PrimaryUse;
  annualKm: number;
  postalCode: string; // garaging location, drives territory
  principalDriverId: string;
}

export interface CoverageSelection {
  vehicleId: string;
  coverageCode: string;
  limitCents?: number; // for liability-style coverages
  deductibleCents?: number; // for physical damage coverages
}

/** Working data carried on a job while drafting; snapshotted on issue. */
export interface RiskData {
  drivers: Driver[];
  vehicles: Vehicle[];
  coverages: CoverageSelection[];
  termMonths: number; // 12 for annual
}

// ─── Product model (configuration as data) ──────────────────────────────────

export type CoverageKind = 'liability' | 'accidentBenefits' | 'physicalDamage' | 'endorsement';

export interface CoverageDef {
  code: string;
  name: string;
  kind: CoverageKind;
  mandatory: boolean;
  /** Available limit options in cents (liability-style). */
  limitOptionsCents?: number[];
  /** Available deductible options in cents (physical damage). */
  deductibleOptionsCents?: number[];
  /** Annual base rate in cents (before factors). */
  baseRateCents: number;
  /** Endorsements can be flat-premium instead of factored. */
  flatPremium?: boolean;
}

export interface FactorTable {
  /** e.g. territory code, driver class band, rate group → multiplier */
  [key: string]: number;
}

/**
 * A cause of loss the product recognises, and the coverages that can respond
 * to it. Claims reads this instead of hard-coding which coverage pays for what,
 * so a new product brings its own causes without touching the claims engine.
 */
export interface LossCauseDef {
  code: string;
  name: string;
  /** Coverage codes that may respond. Order is the order exposures are offered. */
  coverageCodes: string[];
  /** Who can claim under this cause. */
  claimantKinds: ClaimantKind[];
}

/**
 * A fraud indicator, evaluated at first notice of loss. Same rule-as-data shape
 * as `UwRule`, against the derived facts in `FraudSubject`.
 */
export interface FraudRuleDef {
  code: string;
  description: string;
  field: keyof FraudSubject;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
  /** Noun for the value, e.g. "days after the loss". */
  valueLabel?: string;
}

export interface UwRule {
  code: string;
  description: string;
  /** JSON-logic-lite: field path on evaluated subject */
  subject: 'driver' | 'vehicle';
  field: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
  /** How to render the value an underwriter reads on the referral. */
  unit?: 'money' | 'count';
  /** Noun for a counted value, e.g. "at-fault claims". Ignored for money. */
  valueLabel?: string;
}

export interface ProductDefinition {
  productCode: string;
  productName: string;
  province: string;
  version: number;
  effectiveDate: string;
  /** Illustrative factors only — not filed rates. */
  sample: true;
  coverages: CoverageDef[];
  rateTables: {
    territoryByFsaLetter: FactorTable; // first letter of postal code → factor
    driverClass: FactorTable; // band key → factor
    drivingRecord: FactorTable; // record band → factor
    rateGroup: FactorTable; // vehicle rate group → factor
    limitFactor: FactorTable; // liability limit (cents as string) → factor
    deductibleFactor: FactorTable; // deductible (cents as string) → factor
  };
  uwRules: UwRule[];
  /** Causes of loss and the coverages that respond to each. */
  lossCauses: LossCauseDef[];
  /** Fraud indicators evaluated at first notice of loss. */
  fraudRules: FraudRuleDef[];
  /** How this product is billed: which pattern its premium uses, its tax line, and which fees may be charged. */
  billing: { premiumPatternCode: string; line: string; defaultPaymentPlan: string; allowedFeePatterns: string[] };
}

// ─── Quote result ────────────────────────────────────────────────────────────

export interface CoveragePremium {
  vehicleId: string;
  coverageCode: string;
  coverageName: string;
  annualPremiumCents: number;
}

export interface QuoteResult {
  lines: CoveragePremium[];
  vehicleTotals: { vehicleId: string; annualPremiumCents: number }[];
  totalAnnualPremiumCents: number;
  referrals: UwReferral[];
}

export interface UwReferral {
  ruleCode: string;
  description: string;
  detail: string;
}
