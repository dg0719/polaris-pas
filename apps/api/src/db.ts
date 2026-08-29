import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations/index.ts';

export type Db = DatabaseSync;

/**
 * Schema notes:
 * - Every business table carries `tenant_id`; all repository reads are scoped
 *   by it. Tenant isolation is enforced in one place (see repo.ts).
 * - Money is always integer cents. Dates are ISO-8601 strings (UTC).
 * - An account is the customer of record; policies hang off it.
 * - A policy is a container; each transaction (new business, endorsement,
 *   renewal, cancellation) appends an immutable `policy_versions` snapshot.
 * - Money is double-entry. Every event posts a balanced journal entry; an
 *   invoice carries no amount of its own but holds immutable items, and what
 *   a screen shows is derived from them. Nothing edits an item: a change
 *   writes signed items beside the old ones and voids an invoice it empties.
 *
 * The schema itself lives in numbered migrations (see migrations/), applied
 * by `migrate()` in `openDb` below.
 */

export function openDb(file?: string): Db {
  const target = file ?? process.env.POLARIS_DB ?? 'polaris.db';
  const db = new DatabaseSync(target);
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

/** Run `fn` inside a transaction, rolling back on any thrown error. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
