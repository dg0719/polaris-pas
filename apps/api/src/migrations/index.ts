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
