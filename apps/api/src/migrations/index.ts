import type { Db } from '../db.ts';
import { baseline } from './001_baseline.ts';
import { billing } from './002_billing.ts';
import { billingRoles } from './003_billing_roles.ts';

export interface Migration {
  id: number;
  name: string;
  up(db: Db): void;
}

export const MIGRATIONS: Migration[] = [baseline, billing, billingRoles];

function foreignKeysOn(db: Db): boolean {
  return (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys === 1;
}

/** Rows whose foreign key points at something that is not there. */
function danglingRows(db: Db): number {
  return db.prepare('PRAGMA foreign_key_check').all().length;
}

/**
 * Forward-only, numbered migrations. Each runs once, inside a transaction,
 * and is recorded in schema_migrations. A database written before this
 * runner existed (PRAGMA user_version 4) is adopted by the baseline, which
 * only creates what is missing.
 *
 * Foreign keys are disabled for the length of the run. SQLite cannot alter a
 * CHECK constraint in place, so a migration that widens one has to rebuild
 * the table — and dropping a table nine others point at is refused while
 * foreign keys are enforced. `PRAGMA foreign_keys` is a no-op inside a
 * transaction and `defer_foreign_keys` only postpones the same failure to
 * COMMIT, so switching it off out here is the only thing that works; it is
 * what SQLite's own table-rebuild procedure prescribes. `foreign_key_check`
 * afterwards proves the run left nothing dangling.
 */
export function migrate(db: Db): { applied: number[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const done = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  const pending = MIGRATIONS.filter((m) => !done.has(m.id));
  if (pending.length === 0) return { applied: [] };

  const enforcing = foreignKeysOn(db);
  if (enforcing) db.exec('PRAGMA foreign_keys = OFF');
  const applied: number[] = [];
  try {
    for (const m of pending) {
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
  } finally {
    if (enforcing) db.exec('PRAGMA foreign_keys = ON');
  }

  if (enforcing && danglingRows(db) > 0) {
    throw new Error(
      `Migrations ${applied.join(', ')} left ${danglingRows(db)} row(s) with a broken foreign key`,
    );
  }
  return { applied };
}
