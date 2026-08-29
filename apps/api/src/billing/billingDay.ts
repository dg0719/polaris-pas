import { addDays, earnedCents, postingsFor } from '@polaris/domain';
import { inTransaction, type Db } from '../db.ts';
import * as repo from '../repo.ts';
import type { PolicyRow, TenantCtx } from '../repo.ts';

// ─── The billing day ───────────────────────────────────────────────────────
// One time-driven process, run once a day per tenant and on demand. Today it
// does two of the jobs spec §2 lists for it: it bills the invoices whose bill
// date has arrived, and it recognises the premium earned to the end of the
// day it is run for. Delinquency, payment requests and commission join it in
// later tasks.
//
// It is idempotent per (tenant, date): the run is recorded before any work,
// under a unique index on (tenant_id, run_date), and a second call for the
// same date does nothing and says so. Everything runs inside one transaction
// — so nothing here may call a service that opens its own.

export interface BillingDayResult {
  runId: string;
  billedInvoices: number;
  earnedCents: number;
  /** True when a run for this tenant and date had already happened. */
  skipped: boolean;
}

/** How many invoices one query pulls back. The loop repeats until none are
 * left, so this bounds memory, not the day's work. */
const BILL_BATCH = 500;

export function runBillingDay(db: Db, ctx: TenantCtx, date: string): BillingDayResult {
  return inTransaction(db, () => {
    // Inside the transaction: SQLite serialises writers, so the check and the
    // insert cannot interleave with another process's run for the same date.
    const existing = repo.getBillingRun(db, ctx, date);
    if (existing) {
      return { runId: existing.id, billedInvoices: 0, earnedCents: 0, skipped: true };
    }

    const run = repo.insertBillingRun(db, ctx, date);
    const billedInvoices = billPlannedInvoices(db, ctx, date);
    const earned = recogniseEarning(db, ctx, date);
    repo.finishBillingRun(db, ctx, run.id, { billedInvoices, earnedCents: earned });

    return { runId: run.id, billedInvoices, earnedCents: earned, skipped: false };
  });
}

/**
 * A planned invoice becomes billed on its bill date — the day the customer is
 * sent it, ahead of the due date. No money moves: the charges behind the
 * invoice were posted when the job was issued.
 */
function billPlannedInvoices(db: Db, ctx: TenantCtx, date: string): number {
  let billed = 0;
  for (;;) {
    const batch = repo.listInvoicesToBill(db, ctx, date, BILL_BATCH);
    for (const invoice of batch) {
      repo.updateInvoiceStatus(db, ctx, invoice.id, 'billed');
      billed += 1;
    }
    if (batch.length < BILL_BATCH) return billed;
  }
}

/**
 * Move premium from unearned to earned, daily pro rata, for every policy in
 * the tenant. The snapshot per version holds the cumulative figure, so the
 * posting is the difference between what the version has earned by the end of
 * `date` and what the ledger has already been told — which is what makes a
 * missed day, or a run out of order, self-correcting.
 */
function recogniseEarning(db: Db, ctx: TenantCtx, date: string): number {
  let total = 0;
  for (const policy of repo.listPolicies(db, ctx)) {
    total += earnPolicy(db, ctx, policy, date);
  }
  return total;
}

function earnPolicy(db: Db, ctx: TenantCtx, policy: PolicyRow, date: string): number {
  const versions = repo.listPolicyVersions(db, ctx, policy.id);
  if (versions.length === 0) return 0;

  // Earning is measured at the start of a day, so the premium earned by the
  // end of `date` is the premium earned as at the following morning.
  const asOf = addDays(date, 1);

  // A cancellation stops the clock. Its own transaction is the return
  // premium — it reduces what was written rather than earning anything — so
  // the version is skipped and its effective date caps every other version.
  const cancelledOn = versions.find((v) => v.transaction_type === 'Cancellation')?.effective_date;
  const earnedTo = cancelledOn !== undefined && cancelledOn < asOf ? cancelledOn : asOf;

  const writtenByVersion = new Map(
    repo.listTransactions(db, ctx, policy.id).map((tx) => [tx.policy_version_id, tx.amount_cents]),
  );

  let total = 0;
  for (const version of versions) {
    if (version.transaction_type === 'Cancellation') continue;
    const writtenCents = writtenByVersion.get(version.id) ?? 0;
    if (writtenCents === 0) continue;

    const target = earnedCents(writtenCents, version.term_start, version.term_end, earnedTo);
    const already = repo.latestEarningSnapshot(db, ctx, version.id)?.earned_cents ?? 0;
    const delta = target - already;
    if (delta === 0) continue; // never post an entry for nothing

    repo.postEntry(
      db,
      ctx,
      postingsFor({
        type: 'earning',
        amountCents: delta,
        effectiveDate: date,
        policyId: policy.id,
        accountId: policy.account_id,
        versionId: version.id,
      }),
    );
    repo.insertEarningSnapshot(db, ctx, {
      policy_version_id: version.id,
      policy_id: policy.id,
      as_of: date,
      written_cents: writtenCents,
      earned_cents: target,
    });
    total += delta;
  }
  return total;
}
