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

  test('postEntry refuses an entry whose lines are all zero', () => {
    // It balances, but it records no money moving: a row every later reader
    // has to skip. Callers already skip a zero amount rather than posting.
    expect(() =>
      repo.postEntry(db, csr, { effectiveDate: '2026-09-01', eventType: 'nothing', referenceKind: 'x', referenceId: '1', reason: null, lines: [
        { account: '1100', dimension: { accountId: 'a' }, debitCents: 0, creditCents: 0 },
        { account: '2200', dimension: { accountId: 'a' }, debitCents: 0, creditCents: 0 }] }),
    ).toThrow(/moves nothing/i);
    expect(db.prepare(`SELECT count(*) AS n FROM journal_entries WHERE event_type = 'nothing'`).get()).toEqual({ n: 0 });
  });
});
