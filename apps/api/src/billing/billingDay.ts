import { addDays, earnedCents, postingsFor } from '@polaris/domain';
import { todayIso } from '../dates.ts';
import { inTransaction, type Db } from '../db.ts';
import { ApiError } from '../errors.ts';
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
// under a unique index on (tenant_id, run_date), and a second call for a date
// whose run finished does nothing and says so.
//
// The work commits in batches rather than in one transaction, because a
// carrier's whole book in a single write lock would hold every other writer
// out for the length of the run. That makes a crash mid-run possible, so the
// run row is the marker: it is written first, its `finished_at` last, and a
// row without `finished_at` is resumed rather than skipped. Resuming is safe
// because every batch is idempotent — billing an invoice already billed is a
// no-op, and earning posts the delta against the version's last snapshot.

export interface BillingDayResult {
  runId: string;
  billedInvoices: number;
  earnedCents: number;
  /** True when a run for this tenant and date had already finished. */
  skipped: boolean;
}

/** How many invoices one query pulls back. The loop repeats until none are
 * left, so this bounds memory, not the day's work. */
const BILL_BATCH = 500;

/** How many policies one page of the earning loop holds. Same idea. */
const EARNING_BATCH = 200;

/**
 * The run only ever moves forward. A date in the future would earn premium
 * nobody has been on risk for; a date behind the last run would post earning
 * a later snapshot has already accounted for and bill invoices out of order.
 * Both are refused here rather than at the route, so the timer is held to the
 * same rule. Re-running the last date is still allowed: that is the
 * idempotent repeat, and it does nothing.
 */
function assertRunnable(db: Db, ctx: TenantCtx, date: string): void {
  const today = todayIso();
  if (date > today) {
    throw ApiError.badRequest(
      `Cannot run the billing day for ${date}: that date is in the future (today is ${today})`,
      'run_date_out_of_order',
    );
  }
  const latest = repo.latestBillingRun(db, ctx);
  if (latest && date < latest.run_date) {
    throw ApiError.badRequest(
      `Cannot run the billing day for ${date}: this tenant has already run ${latest.run_date}`,
      'run_date_out_of_order',
    );
  }
}

export function runBillingDay(db: Db, ctx: TenantCtx, date: string): BillingDayResult {
  assertRunnable(db, ctx, date);

  const existing = repo.getBillingRun(db, ctx, date);
  // Only a run that finished is a repeat. One without `finished_at` stopped
  // part-way, and nobody can say how far it got, so it is run again.
  if (existing && existing.finished_at !== null) {
    return { runId: existing.id, billedInvoices: 0, earnedCents: 0, skipped: true };
  }

  // The unique index on (tenant_id, run_date) is what stops two processes
  // both claiming the date: the loser's insert fails rather than duplicating.
  const run = existing ?? inTransaction(db, () => repo.insertBillingRun(db, ctx, date));
  const billedInvoices = billPlannedInvoices(db, ctx, date);
  const earned = recogniseEarning(db, ctx, date);
  inTransaction(db, () =>
    repo.finishBillingRun(db, ctx, run.id, { billedInvoices, earnedCents: earned }),
  );

  return { runId: run.id, billedInvoices, earnedCents: earned, skipped: false };
}

/**
 * A planned invoice becomes billed on its bill date — the day the customer is
 * sent it, ahead of the due date. No money moves: the charges behind the
 * invoice were posted when the job was issued.
 *
 * One transaction per batch, so the write lock is held for a page of invoices
 * rather than for the whole book.
 */
function billPlannedInvoices(db: Db, ctx: TenantCtx, date: string): number {
  // The query re-reads what the loop has just changed, so `seen` is the
  // guarantee it terminates: a row that somehow came back a second time ends
  // the loop rather than billing it twice.
  const seen = new Set<string>();
  let billed = 0;
  for (;;) {
    const batch = repo.listInvoicesToBill(db, ctx, date, BILL_BATCH);
    const fresh = batch.filter((invoice) => !seen.has(invoice.id));
    if (fresh.length === 0) return billed;
    inTransaction(db, () => {
      for (const invoice of fresh) {
        seen.add(invoice.id);
        repo.updateInvoiceStatus(db, ctx, invoice.id, 'billed');
        billed += 1;
      }
    });
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
  let after: string | null = null;
  for (;;) {
    // Paged by id rather than read whole: a carrier's book does not fit in
    // one array, and the run must not assume it does. Each page commits on
    // its own, so the lock is held for a page rather than for the book.
    const ids = repo.listPolicyIdsAfter(db, ctx, after, EARNING_BATCH);
    if (ids.length === 0) return total;
    total += inTransaction(db, () => {
      let page = 0;
      for (const id of ids) {
        const policy = repo.getPolicy(db, ctx, id);
        if (policy) page += earnPolicy(db, ctx, policy, date);
      }
      return page;
    });
    after = ids[ids.length - 1]!;
    if (ids.length < EARNING_BATCH) return total;
  }
}

/**
 * The written premium each policy version carries. Summed rather than
 * replaced: a version with more than one transaction against it is written
 * for their total, and keeping only the last would earn the wrong figure.
 */
export function writtenByVersion(
  transactions: { policy_version_id: string; amount_cents: number }[],
): Map<string, number> {
  const written = new Map<string, number>();
  for (const tx of transactions) {
    written.set(tx.policy_version_id, (written.get(tx.policy_version_id) ?? 0) + tx.amount_cents);
  }
  return written;
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

  const written = writtenByVersion(repo.listTransactions(db, ctx, policy.id));

  let total = 0;
  for (const version of versions) {
    if (version.transaction_type === 'Cancellation') continue;
    const writtenCents = written.get(version.id) ?? 0;
    if (writtenCents === 0) continue;

    // A version earns from the day it takes effect, not from the start of
    // the term. An endorsement's transaction is already the delta for the
    // remaining term, so earning it from `term_start` would recognise months
    // of premium the policy was never on risk for at that price.
    const earnFrom =
      version.effective_date > version.term_start ? version.effective_date : version.term_start;
    const target = earnedCents(writtenCents, earnFrom, version.term_end, earnedTo);
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
