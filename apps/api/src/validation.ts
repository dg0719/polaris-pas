import {
  isInstallmentPlan,
  type CoverageSelection,
  type Driver,
  type InstallmentPlan,
  type PrimaryUse,
  type RiskData,
  type Vehicle,
} from '@polaris/domain';
import type { AccountInput } from './repo.ts';
import { isIsoDate } from './dates.ts';
import { ApiError } from './errors.ts';

/**
 * Boundary validation: everything arriving over HTTP is `unknown` until it has
 * been through here. Never trust the client to send a well-formed risk.
 */

type Obj = Record<string, unknown>;

function asObject(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw ApiError.badRequest(`${path} must be an object`);
  }
  return value as Obj;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw ApiError.badRequest(`${path} must be an array`);
  return value;
}

function str(obj: Obj, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw ApiError.badRequest(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function num(obj: Obj, key: string, path: string, min = -Infinity, max = Infinity): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw ApiError.badRequest(`${path}.${key} must be a number`);
  }
  if (value < min || value > max) {
    throw ApiError.badRequest(`${path}.${key} must be between ${min} and ${max}`);
  }
  return value;
}

function intNum(obj: Obj, key: string, path: string, min = -Infinity, max = Infinity): number {
  const value = num(obj, key, path, min, max);
  if (!Number.isInteger(value)) throw ApiError.badRequest(`${path}.${key} must be an integer`);
  return value;
}

function optInt(obj: Obj, key: string, path: string, min = 0): number | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return intNum(obj, key, path, min);
}

function isoDate(obj: Obj, key: string, path: string): string {
  const value = obj[key];
  if (!isIsoDate(value)) throw ApiError.badRequest(`${path}.${key} must be an ISO date (YYYY-MM-DD)`);
  return value;
}

const PRIMARY_USES: PrimaryUse[] = ['pleasure', 'commute', 'business'];

function parseDriver(value: unknown, index: number): Driver {
  const path = `drivers[${index}]`;
  const obj = asObject(value, path);
  return {
    id: str(obj, 'id', path),
    firstName: str(obj, 'firstName', path),
    lastName: str(obj, 'lastName', path),
    dateOfBirth: isoDate(obj, 'dateOfBirth', path),
    licenceNumber: str(obj, 'licenceNumber', path),
    yearsLicensed: num(obj, 'yearsLicensed', path, 0, 80),
    atFaultClaims: intNum(obj, 'atFaultClaims', path, 0, 20),
    minorConvictions: intNum(obj, 'minorConvictions', path, 0, 20),
  };
}

function parseVehicle(value: unknown, index: number): Vehicle {
  const path = `vehicles[${index}]`;
  const obj = asObject(value, path);
  const primaryUse = obj['primaryUse'];
  if (typeof primaryUse !== 'string' || !PRIMARY_USES.includes(primaryUse as PrimaryUse)) {
    throw ApiError.badRequest(`${path}.primaryUse must be one of ${PRIMARY_USES.join(', ')}`);
  }
  return {
    id: str(obj, 'id', path),
    year: intNum(obj, 'year', path, 1900, 2100),
    make: str(obj, 'make', path),
    model: str(obj, 'model', path),
    vin: str(obj, 'vin', path),
    valueCents: intNum(obj, 'valueCents', path, 0),
    rateGroup: intNum(obj, 'rateGroup', path, 1, 20),
    primaryUse: primaryUse as PrimaryUse,
    annualKm: intNum(obj, 'annualKm', path, 0, 500_000),
    postalCode: str(obj, 'postalCode', path),
    principalDriverId: str(obj, 'principalDriverId', path),
  };
}

function parseCoverage(value: unknown, index: number): CoverageSelection {
  const path = `coverages[${index}]`;
  const obj = asObject(value, path);
  const selection: CoverageSelection = {
    vehicleId: str(obj, 'vehicleId', path),
    coverageCode: str(obj, 'coverageCode', path),
  };
  const limitCents = optInt(obj, 'limitCents', path);
  if (limitCents !== undefined) selection.limitCents = limitCents;
  const deductibleCents = optInt(obj, 'deductibleCents', path);
  if (deductibleCents !== undefined) selection.deductibleCents = deductibleCents;
  return selection;
}

function assertUnique(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw ApiError.badRequest(`Duplicate ${label} id ${id}`);
    seen.add(id);
  }
}

/** Parse and cross-validate a risk payload. Throws ApiError(400) on any problem. */
export function parseRiskData(value: unknown): RiskData {
  const obj = asObject(value, 'risk');
  const drivers = asArray(obj['drivers'], 'risk.drivers').map(parseDriver);
  const vehicles = asArray(obj['vehicles'], 'risk.vehicles').map(parseVehicle);
  const coverages = asArray(obj['coverages'], 'risk.coverages').map(parseCoverage);
  const termMonths = intNum(obj, 'termMonths', 'risk', 1, 36);

  if (drivers.length === 0) throw ApiError.badRequest('At least one driver is required');
  if (vehicles.length === 0) throw ApiError.badRequest('At least one vehicle is required');
  assertUnique(drivers.map((d) => d.id), 'driver');
  assertUnique(vehicles.map((v) => v.id), 'vehicle');

  const driverIds = new Set(drivers.map((d) => d.id));
  for (const vehicle of vehicles) {
    if (!driverIds.has(vehicle.principalDriverId)) {
      throw ApiError.badRequest(
        `Vehicle ${vehicle.id} references unknown principal driver ${vehicle.principalDriverId}`,
      );
    }
  }

  const vehicleIds = new Set(vehicles.map((v) => v.id));
  for (const coverage of coverages) {
    if (!vehicleIds.has(coverage.vehicleId)) {
      throw ApiError.badRequest(
        `Coverage ${coverage.coverageCode} references unknown vehicle ${coverage.vehicleId}`,
      );
    }
  }

  return { drivers, vehicles, coverages, termMonths };
}

export function requireIsoDate(value: unknown, field: string): string {
  if (!isIsoDate(value)) throw ApiError.badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw ApiError.badRequest(`${field} must be a non-empty string`);
  }
  return value;
}

// ─── Accounts, plans and payments ───────────────────────────────────────────

const PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'];
const POSTAL_CODE = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

function optStr(obj: Obj, key: string, path: string): string | null {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw ApiError.badRequest(`${path}.${key} must be a string`);
  return value;
}

export function parseAccountInput(value: unknown): AccountInput {
  const obj = asObject(value, 'account');
  const accountType = obj['accountType'];
  if (accountType !== 'person' && accountType !== 'organization') {
    throw ApiError.badRequest("account.accountType must be 'person' or 'organization'");
  }
  const province = str(obj, 'province', 'account').toUpperCase();
  if (!PROVINCES.includes(province)) {
    throw ApiError.badRequest(`account.province must be a Canadian province or territory code`);
  }
  const postalCode = str(obj, 'postalCode', 'account').toUpperCase();
  if (!POSTAL_CODE.test(postalCode)) {
    throw ApiError.badRequest('account.postalCode must look like K1A 0A1');
  }
  const email = optStr(obj, 'email', 'account');
  if (email !== null && !email.includes('@')) {
    throw ApiError.badRequest('account.email must be an email address');
  }
  return {
    account_type: accountType,
    name: str(obj, 'name', 'account'),
    email,
    phone: optStr(obj, 'phone', 'account'),
    address_line1: str(obj, 'addressLine1', 'account'),
    address_line2: optStr(obj, 'addressLine2', 'account'),
    city: str(obj, 'city', 'account'),
    province,
    postal_code: postalCode,
    producer_code: optStr(obj, 'producerCode', 'account'),
  };
}

export function requireInstallmentPlan(value: unknown, field: string): InstallmentPlan {
  if (!isInstallmentPlan(value)) {
    throw ApiError.badRequest(`${field} must be one of full, monthly, quarterly`);
  }
  return value;
}

const PAYMENT_METHODS = ['card', 'eft', 'cheque', 'cash'];

export function parsePaymentInput(value: unknown): {
  amountCents: number;
  method: 'card' | 'eft' | 'cheque' | 'cash';
  reference?: string;
  receivedAt: string;
} {
  const obj = asObject(value, 'payment');
  const method = obj['method'];
  if (typeof method !== 'string' || !PAYMENT_METHODS.includes(method)) {
    throw ApiError.badRequest(`payment.method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  const reference = optStr(obj, 'reference', 'payment');
  return {
    amountCents: intNum(obj, 'amountCents', 'payment', 1),
    method: method as 'card' | 'eft' | 'cheque' | 'cash',
    ...(reference ? { reference } : {}),
    receivedAt: isoDate(obj, 'receivedAt', 'payment'),
  };
}

// ─── Claims validators ──────────────────────────────────────────────────────

/** A whole (possibly negative) number of cents, e.g. a reserve movement. */
export function requireCentsDelta(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw ApiError.badRequest(`${field} must be a whole number of cents`);
  }
  return value;
}

/** A strictly positive whole number of cents. */
export function requirePositiveCents(value: unknown, field: string): number {
  const cents = requireCentsDelta(value, field);
  if (cents <= 0) throw ApiError.badRequest(`${field} must be greater than zero`);
  return cents;
}

export function requireOneOf<T extends string>(
  value: unknown,
  field: string,
  options: readonly T[],
): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw ApiError.badRequest(`${field} must be one of: ${options.join(', ')}`);
  }
  return value as T;
}
