# Billing PR 1 — Ledger, Migrations, Charges and Plans: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mutable-invoice billing core with a double-entry ledger, configurable payment plans (down payment, installment fee, retail sales tax), immutable invoice items grouped into invoices, and a migrations framework — while every existing screen and test keeps working.

**Architecture:** Pure arithmetic (slicing, posting rules, tax, earning) lives in `packages/domain/src/billing/`. The API gains a migration runner, tenant-scoped repos for configuration, journal and billing items, and a service that turns an issued job's transaction into a billing instruction → charges → items → invoices → postings. Payments post to the ledger and apply to items. A `billingDay` skeleton bills planned invoices and posts earning.

**Tech Stack:** Node 24 (`node:sqlite`, type stripping), TypeScript, vitest, React + Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-billing-design.md` (sections 2, 3, 4, and the PR 1 row of section 11). Executors read the spec as well as this plan.

## Global Constraints

- Node `>=24`; API runtime dependencies stay at zero (`node:http`, `node:sqlite` only).
- Money is integer cents; percentages are integer basis points (`130` = 1.3%). Never a float in stored data.
- Dates are ISO strings `YYYY-MM-DD`.
- Every business table carries `tenant_id`; scoping only in `apps/api/src/repo/`.
- `packages/domain` is pure: no I/O, no framework, no imports from `apps/`.
- Invoice items and journal lines are append-only. Nothing updates an item's amount or a journal line.
- Rounding remainder on a split goes to the **last** part.
- Rates, fees and taxes are illustrative until a carrier loads filed values; the `sample` disclaimer stays.
- Files 200–400 lines normal, 800 ceiling. Tests are the contract: every behaviour has a test that fails without it.
- Work on branch `feat/billing-ledger`, branched from `main` after PR #17 merges (or from `feat/billing-design`).
- Before finishing: `npm run typecheck && npm test && npm run build && npm run test:e2e` all green, and screenshots of changed screens at 375px and 1440px, read.

---

## File map

| File | Responsibility |
|---|---|
| `packages/domain/src/dates.ts` | `addMonths`, `addDays` (pure; API re-exports) |
| `packages/domain/src/billing/types.ts` | Plan, pattern, tax, charge, item, journal types |
| `packages/domain/src/billing/ledger.ts` | Chart of accounts, `postingsFor`, `assertBalanced` |
| `packages/domain/src/billing/split.ts` | `splitRemainderLast` |
| `packages/domain/src/billing/slicing.ts` | `sliceCharge` → items with event dates, fee items |
| `packages/domain/src/billing/tax.ts` | `taxRateFor`, `taxItemsFor` |
| `packages/domain/src/billing/respread.ts` | `respreadOnChange` |
| `packages/domain/src/billing/earning.ts` | `earnedCents` |
| `packages/domain/src/billing/defaultPlans.ts` | Shipped catalogue of patterns, plans, tax rates |
| `packages/domain/src/billing/index.ts` | Re-exports |
| `apps/api/src/migrations/index.ts` | `migrate(db)`, `schema_migrations` |
| `apps/api/src/migrations/001_baseline.ts` | Current v4 schema as migration 1 |
| `apps/api/src/migrations/002_billing.ts` | Billing tables, plan seeding, legacy conversion |
| `apps/api/src/repo/billingConfig.ts` | Patterns, plans, tax rates |
| `apps/api/src/repo/journal.ts` | `postEntry`, `accountBalance` |
| `apps/api/src/repo/billingItems.ts` | Instructions, charges, items, streams, invoices |
| `apps/api/src/billing/instructions.ts` | Issue → instruction → charges → items → postings |
| `apps/api/src/billing/payments.ts` | `recordPayment` on items + ledger |
| `apps/api/src/billing/readModel.ts` | `policyBilling`, `accountRollup`, `assertBillingInvariants` |
| `apps/api/src/billing/billingDay.ts` | `runBillingDay`: bill planned invoices, post earning |
| `apps/api/src/routes/billing.ts` | `/billing/run`, `/billing/runs`, `/billing/plans`, `/invoices/:id` |
| `apps/web/src/routes/PolicyDetail.tsx`, `wizard/steps.tsx`, `lib/types.ts` | Line items on the schedule; plans from the API |

---

### Task 1: Migrations framework with the current schema as the baseline

**Files:**
- Create: `apps/api/src/migrations/index.ts`, `apps/api/src/migrations/001_baseline.ts`
- Modify: `apps/api/src/db.ts` (remove `assertCompatible`, call `migrate`)
- Test: `apps/api/tests/migrations.test.ts`

**Interfaces:**
- Produces: `migrate(db: Db): { applied: number[] }`; `interface Migration { id: number; name: string; up(db: Db): void }`; `MIGRATIONS: Migration[]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/migrations.test.ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/db.ts';
import { MIGRATIONS, migrate } from '../src/migrations/index.ts';

describe('migrations', () => {
  test('a fresh database records every migration', () => {
    const db = openDb(':memory:');
    const rows = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: number }[];
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
  });

  test('migrate is idempotent', () => {
    const db = openDb(':memory:');
    expect(migrate(db).applied).toEqual([]);
  });

  test('a pre-migration v4 database is adopted, not rejected', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 4');
    db.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, policy_prefix TEXT NOT NULL,
      claim_prefix TEXT NOT NULL, next_policy_seq INTEGER NOT NULL DEFAULT 1,
      next_account_seq INTEGER NOT NULL DEFAULT 1, next_claim_seq INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`);
    db.exec(`INSERT INTO tenants VALUES ('t1','Old Carrier','OLD','OLDC',1,1,1,'2026-01-01')`);
    const result = migrate(db);
    expect(result.applied[0]).toBe(1);
    expect((db.prepare('SELECT count(*) AS n FROM tenants').get() as { n: number }).n).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/api/tests/migrations.test.ts`
Expected: FAIL — cannot find module `../src/migrations/index.ts`.

- [ ] **Step 3: Move the schema into migration 001**

Cut the `SCHEMA` constant out of `apps/api/src/db.ts` verbatim into:

```ts
// apps/api/src/migrations/001_baseline.ts
import type { Db } from '../db.ts';
import type { Migration } from './index.ts';

/** The schema as it stood at v4 (claims). Every table uses IF NOT EXISTS, so a v4 file is adopted as-is. */
const SCHEMA = `
  ... (the full CREATE TABLE IF NOT EXISTS block from db.ts, unchanged) ...
`;

export const baseline: Migration = {
  id: 1,
  name: 'baseline',
  up(db: Db) {
    db.exec(SCHEMA);
  },
};
```

- [ ] **Step 4: Write the runner**

```ts
// apps/api/src/migrations/index.ts
import type { Db } from '../db.ts';
import { baseline } from './001_baseline.ts';

export interface Migration {
  id: number;
  name: string;
  up(db: Db): void;
}

export const MIGRATIONS: Migration[] = [baseline];

/**
 * Forward-only, numbered migrations. Each runs once, inside a transaction,
 * and is recorded in schema_migrations. A database written before this
 * runner existed (PRAGMA user_version 4) is adopted by the baseline, which
 * only creates what is missing.
 */
export function migrate(db: Db): { applied: number[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const done = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    applied.push(m.id);
  }
  return { applied };
}
```

In `apps/api/src/db.ts`: delete `SCHEMA_VERSION`, `SchemaVersionError`, `assertCompatible`; `openDb` becomes:

```ts
export function openDb(file?: string): Db {
  const target = file ?? process.env.POLARIS_DB ?? 'polaris.db';
  const db = new DatabaseSync(target);
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}
```

Grep for `SCHEMA_VERSION` / `SchemaVersionError` across `apps/` and remove the references (server.ts error handling, README mention).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/api/tests/migrations.test.ts && npx vitest run`
Expected: all pass (246 + 3).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/migrations apps/api/src/db.ts apps/api/tests/migrations.test.ts
git commit -m "feat: numbered migrations; the v4 schema becomes the baseline"
```

---

### Task 2: Pure dates in the domain

**Files:**
- Create: `packages/domain/src/dates.ts`, `packages/domain/tests/dates.test.ts`
- Modify: `packages/domain/src/index.ts` (export), `apps/api/src/dates.ts` (re-export `addMonths`, `addDays` from `@polaris/domain`)

**Interfaces:**
- Produces: `addMonths(iso: string, months: number): string`, `addDays(iso: string, days: number): string`.

- [ ] **Step 1: Failing test**

```ts
// packages/domain/tests/dates.test.ts
import { expect, test } from 'vitest';
import { addDays, addMonths } from '../src/dates.ts';

test('addMonths clamps to the end of a shorter month', () => {
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2026-09-01', 12)).toBe('2027-09-01');
});
test('addDays crosses a year boundary', () => {
  expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
});
```

- [ ] **Step 2: Run** — `npx vitest run packages/domain/tests/dates.test.ts` — FAIL, module missing.

- [ ] **Step 3: Implement** by moving the bodies of `addMonths`, `addDays` and the private `daysInMonth` from `apps/api/src/dates.ts` into `packages/domain/src/dates.ts` (they only use `Date.UTC`, so they are pure). In `apps/api/src/dates.ts` replace those two functions with `export { addMonths, addDays } from '@polaris/domain';`. Add `export * from './dates.ts';` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Run** — `npx vitest run` — all pass.

- [ ] **Step 5: Commit** — `git commit -am "refactor: month and day arithmetic moves into the pure domain"`

---

### Task 3: Billing types and the chart of accounts with posting rules

**Files:**
- Create: `packages/domain/src/billing/types.ts`, `packages/domain/src/billing/ledger.ts`, `packages/domain/src/billing/index.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './billing/index.ts';`)
- Test: `packages/domain/tests/billing/ledger.test.ts`

**Interfaces (produced, used by every later task):**

```ts
// types.ts
export type ChargeKind = 'prorata' | 'immediate' | 'passthrough';
export type ChargeCategory = 'premium' | 'tax' | 'fee' | 'other';
export interface ChargePatternDef {
  code: string; name: string; kind: ChargeKind; category: ChargeCategory;
  invoicing: 'spread' | 'single'; priority: number;
  commissionable: boolean; taxable: boolean; filingReference: string | null;
}
export type Periodicity = 'monthly' | 'quarterly' | 'annual';
export interface PaymentPlanDef {
  code: string; name: string;
  downPaymentBps: number;          // share of the charge billed at inception
  installments: number;            // count after the down payment
  periodicity: Periodicity;
  feePatternCode: string | null;   // charge pattern for the installment fee
  feeBps: number;                  // fee as share of the charge
  feeCapBps: number | null;        // regulatory cap (Ontario auto: 130)
  renewalDownPaymentBps: number | null;
  products: string[]; provinces: string[];
}
export interface TaxRateDef {
  code: string; province: string; line: string;   // line: 'auto' | 'property' | 'liability'
  rateBps: number; effectiveFrom: string; effectiveTo: string | null;
  appliesOn: 'billed' | 'paid'; patternCode: string;
}
export type InstructionType = 'newBusiness' | 'change' | 'cancellation' | 'reinstatement' | 'renewal' | 'adjustment';
export interface ChargeInput { patternCode: string; amountCents: number; effectiveDate: string; province: string; line: string }
export type ItemKind = 'downPayment' | 'installment' | 'oneTime' | 'fee' | 'tax';
export interface SlicedItem { kind: ItemKind; patternCode: string; amountCents: number; eventDate: string; sequence: number }
export type LedgerAccountCode =
  | '1100' | '1150' | '1200' | '2100' | '2200' | '2300' | '2400' | '2500' | '2600'
  | '4100' | '4200' | '5100' | '5200';
export interface Dimension { accountId?: string; policyId?: string; producerId?: string; province?: string; method?: string }
export interface JournalLineInput { account: LedgerAccountCode; dimension: Dimension; debitCents: number; creditCents: number }
export interface JournalEntryInput {
  effectiveDate: string; eventType: string; referenceKind: string; referenceId: string;
  reason: string | null; lines: JournalLineInput[];
}
export type BillingEvent =
  | { type: 'chargeBilled'; category: ChargeCategory; amountCents: number; effectiveDate: string; chargeId: string; accountId: string; policyId: string; province: string }
  | { type: 'earning'; amountCents: number; effectiveDate: string; policyId: string; accountId: string; versionId: string }
  | { type: 'paymentReceived'; amountCents: number; effectiveDate: string; paymentId: string; accountId: string; method: string }
  | { type: 'distribution'; amountCents: number; effectiveDate: string; applicationId: string; accountId: string; policyId: string };
```

- [ ] **Step 1: Failing test**

```ts
// packages/domain/tests/billing/ledger.test.ts
import { describe, expect, test } from 'vitest';
import { assertBalanced, LEDGER_ACCOUNTS, postingsFor } from '../../src/billing/ledger.ts';

const base = { effectiveDate: '2026-09-01', accountId: 'a1', policyId: 'p1' };

describe('posting rules', () => {
  test('the chart names every account the rules use', () => {
    expect(LEDGER_ACCOUNTS['1100']!.name).toBe('Premium receivable');
    expect(Object.keys(LEDGER_ACCOUNTS)).toHaveLength(13);
  });

  test('a premium charge debits receivable and credits unearned premium', () => {
    const entry = postingsFor({ type: 'chargeBilled', category: 'premium', amountCents: 120_000, chargeId: 'c1', province: 'ON', ...base });
    expect(entry.lines).toEqual([
      { account: '1100', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 120_000, creditCents: 0 },
      { account: '2200', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 0, creditCents: 120_000 },
    ]);
  });

  test('a negative premium charge reverses the direction', () => {
    const entry = postingsFor({ type: 'chargeBilled', category: 'premium', amountCents: -5_000, chargeId: 'c2', province: 'ON', ...base });
    expect(entry.lines[0]).toMatchObject({ account: '2200', debitCents: 5_000 });
    expect(entry.lines[1]).toMatchObject({ account: '1100', creditCents: 5_000 });
  });

  test('tax goes to tax payable by province and fees to fee income', () => {
    const tax = postingsFor({ type: 'chargeBilled', category: 'tax', amountCents: 800, chargeId: 'c3', province: 'ON', ...base });
    expect(tax.lines[1]).toMatchObject({ account: '2300', dimension: { accountId: 'a1', policyId: 'p1', province: 'ON' } });
    const fee = postingsFor({ type: 'chargeBilled', category: 'fee', amountCents: 300, chargeId: 'c4', province: 'ON', ...base });
    expect(fee.lines[1]).toMatchObject({ account: '4200' });
  });

  test('earning moves unearned to earned', () => {
    const e = postingsFor({ type: 'earning', amountCents: 10_000, effectiveDate: '2026-09-30', policyId: 'p1', accountId: 'a1', versionId: 'v1' });
    expect(e.lines).toEqual([
      { account: '2200', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 10_000, creditCents: 0 },
      { account: '4100', dimension: { accountId: 'a1', policyId: 'p1' }, debitCents: 0, creditCents: 10_000 },
    ]);
  });

  test('a payment lands in unapplied cash; distribution moves it to receivable', () => {
    const p = postingsFor({ type: 'paymentReceived', amountCents: 10_000, effectiveDate: '2026-09-01', paymentId: 'pay1', accountId: 'a1', method: 'eft' });
    expect(p.lines[0]).toMatchObject({ account: '1200', dimension: { accountId: 'a1', method: 'eft' }, debitCents: 10_000 });
    expect(p.lines[1]).toMatchObject({ account: '2100', creditCents: 10_000 });
    const d = postingsFor({ type: 'distribution', amountCents: 10_000, effectiveDate: '2026-09-01', applicationId: 'ap1', accountId: 'a1', policyId: 'p1' });
    expect(d.lines[0]).toMatchObject({ account: '2100', debitCents: 10_000 });
    expect(d.lines[1]).toMatchObject({ account: '1100', creditCents: 10_000 });
  });

  test('every rule balances and an unbalanced entry is refused', () => {
    for (const ev of [
      { type: 'chargeBilled', category: 'premium', amountCents: 7, chargeId: 'x', province: 'ON', ...base },
      { type: 'earning', amountCents: 7, effectiveDate: '2026-09-02', policyId: 'p1', accountId: 'a1', versionId: 'v1' },
    ] as const) {
      expect(() => assertBalanced(postingsFor(ev))).not.toThrow();
    }
    expect(() => assertBalanced({ effectiveDate: '2026-01-01', eventType: 'x', referenceKind: 'x', referenceId: 'x', reason: null,
      lines: [{ account: '1100', dimension: {}, debitCents: 1, creditCents: 0 }] })).toThrow(/does not balance/);
  });
});
```

- [ ] **Step 2: Run** — FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// packages/domain/src/billing/ledger.ts
import type { BillingEvent, Dimension, JournalEntryInput, JournalLineInput, LedgerAccountCode } from './types.ts';

export const LEDGER_ACCOUNTS: Record<LedgerAccountCode, { name: string; side: 'debit' | 'credit' }> = {
  '1100': { name: 'Premium receivable', side: 'debit' },
  '1150': { name: 'Producer receivable', side: 'debit' },
  '1200': { name: 'Cash clearing', side: 'debit' },
  '2100': { name: 'Unapplied cash', side: 'credit' },
  '2200': { name: 'Unearned premium', side: 'credit' },
  '2300': { name: 'Tax payable', side: 'credit' },
  '2400': { name: 'Commission payable', side: 'credit' },
  '2500': { name: 'Suspense', side: 'credit' },
  '2600': { name: 'Disbursement payable', side: 'credit' },
  '4100': { name: 'Earned premium', side: 'credit' },
  '4200': { name: 'Fee income', side: 'credit' },
  '5100': { name: 'Commission expense', side: 'debit' },
  '5200': { name: 'Write-offs', side: 'debit' },
};

export class UnbalancedEntryError extends Error {}

export function assertBalanced(entry: JournalEntryInput): void {
  const debits = entry.lines.reduce((s, l) => s + l.debitCents, 0);
  const credits = entry.lines.reduce((s, l) => s + l.creditCents, 0);
  if (debits !== credits || entry.lines.length < 2) {
    throw new UnbalancedEntryError(`Entry ${entry.eventType} does not balance: ${debits} vs ${credits}`);
  }
}

/** Two lines: debit `from`, credit `to`. A negative amount swaps the sides. */
function pair(from: LedgerAccountCode, to: LedgerAccountCode, amountCents: number, dim: Dimension, toDim: Dimension = dim): JournalLineInput[] {
  const a = Math.abs(amountCents);
  if (amountCents >= 0) {
    return [
      { account: from, dimension: dim, debitCents: a, creditCents: 0 },
      { account: to, dimension: toDim, debitCents: 0, creditCents: a },
    ];
  }
  return [
    { account: to, dimension: toDim, debitCents: a, creditCents: 0 },
    { account: from, dimension: dim, debitCents: 0, creditCents: a },
  ];
}

const CREDIT_SIDE_FOR_CATEGORY = { premium: '2200', tax: '2300', fee: '4200', other: '4200' } as const;

/** The posting rule for each billing event. Pure; the API persists the result. */
export function postingsFor(ev: BillingEvent): JournalEntryInput {
  switch (ev.type) {
    case 'chargeBilled': {
      const dim = { accountId: ev.accountId, policyId: ev.policyId };
      const to = CREDIT_SIDE_FOR_CATEGORY[ev.category];
      const toDim = ev.category === 'tax' ? { ...dim, province: ev.province } : dim;
      return { effectiveDate: ev.effectiveDate, eventType: 'chargeBilled', referenceKind: 'charge', referenceId: ev.chargeId, reason: null,
        lines: pair('1100', to, ev.amountCents, dim, toDim) };
    }
    case 'earning': {
      const dim = { accountId: ev.accountId, policyId: ev.policyId };
      return { effectiveDate: ev.effectiveDate, eventType: 'earning', referenceKind: 'policyVersion', referenceId: ev.versionId, reason: null,
        lines: pair('2200', '4100', ev.amountCents, dim) };
    }
    case 'paymentReceived': {
      return { effectiveDate: ev.effectiveDate, eventType: 'paymentReceived', referenceKind: 'payment', referenceId: ev.paymentId, reason: null,
        lines: pair('1200', '2100', ev.amountCents, { accountId: ev.accountId, method: ev.method }, { accountId: ev.accountId }) };
    }
    case 'distribution': {
      return { effectiveDate: ev.effectiveDate, eventType: 'distribution', referenceKind: 'paymentApplication', referenceId: ev.applicationId, reason: null,
        lines: pair('2100', '1100', ev.amountCents, { accountId: ev.accountId }, { accountId: ev.accountId, policyId: ev.policyId }) };
    }
  }
}
```

`index.ts` exports types, ledger. Add to `packages/domain/src/index.ts`.

- [ ] **Step 4: Run** — pass. **Step 5: Commit** — `feat(domain): chart of accounts and posting rules for billing events`

---

### Task 4: Splitting and slicing a charge by a payment plan

**Files:**
- Create: `packages/domain/src/billing/split.ts`, `packages/domain/src/billing/slicing.ts`
- Test: `packages/domain/tests/billing/slicing.test.ts`

**Interfaces:**
- Produces: `splitRemainderLast(totalCents, count): number[]`; `sliceCharge(input: { amountCents; patternCode; termStart; plan: PaymentPlanDef; instructionType; feePattern: ChargePatternDef | null }): SlicedItem[]`; `PlanCapError`.

- [ ] **Step 1: Failing tests**

```ts
// packages/domain/tests/billing/slicing.test.ts
import { describe, expect, test } from 'vitest';
import { sliceCharge } from '../../src/billing/slicing.ts';
import { splitRemainderLast } from '../../src/billing/split.ts';
import type { ChargePatternDef, PaymentPlanDef } from '../../src/billing/types.ts';

const FEE: ChargePatternDef = { code: 'FEE-INST', name: 'Installment fee', kind: 'immediate', category: 'fee', invoicing: 'spread', priority: 10, commissionable: false, taxable: false, filingReference: 'FSRA-2026-01' };
const monthly: PaymentPlanDef = { code: 'monthly', name: '12 monthly', downPaymentBps: 0, installments: 12, periodicity: 'monthly', feePatternCode: null, feeBps: 0, feeCapBps: null, renewalDownPaymentBps: null, products: ['ON_PA'], provinces: ['ON'] };
const twoDown: PaymentPlanDef = { ...monthly, code: 'monthly-2down', downPaymentBps: 1667, installments: 10, feePatternCode: 'FEE-INST', feeBps: 130, feeCapBps: 130 };

describe('splitRemainderLast', () => {
  test('the remainder lands on the last part', () => {
    expect(splitRemainderLast(100, 3)).toEqual([33, 33, 34]);
    expect(splitRemainderLast(-100, 3)).toEqual([-33, -33, -34]);
    expect(splitRemainderLast(5, 0)).toEqual([]);
  });
});

describe('sliceCharge', () => {
  const base = { amountCents: 120_005, patternCode: 'PREMIUM', termStart: '2026-09-01', instructionType: 'newBusiness' as const };

  test('12 monthly installments start at inception and sum to the charge', () => {
    const items = sliceCharge({ ...base, plan: monthly, feePattern: null });
    expect(items).toHaveLength(12);
    expect(items.map((i) => i.eventDate).slice(0, 2)).toEqual(['2026-09-01', '2026-10-01']);
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(120_005);
    expect(items[11]!.amountCents).toBe(10_005);
    expect(items.every((i) => i.kind === 'installment')).toBe(true);
  });

  test('a down payment is billed at inception and installments follow monthly', () => {
    const items = sliceCharge({ ...base, plan: twoDown, feePattern: FEE });
    const premium = items.filter((i) => i.patternCode === 'PREMIUM');
    expect(premium[0]).toMatchObject({ kind: 'downPayment', amountCents: 20_005, eventDate: '2026-09-01' });
    expect(premium).toHaveLength(11);
    expect(premium[1]!.eventDate).toBe('2026-10-01');
    expect(premium.reduce((s, i) => s + i.amountCents, 0)).toBe(120_005);
  });

  test('the installment fee is spread over the installments and capped', () => {
    const items = sliceCharge({ ...base, plan: twoDown, feePattern: FEE });
    const fees = items.filter((i) => i.kind === 'fee');
    expect(fees).toHaveLength(10);
    expect(fees.reduce((s, i) => s + i.amountCents, 0)).toBe(1_560); // 1.3% of 120,005 = 1560.07 → 1560
    expect(fees[0]!.eventDate).toBe('2026-10-01');
  });

  test('a fee above the regulatory cap is refused', () => {
    expect(() => sliceCharge({ ...base, plan: { ...twoDown, feeBps: 300 }, feePattern: FEE })).toThrow(/cap/);
  });

  test('a renewal uses the renewal down payment', () => {
    const items = sliceCharge({ ...base, instructionType: 'renewal', plan: { ...twoDown, renewalDownPaymentBps: 0, installments: 12 }, feePattern: null });
    expect(items[0]!.kind).toBe('installment');
    expect(items).toHaveLength(12);
  });

  test('a negative charge slices without losing a cent', () => {
    const items = sliceCharge({ ...base, amountCents: -1_001, plan: monthly, feePattern: null });
    expect(items.reduce((s, i) => s + i.amountCents, 0)).toBe(-1_001);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/domain/src/billing/split.ts
/** Equal parts; the rounding remainder goes to the LAST part; sign preserved. */
export function splitRemainderLast(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);
  const base = Math.floor(magnitude / count);
  const remainder = magnitude - base * count;
  return Array.from({ length: count }, (_, i) => sign * (base + (i === count - 1 ? remainder : 0)));
}

/** Basis-point share of an amount, rounded once. */
export function bpsOf(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}
```

```ts
// packages/domain/src/billing/slicing.ts
import { addMonths } from '../dates.ts';
import { bpsOf, splitRemainderLast } from './split.ts';
import type { ChargePatternDef, InstructionType, PaymentPlanDef, Periodicity, SlicedItem } from './types.ts';

const MONTHS: Record<Periodicity, number> = { monthly: 1, quarterly: 3, annual: 12 };

export class PlanCapError extends Error {}

export interface SliceInput {
  amountCents: number;
  patternCode: string;
  termStart: string;
  plan: PaymentPlanDef;
  instructionType: InstructionType;
  feePattern: ChargePatternDef | null;
}

/**
 * Slice a charge into invoice items: a down payment at inception (if the
 * plan has one), equal installments on the plan's cadence with the rounding
 * remainder on the last, and the installment fee spread over the
 * installments. Fees are never charged on a down payment.
 */
export function sliceCharge(input: SliceInput): SlicedItem[] {
  const { plan } = input;
  const downBps = input.instructionType === 'renewal' && plan.renewalDownPaymentBps !== null
    ? plan.renewalDownPaymentBps : plan.downPaymentBps;
  const items: SlicedItem[] = [];
  let sequence = 1;

  const down = downBps > 0 ? bpsOf(input.amountCents, downBps) : 0;
  if (down !== 0) {
    items.push({ kind: 'downPayment', patternCode: input.patternCode, amountCents: down, eventDate: input.termStart, sequence: sequence++ });
  }

  const firstOffset = down !== 0 ? 1 : 0;
  const parts = splitRemainderLast(input.amountCents - down, plan.installments);
  const dates = parts.map((_, i) => addMonths(input.termStart, (i + firstOffset) * MONTHS[plan.periodicity]));
  parts.forEach((amountCents, i) => {
    items.push({ kind: 'installment', patternCode: input.patternCode, amountCents, eventDate: dates[i]!, sequence: sequence++ });
  });

  if (input.feePattern && plan.feeBps > 0 && input.amountCents > 0) {
    if (plan.feeCapBps !== null && plan.feeBps > plan.feeCapBps) {
      throw new PlanCapError(`Plan ${plan.code} fee ${plan.feeBps} bps exceeds the cap of ${plan.feeCapBps} bps`);
    }
    const fee = bpsOf(input.amountCents, plan.feeBps);
    splitRemainderLast(fee, parts.length).forEach((amountCents, i) => {
      items.push({ kind: 'fee', patternCode: input.feePattern!.code, amountCents, eventDate: dates[i]!, sequence: sequence++ });
    });
  }
  return items;
}
```

- [ ] **Step 4: Run** — pass. **Step 5: Commit** — `feat(domain): slice a charge by a payment plan with down payment and capped fee`

---

### Task 5: Tax and earning

**Files:**
- Create: `packages/domain/src/billing/tax.ts`, `packages/domain/src/billing/earning.ts`
- Test: `packages/domain/tests/billing/tax.test.ts`, `packages/domain/tests/billing/earning.test.ts`

**Interfaces:**
- Produces: `taxRateFor(rates: TaxRateDef[], province, line, date): TaxRateDef | null`; `taxItemsFor(premiumItems: SlicedItem[], rate: TaxRateDef, nextSequence: number): SlicedItem[]`; `earnedCents(writtenCents, termStart, termEnd, asOf): number`.

- [ ] **Step 1: Failing tests**

```ts
// packages/domain/tests/billing/tax.test.ts
import { describe, expect, test } from 'vitest';
import { taxItemsFor, taxRateFor } from '../../src/billing/tax.ts';
import type { SlicedItem, TaxRateDef } from '../../src/billing/types.ts';

const RATES: TaxRateDef[] = [
  { code: 'ON-RST-PROP', province: 'ON', line: 'property', rateBps: 800, effectiveFrom: '2000-01-01', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
  { code: 'QC-IPT', province: 'QC', line: 'auto', rateBps: 900, effectiveFrom: '2000-01-01', effectiveTo: '2026-12-31', appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'QC-IPT-2027', province: 'QC', line: 'auto', rateBps: 998, effectiveFrom: '2027-01-01', effectiveTo: null, appliesOn: 'paid', patternCode: 'TAX-QC' },
];

describe('taxRateFor', () => {
  test('Ontario auto is exempt; Ontario property is taxed at 8%', () => {
    expect(taxRateFor(RATES, 'ON', 'auto', '2026-09-01')).toBeNull();
    expect(taxRateFor(RATES, 'ON', 'property', '2026-09-01')?.rateBps).toBe(800);
  });
  test('Quebec picks the rate in force on the date', () => {
    expect(taxRateFor(RATES, 'QC', 'auto', '2026-12-31')?.rateBps).toBe(900);
    expect(taxRateFor(RATES, 'QC', 'auto', '2027-01-01')?.rateBps).toBe(998);
  });
});

describe('taxItemsFor', () => {
  test('one tax item per premium item, rounded per item, same event date', () => {
    const premium: SlicedItem[] = [
      { kind: 'downPayment', patternCode: 'PREMIUM', amountCents: 20_005, eventDate: '2026-09-01', sequence: 1 },
      { kind: 'installment', patternCode: 'PREMIUM', amountCents: 10_000, eventDate: '2026-10-01', sequence: 2 },
    ];
    const tax = taxItemsFor(premium, RATES[0]!, 3);
    expect(tax).toEqual([
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 1_600, eventDate: '2026-09-01', sequence: 3 },
      { kind: 'tax', patternCode: 'TAX-RST', amountCents: 800, eventDate: '2026-10-01', sequence: 4 },
    ]);
  });
  test('fee items are never taxed', () => {
    const fee: SlicedItem[] = [{ kind: 'fee', patternCode: 'FEE-INST', amountCents: 100, eventDate: '2026-10-01', sequence: 1 }];
    expect(taxItemsFor(fee, RATES[0]!, 2)).toEqual([]);
  });
});
```

```ts
// packages/domain/tests/billing/earning.test.ts
import { expect, test } from 'vitest';
import { earnedCents } from '../../src/billing/earning.ts';

test('earned premium accrues daily pro rata', () => {
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2025-12-31')).toBe(0);
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2026-01-02')).toBe(1_000);
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2026-07-02')).toBe(182_000);
  expect(earnedCents(365_000, '2026-01-01', '2027-01-01', '2028-01-01')).toBe(365_000);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/domain/src/billing/tax.ts
import { bpsOf } from './split.ts';
import type { SlicedItem, TaxRateDef } from './types.ts';

export function taxRateFor(rates: TaxRateDef[], province: string, line: string, date: string): TaxRateDef | null {
  return rates.find((r) => r.province === province && r.line === line && r.effectiveFrom <= date && (r.effectiveTo === null || date <= r.effectiveTo)) ?? null;
}

/** A tax item beside every premium item — never beside a fee. Rounded per item, as the invoice will show it. */
export function taxItemsFor(items: SlicedItem[], rate: TaxRateDef, nextSequence: number): SlicedItem[] {
  let sequence = nextSequence;
  return items
    .filter((i) => i.kind === 'downPayment' || i.kind === 'installment' || i.kind === 'oneTime')
    .map((i) => ({ kind: 'tax' as const, patternCode: rate.patternCode, amountCents: bpsOf(i.amountCents, rate.rateBps), eventDate: i.eventDate, sequence: sequence++ }));
}
```

```ts
// packages/domain/src/billing/earning.ts
import { daysBetween, prorate } from '../proration.ts';

/** Premium earned by the start of `asOf`, daily pro rata over [termStart, termEnd). */
export function earnedCents(writtenCents: number, termStart: string, termEnd: string, asOf: string): number {
  if (asOf <= termStart) return 0;
  if (asOf >= termEnd) return writtenCents;
  return prorate(writtenCents, daysBetween(termStart, asOf), daysBetween(termStart, termEnd));
}
```

- [ ] **Step 4: Run** — pass. **Step 5: Commit** — `feat(domain): retail sales tax by province and date; daily earned premium`

---

### Task 6: Re-spreading a change over remaining invoices

**Files:**
- Create: `packages/domain/src/billing/respread.ts`
- Test: `packages/domain/tests/billing/respread.test.ts`

**Interfaces:**
- Produces:
```ts
export interface OpenInvoice { invoiceId: string; eventDate: string; outstandingCents: number }
export interface RespreadResult { onInvoices: { invoiceId: string; eventDate: string; amountCents: number }[]; unabsorbedCents: number }
export function respreadOnChange(deltaCents: number, planned: OpenInvoice[]): RespreadResult
```

- [ ] **Step 1: Failing test**

```ts
// packages/domain/tests/billing/respread.test.ts
import { describe, expect, test } from 'vitest';
import { respreadOnChange } from '../../src/billing/respread.ts';

const planned = [
  { invoiceId: 'i3', eventDate: '2026-11-01', outstandingCents: 10_000 },
  { invoiceId: 'i4', eventDate: '2026-12-01', outstandingCents: 10_000 },
  { invoiceId: 'i5', eventDate: '2027-01-01', outstandingCents: 10_000 },
];

describe('respreadOnChange', () => {
  test('additional premium spreads evenly, remainder last', () => {
    const r = respreadOnChange(1_000, planned);
    expect(r.onInvoices.map((x) => x.amountCents)).toEqual([333, 333, 334]);
    expect(r.unabsorbedCents).toBe(0);
  });
  test('return premium comes off the latest invoices first and never below zero', () => {
    const r = respreadOnChange(-25_000, planned);
    expect(r.onInvoices).toEqual([
      { invoiceId: 'i5', eventDate: '2027-01-01', amountCents: -10_000 },
      { invoiceId: 'i4', eventDate: '2026-12-01', amountCents: -10_000 },
      { invoiceId: 'i3', eventDate: '2026-11-01', amountCents: -5_000 },
    ]);
    expect(r.unabsorbedCents).toBe(0);
  });
  test('what the planned invoices cannot absorb is reported back as credit', () => {
    const r = respreadOnChange(-35_000, planned);
    expect(r.unabsorbedCents).toBe(-5_000);
  });
  test('with nothing planned the whole delta is unabsorbed', () => {
    expect(respreadOnChange(700, [])).toEqual({ onInvoices: [], unabsorbedCents: 700 });
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
// packages/domain/src/billing/respread.ts
import { splitRemainderLast } from './split.ts';

export interface OpenInvoice { invoiceId: string; eventDate: string; outstandingCents: number }
export interface RespreadResult {
  onInvoices: { invoiceId: string; eventDate: string; amountCents: number }[];
  unabsorbedCents: number;
}

/**
 * Additional premium spreads evenly over the planned invoices; return
 * premium comes off the latest first so the next payment drops before the
 * last one does. Nothing here edits an item: the caller writes these as new
 * offsetting items.
 */
export function respreadOnChange(deltaCents: number, planned: OpenInvoice[]): RespreadResult {
  if (deltaCents === 0 || planned.length === 0) return { onInvoices: [], unabsorbedCents: deltaCents };
  if (deltaCents > 0) {
    const parts = splitRemainderLast(deltaCents, planned.length);
    return { onInvoices: planned.map((p, i) => ({ invoiceId: p.invoiceId, eventDate: p.eventDate, amountCents: parts[i]! })), unabsorbedCents: 0 };
  }
  let remaining = -deltaCents;
  const onInvoices: RespreadResult['onInvoices'] = [];
  for (const p of [...planned].sort((a, b) => b.eventDate.localeCompare(a.eventDate))) {
    if (remaining === 0) break;
    const take = Math.min(p.outstandingCents, remaining);
    if (take > 0) { onInvoices.push({ invoiceId: p.invoiceId, eventDate: p.eventDate, amountCents: -take }); remaining -= take; }
  }
  return { onInvoices, unabsorbedCents: -remaining };
}
```

- [ ] **Step 4: Run** — pass. **Step 5: Commit** — `feat(domain): re-spread a mid-term change over planned invoices`

---

### Task 7: The shipped catalogue and product billing configuration

**Files:**
- Create: `packages/domain/src/billing/defaultPlans.ts`
- Modify: `packages/domain/src/types.ts` (`ProductDefinition.billing`), `packages/domain/src/product.ts`
- Test: `packages/domain/tests/billing/defaultPlans.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CHARGE_PATTERNS: ChargePatternDef[]`, `DEFAULT_PAYMENT_PLANS: PaymentPlanDef[]`, `DEFAULT_TAX_RATES: TaxRateDef[]`; `ProductDefinition.billing: { premiumPatternCode: string; line: string; defaultPaymentPlan: string; allowedFeePatterns: string[] }`.

- [ ] **Step 1: Failing test**

```ts
// packages/domain/tests/billing/defaultPlans.test.ts
import { expect, test } from 'vitest';
import { DEFAULT_CHARGE_PATTERNS, DEFAULT_PAYMENT_PLANS, DEFAULT_TAX_RATES } from '../../src/billing/defaultPlans.ts';
import { ontarioAutoV1 } from '../../src/product.ts';

test('the three legacy plan codes survive as real plans', () => {
  expect(DEFAULT_PAYMENT_PLANS.map((p) => p.code)).toEqual(expect.arrayContaining(['full', 'monthly', 'quarterly', 'monthly-2down']));
});
test('every plan fee pattern and every tax pattern exists', () => {
  const codes = new Set(DEFAULT_CHARGE_PATTERNS.map((p) => p.code));
  for (const p of DEFAULT_PAYMENT_PLANS) if (p.feePatternCode) expect(codes.has(p.feePatternCode)).toBe(true);
  for (const r of DEFAULT_TAX_RATES) expect(codes.has(r.patternCode)).toBe(true);
});
test('Ontario auto plans respect the 1.3% cap and the product names its billing', () => {
  for (const p of DEFAULT_PAYMENT_PLANS.filter((p) => p.products.includes('ON_PA'))) expect(p.feeBps).toBeLessThanOrEqual(130);
  expect(ontarioAutoV1.billing).toEqual({ premiumPatternCode: 'PREMIUM', line: 'auto', defaultPaymentPlan: 'monthly', allowedFeePatterns: ['FEE-INST', 'FEE-NSF', 'FEE-REINSTATE'] });
});
test('Ontario auto is RST-exempt and Ontario property is not', () => {
  expect(DEFAULT_TAX_RATES.find((r) => r.province === 'ON' && r.line === 'auto')).toBeUndefined();
  expect(DEFAULT_TAX_RATES.find((r) => r.province === 'ON' && r.line === 'property')?.rateBps).toBe(800);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
// packages/domain/src/billing/defaultPlans.ts
import type { ChargePatternDef, PaymentPlanDef, TaxRateDef } from './types.ts';

/**
 * Illustrative configuration. A carrier replaces these with its filed
 * values; the filing references below are placeholders, not filings.
 */
export const DEFAULT_CHARGE_PATTERNS: ChargePatternDef[] = [
  { code: 'PREMIUM', name: 'Premium', kind: 'prorata', category: 'premium', invoicing: 'spread', priority: 50, commissionable: true, taxable: true, filingReference: null },
  { code: 'FEE-INST', name: 'Installment fee', kind: 'immediate', category: 'fee', invoicing: 'spread', priority: 10, commissionable: false, taxable: false, filingReference: 'SAMPLE-FILING' },
  { code: 'FEE-NSF', name: 'Returned payment fee', kind: 'immediate', category: 'fee', invoicing: 'single', priority: 5, commissionable: false, taxable: false, filingReference: 'SAMPLE-FILING' },
  { code: 'FEE-REINSTATE', name: 'Reinstatement fee', kind: 'immediate', category: 'fee', invoicing: 'single', priority: 5, commissionable: false, taxable: false, filingReference: 'SAMPLE-FILING' },
  { code: 'TAX-RST', name: 'Retail sales tax', kind: 'passthrough', category: 'tax', invoicing: 'spread', priority: 40, commissionable: false, taxable: false, filingReference: null },
  { code: 'TAX-QC', name: 'Quebec tax on insurance premiums', kind: 'passthrough', category: 'tax', invoicing: 'spread', priority: 40, commissionable: false, taxable: false, filingReference: null },
];

const ALL = ['ON_PA'];
const ON = ['ON'];

export const DEFAULT_PAYMENT_PLANS: PaymentPlanDef[] = [
  { code: 'full', name: 'Pay in full', downPaymentBps: 0, installments: 1, periodicity: 'annual', feePatternCode: null, feeBps: 0, feeCapBps: 130, renewalDownPaymentBps: null, products: ALL, provinces: ON },
  { code: 'monthly', name: '12 monthly payments', downPaymentBps: 0, installments: 12, periodicity: 'monthly', feePatternCode: 'FEE-INST', feeBps: 130, feeCapBps: 130, renewalDownPaymentBps: null, products: ALL, provinces: ON },
  { code: 'monthly-2down', name: 'Two months down, 10 monthly', downPaymentBps: 1667, installments: 10, periodicity: 'monthly', feePatternCode: 'FEE-INST', feeBps: 130, feeCapBps: 130, renewalDownPaymentBps: 0, products: ALL, provinces: ON },
  { code: 'quarterly', name: '4 quarterly payments', downPaymentBps: 0, installments: 4, periodicity: 'quarterly', feePatternCode: 'FEE-INST', feeBps: 65, feeCapBps: 130, renewalDownPaymentBps: null, products: ALL, provinces: ON },
];

export const DEFAULT_TAX_RATES: TaxRateDef[] = [
  { code: 'ON-RST-PROPERTY', province: 'ON', line: 'property', rateBps: 800, effectiveFrom: '2000-01-01', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
  { code: 'QC-IPT', province: 'QC', line: 'auto', rateBps: 900, effectiveFrom: '2000-01-01', effectiveTo: '2026-12-31', appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'QC-IPT-2027', province: 'QC', line: 'auto', rateBps: 998, effectiveFrom: '2027-01-01', effectiveTo: null, appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'QC-IPT-PROPERTY', province: 'QC', line: 'property', rateBps: 900, effectiveFrom: '2000-01-01', effectiveTo: '2026-12-31', appliesOn: 'paid', patternCode: 'TAX-QC' },
  { code: 'SK-PST', province: 'SK', line: 'auto', rateBps: 600, effectiveFrom: '2017-08-01', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
  { code: 'MB-RST-LIAB', province: 'MB', line: 'liability', rateBps: 700, effectiveFrom: '2012-07-15', effectiveTo: null, appliesOn: 'billed', patternCode: 'TAX-RST' },
];
```

Add to `ProductDefinition` in `types.ts`:
```ts
  /** How this product is billed: which pattern its premium uses, its tax line, and which fees may be charged. */
  billing: { premiumPatternCode: string; line: string; defaultPaymentPlan: string; allowedFeePatterns: string[] };
```
and in `product.ts` set `billing: { premiumPatternCode: 'PREMIUM', line: 'auto', defaultPaymentPlan: 'monthly', allowedFeePatterns: ['FEE-INST', 'FEE-NSF', 'FEE-REINSTATE'] }`. Export `defaultPlans` from `billing/index.ts`.

- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — pass. **Step 5: Commit** — `feat(domain): shipped billing catalogue and product billing configuration`

---

### Task 8: Migration 002 — billing tables, catalogue rows, legacy conversion

**Files:**
- Create: `apps/api/src/migrations/002_billing.ts`
- Modify: `apps/api/src/migrations/index.ts` (register)
- Test: extend `apps/api/tests/migrations.test.ts`

**Tables created (all with `tenant_id TEXT NOT NULL REFERENCES tenants(id)`):**

```sql
CREATE TABLE IF NOT EXISTS charge_patterns (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('prorata','immediate','passthrough')),
  category TEXT NOT NULL CHECK (category IN ('premium','tax','fee','other')),
  invoicing TEXT NOT NULL CHECK (invoicing IN ('spread','single')), priority INTEGER NOT NULL,
  commissionable INTEGER NOT NULL, taxable INTEGER NOT NULL, filing_reference TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS charge_patterns_code ON charge_patterns(tenant_id, code);

CREATE TABLE IF NOT EXISTS payment_plans (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, name TEXT NOT NULL,
  down_payment_bps INTEGER NOT NULL, installments INTEGER NOT NULL,
  periodicity TEXT NOT NULL CHECK (periodicity IN ('monthly','quarterly','annual')),
  fee_pattern_code TEXT, fee_bps INTEGER NOT NULL, fee_cap_bps INTEGER, renewal_down_payment_bps INTEGER,
  products_json TEXT NOT NULL, provinces_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS payment_plans_code ON payment_plans(tenant_id, code);

CREATE TABLE IF NOT EXISTS tax_rates (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, province TEXT NOT NULL, line TEXT NOT NULL,
  rate_bps INTEGER NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
  applies_on TEXT NOT NULL CHECK (applies_on IN ('billed','paid')), pattern_code TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tax_rates_lookup ON tax_rates(tenant_id, province, line, effective_from);

CREATE TABLE IF NOT EXISTS ledger_accounts (id TEXT PRIMARY KEY, tenant_id, code TEXT NOT NULL, name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('debit','credit')), gl_code TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_code ON ledger_accounts(tenant_id, code);

CREATE TABLE IF NOT EXISTS journal_entries (id TEXT PRIMARY KEY, tenant_id, posted_at TEXT NOT NULL, effective_date TEXT NOT NULL,
  event_type TEXT NOT NULL, reference_kind TEXT NOT NULL, reference_id TEXT NOT NULL, actor_user_id TEXT,
  reversal_of TEXT REFERENCES journal_entries(id), reason TEXT);
CREATE INDEX IF NOT EXISTS journal_entries_ref ON journal_entries(tenant_id, reference_kind, reference_id);
CREATE INDEX IF NOT EXISTS journal_entries_date ON journal_entries(tenant_id, effective_date);

CREATE TABLE IF NOT EXISTS journal_lines (id TEXT PRIMARY KEY, tenant_id, entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL, account_id TEXT, policy_id TEXT, producer_id TEXT, province TEXT, method TEXT,
  debit_cents INTEGER NOT NULL DEFAULT 0, credit_cents INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(tenant_id, account_code, account_id);
CREATE INDEX IF NOT EXISTS journal_lines_policy ON journal_lines(tenant_id, account_code, policy_id);
CREATE INDEX IF NOT EXISTS journal_lines_entry ON journal_lines(tenant_id, entry_id);

CREATE TABLE IF NOT EXISTS billing_instructions (id TEXT PRIMARY KEY, tenant_id, policy_id TEXT NOT NULL REFERENCES policies(id),
  policy_version_id TEXT NOT NULL, transaction_id TEXT, type TEXT NOT NULL, payment_plan_code TEXT NOT NULL,
  billing_method TEXT NOT NULL DEFAULT 'direct', effective_date TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS billing_instructions_policy ON billing_instructions(tenant_id, policy_id);

CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, tenant_id, instruction_id TEXT NOT NULL REFERENCES billing_instructions(id),
  account_id TEXT NOT NULL, policy_id TEXT NOT NULL, pattern_code TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  effective_date TEXT NOT NULL, province TEXT NOT NULL, line TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS charges_policy ON charges(tenant_id, policy_id);

CREATE TABLE IF NOT EXISTS invoice_streams (id TEXT PRIMARY KEY, tenant_id, account_id TEXT NOT NULL, policy_id TEXT,
  anchor_date TEXT NOT NULL, periodicity TEXT NOT NULL, lead_days INTEGER NOT NULL DEFAULT 21, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS invoice_streams_account ON invoice_streams(tenant_id, account_id);

CREATE TABLE IF NOT EXISTS billing_invoices (id TEXT PRIMARY KEY, tenant_id, account_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  stream_id TEXT NOT NULL REFERENCES invoice_streams(id), invoice_number TEXT NOT NULL, sequence INTEGER NOT NULL,
  term_number INTEGER NOT NULL, event_date TEXT NOT NULL, bill_date TEXT NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','billed','paid','void')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_number ON billing_invoices(tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS billing_invoices_policy ON billing_invoices(tenant_id, policy_id, sequence);
CREATE INDEX IF NOT EXISTS billing_invoices_account ON billing_invoices(tenant_id, account_id, due_date);
CREATE INDEX IF NOT EXISTS billing_invoices_bill ON billing_invoices(tenant_id, status, bill_date);

CREATE TABLE IF NOT EXISTS invoice_items (id TEXT PRIMARY KEY, tenant_id, charge_id TEXT NOT NULL REFERENCES charges(id),
  invoice_id TEXT NOT NULL REFERENCES billing_invoices(id), account_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('downPayment','installment','oneTime','fee','tax')), pattern_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, event_date TEXT NOT NULL, sequence INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0, offsets_item_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS invoice_items_invoice ON invoice_items(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS invoice_items_policy ON invoice_items(tenant_id, policy_id);
CREATE INDEX IF NOT EXISTS invoice_items_account ON invoice_items(tenant_id, account_id, event_date);

CREATE TABLE IF NOT EXISTS item_applications (id TEXT PRIMARY KEY, tenant_id, payment_id TEXT NOT NULL REFERENCES payments(id),
  item_id TEXT NOT NULL REFERENCES invoice_items(id), amount_cents INTEGER NOT NULL, reversed_by TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS item_applications_item ON item_applications(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS item_applications_payment ON item_applications(tenant_id, payment_id);

CREATE TABLE IF NOT EXISTS billing_runs (id TEXT PRIMARY KEY, tenant_id, run_date TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, summary_json TEXT NOT NULL DEFAULT '{}');
CREATE UNIQUE INDEX IF NOT EXISTS billing_runs_date ON billing_runs(tenant_id, run_date);

CREATE TABLE IF NOT EXISTS earning_snapshots (id TEXT PRIMARY KEY, tenant_id, policy_version_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  as_of TEXT NOT NULL, written_cents INTEGER NOT NULL, earned_cents INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS earning_snapshots_version ON earning_snapshots(tenant_id, policy_version_id, as_of);

ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'cleared';
ALTER TABLE payments ADD COLUMN created_by TEXT;
ALTER TABLE payments ADD COLUMN policy_id TEXT;
```

The old `invoices` and `payment_applications` tables are renamed `legacy_invoices` / `legacy_payment_applications` after conversion (SQLite `ALTER TABLE ... RENAME TO`), never dropped in this PR.

- [ ] **Step 1: Failing test** (append to `migrations.test.ts`)

```ts
import { bootstrapTenant } from '../src/bootstrap.ts';

test('migration 002 seeds the catalogue for every tenant and converts legacy invoices', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = 4');
  MIGRATIONS[0]!.up(db);                      // v4 schema only
  db.exec(`INSERT INTO schema_migrations (id, name, applied_at) VALUES (1, 'baseline', '2026-01-01')`);
  bootstrapTenant(db, 'Old Carrier', 'OLD');
  const tenantId = (db.prepare('SELECT id FROM tenants').get() as { id: string }).id;
  db.exec(`INSERT INTO accounts (id, tenant_id, account_number, account_type, name, address_line1, city, province, postal_code, created_at, updated_at)
    VALUES ('acc1','${tenantId}','OLD-A0001','person','Legacy Person','1 St','Ottawa','ON','K1A 0A1','2026-01-01','2026-01-01')`);
  db.exec(`INSERT INTO policies (id, tenant_id, account_id, policy_number, product_code, status, billing_plan, created_at, updated_at)
    VALUES ('pol1','${tenantId}','acc1','OLD-000001','ON_PA','InForce','monthly','2026-01-01','2026-01-01')`);
  db.exec(`INSERT INTO invoices (id, tenant_id, account_id, policy_id, invoice_number, sequence, term_number, due_date, amount_cents, paid_cents, status, created_at, updated_at)
    VALUES ('inv1','${tenantId}','acc1','pol1','OLD-000001-01',1,1,'2026-09-01',10000,10000,'paid','2026-01-01','2026-01-01'),
           ('inv2','${tenantId}','acc1','pol1','OLD-000001-02',2,1,'2026-10-01',10000,0,'open','2026-01-01','2026-01-01'),
           ('inv3','${tenantId}','acc1','pol1','OLD-000001-03',3,1,'2026-11-01',0,0,'void','2026-01-01','2026-01-01')`);
  db.exec(`INSERT INTO payments (id, tenant_id, account_id, amount_cents, method, received_at, created_at)
    VALUES ('pay1','${tenantId}','acc1',10000,'eft','2026-09-01','2026-09-01')`);
  db.exec(`INSERT INTO payment_applications (id, tenant_id, payment_id, invoice_id, amount_cents, created_at)
    VALUES ('app1','${tenantId}','pay1','inv1',10000,'2026-09-01')`);

  migrate(db);

  expect((db.prepare('SELECT count(*) AS n FROM payment_plans WHERE tenant_id = ?').get(tenantId) as { n: number }).n).toBe(4);
  expect((db.prepare('SELECT count(*) AS n FROM ledger_accounts WHERE tenant_id = ?').get(tenantId) as { n: number }).n).toBe(13);
  const items = db.prepare('SELECT amount_cents, paid_cents FROM invoice_items WHERE policy_id = ? ORDER BY sequence').all('pol1') as { amount_cents: number; paid_cents: number }[];
  expect(items).toEqual([{ amount_cents: 10000, paid_cents: 10000 }, { amount_cents: 10000, paid_cents: 0 }]);
  const receivable = db.prepare(`SELECT SUM(debit_cents) - SUM(credit_cents) AS bal FROM journal_lines WHERE account_code = '1100' AND account_id = 'acc1'`).get() as { bal: number };
  expect(receivable.bal).toBe(10000);
  const unbalanced = db.prepare(`SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING SUM(debit_cents) <> SUM(credit_cents)`).all();
  expect(unbalanced).toEqual([]);
  expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'legacy_invoices'`).get()).toBeTruthy();
});
```

- [ ] **Step 2: Run** — FAIL (no migration 2).

- [ ] **Step 3: Implement `002_billing.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { DEFAULT_CHARGE_PATTERNS, DEFAULT_PAYMENT_PLANS, DEFAULT_TAX_RATES, LEDGER_ACCOUNTS, postingsFor } from '@polaris/domain';
import type { JournalEntryInput } from '@polaris/domain';
import type { Db } from '../db.ts';
import type { Migration } from './index.ts';

const TABLES = ` ...the CREATE TABLE / INDEX block above, verbatim... `;

function now(): string { return new Date().toISOString(); }

/** Seed the catalogue for one tenant. Also called by bootstrap for new tenants (Task 9). */
export function seedBillingCatalogue(db: Db, tenantId: string): void {
  const ts = now();
  for (const p of DEFAULT_CHARGE_PATTERNS) {
    db.prepare(`INSERT OR IGNORE INTO charge_patterns (id, tenant_id, code, name, kind, category, invoicing, priority, commissionable, taxable, filing_reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), tenantId, p.code, p.name, p.kind, p.category, p.invoicing, p.priority, p.commissionable ? 1 : 0, p.taxable ? 1 : 0, p.filingReference, ts);
  }
  for (const p of DEFAULT_PAYMENT_PLANS) {
    db.prepare(`INSERT OR IGNORE INTO payment_plans (id, tenant_id, code, name, down_payment_bps, installments, periodicity, fee_pattern_code, fee_bps, fee_cap_bps, renewal_down_payment_bps, products_json, provinces_json, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(randomUUID(), tenantId, p.code, p.name, p.downPaymentBps, p.installments, p.periodicity, p.feePatternCode, p.feeBps, p.feeCapBps, p.renewalDownPaymentBps, JSON.stringify(p.products), JSON.stringify(p.provinces), ts);
  }
  for (const r of DEFAULT_TAX_RATES) {
    db.prepare(`INSERT OR IGNORE INTO tax_rates (id, tenant_id, code, province, line, rate_bps, effective_from, effective_to, applies_on, pattern_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), tenantId, r.code, r.province, r.line, r.rateBps, r.effectiveFrom, r.effectiveTo, r.appliesOn, r.patternCode, ts);
  }
  for (const [code, acct] of Object.entries(LEDGER_ACCOUNTS)) {
    db.prepare(`INSERT OR IGNORE INTO ledger_accounts (id, tenant_id, code, name, side, gl_code, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`).run(randomUUID(), tenantId, code, acct.name, acct.side, ts);
  }
}

function writeEntry(db: Db, tenantId: string, entry: JournalEntryInput): void {
  const id = randomUUID();
  db.prepare(`INSERT INTO journal_entries (id, tenant_id, posted_at, effective_date, event_type, reference_kind, reference_id, actor_user_id, reversal_of, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`).run(id, tenantId, now(), entry.effectiveDate, entry.eventType, entry.referenceKind, entry.referenceId, entry.reason);
  for (const l of entry.lines) {
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, entry_id, account_code, account_id, policy_id, producer_id, province, method, debit_cents, credit_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), tenantId, id, l.account, l.dimension.accountId ?? null, l.dimension.policyId ?? null, l.dimension.producerId ?? null, l.dimension.province ?? null, l.dimension.method ?? null, l.debitCents, l.creditCents);
  }
}

interface LegacyInvoice { id: string; tenant_id: string; account_id: string; policy_id: string; invoice_number: string; sequence: number; term_number: number; due_date: string; amount_cents: number; paid_cents: number; status: string }

/** One premium charge and one item per non-void legacy invoice; postings to match. */
function convertLegacy(db: Db): void {
  const ts = now();
  const invoices = db.prepare(`SELECT * FROM invoices WHERE status <> 'void' ORDER BY tenant_id, policy_id, sequence`).all() as LegacyInvoice[];
  const streams = new Map<string, string>();
  const instructions = new Map<string, string>();
  const itemByInvoice = new Map<string, string>();
  for (const inv of invoices) {
    const policy = db.prepare('SELECT * FROM policies WHERE id = ?').get(inv.policy_id) as { billing_plan: string } | undefined;
    const version = db.prepare('SELECT id, term_start FROM policy_versions WHERE policy_id = ? ORDER BY version_number LIMIT 1').get(inv.policy_id) as { id: string; term_start: string } | undefined;
    const account = db.prepare('SELECT province FROM accounts WHERE id = ?').get(inv.account_id) as { province: string };
    let streamId = streams.get(inv.policy_id);
    if (!streamId) {
      streamId = randomUUID();
      db.prepare(`INSERT INTO invoice_streams (id, tenant_id, account_id, policy_id, anchor_date, periodicity, lead_days, created_at) VALUES (?, ?, ?, ?, ?, 'monthly', 21, ?)`)
        .run(streamId, inv.tenant_id, inv.account_id, inv.policy_id, version?.term_start ?? inv.due_date, ts);
      streams.set(inv.policy_id, streamId);
    }
    let instructionId = instructions.get(inv.policy_id);
    if (!instructionId) {
      instructionId = randomUUID();
      db.prepare(`INSERT INTO billing_instructions (id, tenant_id, policy_id, policy_version_id, transaction_id, type, payment_plan_code, billing_method, effective_date, created_at)
        VALUES (?, ?, ?, ?, NULL, 'adjustment', ?, 'direct', ?, ?)`).run(instructionId, inv.tenant_id, inv.policy_id, version?.id ?? 'legacy', policy?.billing_plan ?? 'monthly', inv.due_date, ts);
      instructions.set(inv.policy_id, instructionId);
    }
    const chargeId = randomUUID();
    db.prepare(`INSERT INTO charges (id, tenant_id, instruction_id, account_id, policy_id, pattern_code, amount_cents, effective_date, province, line, created_at) VALUES (?, ?, ?, ?, ?, 'PREMIUM', ?, ?, ?, 'auto', ?)`)
      .run(chargeId, inv.tenant_id, instructionId, inv.account_id, inv.policy_id, inv.amount_cents, inv.due_date, account.province, ts);
    const invoiceId = randomUUID();
    db.prepare(`INSERT INTO billing_invoices (id, tenant_id, account_id, policy_id, stream_id, invoice_number, sequence, term_number, event_date, bill_date, due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invoiceId, inv.tenant_id, inv.account_id, inv.policy_id, streamId, inv.invoice_number, inv.sequence, inv.term_number, inv.due_date, inv.due_date, inv.due_date, inv.status === 'paid' ? 'paid' : 'billed', ts, ts);
    const itemId = randomUUID();
    db.prepare(`INSERT INTO invoice_items (id, tenant_id, charge_id, invoice_id, account_id, policy_id, kind, pattern_code, amount_cents, event_date, sequence, paid_cents, offsets_item_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'installment', 'PREMIUM', ?, ?, 1, ?, NULL, ?)`)
      .run(itemId, inv.tenant_id, chargeId, invoiceId, inv.account_id, inv.policy_id, inv.amount_cents, inv.due_date, inv.paid_cents, ts);
    itemByInvoice.set(inv.id, itemId);
    writeEntry(db, inv.tenant_id, postingsFor({ type: 'chargeBilled', category: 'premium', amountCents: inv.amount_cents, effectiveDate: inv.due_date, chargeId, accountId: inv.account_id, policyId: inv.policy_id, province: account.province }));
  }
  const payments = db.prepare('SELECT * FROM payments').all() as { id: string; tenant_id: string; account_id: string; amount_cents: number; method: string; received_at: string }[];
  for (const p of payments) {
    writeEntry(db, p.tenant_id, postingsFor({ type: 'paymentReceived', amountCents: p.amount_cents, effectiveDate: p.received_at, paymentId: p.id, accountId: p.account_id, method: p.method }));
    const apps = db.prepare('SELECT * FROM payment_applications WHERE payment_id = ?').all(p.id) as { id: string; invoice_id: string; amount_cents: number; created_at: string }[];
    for (const a of apps) {
      const itemId = itemByInvoice.get(a.invoice_id);
      if (!itemId) continue;
      const policyId = (db.prepare('SELECT policy_id FROM invoice_items WHERE id = ?').get(itemId) as { policy_id: string }).policy_id;
      const appId = randomUUID();
      db.prepare(`INSERT INTO item_applications (id, tenant_id, payment_id, item_id, amount_cents, reversed_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`).run(appId, p.tenant_id, p.id, itemId, a.amount_cents, a.created_at);
      writeEntry(db, p.tenant_id, postingsFor({ type: 'distribution', amountCents: a.amount_cents, effectiveDate: p.received_at, applicationId: appId, accountId: p.account_id, policyId }));
    }
  }
  db.exec('ALTER TABLE invoices RENAME TO legacy_invoices');
  db.exec('ALTER TABLE payment_applications RENAME TO legacy_payment_applications');
}

export const billing: Migration = {
  id: 2,
  name: 'billing',
  up(db: Db) {
    db.exec(TABLES);
    for (const t of db.prepare('SELECT id FROM tenants').all() as { id: string }[]) seedBillingCatalogue(db, t.id);
    convertLegacy(db);
  },
};
```

Register in `index.ts`: `export const MIGRATIONS: Migration[] = [baseline, billing];`. In `bootstrap.ts`, after `repo.createTenant`, call `seedBillingCatalogue(db, tenant.id)` so new tenants get the catalogue too.

- [ ] **Step 4: Run** `npx vitest run apps/api/tests/migrations.test.ts` — pass. Then `npx vitest run` — expect the old billing/accounts tests to FAIL because `invoices` no longer exists; that is expected until Task 11 and is why Tasks 8–11 land on the branch together before merge.

- [ ] **Step 5: Commit** — `feat: migration 002 — billing tables, catalogue, legacy conversion`

---

### Task 9: Repos — configuration, journal, billing items

**Files:**
- Create: `apps/api/src/repo/billingConfig.ts`, `apps/api/src/repo/journal.ts`, `apps/api/src/repo/billingItems.ts`
- Modify: `apps/api/src/repo/shared.ts` (row types), `apps/api/src/repo.ts` (re-export), `apps/api/src/repo/ledger.ts` (remove invoice/application functions; keep transactions and payments; add `status`, `created_by`, `policy_id` to `PaymentRow` and `insertPayment`)
- Test: `apps/api/tests/repo.billing.test.ts`

**Interfaces produced:**

```ts
// billingConfig.ts
listChargePatterns(db, ctx): ChargePatternDef[]
getChargePattern(db, ctx, code): ChargePatternDef | null
listPaymentPlans(db, ctx, filter?: { productCode?: string; province?: string }): PaymentPlanDef[]
getPaymentPlan(db, ctx, code): PaymentPlanDef | null
listTaxRates(db, ctx): TaxRateDef[]
// journal.ts
postEntry(db, ctx, entry: JournalEntryInput): JournalEntryRow      // asserts balance, writes entry + lines
accountBalance(db, ctx, code: LedgerAccountCode, dim: { accountId?: string; policyId?: string }): number  // debits − credits
listEntries(db, ctx, ref: { kind: string; id: string }): JournalEntryRow[]
// billingItems.ts
insertInstruction, insertCharge, insertStream, getStreamForPolicy, insertInvoice, getInvoice,
listInvoicesForPolicy, listInvoicesForAccount, updateInvoiceStatus(db, ctx, id, status),
insertItem, listItemsForInvoice, listItemsForPolicy, listItemsForAccount, setItemPaid(db, ctx, itemId, paidCents),
insertItemApplication, listItemApplicationsForPayment, nextInvoiceSequence(db, ctx, policyId)
```

Row types added to `shared.ts`: `JournalEntryRow`, `JournalLineRow`, `BillingInstructionRow`, `ChargeRow`, `InvoiceStreamRow`, `BillingInvoiceRow`, `InvoiceItemRow`, `ItemApplicationRow`, `BillingRunRow`; `PaymentRow` gains `status: 'pending' | 'cleared' | 'returned' | 'reversed'`, `created_by: string | null`, `policy_id: string | null`. Remove `InvoiceRow`, `PaymentApplicationRow`.

- [ ] **Step 1: Failing test**

```ts
// apps/api/tests/repo.billing.test.ts
import { beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db.ts';
import * as repo from '../src/repo.ts';
import type { TenantCtx } from '../src/repo.ts';
import { makeTenant, testDb } from './helpers.ts';

let db: Db; let csr: TenantCtx; let other: TenantCtx;
beforeEach(() => { db = testDb(); csr = makeTenant(db).ctx.csr; other = makeTenant(db, 'Northstar', 'NSTR').ctx.csr; });

describe('billing configuration', () => {
  test('each tenant sees its own catalogue', () => {
    expect(repo.listPaymentPlans(db, csr).map((p) => p.code)).toContain('monthly-2down');
    expect(repo.getPaymentPlan(db, other, 'monthly')?.installments).toBe(12);
    expect(repo.listPaymentPlans(db, csr, { productCode: 'HOME' })).toEqual([]);
  });
});

describe('journal', () => {
  test('postEntry refuses an unbalanced entry and balances sum by dimension', () => {
    expect(() => repo.postEntry(db, csr, { effectiveDate: '2026-09-01', eventType: 'x', referenceKind: 'x', referenceId: '1', reason: null,
      lines: [{ account: '1100', dimension: { accountId: 'a' }, debitCents: 5, creditCents: 0 }] })).toThrow(/balance/);
    repo.postEntry(db, csr, { effectiveDate: '2026-09-01', eventType: 'x', referenceKind: 'x', referenceId: '1', reason: null, lines: [
      { account: '1100', dimension: { accountId: 'a', policyId: 'p' }, debitCents: 500, creditCents: 0 },
      { account: '2200', dimension: { accountId: 'a', policyId: 'p' }, debitCents: 0, creditCents: 500 }] });
    expect(repo.accountBalance(db, csr, '1100', { accountId: 'a' })).toBe(500);
    expect(repo.accountBalance(db, csr, '2200', { policyId: 'p' })).toBe(-500);
    expect(repo.accountBalance(db, other, '1100', { accountId: 'a' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the three repo modules following `repo/policies.ts` style (`one`, `many`, `newId`, `nowIso`; every query `WHERE tenant_id = ?`). `postEntry` calls `assertBalanced` from the domain before inserting. `accountBalance` is `SELECT COALESCE(SUM(debit_cents) - SUM(credit_cents), 0)` with optional `AND account_id = ?` / `AND policy_id = ?`. `listPaymentPlans` filters in SQL by tenant then in TypeScript by `products_json`/`provinces_json` membership. Map rows to `PaymentPlanDef` etc. in the repo so services never see snake_case config.

- [ ] **Step 4: Run** the new test — pass. **Step 5: Commit** — `feat: tenant-scoped repos for billing configuration, journal and items`

---

### Task 10: Issuing a job produces an instruction, charges, items, invoices and postings

**Files:**
- Create: `apps/api/src/billing/instructions.ts`
- Modify: `apps/api/src/issue.ts` (replace `scheduleTerm`/`reconcile` with `applyIssuedJob`), delete `apps/api/src/billing.ts` (its payment and read-model parts move in Tasks 11–12)
- Test: `apps/api/tests/billing.test.ts` (rewrite the schedule/endorsement/cancellation groups)

**Interfaces:**
- Produces: `applyIssuedJob(db, ctx, input: { job: JobRow; policy: PolicyRow; version: PolicyVersionRow; transaction: TransactionRow; termNumber: number }): { instruction: BillingInstructionRow; invoices: BillingInvoiceRow[] }`.

**Behaviour:**
1. Map job type → instruction type (`Submission→newBusiness`, `PolicyChange→change`, `Renewal→renewal`, `Cancellation→cancellation`).
2. Load the plan (`policy.billing_plan` for new business and renewal — a renewal may carry `job.billing_plan`), the product (`getProduct`), patterns, tax rates, the account's province.
3. Insert the instruction. Insert the premium charge (`transaction.amount_cents`, pattern from `product.billing.premiumPatternCode`).
4. **New business / renewal:** create a stream (anchor `job.term_start`, lead 21 days) if none; `sliceCharge` → premium and fee items; `taxItemsFor` if a rate applies; group items by `eventDate` into one invoice each (number `${policy_number}-NN`, `bill_date = addDays(eventDate, -lead)`, `due_date = eventDate`, `status 'planned'`); insert items; for each of premium/fee/tax categories post `chargeBilled` with the category's total (fee and tax also get their own charge rows so the "charge coverage" invariant holds per charge).
5. **Change / cancellation:** planned invoices with `event_date >= job.effective_date` and status `planned` form the `OpenInvoice[]`; `respreadOnChange(delta, planned)` → one `installment` item per touched invoice on the premium charge (kind `installment`, `offsets_item_id` null); tax items alongside if a rate applies (as their own charge); `unabsorbedCents !== 0` → a new invoice at `addDays(job.effective_date, 14)` holding a `oneTime` item (negative = credit note, status `billed`). Invoices whose items now sum to zero → status `void`. Post `chargeBilled` per charge.

- [ ] **Step 1: Failing tests** — rewrite `apps/api/tests/billing.test.ts` header helpers and these groups:

```ts
import { assertBillingInvariants } from '../src/billing/readModel.ts'; // Task 12 adds; until then use the inline version below

function invariants(policy: PolicyRow) {
  const charges = repo.listChargesForPolicy(db, csr, policy.id);
  const items = repo.listItemsForPolicy(db, csr, policy.id);
  for (const c of charges) {
    expect(items.filter((i) => i.charge_id === c.id).reduce((s, i) => s + i.amount_cents, 0)).toBe(c.amount_cents);
  }
  const premiumBilled = charges.filter((c) => c.pattern_code === 'PREMIUM').reduce((s, c) => s + c.amount_cents, 0);
  const written = repo.listTransactions(db, csr, policy.id).reduce((s, t) => s + t.amount_cents, 0);
  expect(premiumBilled).toBe(written);
}

describe('schedule generation', () => {
  test('a monthly plan bills twelve invoices, each with premium and fee lines, summing to premium plus fee', () => {
    const { policy, transaction } = issue('monthly');
    const invoices = repo.listInvoicesForPolicy(db, csr, policy.id);
    expect(invoices).toHaveLength(12);
    expect(invoices[0]!.due_date).toBe('2026-09-01');
    expect(invoices[0]!.bill_date).toBe('2026-08-11');
    const items = repo.listItemsForPolicy(db, csr, policy.id);
    expect(items.filter((i) => i.kind === 'installment').reduce((s, i) => s + i.amount_cents, 0)).toBe(transaction.amount_cents);
    expect(items.filter((i) => i.kind === 'fee').reduce((s, i) => s + i.amount_cents, 0)).toBe(Math.round(transaction.amount_cents * 130 / 10_000));
    expect(items.some((i) => i.kind === 'tax')).toBe(false); // Ontario auto is exempt
    invariants(policy);
  });

  test('two months down bills the down payment at inception and ten installments after', () => {
    const { policy } = issue('monthly-2down');
    const items = repo.listItemsForPolicy(db, csr, policy.id).filter((i) => i.pattern_code === 'PREMIUM');
    expect(items[0]!.kind).toBe('downPayment');
    expect(repo.listInvoicesForPolicy(db, csr, policy.id)).toHaveLength(11);
    invariants(policy);
  });

  test('the premium charge posts receivable against unearned premium', () => {
    const { policy, transaction } = issue('full');
    expect(repo.accountBalance(db, csr, '1100', { policyId: policy.id })).toBe(transaction.amount_cents);
    expect(repo.accountBalance(db, csr, '2200', { policyId: policy.id })).toBe(-transaction.amount_cents);
  });
});

describe('endorsements move the schedule', () => {
  test('additional premium spreads over planned invoices as new items; nothing is edited', () => {
    const { policy } = issue('monthly');
    const before = repo.listItemsForPolicy(db, csr, policy.id).map((i) => [i.id, i.amount_cents]);
    const change = createPolicyChange(db, csr, { policyId: policy.id, effectiveDate: '2027-01-15', risk: withCollision(cleanRisk()) });
    quoteJob(db, csr, change.id); bindJob(db, csr, change.id); issueJob(db, csr, change.id);
    const after = repo.listItemsForPolicy(db, csr, policy.id);
    for (const [id, amount] of before) expect(after.find((i) => i.id === id)!.amount_cents).toBe(amount);
    expect(after.length).toBeGreaterThan(before.length);
    invariants(policy);
  });
});

describe('cancellation', () => {
  test('planned invoices net to zero and are voided; a paid-in-full customer holds a credit note', () => {
    const { policy } = issue('full');
    recordPayment(db, csr, { accountId, amountCents: 999_999_99, method: 'eft', receivedAt: '2026-09-01' });
    const cancel = createCancellation(db, csr, { policyId: policy.id, effectiveDate: '2027-03-01', reason: 'insured request' });
    quoteJob(db, csr, cancel.id); bindJob(db, csr, cancel.id); issueJob(db, csr, cancel.id);
    const credit = repo.listInvoicesForPolicy(db, csr, policy.id).at(-1)!;
    const creditItems = repo.listItemsForInvoice(db, csr, credit.id);
    expect(creditItems.reduce((s, i) => s + i.amount_cents, 0)).toBeLessThan(0);
    invariants(policy);
  });
});
```

(Keep `withCollision` as in the existing test file. `999_999_99` is a deliberate overpayment to prove credit; use the actual transaction amount if the existing test does.)

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement `instructions.ts`** per the behaviour list, ~250 lines, and change `issue.ts` lines that call `scheduleTerm`/`reconcile` to:

```ts
applyIssuedJob(db, ctx, { job, policy, version, transaction, termNumber });
```

- [ ] **Step 4: Run** `npx vitest run apps/api/tests/billing.test.ts` — the three groups pass (payments/read-model groups still fail until Tasks 11–12). **Step 5: Commit** — `feat: issued jobs become billing instructions, charges, immutable items and postings`

---

### Task 11: Payments post to the ledger and apply to items

**Files:**
- Create: `apps/api/src/billing/payments.ts`
- Test: `apps/api/tests/billing.test.ts` payments group (rewrite)

**Interfaces:**
- Produces: `recordPayment(db, ctx, input: { accountId; amountCents; method; reference?; receivedAt; policyId?: string }): { payment: PaymentRow; appliedCents: number; unappliedCents: number }`; `unappliedCents(db, ctx, accountId): number`.

**Behaviour:** refuse `amountCents <= 0`; insert payment (`status 'cleared'`, `created_by ctx.userId`); post `paymentReceived`; eligible items = positive items with `paid_cents < amount_cents` on the account (or policy if targeted), on invoices not void, ordered by invoice `due_date`, then pattern priority ascending, then sequence; apply `min(remaining, unpaid)`; insert `item_applications`; `setItemPaid`; post `distribution`; mark an invoice `paid` when all its items are fully paid. `unappliedCents` = `-accountBalance('2100', { accountId })`.

- [ ] **Step 1: Failing tests**

```ts
describe('payments', () => {
  test('a payment is applied oldest invoice first and the rest stays in unapplied cash', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    const firstTotal = repo.listItemsForInvoice(db, csr, first.id).reduce((s, i) => s + i.amount_cents, 0);
    const result = recordPayment(db, csr, { accountId, amountCents: firstTotal + 100, method: 'eft', receivedAt: '2026-09-01' });
    expect(result.appliedCents).toBe(firstTotal + 100);   // 100 flows into invoice 2
    expect(repo.getInvoice(db, csr, first.id)!.status).toBe('paid');
    expect(unappliedCents(db, csr, accountId)).toBe(0);
  });
  test('overpaying everything leaves a real unapplied cash balance in the ledger', () => {
    const { policy } = issue('full');
    const total = repo.listItemsForPolicy(db, csr, policy.id).reduce((s, i) => s + i.amount_cents, 0);
    recordPayment(db, csr, { accountId, amountCents: total + 5_000, method: 'cheque', receivedAt: '2026-09-01' });
    expect(unappliedCents(db, csr, accountId)).toBe(5_000);
    expect(repo.accountBalance(db, csr, '1100', { accountId })).toBe(0);
  });
  test('fee items are settled after the premium on the same invoice', () => {
    const { policy } = issue('monthly');
    const first = repo.listInvoicesForPolicy(db, csr, policy.id)[0]!;
    const items = repo.listItemsForInvoice(db, csr, first.id);
    const premium = items.find((i) => i.kind === 'installment')!;
    recordPayment(db, csr, { accountId, amountCents: premium.amount_cents, method: 'eft', receivedAt: '2026-09-01' });
    expect(repo.listItemsForInvoice(db, csr, first.id).find((i) => i.kind === 'fee')!.paid_cents).toBe(0);
  });
  test('a zero or negative payment is refused', () => {
    expect(() => recordPayment(db, csr, { accountId, amountCents: 0, method: 'cash', receivedAt: '2026-09-01' })).toThrow(ApiError);
  });
});
```

Note on ordering: priority ascending means `FEE-INST` (10) would settle before `PREMIUM` (50). The test wants premium first, so order by `priority DESC` — document this in the code comment ("higher priority settles first") and set `PREMIUM` 50, fees 10, tax 40.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — pass. **Step 5: Commit** — `feat: payments post to the ledger and apply to invoice items`

---

### Task 12: Read model, invariants helper, and the callers that used the old billing module

**Files:**
- Create: `apps/api/src/billing/readModel.ts`
- Modify: `apps/api/src/accounts.ts` (`accountRollup`), `apps/api/src/dto.ts` (`invoiceDto` with `lines`, `paymentDto` with `status`, `policyBillingDto` with `unappliedCents`), `apps/api/src/routes/policies.ts`, `apps/api/src/routes/accounts.ts`, `apps/api/tests/accounts.test.ts`, `apps/api/tests/e2eSeed.ts` (payment call unchanged; verify it still runs)
- Test: `apps/api/tests/billing.test.ts` read-model group; `apps/api/tests/invariants.test.ts`

**Interfaces:**
- Produces: `policyBilling(db, ctx, policy, today): PolicyBilling` where `PolicyBilling = { plan: string; invoices: InvoiceView[]; billedCents; paidCents; balanceCents; pastDueCents; nextDue }` and `InvoiceView = BillingInvoiceRow & { totalCents; paidCents; outstandingCents; displayStatus: 'planned' | 'due' | 'overdue' | 'paid' | 'void' | 'credit'; lines: InvoiceItemRow[] }`; `accountRollup(db, ctx, accountId, today): { billedCents; paidCents; balanceCents; pastDueCents; unappliedCents }`; `assertBillingInvariants(db, ctx, accountId): void` throwing on any violation of the three invariants (ledger balanced per entry, charge coverage, receivable === Σ unpaid items).

- [ ] **Step 1: Failing tests** — `invariants.test.ts` issues one of each job type, records a payment, and calls `assertBillingInvariants` after each step; the read-model group asserts `displayStatus` (`'planned'` before bill date, `'due'` once billed and not past due, `'overdue'` past due, `'credit'` when total < 0) and that `balanceCents === accountBalance('1100', { policyId })`.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; `pastDueCents` uses `due_date < today` in both rollups (fixing the inconsistency the code map found); `paidCents` in both rollups is Σ `paid_cents` over items. Update DTOs and both route files. Update `accounts.test.ts` "billing over HTTP" expectations for the new invoice shape (`lines` array).

- [ ] **Step 4: Run** `npx vitest run` — everything green (the whole suite). **Step 5: Commit** — `feat: billing read model over items and ledger; invariants helper`

---

### Task 13: The billing day — bill planned invoices, post earning

**Files:**
- Create: `apps/api/src/billing/billingDay.ts`, `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/routes.ts` (register **before** policy/claim routes so `/billing/run` precedes any `/:id`), `apps/api/src/server.ts` (daily timer: `setInterval` every 6 hours calling `runBillingDay(db, tenant, todayIso())` for each tenant — `unref()` the timer)
- Test: `apps/api/tests/billingDay.test.ts`

**Interfaces:**
- Produces: `runBillingDay(db, ctx, date): { runId: string; billedInvoices: number; earnedCents: number; skipped: boolean }`.

**Behaviour:** if a `billing_runs` row exists for `(tenant, date)` return `skipped: true`; insert the run; set `status 'billed'` on planned invoices with `bill_date <= date`; for every in-force policy version whose term contains `date`, compute `earnedCents(annual_premium_cents × termMonths/12 … use the transaction amount for the version, term_start, term_end, addDays(date, 1))`, subtract what the ledger already shows earned for that version (`-accountBalance('4100', { policyId })` restricted by reference to the version — simplest: keep the cumulative in `earning_snapshots` and post the difference), post `earning`, write the snapshot; record the summary.

- [ ] **Step 1: Failing test**

```ts
test('the billing day bills invoices whose bill date has arrived and posts earned premium once', () => {
  const { policy, transaction } = issue('monthly');
  const r1 = runBillingDay(db, csr, '2026-08-11');
  expect(r1.billedInvoices).toBe(1);
  expect(repo.listInvoicesForPolicy(db, csr, policy.id)[0]!.status).toBe('billed');
  const r2 = runBillingDay(db, csr, '2026-09-30');
  expect(r2.billedInvoices).toBe(1);
  expect(r2.earnedCents).toBe(earnedCents(transaction.amount_cents, '2026-09-01', '2027-09-01', '2026-10-01'));
  expect(runBillingDay(db, csr, '2026-09-30').skipped).toBe(true);
  expect(repo.accountBalance(db, csr, '4100', { policyId: policy.id })).toBe(-r2.earnedCents);
  assertBillingInvariants(db, csr, accountId);
});
test('POST /billing/run is finance or admin only', async () => { /* csr → 403, admin → 200 with the summary */ });
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; routes: `POST /billing/run?date=` `[admin, finance]` (add `'finance'` and `'billing'` to `Role` and the users CHECK via a small migration `003_billing_roles.ts` that recreates the `users` table with the wider CHECK — SQLite cannot alter a CHECK in place; copy rows across), `GET /billing/runs`, `GET /billing/plans` `[admin, finance]`, `GET /invoices/:id` (any authenticated role; returns `invoiceDto` with lines and the journal entries referencing its charges).

- [ ] **Step 4: Run** — pass, full suite green. **Step 5: Commit** — `feat: billing day bills planned invoices and posts earned premium`

---

### Task 14: Screens — line items on the schedule, plans from the API, unapplied credit

**Files:**
- Modify: `apps/web/src/lib/types.ts` (`Invoice` gains `lines: { kind; patternCode; amountCents; paidCents }[]`, `totalCents`, `displayStatus`; `PolicyBilling.plan: string`; `AccountRollup.unappliedCents`), `apps/web/src/routes/PolicyDetail.tsx` (schedule table: expandable invoice rows showing lines with a kind word — Premium / Down payment / Installment fee / Tax; `bill_date` column), `apps/web/src/routes/AccountDetail.tsx` (facts: "Credit on account" when `unappliedCents > 0`), `apps/web/src/routes/wizard/steps.tsx` and `SubmissionWizard.tsx` (plan choices from `GET /billing/plans?productCode=&province=`; preview shows down payment, first installment, fee — remove the client-side `firstInstalment` duplicate), `apps/web/src/lib/format.ts` (`planName` falls back to the API name)
- Test: `apps/web/e2e/smoke.mjs` — extend the wizard check to assert the plan step lists "Two months down"; the browser test must still pass end to end.

- [ ] **Step 1:** Add the API route `GET /billing/plans` filter support (`productCode`, `province`) if Task 13 shipped it unfiltered; write the e2e assertion first and watch it fail.
- [ ] **Step 2:** Implement the screen changes following `DESIGN.md` (kind words, tabular figures, no nested cards).
- [ ] **Step 3:** `npm run build`, `npm run test:e2e` — both green.
- [ ] **Step 4:** Screenshot Policy detail (schedule expanded), Account detail, and the wizard plan step at 375px and 1440px using a scratch script like `apps/web/e2e/_team_shots.tmp.mjs` from the previous PR; read every image; fix what is wrong.
- [ ] **Step 5: Commit** — `feat(web): invoice line items, plans from the API, credit on account`

---

### Task 15: Remove the old domain billing module; docs; final verification

**Files:**
- Delete: `packages/domain/src/billing.ts`, `packages/domain/tests/billing.test.ts` (old `buildSchedule`/`spreadDelta` tests — superseded by Tasks 4 and 6)
- Modify: `packages/domain/src/index.ts`, `apps/api/src/validation.ts` (`requireInstallmentPlan` → `requirePaymentPlanCode(db, ctx, value)` validating against `getPaymentPlan`), `apps/api/src/repo/shared.ts` (`billing_plan: string`), `CLAUDE.md` (invariant 4 becomes the three billing invariants; "Where the build has reached"), `DECISIONS.md` (D-023 ledger and immutable items; D-024 migrations replace reseeding — mark D-013 superseded; D-025 payment plans and fees as tenant configuration), `README.md` (billing section, `/billing/*` routes, no more "delete the file" instruction), `ROADMAP.md` (Stage 2 progress)

- [ ] **Step 1:** Delete and fix imports until `npm run typecheck` is clean.
- [ ] **Step 2:** Write the three DECISIONS entries in the existing format (date, decision, instead of, why, revisit when).
- [ ] **Step 3:** Run everything and paste the real output into the PR description:

```bash
npm run typecheck && npm test && npm run build && npm run test:e2e
```

- [ ] **Step 4: Commit** — `docs: record the billing ledger decisions; retire the old schedule maths`
- [ ] **Step 5:** Open the pull request against `main` with: what changed, the three invariants, the migration story (existing databases upgrade in place), the rounding-remainder change, test counts, screenshots, and the honest remainder (no collection rails yet, no delinquency, no producers — PRs 2–4).

---

## Self-review

**Spec coverage (PR 1 row of §11):** migrations ✔ Tasks 1, 8, 13; ledger and posting rules ✔ 3, 9; charge patterns ✔ 7, 8; payment plans with down payments, fees, taxes ✔ 4, 5, 7; immutable items ✔ 8, 10; invoice streams ✔ 8, 10; rebuilt screens ✔ 14; billing day skeleton (billing + earning) ✔ 13; existing tests moved to the new invariants ✔ 10–12. Not in PR 1 by design: instruments, requests, returns, disbursements, holds, delinquency, producers.

**Type consistency:** `SlicedItem.kind` values match the `invoice_items.kind` CHECK; `LedgerAccountCode` matches `LEDGER_ACCOUNTS` keys and the migration seed; `PaymentPlanDef` fields match `payment_plans` columns (bps naming throughout); `respreadOnChange` consumes `OpenInvoice` built from `billing_invoices` + Σ items; `recordPayment` signature keeps `accountId/amountCents/method/reference/receivedAt` so `e2eSeed.ts` and `AccountDetail` need no change beyond DTO additions.

**Known judgement calls for the executor:** how earning is attributed per version when several versions share a term (use the transaction amount per version and its own effective-to-term-end window); the `users` CHECK widening needs a table rebuild (migration 003) — do it exactly as SQLite documents: create new, copy, drop, rename, recreate indexes.
