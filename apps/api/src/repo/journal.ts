import { assertBalanced, UnbalancedEntryError } from '@polaris/domain';
import type { JournalEntryInput, LedgerAccountCode } from '@polaris/domain';
import type { Db } from '../db.ts';
import { many, newId, nowIso } from './shared.ts';
import type { JournalEntryRow, TenantCtx } from './shared.ts';

// ─── Journal (double-entry ledger) ──────────────────────────────────────────
// `postEntry` is the only way an entry reaches the database: it refuses an
// unbalanced entry before writing anything, then inserts the entry and its
// lines. The caller wraps larger operations (e.g. billing a charge and
// posting its entry together) in `inTransaction`; this module never opens
// one itself.

export function postEntry(db: Db, ctx: TenantCtx, entry: JournalEntryInput): JournalEntryRow {
  assertBalanced(entry);
  // An entry of nothing but zeros balances, but it records no money moving.
  // Writing it would put a row in the ledger that means nothing and that
  // every later reader has to skip, so it is refused at the door: callers
  // already skip a zero amount rather than posting one.
  if (entry.lines.every((line) => line.debitCents === 0 && line.creditCents === 0)) {
    throw new UnbalancedEntryError(
      `Entry ${entry.eventType} moves nothing: every line is zero on both sides`,
    );
  }

  const row: JournalEntryRow = {
    id: newId(),
    tenant_id: ctx.tenantId,
    posted_at: nowIso(),
    effective_date: entry.effectiveDate,
    event_type: entry.eventType,
    reference_kind: entry.referenceKind,
    reference_id: entry.referenceId,
    actor_user_id: ctx.userId,
    reversal_of: null,
    reason: entry.reason,
  };
  db.prepare(
    `INSERT INTO journal_entries
       (id, tenant_id, posted_at, effective_date, event_type, reference_kind,
        reference_id, actor_user_id, reversal_of, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.posted_at,
    row.effective_date,
    row.event_type,
    row.reference_kind,
    row.reference_id,
    row.actor_user_id,
    row.reversal_of,
    row.reason,
  );

  for (const line of entry.lines) {
    db.prepare(
      `INSERT INTO journal_lines
         (id, tenant_id, entry_id, account_code, account_id, policy_id,
          producer_id, province, method, debit_cents, credit_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      ctx.tenantId,
      row.id,
      line.account,
      line.dimension.accountId ?? null,
      line.dimension.policyId ?? null,
      line.dimension.producerId ?? null,
      line.dimension.province ?? null,
      line.dimension.method ?? null,
      line.debitCents,
      line.creditCents,
    );
  }

  return row;
}

/** Debits minus credits for one account, optionally narrowed to one account-
 * holder or one policy. A credit-side account (e.g. unearned premium, 2200)
 * therefore reads negative when it holds a balance — that is intended. */
export function accountBalance(
  db: Db,
  ctx: TenantCtx,
  code: LedgerAccountCode,
  dim: { accountId?: string; policyId?: string },
): number {
  const clauses = ['tenant_id = ?', 'account_code = ?'];
  const params: string[] = [ctx.tenantId, code];
  if (dim.accountId !== undefined) {
    clauses.push('account_id = ?');
    params.push(dim.accountId);
  }
  if (dim.policyId !== undefined) {
    clauses.push('policy_id = ?');
    params.push(dim.policyId);
  }
  const result = db
    .prepare(
      `SELECT COALESCE(SUM(debit_cents) - SUM(credit_cents), 0) AS balance
         FROM journal_lines WHERE ${clauses.join(' AND ')}`,
    )
    .get(...params) as { balance: number };
  return result.balance;
}

/**
 * Entries whose lines do not balance. `postEntry` refuses to write one, so a
 * healthy ledger always returns none; the invariant check reads this rather
 * than trusting that nothing ever reached the table another way.
 */
export function unbalancedEntryIds(db: Db, ctx: TenantCtx): string[] {
  const rows = db
    .prepare(
      `SELECT entry_id FROM journal_lines
        WHERE tenant_id = ?
        GROUP BY entry_id
        HAVING SUM(debit_cents) <> SUM(credit_cents)`,
    )
    .all(ctx.tenantId) as unknown as { entry_id: string }[];
  return rows.map((row) => row.entry_id);
}

/**
 * Lines carrying a negative debit or credit. A signed amount belongs on one
 * side or the other, never as a negative on both: `postingsFor` swaps the
 * sides for a reversal and posts the absolute value, so a negative here means
 * something reached the table another way.
 */
export function negativeJournalLineIds(db: Db, ctx: TenantCtx): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM journal_lines
        WHERE tenant_id = ? AND (debit_cents < 0 OR credit_cents < 0)`,
    )
    .all(ctx.tenantId) as unknown as { id: string }[];
  return rows.map((row) => row.id);
}

export function listEntries(
  db: Db,
  ctx: TenantCtx,
  ref: { kind: string; id: string },
): JournalEntryRow[] {
  return many<JournalEntryRow>(
    db
      .prepare(
        `SELECT * FROM journal_entries
          WHERE tenant_id = ? AND reference_kind = ? AND reference_id = ?
          ORDER BY posted_at ASC`,
      )
      .all(ctx.tenantId, ref.kind, ref.id),
  );
}
