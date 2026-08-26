import {
  coverageInForce,
  daysBetween,
  deductibleFor,
  evaluateFraudRules,
  respondingCoverages,
  type ClaimantKind,
  type FraudSubject,
} from '@polaris/domain';
import type { Db } from '../db.ts';
import { inTransaction } from '../db.ts';
import { ApiError } from '../errors.ts';
import { getProduct } from '../products.ts';
import * as repo from '../repo.ts';
import type { ClaimExposureRow, ClaimRow, PolicyVersionRow, TenantCtx } from '../repo.ts';
import { priorAtFaultClaims, riskItemLabel, versionSnapshot } from './snapshot.ts';

/**
 * First notice of loss. The claim is opened against the policy version whose
 * coverage was in force on the loss date — resolved here, once, and pinned to
 * the claim so later questions have one answer.
 */

export interface FnolExposureInput {
  coverageCode: string;
  riskItemId?: string;
  claimantName?: string;
  claimantKind?: ClaimantKind;
}

export interface FnolInput {
  policyId: string;
  lossDate: string;
  reportedDate: string;
  lossCause: string;
  description: string;
  lossLocation?: string;
  /** Chosen exposures; when absent, one per responding coverage is seeded. */
  exposures?: FnolExposureInput[];
}

export interface CoverageAtDate {
  inForce: boolean;
  reason: string | null;
  version: PolicyVersionRow | null;
}

/** The version answering for a loss date, with a human reason when none does. */
export function coverageAtDate(
  db: Db,
  ctx: TenantCtx,
  policyId: string,
  lossDate: string,
): CoverageAtDate {
  const versions = repo.listPolicyVersions(db, ctx, policyId);
  if (versions.length === 0) {
    return { inForce: false, reason: 'This policy has no issued versions', version: null };
  }
  const snapshot = coverageInForce(versions.map(versionSnapshot), lossDate);
  if (!snapshot) {
    return {
      inForce: false,
      reason:
        `No coverage was in force on ${lossDate}: the policy term does not include that date, ` +
        'or the policy was cancelled before it',
      version: null,
    };
  }
  return {
    inForce: true,
    reason: null,
    version: versions.find((v) => v.id === snapshot.id) ?? null,
  };
}

function fraudSubject(
  db: Db,
  ctx: TenantCtx,
  policyId: string,
  version: PolicyVersionRow,
  input: { lossDate: string; reportedDate: string },
): FraudSubject {
  // A cancellation version marks the date cover stopped; a claim reported
  // after that date, for a loss before it, is worth a second look.
  const cancellation = repo
    .listPolicyVersions(db, ctx, policyId)
    .find((v) => v.transaction_type === 'Cancellation');
  const daysSinceCancellation =
    cancellation && cancellation.effective_date <= input.reportedDate
      ? daysBetween(cancellation.effective_date, input.reportedDate)
      : -1;

  return {
    daysToReport: daysBetween(input.lossDate, input.reportedDate),
    daysSinceInception: daysBetween(version.term_start, input.lossDate),
    daysSinceCancellation,
    priorAtFaultClaims: priorAtFaultClaims(version),
  };
}

export interface FnolResult {
  claim: ClaimRow;
  exposures: ClaimExposureRow[];
}

export function reportClaim(db: Db, ctx: TenantCtx, input: FnolInput): FnolResult {
  return inTransaction(db, () => {
    const policy = repo.getPolicy(db, ctx, input.policyId);
    if (!policy) throw ApiError.notFound(`Policy ${input.policyId} not found`);
    if (input.reportedDate < input.lossDate) {
      throw ApiError.badRequest('The reported date cannot be before the loss date');
    }

    const cover = coverageAtDate(db, ctx, policy.id, input.lossDate);
    if (!cover.inForce || !cover.version) {
      throw ApiError.conflict(cover.reason ?? 'No coverage in force', 'no_coverage_in_force');
    }
    const version = cover.version;
    const snapshot = versionSnapshot(version);

    const product = getProduct(policy.product_code);
    const cause = product.lossCauses.find((c) => c.code === input.lossCause);
    if (!cause) {
      throw ApiError.badRequest(`Unknown loss cause ${input.lossCause}`, 'unknown_loss_cause');
    }

    const responding = respondingCoverages(snapshot, cause.code, product);
    if (responding.length === 0) {
      throw ApiError.conflict(
        `No coverage on this policy responds to ${cause.name.toLowerCase()}`,
        'no_responding_coverage',
      );
    }

    const account = repo.getAccount(db, ctx, policy.account_id);
    const flags = evaluateFraudRules(fraudSubject(db, ctx, policy.id, version, input), product);

    const claim = repo.insertClaim(db, ctx, {
      account_id: policy.account_id,
      policy_id: policy.id,
      policy_version_id: version.id,
      claim_number: repo.nextClaimNumber(db, ctx.tenantId),
      status: 'Open',
      loss_date: input.lossDate,
      reported_date: input.reportedDate,
      loss_cause: cause.code,
      description: input.description,
      loss_location: input.lossLocation ?? null,
      assigned_user_id: null,
      fraud_flags_json: JSON.stringify(flags),
    });

    // Either the caller chose the exposures, or one per responding coverage.
    const wanted: FnolExposureInput[] =
      input.exposures && input.exposures.length > 0
        ? input.exposures
        : responding.map((c) => ({ coverageCode: c.coverageCode, riskItemId: c.vehicleId }));

    const exposures = wanted.map((w) =>
      createExposure(db, ctx, claim, version, w, account?.name ?? 'Insured'),
    );

    repo.appendClaimEvent(db, ctx, {
      claimId: claim.id,
      action: 'reported',
      subjectKind: 'claim',
      subjectId: claim.id,
      detail: `${cause.name}, loss ${input.lossDate}`,
    });

    return { claim, exposures };
  });
}

/**
 * Add one exposure to a claim. Validates that the coverage both responds to
 * the cause of loss and was actually carried on the pinned version.
 */
export function createExposure(
  db: Db,
  ctx: TenantCtx,
  claim: ClaimRow,
  version: PolicyVersionRow,
  input: FnolExposureInput,
  defaultClaimant: string,
): ClaimExposureRow {
  const policy = repo.getPolicy(db, ctx, claim.policy_id);
  const product = getProduct(policy!.product_code);
  const snapshot = versionSnapshot(version);

  const responding = respondingCoverages(snapshot, claim.loss_cause, product);
  const carried = responding.find(
    (c) =>
      c.coverageCode === input.coverageCode &&
      (input.riskItemId === undefined || c.vehicleId === input.riskItemId),
  );
  if (!carried) {
    throw ApiError.conflict(
      `Coverage ${input.coverageCode} was not in force for this loss`,
      'coverage_not_in_force',
    );
  }

  const coverageDef = product.coverages.find((c) => c.code === input.coverageCode);
  const kind = input.claimantKind ?? 'insured';
  const cause = product.lossCauses.find((c) => c.code === claim.loss_cause);
  if (cause && !cause.claimantKinds.includes(kind)) {
    const noun = kind === 'thirdParty' ? 'third party' : 'insured';
    throw ApiError.badRequest(`A ${noun} cannot claim under ${cause.name.toLowerCase()}`);
  }

  const riskItemId = input.riskItemId ?? carried.vehicleId;
  const exposure = repo.insertExposure(db, ctx, {
    claim_id: claim.id,
    coverage_code: carried.coverageCode,
    coverage_name: coverageDef?.name ?? carried.coverageCode,
    risk_item_id: riskItemId,
    risk_item_label: riskItemLabel(version, riskItemId),
    claimant_name: input.claimantName ?? defaultClaimant,
    claimant_kind: kind,
    deductible_cents: deductibleFor(snapshot, carried.coverageCode, riskItemId),
    status: 'Open',
  });

  repo.appendClaimEvent(db, ctx, {
    claimId: claim.id,
    action: 'exposureAdded',
    subjectKind: 'exposure',
    subjectId: exposure.id,
    detail: `${exposure.coverage_name} — ${exposure.claimant_name}`,
  });

  return exposure;
}
