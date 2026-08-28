import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/db.ts';
import { MIGRATIONS, migrate } from '../src/migrations/index.ts';
import { bootstrapTenant } from '../src/bootstrap.ts';

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
  });
});
