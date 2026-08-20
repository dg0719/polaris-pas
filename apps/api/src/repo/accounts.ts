import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type { AccountRow, TenantCtx, TenantRow } from './shared.ts';

/** Atomically allocate the next account number for a tenant, e.g. ACME-A0042. */
export function nextAccountNumber(db: Db, tenantId: string): string {
  const tenant = one<TenantRow>(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId));
  if (!tenant) throw new Error(`Unknown tenant ${tenantId}`);
  db.prepare('UPDATE tenants SET next_account_seq = next_account_seq + 1 WHERE id = ?').run(
    tenantId,
  );
  return `${tenant.policy_prefix}-A${String(tenant.next_account_seq).padStart(4, '0')}`;
}

// --- Accounts ---------------------------------------------------------------

export type AccountInput = Omit<
  AccountRow,
  'id' | 'tenant_id' | 'account_number' | 'created_at' | 'updated_at'
>;

export function insertAccount(
  db: Db,
  ctx: TenantCtx,
  accountNumber: string,
  input: AccountInput,
): AccountRow {
  const ts = nowIso();
  const row: AccountRow = {
    ...input,
    id: newId(),
    tenant_id: ctx.tenantId,
    account_number: accountNumber,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO accounts
       (id, tenant_id, account_number, account_type, name, email, phone,
        address_line1, address_line2, city, province, postal_code, producer_code,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.account_number,
    row.account_type,
    row.name,
    row.email,
    row.phone,
    row.address_line1,
    row.address_line2,
    row.city,
    row.province,
    row.postal_code,
    row.producer_code,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function getAccount(db: Db, ctx: TenantCtx, accountId: string): AccountRow | null {
  return one<AccountRow>(
    db.prepare('SELECT * FROM accounts WHERE tenant_id = ? AND id = ?').get(ctx.tenantId, accountId),
  );
}

export function listAccounts(db: Db, ctx: TenantCtx, search?: string): AccountRow[] {
  if (search && search.trim() !== '') {
    const term = `%${search.trim().toLowerCase()}%`;
    return many<AccountRow>(
      db
        .prepare(
          `SELECT * FROM accounts
            WHERE tenant_id = ?
              AND (lower(name) LIKE ? OR lower(account_number) LIKE ?
                   OR lower(coalesce(email, '')) LIKE ? OR lower(city) LIKE ?)
            ORDER BY name ASC`,
        )
        .all(ctx.tenantId, term, term, term, term),
    );
  }
  return many<AccountRow>(
    db.prepare('SELECT * FROM accounts WHERE tenant_id = ? ORDER BY name ASC').all(ctx.tenantId),
  );
}

export function updateAccount(
  db: Db,
  ctx: TenantCtx,
  accountId: string,
  patch: Partial<AccountInput>,
): void {
  const keys = Object.keys(patch) as (keyof AccountInput)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k] as string | null);
  db.prepare(`UPDATE accounts SET ${sets}, updated_at = ? WHERE tenant_id = ? AND id = ?`).run(
    ...values,
    nowIso(),
    ctx.tenantId,
    accountId,
  );
}
