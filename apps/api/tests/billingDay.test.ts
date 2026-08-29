import { earnedCents } from '@polaris/domain';
import type { Role } from '@polaris/domain';
import { beforeEach, describe, expect, test } from 'vitest';
import { runBillingDay, writtenByVersion } from '../src/billing/billingDay.ts';
import { assertBillingInvariants } from '../src/billing/readModel.ts';
import { apiKey } from '../src/bootstrap.ts';
import type { Db } from '../src/db.ts';
import { createCancellation, createPolicyChange, createSubmission } from '../src/jobs.ts';
import { hashPassword } from '../src/passwords.ts';
import * as repo from '../src/repo.ts';
import type { PlanCode, TenantCtx } from '../src/repo.ts';
import { buildRouter } from '../src/routes.ts';
import { issueSubmission, runJob, withCollision } from './billingHelpers.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

// ─── The billing day ───────────────────────────────────────────────────────
// One time-driven process: it bills the invoices whose bill date has arrived
// and recognises premium earned to the end of the day it is run for. It is
// idempotent per (tenant, date) — a second run for the same date does
// nothing at all — and it never earns a cent past a cancellation.
//
// Every date here is in the past, because the run refuses a date later than
// today and refuses to go backwards once it has run. The term starts two
// years before the shared billing fixtures use theirs, so that even its
// expiry is safely behind today — which is why this file issues its own
// submissions rather than calling `issueSubmission`.

const TERM_START = '2024-09-01';
const TERM_END = '2025-09-01';

let db: Db;
let tenantId: string;
let csr: TenantCtx;
let accountId: string;
let keys: Record<string, string>;

function addUser(role: Role, username: string): string {
  const key = apiKey(username);
  const stored = hashPassword('a-long-password');
  repo.createUser(db, tenantId, {
    username,
    email: `${username}@example.com`,
    name: username,
    role,
    passwordHash: stored.hash,
    passwordSalt: stored.salt,
    apiKey: key,
  });
  return key;
}

beforeEach(() => {
  db = testDb();
  const tenant = makeTenant(db);
  tenantId = tenant.tenantId;
  csr = tenant.ctx.csr;
  accountId = makeAccount(db, csr).id;
  keys = {
    ...tenant.keys,
    billing: addUser('billing', 'bailey.brooks'),
    finance: addUser('finance', 'frankie.ford'),
  };
});

function issue(plan: PlanCode = 'monthly', risk = cleanRisk()) {
  const job = createSubmission(db, csr, {
    accountId,
    productCode: 'ON_PA',
    effectiveDate: TERM_START,
    billingPlan: plan,
    risk,
  });
  return runJob(db, csr, job.id);
}

/** What the ledger has been told one version has earned so far. */
function earnedOn(versionId: string): number {
  return repo.latestEarningSnapshot(db, csr, versionId)?.earned_cents ?? 0;
}

describe('the billing day', () => {
  test('bills invoices whose bill date has arrived and posts earned premium once', () => {
    const { policy, transaction } = issue('monthly');

    const r1 = runBillingDay(db, csr, '2024-08-11');
    expect(r1.billedInvoices).toBe(1);
    expect(repo.listInvoicesForPolicy(db, csr, policy.id)[0]!.status).toBe('billed');
    // Nothing is earned before the term starts.
    expect(r1.earnedCents).toBe(0);

    const r2 = runBillingDay(db, csr, '2024-09-30');
    expect(r2.billedInvoices).toBe(1);
    expect(r2.earnedCents).toBe(
      earnedCents(transaction.amount_cents, TERM_START, TERM_END, '2024-10-01'),
    );
    expect(runBillingDay(db, csr, '2024-09-30').skipped).toBe(true);
    expect(repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(-r2.earnedCents);

    assertBillingInvariants(db, csr, accountId);
  });

  test('a second run for the same date changes nothing and returns the first run', () => {
    issue('monthly');
    const first = runBillingDay(db, csr, '2024-10-15');
    expect(first.skipped).toBe(false);

    const entriesAfterFirst = db
      .prepare('SELECT count(*) AS n FROM journal_entries WHERE tenant_id = ?')
      .get(tenantId) as { n: number };

    const second = runBillingDay(db, csr, '2024-10-15');
    expect(second.skipped).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(second.billedInvoices).toBe(0);
    expect(second.earnedCents).toBe(0);
    expect(
      db.prepare('SELECT count(*) AS n FROM journal_entries WHERE tenant_id = ?').get(tenantId),
    ).toEqual(entriesAfterFirst);
    expect(repo.listBillingRuns(db, csr)).toHaveLength(1);
  });

  test('a run left unfinished by a crash resumes instead of being skipped', () => {
    issue('monthly');
    // The run row is written before any work and closed out after it, so a
    // crash mid-run leaves it without `finished_at`. Nobody can say how far
    // it got, so the next call has to do the work rather than skip it.
    const crashed = repo.insertBillingRun(db, csr, '2024-09-30');
    expect(crashed.finished_at).toBeNull();

    const resumed = runBillingDay(db, csr, '2024-09-30');
    expect(resumed.skipped).toBe(false);
    expect(resumed.runId).toBe(crashed.id);
    expect(resumed.billedInvoices).toBe(2);
    expect(resumed.earnedCents).toBeGreaterThan(0);
    expect(repo.getBillingRun(db, csr, '2024-09-30')!.finished_at).not.toBeNull();
    expect(repo.listBillingRuns(db, csr)).toHaveLength(1);

    // Forced back to unfinished, the resume does the batches again and they
    // are all no-ops: that idempotence is what makes resuming safe.
    db.prepare('UPDATE billing_runs SET finished_at = NULL WHERE id = ?').run(crashed.id);
    const again = runBillingDay(db, csr, '2024-09-30');
    expect(again.skipped).toBe(false);
    expect(again.billedInvoices).toBe(0);
    expect(again.earnedCents).toBe(0);
    expect(again.earnedCents + resumed.earnedCents).toBe(
      -repo.accountBalance(db, csr, '4100', { accountId }),
    );
    assertBillingInvariants(db, csr, accountId);
  });

  test('a version written by more than one transaction is earned on their total', () => {
    // The map the earning loop reads sums a version's transactions; keeping
    // only the last would earn the wrong figure for a version that carries
    // two of them.
    expect(
      writtenByVersion([
        { policy_version_id: 'v1', amount_cents: 10_000 },
        { policy_version_id: 'v1', amount_cents: -2_500 },
        { policy_version_id: 'v2', amount_cents: 400 },
      ]),
    ).toEqual(
      new Map([
        ['v1', 7_500],
        ['v2', 400],
      ]),
    );
    expect(writtenByVersion([])).toEqual(new Map());
  });

  test('an endorsement earns from its own effective date, not from term start', () => {
    const { policy } = issue('monthly');
    runBillingDay(db, csr, '2024-09-30');

    // Six months in, add collision. The transaction is already the delta for
    // the remaining term, so it must earn over the remaining term alone.
    const change = createPolicyChange(db, csr, {
      policyId: policy.id,
      effectiveDate: '2025-03-01',
      risk: withCollision(cleanRisk()),
    });
    const endorsement = runJob(db, csr, change.id);
    const delta = endorsement.transaction.amount_cents;
    expect(delta).toBeGreaterThan(0);

    // The day after the endorsement: one day of it, not half of it.
    runBillingDay(db, csr, '2025-03-01');
    expect(earnedOn(endorsement.version.id)).toBe(
      earnedCents(delta, '2025-03-01', TERM_END, '2025-03-02'),
    );
    expect(earnedOn(endorsement.version.id) * 2).toBeLessThan(delta);

    // A month later it has accrued at the endorsement's own daily rate.
    runBillingDay(db, csr, '2025-03-31');
    expect(earnedOn(endorsement.version.id)).toBe(
      earnedCents(delta, '2025-03-01', TERM_END, '2025-04-01'),
    );

    // By expiry it has earned exactly what it was written for, no more.
    runBillingDay(db, csr, '2025-08-31');
    expect(earnedOn(endorsement.version.id)).toBe(delta);
    assertBillingInvariants(db, csr, accountId);
  });

  test('earning stops at the cancellation date and never exceeds written premium', () => {
    const { policy, transaction } = issue('monthly');
    runBillingDay(db, csr, '2024-11-30');

    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2024-12-01',
      reason: 'insured request',
    });
    runJob(db, csr, cancel.id);

    runBillingDay(db, csr, '2024-12-31');
    const cap = earnedCents(transaction.amount_cents, TERM_START, TERM_END, '2024-12-01');
    expect(-repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(cap);

    // Months later the policy is still cancelled: nothing more is earned.
    const later = runBillingDay(db, csr, '2025-06-30');
    expect(later.earnedCents).toBe(0);
    expect(-repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(cap);

    const written = repo
      .listTransactions(db, csr, policy.id)
      .reduce((sum, t) => sum + t.amount_cents, 0);
    expect(cap).toBeLessThanOrEqual(transaction.amount_cents);
    // Written premium net of the return is what has been earned: nothing is
    // left unearned on a cancelled policy.
    expect(written).toBe(cap);
    assertBillingInvariants(db, csr, accountId);
  });

  test('a backdated cancellation reverses the earning already posted', () => {
    const { policy } = issue('monthly');
    runBillingDay(db, csr, '2025-01-31');
    const earnedBefore = -repo.accountBalance(db, csr, '4100', { policyId: policy.id });
    expect(earnedBefore).toBeGreaterThan(0);

    // Backdated two months: the ledger has already earned past it.
    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2024-12-01',
      reason: 'insured request',
    });
    runJob(db, csr, cancel.id);

    const reversal = runBillingDay(db, csr, '2025-02-28');
    expect(reversal.earnedCents).toBeLessThan(0);
    expect(-repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBeLessThan(earnedBefore);

    // The reversing entry debits earned premium and credits unearned, both in
    // positive cents: a journal line is never negative.
    const lines = db
      .prepare(
        `SELECT l.account_code, l.debit_cents, l.credit_cents
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE e.tenant_id = ? AND e.event_type = 'earning'
          ORDER BY e.posted_at DESC, l.account_code ASC LIMIT 2`,
      )
      .all(tenantId) as unknown as {
      account_code: string;
      debit_cents: number;
      credit_cents: number;
    }[];
    expect(lines.map((l) => l.account_code)).toEqual(['2200', '4100']);
    expect(lines[0]!.credit_cents).toBeGreaterThan(0);
    expect(lines[0]!.debit_cents).toBe(0);
    expect(lines[1]!.debit_cents).toBeGreaterThan(0);
    expect(lines[1]!.credit_cents).toBe(0);

    assertBillingInvariants(db, csr, accountId);
  });

  test('the run refuses a date in the future or a date it has already passed', () => {
    issue('monthly');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(() => runBillingDay(db, csr, tomorrow)).toThrow(/future/i);

    runBillingDay(db, csr, '2025-01-31');
    expect(() => runBillingDay(db, csr, '2024-12-31')).toThrow(/2025-01-31/);
    // The date it last ran is still allowed: that is the idempotent repeat.
    expect(runBillingDay(db, csr, '2025-01-31').skipped).toBe(true);
  });

  test('one tenant’s run leaves another tenant’s policies alone', () => {
    const other = makeTenant(db, 'Beta Mutual', 'BETA');
    const otherAccount = makeAccount(db, other.ctx.csr, 'Other Person');
    const otherIssued = issueSubmission(db, other.ctx.csr, {
      accountId: otherAccount.id,
      plan: 'monthly',
      risk: cleanRisk(),
    });

    runBillingDay(db, csr, '2024-09-30');

    expect(repo.accountBalance(db, other.ctx.csr, '4100', { policyId: otherIssued.policy.id })).toBe(
      0,
    );
    expect(
      repo
        .listInvoicesForPolicy(db, other.ctx.csr, otherIssued.policy.id)
        .every((i) => i.status === 'planned'),
    ).toBe(true);
    expect(repo.listBillingRuns(db, other.ctx.csr)).toHaveLength(0);
  });

  test('every policy in the tenant is earned, not just the first page of them', () => {
    const policies = [issue('monthly').policy, issue('monthly').policy, issue('monthly').policy];
    const result = runBillingDay(db, csr, '2024-09-30');

    let summed = 0;
    for (const policy of policies) {
      const earned = -repo.accountBalance(db, csr, '4100', { policyId: policy.id });
      expect(earned).toBeGreaterThan(0);
      summed += earned;
    }
    expect(summed).toBe(result.earnedCents);
  });
});

// ─── Routes ────────────────────────────────────────────────────────────────

interface Invocation {
  status: number;
  payload: unknown;
}

/** Drive a route handler directly, the way the other route tests do. */
async function call(
  key: string | null,
  method: string,
  path: string,
  bodyValue?: unknown,
): Promise<Invocation> {
  const router = buildRouter(db);
  const [pathname, search] = path.split('?');
  const match = router.match(method, pathname!);
  if (!match) return { status: 404, payload: null };
  try {
    const result = await match.handler({
      req: { headers: key ? { authorization: `Bearer ${key}` } : {} } as never,
      res: {} as never,
      params: match.params,
      query: new URLSearchParams(search ?? ''),
      body: bodyValue,
    });
    if (result && typeof result === 'object' && 'status' in result && 'payload' in result) {
      return result as Invocation;
    }
    return { status: 200, payload: result };
  } catch (err) {
    const apiErr = err as { status?: number; code?: string; message: string };
    return { status: apiErr.status ?? 500, payload: { code: apiErr.code, message: apiErr.message } };
  }
}

describe('billing routes', () => {
  test('POST /billing/run is finance or admin only', async () => {
    issue('monthly');
    expect((await call(keys['csr']!, 'POST', '/billing/run?date=2024-09-30')).status).toBe(403);
    expect((await call(keys['billing']!, 'POST', '/billing/run?date=2024-09-30')).status).toBe(403);

    const run = await call(keys['admin']!, 'POST', '/billing/run?date=2024-09-30');
    expect(run.status).toBe(200);
    const payload = run.payload as { run: { id: string; billedInvoices: number; skipped: boolean } };
    expect(payload.run.billedInvoices).toBe(2);
    expect(payload.run.skipped).toBe(false);

    expect((await call(keys['finance']!, 'POST', '/billing/run?date=2024-10-31')).status).toBe(200);
  });

  test('POST /billing/run refuses a date that is not YYYY-MM-DD', async () => {
    expect((await call(keys['admin']!, 'POST', '/billing/run?date=yesterday')).status).toBe(400);
  });

  test('POST /billing/run refuses a future date and a date already run past', async () => {
    issue('monthly');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const future = await call(keys['admin']!, 'POST', `/billing/run?date=${tomorrow}`);
    expect(future.status).toBe(400);
    expect((future.payload as { code: string }).code).toBe('run_date_out_of_order');

    await call(keys['admin']!, 'POST', '/billing/run?date=2025-01-31');
    const backwards = await call(keys['admin']!, 'POST', '/billing/run?date=2024-12-31');
    expect(backwards.status).toBe(400);
    expect((backwards.payload as { code: string }).code).toBe('run_date_out_of_order');
  });

  test('GET /billing/runs lists the runs, newest first, for billing staff', async () => {
    issue('monthly');
    await call(keys['admin']!, 'POST', '/billing/run?date=2024-09-30');
    await call(keys['admin']!, 'POST', '/billing/run?date=2024-10-31');

    const listed = await call(keys['billing']!, 'GET', '/billing/runs');
    expect(listed.status).toBe(200);
    const runs = (listed.payload as { runs: { runDate: string }[] }).runs;
    expect(runs.map((r) => r.runDate)).toEqual(['2024-10-31', '2024-09-30']);

    expect((await call(keys['underwriter']!, 'GET', '/billing/runs')).status).toBe(403);
  });

  test('GET /billing/plans gives a CSR the plans for a product and province', async () => {
    const result = await call(keys['csr']!, 'GET', '/billing/plans?productCode=ON_PA&province=ON');
    expect(result.status).toBe(200);
    const payload = result.payload as {
      paymentPlans: { code: string }[];
      chargePatterns: unknown[];
      taxRates: unknown[];
    };
    expect(payload.paymentPlans.map((p) => p.code)).toContain('monthly');
    expect(payload.chargePatterns.length).toBeGreaterThan(0);
    expect(payload.taxRates.length).toBeGreaterThan(0);

    const none = await call(keys['csr']!, 'GET', '/billing/plans?productCode=NOPE');
    expect((none.payload as { paymentPlans: unknown[] }).paymentPlans).toEqual([]);

    // The catalogue is product configuration, not money: every authenticated
    // role reads it, because every role can land on a screen that names a plan.
    expect((await call(keys['adjuster']!, 'GET', '/billing/plans')).status).toBe(200);
    expect((await call(keys['underwriter']!, 'GET', '/billing/plans')).status).toBe(200);
  });

  test('GET /invoices/:id returns the lines and the postings behind them', async () => {
    const { policy } = issue('monthly');
    const invoice = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;

    const result = await call(keys['csr']!, 'GET', `/invoices/${invoice.id}`);
    expect(result.status).toBe(200);
    const payload = result.payload as {
      invoice: { id: string; lines: unknown[]; totalCents: number };
      entries: { eventType: string }[];
    };
    expect(payload.invoice.id).toBe(invoice.id);
    expect(payload.invoice.lines.length).toBeGreaterThan(0);
    expect(payload.entries.length).toBeGreaterThan(0);
    expect(payload.entries.every((e) => e.eventType === 'chargeBilled')).toBe(true);
  });

  test('an invoice belonging to another tenant is not found', async () => {
    const other = makeTenant(db, 'Beta Mutual', 'BETA');
    const otherAccount = makeAccount(db, other.ctx.csr, 'Other Person');
    const otherIssued = issueSubmission(db, other.ctx.csr, {
      accountId: otherAccount.id,
      plan: 'monthly',
      risk: cleanRisk(),
    });
    const theirInvoice = repo.listInvoicesForPolicy(db, other.ctx.csr, otherIssued.policy.id)[0]!;

    expect((await call(keys['csr']!, 'GET', `/invoices/${theirInvoice.id}`)).status).toBe(404);
  });
});
