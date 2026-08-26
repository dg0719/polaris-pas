import { claimFinancials, exposureFinancials, type ClaimLedger, type Financials } from '@polaris/domain';
import type { Db } from '../db.ts';
import * as repo from '../repo.ts';
import type {
  ClaimExposureRow,
  ClaimPaymentRow,
  ClaimRecoveryRow,
  ClaimRow,
  ReserveMovementRow,
  TenantCtx,
} from '../repo.ts';

/**
 * Assemble the financial picture of a claim from its stored rows using the
 * pure arithmetic in the domain. Nothing here writes.
 */

function toLedger(
  movements: ReserveMovementRow[],
  payments: ClaimPaymentRow[],
  recoveries: ClaimRecoveryRow[],
): ClaimLedger {
  return {
    movements: movements.map((m) => ({
      exposureId: m.exposure_id,
      category: m.category,
      amountCents: m.amount_cents,
    })),
    payments: payments.map((p) => ({
      exposureId: p.exposure_id,
      category: p.category,
      amountCents: p.amount_cents,
      status: p.status,
    })),
    recoveries: recoveries.map((r) => ({
      exposureId: r.exposure_id,
      category: r.category,
      receivedCents: r.received_cents,
      status: r.status,
    })),
  };
}

export interface ClaimFinancialView {
  claim: Financials;
  byExposure: Map<string, Financials>;
}

export function claimFinancialView(db: Db, ctx: TenantCtx, claim: ClaimRow): ClaimFinancialView {
  const exposures = repo.listExposures(db, ctx, claim.id);
  const ledger = toLedger(
    repo.listReserveMovements(db, ctx, claim.id),
    repo.listClaimPayments(db, ctx, claim.id),
    repo.listClaimRecoveries(db, ctx, claim.id),
  );
  const byExposure = new Map<string, Financials>(
    exposures.map((e: ClaimExposureRow) => [e.id, exposureFinancials(ledger, e.id)]),
  );
  return {
    claim: claimFinancials(
      ledger,
      exposures.map((e) => e.id),
    ),
    byExposure,
  };
}
