import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/db.ts';
import { MIGRATIONS, migrate } from '../src/migrations/index.ts';
import { bootstrapTenant } from '../src/bootstrap.ts';

/** tenant_id must be declared TEXT NOT NULL REFERENCES tenants(id) on every
 * billing table, not the bare, untyped column the brief's SQL shorthand
 * could be misread as. Checking two tables pins the column definition used
 * by all fourteen, since they're generated from the same brief text. */
function expectTenantIdIsTypedForeignKey(db: DatabaseSync, table: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number }[];
  const tenantId = columns.find((c) => c.name === 'tenant_id');
  expect(tenantId?.type).toBe('TEXT');
  expect(tenantId?.notnull).toBe(1);
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string; from: string }[];
  expect(foreignKeys).toContainEqual(expect.objectContaining({ table: 'tenants', from: 'tenant_id' }));
}

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

  test('migration 002 seeds the catalogue for every tenant and converts legacy invoices', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 4');
    MIGRATIONS[0]!.up(db);                      // v4 schema only
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
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
    expectTenantIdIsTypedForeignKey(db, 'invoice_items');
    expectTenantIdIsTypedForeignKey(db, 'journal_lines');
  });
});

describe('migration 003 (billing and finance roles)', () => {
  /** A v5 database — baseline plus billing — with one tenant, its five
   * sign-ins, and a job whose `created_by` points at one of them. This is the
   * shape migration 003 has to rebuild the `users` table underneath. */
  function v5Database(): { db: DatabaseSync; tenantId: string; userId: string } {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    MIGRATIONS[0]!.up(db);
    MIGRATIONS[1]!.up(db);
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(1, 'baseline', '2026-01-01');
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(2, 'billing', '2026-01-01');
    bootstrapTenant(db, 'Old Carrier', 'OLD');
    const tenantId = (db.prepare('SELECT id FROM tenants').get() as { id: string }).id;
    const userId = (db.prepare(`SELECT id FROM users WHERE role = 'csr'`).get() as { id: string }).id;
    db.exec(`INSERT INTO accounts (id, tenant_id, account_number, account_type, name, address_line1, city, province, postal_code, created_at, updated_at)
      VALUES ('acc1','${tenantId}','OLD-A0001','person','Legacy Person','1 St','Ottawa','ON','K1A 0A1','2026-01-01','2026-01-01')`);
    db.exec(`INSERT INTO jobs (id, tenant_id, account_id, job_type, status, product_code, billing_plan, effective_date, term_start, term_end, risk_json, created_by, created_at, updated_at)
      VALUES ('job1','${tenantId}','acc1','Submission','Draft','ON_PA','monthly','2026-09-01','2026-09-01','2027-09-01','{}','${userId}','2026-01-01','2026-01-01')`);
    return { db, tenantId, userId };
  }

  test('a database with a job referencing a user migrates cleanly', () => {
    const { db, userId } = v5Database();

    expect(migrate(db).applied).toEqual([3]);

    // Every sign-in survived the table rebuild, and the job still resolves
    // to the user that created it through the foreign key.
    expect((db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n).toBe(5);
    const joined = db.prepare('SELECT u.username FROM jobs j JOIN users u ON u.id = j.created_by WHERE j.id = ?').get('job1') as { username: string };
    expect(joined.username).toBe('csr');
    expect(db.prepare('SELECT id FROM jobs WHERE created_by = ?').get(userId)).toBeTruthy();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  test('the widened CHECK accepts billing and finance and still refuses nonsense', () => {
    const { db, tenantId } = v5Database();
    migrate(db);

    const insert = (id: string, role: string) =>
      db.prepare(`INSERT INTO users (id, tenant_id, username, email, name, role, password_hash, password_salt, api_key, authority_limit_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'h', 's', ?, 0, '2026-01-01')`).run(id, tenantId, id, `${id}@example.com`, id, role, `key-${id}`);

    insert('u-billing', 'billing');
    insert('u-finance', 'finance');
    expect(() => insert('u-nope', 'wizard')).toThrow();
  });

  test('the rebuilt users table keeps its indexes and uniqueness', () => {
    const { db, tenantId } = v5Database();
    migrate(db);

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users'`).all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('users_tenant_email');

    // The two column-level UNIQUE constraints still bite.
    const duplicate = (username: string, email: string, key: string) =>
      db.prepare(`INSERT INTO users (id, tenant_id, username, email, name, role, password_hash, password_salt, api_key, authority_limit_cents, created_at)
        VALUES (?, ?, ?, ?, 'X', 'billing', 'h', 's', ?, 0, '2026-01-01')`).run(`id-${key}`, tenantId, username, email, key);
    expect(() => duplicate('csr', 'new@example.com', 'k1')).toThrow();
    expect(() => duplicate('someone.new', 'casey.reid@example.com', 'k2')).toThrow();
  });
});

describe('the foreign key gate', () => {
  /** A row pointing at a user who does not exist. Written with foreign keys
   * off, the way a bad migration or a hand-edited database could leave one. */
  function withDanglingRow(file: string): void {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys = OFF');
    const tenantId = (db.prepare('SELECT id FROM tenants').get() as { id: string }).id;
    db.exec(`INSERT INTO accounts (id, tenant_id, account_number, account_type, name, address_line1, city, province, postal_code, created_at, updated_at)
      VALUES ('acc-x','${tenantId}','X-A0001','person','Nobody','1 St','Ottawa','ON','K1A 0A1','2026-01-01','2026-01-01')`);
    db.exec(`INSERT INTO jobs (id, tenant_id, account_id, job_type, status, product_code, billing_plan, effective_date, term_start, term_end, risk_json, created_by, created_at, updated_at)
      VALUES ('job-x','${tenantId}','acc-x','Submission','Draft','ON_PA','monthly','2026-09-01','2026-09-01','2027-09-01','{}','no-such-user','2026-01-01','2026-01-01')`);
    db.close();
  }

  test('a broken foreign key fails every open, not only the first', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'polaris-fk-')), 'fk.db');
    const first = openDb(file);
    bootstrapTenant(first, 'Old Carrier', 'OLD');
    first.close();

    withDanglingRow(file);

    // Nothing is pending any more, so the gate has to run on a no-op
    // migration pass as well — otherwise the damage is only ever seen once.
    expect(() => openDb(file)).toThrow(/foreign key/i);
    expect(() => openDb(file)).toThrow(/foreign key/i);
  });
});

