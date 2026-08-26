import type { PolicyVersionSnapshot, RiskData } from '@polaris/domain';
import type { PolicyVersionRow } from '../repo.ts';

/**
 * Project a stored policy version row into the pure snapshot shape the claims
 * domain reasons about. The version's risk_json already carries the coverages
 * exactly as they were issued, which is the whole point of immutable versions.
 */
export function versionSnapshot(row: PolicyVersionRow): PolicyVersionSnapshot {
  const risk = JSON.parse(row.risk_json) as RiskData;
  return {
    id: row.id,
    versionNumber: row.version_number,
    transactionType: row.transaction_type,
    effectiveDate: row.effective_date,
    termStart: row.term_start,
    termEnd: row.term_end,
    coverages: risk.coverages.map((c) => ({
      coverageCode: c.coverageCode,
      vehicleId: c.vehicleId,
      limitCents: c.limitCents,
      deductibleCents: c.deductibleCents,
    })),
  };
}

/** "2023 Honda Civic", or the raw id when the vehicle is not on the version. */
export function riskItemLabel(row: PolicyVersionRow, vehicleId: string | null): string | null {
  if (!vehicleId) return null;
  const risk = JSON.parse(row.risk_json) as RiskData;
  const vehicle = risk.vehicles.find((v) => v.id === vehicleId);
  return vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : vehicleId;
}

/** Total at-fault claims across the drivers of record on the version. */
export function priorAtFaultClaims(row: PolicyVersionRow): number {
  const risk = JSON.parse(row.risk_json) as RiskData;
  return risk.drivers.reduce((sum, d) => sum + d.atFaultClaims, 0);
}
