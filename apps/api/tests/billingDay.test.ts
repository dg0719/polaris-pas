import { earnedCents } from '@polaris/domain';
import type { Role } from '@polaris/domain';
import { beforeEach, describe, expect, test } from 'vitest';
import { runBillingDay } from '../src/billing/billingDay.ts';
import { assertBillingInvariants } from '../src/billing/readModel.ts';
import { apiKey } from '../src/bootstrap.ts';
import type { Db } from '../src/db.ts';
import { createCancellation } from '../src/jobs.ts';
import { hashPassword } from '../src/passwords.ts';
import * as repo from '../src/repo.ts';
import type { TenantCtx } from '../src/repo.ts';
import { buildRouter } from '../src/routes.ts';
import { TERM_START, issueSubmission, runJob } from './billingHelpers.ts';
import { cleanRisk, makeAccount, makeTenant, testDb } from './helpers.ts';

// ─── The billing day ───────────────────────────────────────────────────────
// One time-driven process: it bills the invoices whose bill date has arrived
// and recognises premium earned to the end of the day it is run for. It is
// idempotent per (tenant, date) — a second run for the same date does
// nothing at all — and it never earns a cent past a cancellation.

const TERM_END = '2027-09-01';

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

function issue(plan: 'full' | 'monthly' | 'quarterly' = 'monthly') {
  return issueSubmission(db, csr, { accountId, plan, risk: cleanRisk() });
}

describe('the billing day', () => {
  test('bills invoices whose bill date has arrived and posts earned premium once', () => {
    const { policy, transaction } = issue('monthly');

    const r1 = runBillingDay(db, csr, '2026-08-11');
    expect(r1.billedInvoices).toBe(1);
    expect(repo.listInvoicesForPolicy(db, csr, policy.id)[0]!.status).toBe('billed');
    // Nothing is earned before the term starts.
    expect(r1.earnedCents).toBe(0);

    const r2 = runBillingDay(db, csr, '2026-09-30');
    expect(r2.billedInvoices).toBe(1);
    expect(r2.earnedCents).toBe(
      earnedCents(transaction.amount_cents, TERM_START, TERM_END, '2026-10-01'),
    );
    expect(runBillingDay(db, csr, '2026-09-30').skipped).toBe(true);
    expect(repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(-r2.earnedCents);

    assertBillingInvariants(db, csr, accountId);
  });

  test('a second run for the same date changes nothing and returns the first run', () => {
    issue('monthly');
    const first = runBillingDay(db, csr, '2026-10-15');
    expect(first.skipped).toBe(false);

    const entriesAfterFirst = db
      .prepare('SELECT count(*) AS n FROM journal_entries WHERE tenant_id = ?')
      .get(tenantId) as { n: number };

    const second = runBillingDay(db, csr, '2026-10-15');
    expect(second.skipped).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(second.billedInvoices).toBe(0);
    expect(second.earnedCents).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM journal_entries WHERE tenant_id = ?').get(tenantId))
      .toEqual(entriesAfterFirst);
    expect(repo.listBillingRuns(db, csr)).toHaveLength(1);
  });

  test('earning stops at the cancellation date and never exceeds written premium', () => {
    const { policy, transaction } = issue('monthly');
    runBillingDay(db, csr, '2026-11-30');

    const cancel = createCancellation(db, csr, {
      policyId: policy.id,
      effectiveDate: '2026-12-01',
      reason: 'insured request',
    });
    runJob(db, csr, cancel.id);

    runBillingDay(db, csr, '2026-12-31');
    const cap = earnedCents(transaction.amount_cents, TERM_START, TERM_END, '2026-12-01');
    expect(-repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(cap);

    // Months later the policy is still cancelled: nothing more is earned.
    const later = runBillingDay(db, csr, '2027-06-30');
    expect(later.earnedCents).toBe(0);
    expect(-repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(cap);

    const written = repo
      .listTransactions(db, csr, policy.id)
      .reduce((sum, t) => sum + t.amount_cents, 0);
    expect(cap).toBeLessThanOrEqual(transaction.amount_cents);
    expect(-repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBeLessThanOrEqual(
      transaction.amount_cents,
    );
    // Written premium net of the return is what has been earned: nothing is
    // left unearned on a cancelled policy.
    expect(written).toBe(cap);
    assertBillingInvariants(db, csr, accountId);
  });

  test('one tenant’s run leaves another tenant’s policies alone', () => {
    const other = makeTenant(db, 'Beta Mutual', 'BETA');
    const otherAccount = makeAccount(db, other.ctx.csr, 'Other Person');
    const otherIssued = issueSubmission(db, other.ctx.csr, {
      accountId: otherAccount.id,
      plan: 'monthly',
      risk: cleanRisk(),
    });

    runBillingDay(db, csr, '2026-09-30');

    expect(repo.accountBalance(db, other.ctx.csr, '4100', { policyId: otherIssued.policy.id })).toBe(0);
    expect(
      repo.listInvoicesForPolicy(db, other.ctx.csr, otherIssued.policy.id).every((i) => i.status === 'planned'),
    ).toBe(true);
    expect(repo.listBillingRuns(db, other.ctx.csr)).toHaveLength(0);
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
    const apiErr = err as { status?: number; message: string };
    return { status: apiErr.status ?? 500, payload: { message: apiErr.message } };
  }
}

describe('billing routes', () => {
  test('POST /billing/run is finance or admin only', async () => {
    issue('monthly');
    expect((await call(keys['csr']!, 'POST', '/billing/run?date=2026-09-30')).status).toBe(403);
    expect((await call(keys['billing']!, 'POST', '/billing/run?date=2026-09-30')).status).toBe(403);

    const run = await call(keys['admin']!, 'POST', '/billing/run?date=2026-09-30');
    expect(run.status).toBe(200);
    const payload = run.payload as { run: { id: string; billedInvoices: number; skipped: boolean } };
    expect(payload.run.billedInvoices).toBe(2);
    expect(payload.run.skipped).toBe(false);

    expect((await call(keys['finance']!, 'POST', '/billing/run?date=2026-10-31')).status).toBe(200);
  });

  test('POST /billing/run refuses a date that is not YYYY-MM-DD', async () => {
    expect((await call(keys['admin']!, 'POST', '/billing/run?date=yesterday')).status).toBe(400);
  });

  test('GET /billing/runs lists the runs, newest first, for billing staff', async () => {
    issue('monthly');
    await call(keys['admin']!, 'POST', '/billing/run?date=2026-09-30');
    await call(keys['admin']!, 'POST', '/billing/run?date=2026-10-31');

    const listed = await call(keys['billing']!, 'GET', '/billing/runs');
    expect(listed.status).toBe(200);
    const runs = (listed.payload as { runs: { runDate: string }[] }).runs;
    expect(runs.map((r) => r.runDate)).toEqual(['2026-10-31', '2026-09-30']);

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

    expect((await call(keys['adjuster']!, 'GET', '/billing/plans')).status).toBe(403);
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
