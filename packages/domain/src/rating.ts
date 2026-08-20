import type {
  CoverageDef,
  CoveragePremium,
  CoverageSelection,
  Driver,
  ProductDefinition,
  QuoteResult,
  RiskData,
  Vehicle,
} from './types.ts';
import { evaluateUwRules } from './uwRules.ts';

/** All money in integer cents. Factors multiply; round once per coverage line. */

function territoryFactor(product: ProductDefinition, vehicle: Vehicle): number {
  const letter = (vehicle.postalCode || '').trim().charAt(0).toUpperCase();
  const table = product.rateTables.territoryByFsaLetter;
  return table[letter] ?? table['DEFAULT'] ?? 1.0;
}

function driverClassFactor(product: ProductDefinition, driver: Driver): number {
  const yl = driver.yearsLicensed;
  const t = product.rateTables.driverClass;
  if (yl < 3) return t['yl<3'];
  if (yl < 6) return t['yl<6'];
  if (yl < 10) return t['yl<10'];
  return t['yl>=10'];
}

function drivingRecordFactor(product: ProductDefinition, driver: Driver): number {
  const t = product.rateTables.drivingRecord;
  if (driver.atFaultClaims >= 2) return t['claims2plus'];
  if (driver.atFaultClaims === 1) return t['claims1'];
  if (driver.minorConvictions > 0) return t['minor'];
  return t['clean'];
}

function rateGroupFactor(product: ProductDefinition, vehicle: Vehicle): number {
  const rg = Math.min(20, Math.max(1, Math.round(vehicle.rateGroup)));
  return product.rateTables.rateGroup[String(rg)] ?? 1.0;
}

export class RatingError extends Error {}

/**
 * A limit or deductible the product does not offer must never be rated. Left
 * unchecked, an unlisted value falls through to a factor of 1.0 and the risk is
 * silently underpriced.
 */
function assertSelectionIsOffered(def: CoverageDef, sel: CoverageSelection): void {
  if (def.limitOptionsCents) {
    if (sel.limitCents == null) {
      throw new RatingError(`Coverage ${def.code} requires a limit`);
    }
    if (!def.limitOptionsCents.includes(sel.limitCents)) {
      throw new RatingError(
        `Limit ${sel.limitCents} is not offered for ${def.code} ` +
          `(available: ${def.limitOptionsCents.join(', ')})`,
      );
    }
  }
  if (def.deductibleOptionsCents) {
    if (sel.deductibleCents == null) {
      throw new RatingError(`Coverage ${def.code} requires a deductible`);
    }
    if (!def.deductibleOptionsCents.includes(sel.deductibleCents)) {
      throw new RatingError(
        `Deductible ${sel.deductibleCents} is not offered for ${def.code} ` +
          `(available: ${def.deductibleOptionsCents.join(', ')})`,
      );
    }
  }
}

/**
 * Rate a full risk. Pure function: (product, risk) → quote.
 * Throws RatingError on structurally invalid input (unknown coverage,
 * missing principal driver, missing mandatory coverage).
 */
export function rateRisk(product: ProductDefinition, risk: RiskData): QuoteResult {
  if (risk.vehicles.length === 0) throw new RatingError('At least one vehicle is required');
  if (risk.drivers.length === 0) throw new RatingError('At least one driver is required');

  const coverageDefs = new Map(product.coverages.map((c) => [c.code, c]));
  const driversById = new Map(risk.drivers.map((d) => [d.id, d]));

  // Mandatory coverages must be present on every vehicle
  for (const vehicle of risk.vehicles) {
    for (const def of product.coverages.filter((c) => c.mandatory)) {
      const present = risk.coverages.some(
        (s) => s.vehicleId === vehicle.id && s.coverageCode === def.code,
      );
      if (!present) {
        throw new RatingError(
          `Mandatory coverage ${def.code} missing on vehicle ${vehicle.id}`,
        );
      }
    }
  }

  const lines: CoveragePremium[] = [];

  for (const sel of risk.coverages) {
    const def = coverageDefs.get(sel.coverageCode);
    if (!def) throw new RatingError(`Unknown coverage code ${sel.coverageCode}`);
    const vehicle = risk.vehicles.find((v) => v.id === sel.vehicleId);
    if (!vehicle) throw new RatingError(`Coverage ${sel.coverageCode} references unknown vehicle`);
    const principal = driversById.get(vehicle.principalDriverId);
    if (!principal) throw new RatingError(`Vehicle ${vehicle.id} has no principal driver`);

    assertSelectionIsOffered(def, sel);

    let premiumCents: number;
    if (def.flatPremium) {
      premiumCents = def.baseRateCents;
    } else {
      let factor =
        territoryFactor(product, vehicle) *
        driverClassFactor(product, principal) *
        drivingRecordFactor(product, principal) *
        rateGroupFactor(product, vehicle);

      if (def.limitOptionsCents) {
        factor *= product.rateTables.limitFactor[String(sel.limitCents)]!;
      }
      if (def.deductibleOptionsCents) {
        factor *= product.rateTables.deductibleFactor[String(sel.deductibleCents)]!;
      }
      premiumCents = Math.round(def.baseRateCents * factor);
    }

    lines.push({
      vehicleId: vehicle.id,
      coverageCode: def.code,
      coverageName: def.name,
      annualPremiumCents: premiumCents,
    });
  }

  const vehicleTotals = risk.vehicles.map((v) => ({
    vehicleId: v.id,
    annualPremiumCents: lines
      .filter((l) => l.vehicleId === v.id)
      .reduce((sum, l) => sum + l.annualPremiumCents, 0),
  }));

  const totalAnnualPremiumCents = vehicleTotals.reduce(
    (sum, v) => sum + v.annualPremiumCents,
    0,
  );

  return {
    lines,
    vehicleTotals,
    totalAnnualPremiumCents,
    referrals: evaluateUwRules(product, risk),
  };
}
