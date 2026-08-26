import type { ProductDefinition } from './types.ts';

/**
 * Ontario Personal Auto product definition.
 *
 * Coverage structure follows the standard Ontario auto policy (OAP 1) coverage
 * categories and standard OPCF endorsement numbers, which are public regulatory
 * facts. All rates and factors are ILLUSTRATIVE SAMPLES ONLY — not filed rates.
 */
export const ontarioAutoV1: ProductDefinition = {
  productCode: 'ON_PA',
  productName: 'Ontario Personal Automobile',
  province: 'ON',
  version: 1,
  effectiveDate: '2026-01-01',
  sample: true,
  coverages: [
    {
      code: 'LIAB',
      name: 'Third Party Liability',
      kind: 'liability',
      mandatory: true,
      limitOptionsCents: [100000000, 200000000], // $1M, $2M
      baseRateCents: 62000,
    },
    {
      code: 'AB',
      name: 'Accident Benefits (Standard)',
      kind: 'accidentBenefits',
      mandatory: true,
      baseRateCents: 38000,
    },
    {
      code: 'DCPD',
      name: 'Direct Compensation – Property Damage',
      kind: 'liability',
      mandatory: true,
      baseRateCents: 21000,
    },
    {
      code: 'UA',
      name: 'Uninsured Automobile',
      kind: 'liability',
      mandatory: true,
      baseRateCents: 3200,
    },
    {
      code: 'COLL',
      name: 'Collision or Upset',
      kind: 'physicalDamage',
      mandatory: false,
      deductibleOptionsCents: [50000, 100000, 200000],
      baseRateCents: 34000,
    },
    {
      code: 'COMP',
      name: 'Comprehensive',
      kind: 'physicalDamage',
      mandatory: false,
      deductibleOptionsCents: [50000, 100000, 200000],
      baseRateCents: 18000,
    },
    {
      code: 'OPCF20',
      name: 'OPCF 20 — Coverage for Transportation Replacement',
      kind: 'endorsement',
      mandatory: false,
      baseRateCents: 6500,
      flatPremium: true,
    },
    {
      code: 'OPCF27',
      name: 'OPCF 27 — Liability for Damage to Non-Owned Automobiles',
      kind: 'endorsement',
      mandatory: false,
      baseRateCents: 5000,
      flatPremium: true,
    },
    {
      code: 'OPCF43',
      name: 'OPCF 43 — Removing Depreciation Deduction',
      kind: 'endorsement',
      mandatory: false,
      baseRateCents: 9000,
      flatPremium: true,
    },
    {
      code: 'OPCF44R',
      name: 'OPCF 44R — Family Protection Coverage',
      kind: 'endorsement',
      mandatory: false,
      baseRateCents: 4200,
      flatPremium: true,
    },
  ],
  rateTables: {
    // First letter of garaging postal code → territory factor (sample values)
    territoryByFsaLetter: {
      M: 1.35, // Toronto
      L: 1.2, // GTA belt
      K: 1.0, // Eastern ON
      N: 0.95, // Southwestern ON
      P: 0.9, // Northern ON
      DEFAULT: 1.05,
    },
    // Principal driver class band → factor
    driverClass: {
      'yl<3': 1.6, // licensed under 3 years
      'yl<6': 1.25,
      'yl<10': 1.05,
      'yl>=10': 0.95,
    },
    // Driving record band → factor
    drivingRecord: {
      clean: 0.9, // 0 at-fault, 0 convictions
      minor: 1.1, // convictions only
      claims1: 1.35, // 1 at-fault claim
      claims2plus: 1.85, // 2+ at-fault claims
    },
    // Vehicle rate group (1..20) → factor
    rateGroup: {
      '1': 0.7, '2': 0.75, '3': 0.8, '4': 0.85, '5': 0.9,
      '6': 0.95, '7': 1.0, '8': 1.05, '9': 1.1, '10': 1.18,
      '11': 1.26, '12': 1.34, '13': 1.42, '14': 1.5, '15': 1.6,
      '16': 1.72, '17': 1.85, '18': 2.0, '19': 2.2, '20': 2.45,
    },
    // Liability limit → factor (keyed by cents)
    limitFactor: {
      '100000000': 1.0,
      '200000000': 1.12,
    },
    // Deductible → factor (keyed by cents)
    deductibleFactor: {
      '50000': 1.15,
      '100000': 1.0,
      '200000': 0.88,
    },
  },
  uwRules: [
    {
      code: 'UW-CLAIMS',
      description: 'Driver has 2 or more at-fault claims in the last 6 years',
      subject: 'driver',
      field: 'atFaultClaims',
      op: 'gte',
      value: 2,
      unit: 'count',
      valueLabel: 'at-fault claims in the last 6 years',
    },
    {
      code: 'UW-NEWDRIVER',
      description: 'Driver licensed for less than 1 year',
      subject: 'driver',
      field: 'yearsLicensed',
      op: 'lt',
      value: 1,
      unit: 'count',
      valueLabel: 'years licensed',
    },
    {
      code: 'UW-HIGHVALUE',
      description: 'Vehicle value exceeds $150,000',
      subject: 'vehicle',
      field: 'valueCents',
      op: 'gt',
      value: 15000000,
      unit: 'money',
    },
  ],
  // Causes of loss and the coverages that can respond to each. Order within
  // coverageCodes is the order exposures are offered at first notice of loss.
  lossCauses: [
    {
      code: 'COLLISION',
      name: 'Collision',
      coverageCodes: ['COLL', 'DCPD', 'LIAB', 'AB'],
      claimantKinds: ['insured', 'thirdParty'],
    },
    {
      code: 'THEFT',
      name: 'Theft',
      coverageCodes: ['COMP'],
      claimantKinds: ['insured'],
    },
    {
      code: 'FIRE',
      name: 'Fire',
      coverageCodes: ['COMP'],
      claimantKinds: ['insured'],
    },
    {
      code: 'HAIL',
      name: 'Hail or windstorm',
      coverageCodes: ['COMP'],
      claimantKinds: ['insured'],
    },
    {
      code: 'VANDALISM',
      name: 'Vandalism',
      coverageCodes: ['COMP'],
      claimantKinds: ['insured'],
    },
    {
      code: 'GLASS',
      name: 'Glass breakage',
      coverageCodes: ['COMP'],
      claimantKinds: ['insured'],
    },
    {
      code: 'BODILY_INJURY',
      name: 'Bodily injury',
      coverageCodes: ['AB', 'LIAB'],
      claimantKinds: ['insured', 'thirdParty'],
    },
    {
      code: 'UNINSURED',
      name: 'Uninsured or unidentified motorist',
      coverageCodes: ['UA'],
      claimantKinds: ['insured'],
    },
  ],
  // Fraud indicators evaluated at first notice of loss. Indicators only:
  // they ask an adjuster to look, they decide nothing.
  fraudRules: [
    {
      code: 'FR-LATE',
      description: 'Loss reported more than 30 days after it happened',
      field: 'daysToReport',
      op: 'gt',
      value: 30,
      valueLabel: 'days after the loss',
    },
    {
      code: 'FR-NEWPOLICY',
      description: 'Loss within 14 days of the term starting',
      field: 'daysSinceInception',
      op: 'lt',
      value: 14,
      valueLabel: 'days after inception',
    },
    {
      code: 'FR-POSTCANCEL',
      description: 'Loss date falls after the policy was cancelled',
      field: 'daysSinceCancellation',
      op: 'gte',
      value: 0,
      valueLabel: 'days after cancellation',
    },
    {
      code: 'FR-HISTORY',
      description: 'Drivers of record carry 3 or more prior at-fault claims',
      field: 'priorAtFaultClaims',
      op: 'gte',
      value: 3,
      valueLabel: 'prior at-fault claims',
    },
  ],
};
