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
