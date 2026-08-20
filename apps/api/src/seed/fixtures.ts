import type { CoverageSelection, Driver, RiskData, Vehicle } from '@polaris/domain';
import type { AccountInput } from '../repo.ts';

/** Demo fixtures. Names, VINs and licence numbers are invented. */

export function driver(input: {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  yearsLicensed: number;
  atFaultClaims?: number;
  minorConvictions?: number;
}): Driver {
  return {
    id: input.id,
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    licenceNumber: `${input.lastName[0]!.toUpperCase()}${input.id.toUpperCase()}-4821-63095`,
    yearsLicensed: input.yearsLicensed,
    atFaultClaims: input.atFaultClaims ?? 0,
    minorConvictions: input.minorConvictions ?? 0,
  };
}

export function vehicle(input: {
  id: string;
  year: number;
  make: string;
  model: string;
  valueCents: number;
  rateGroup: number;
  postalCode: string;
  principalDriverId: string;
  primaryUse?: Vehicle['primaryUse'];
  annualKm?: number;
}): Vehicle {
  return {
    id: input.id,
    year: input.year,
    make: input.make,
    model: input.model,
    vin: `2${input.make.slice(0, 2).toUpperCase()}${input.year}${input.id.toUpperCase()}4471835`,
    valueCents: input.valueCents,
    rateGroup: input.rateGroup,
    primaryUse: input.primaryUse ?? 'commute',
    annualKm: input.annualKm ?? 16_000,
    postalCode: input.postalCode,
    principalDriverId: input.principalDriverId,
  };
}

export interface CoverageOptions {
  limitCents?: number;
  physicalDamage?: boolean;
  deductibleCents?: number;
  endorsements?: string[];
}

export function coverages(vehicleId: string, options: CoverageOptions = {}): CoverageSelection[] {
  const limitCents = options.limitCents ?? 100_000_000;
  const deductibleCents = options.deductibleCents ?? 100_000;
  const selections: CoverageSelection[] = [
    { vehicleId, coverageCode: 'LIAB', limitCents },
    { vehicleId, coverageCode: 'AB' },
    { vehicleId, coverageCode: 'DCPD' },
    { vehicleId, coverageCode: 'UA' },
  ];
  if (options.physicalDamage !== false) {
    selections.push({ vehicleId, coverageCode: 'COLL', deductibleCents });
    selections.push({ vehicleId, coverageCode: 'COMP', deductibleCents });
  }
  for (const code of options.endorsements ?? []) {
    selections.push({ vehicleId, coverageCode: code });
  }
  return selections;
}

export function risk(drivers: Driver[], vehicles: Vehicle[], selections: CoverageSelection[]): RiskData {
  return { termMonths: 12, drivers, vehicles, coverages: selections };
}

export function account(input: {
  name: string;
  accountType?: AccountInput['account_type'];
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  producerCode?: string;
}): AccountInput {
  return {
    account_type: input.accountType ?? 'person',
    name: input.name,
    email: input.email,
    phone: input.phone,
    address_line1: input.addressLine1,
    address_line2: null,
    city: input.city,
    province: 'ON',
    postal_code: input.postalCode,
    producer_code: input.producerCode ?? 'BRK-2201',
  };
}
