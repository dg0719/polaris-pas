import type { LossCauseDef, ProductDefinition } from '../types.ts';

/**
 * The slice of a policy version that coverage verification needs. The API
 * layer builds these from stored version rows; keeping the shape minimal
 * keeps this module ignorant of storage.
 */
export interface CoverageSnapshot {
  coverageCode: string;
  /** The risk item (vehicle, later dwelling) the coverage attaches to. */
  vehicleId: string;
  limitCents?: number;
  deductibleCents?: number;
}

export interface PolicyVersionSnapshot {
  id: string;
  versionNumber: number;
  /** NewBusiness, Endorsement, Renewal, Cancellation. */
  transactionType: string;
  effectiveDate: string; // ISO date
  termStart: string;
  termEnd: string;
  coverages: CoverageSnapshot[];
}

/**
 * The version whose coverage was in force on the loss date, or null.
 *
 * Rules, all on ISO date strings so plain comparison is date comparison:
 * - the loss must fall inside the version's term: termStart ≤ loss < termEnd;
 * - among versions effective at or before the loss, the latest one answers;
 * - a Cancellation version ends coverage at its effective date — it is a
 *   record that cover stopped, never a version that responds.
 */
export function coverageInForce(
  versions: PolicyVersionSnapshot[],
  lossDate: string,
): PolicyVersionSnapshot | null {
  const inEffect = versions
    .filter((v) => v.effectiveDate <= lossDate)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];

  if (!inEffect) return null;
  if (inEffect.transactionType === 'Cancellation') return null;
  if (lossDate < inEffect.termStart || lossDate >= inEffect.termEnd) return null;
  return inEffect;
}

function lossCause(product: ProductDefinition, causeCode: string): LossCauseDef | null {
  return product.lossCauses.find((c) => c.code === causeCode) ?? null;
}

/**
 * The coverages on the version that can respond to a cause of loss: the
 * intersection of what the product says responds and what the policy carries.
 */
export function respondingCoverages(
  version: PolicyVersionSnapshot,
  lossCauseCode: string,
  product: ProductDefinition,
): CoverageSnapshot[] {
  const cause = lossCause(product, lossCauseCode);
  if (!cause) return [];
  return version.coverages.filter((c) => cause.coverageCodes.includes(c.coverageCode));
}

/** The deductible carried for a coverage on a risk item; 0 when there is none. */
export function deductibleFor(
  version: PolicyVersionSnapshot,
  coverageCode: string,
  vehicleId: string,
): number {
  const coverage = version.coverages.find(
    (c) => c.coverageCode === coverageCode && c.vehicleId === vehicleId,
  );
  return coverage?.deductibleCents ?? 0;
}
