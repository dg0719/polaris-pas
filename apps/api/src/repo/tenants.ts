import type { Db } from '../db.ts';
import { many, newId, nowIso, one } from './shared.ts';
import type { Role, TenantCtx, TenantRow, UserRow } from './shared.ts';

// ─── Tenants & users ────────────────────────────────────────────────────────

export function createTenant(db: Db, name: string, policyPrefix: string): TenantRow {
  const row: TenantRow = {
    id: newId(),
    name,
    policy_prefix: policyPrefix,
    next_policy_seq: 1,
    next_account_seq: 1,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO tenants
       (id, name, policy_prefix, next_policy_seq, next_account_seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.name,
    row.policy_prefix,
    row.next_policy_seq,
    row.next_account_seq,
    row.created_at,
  );
  return row;
}

export function createUser(
  db: Db,
  tenantId: string,
  input: {
    username: string;
    email: string;
    name: string;
    role: Role;
    passwordHash: string;
    passwordSalt: string;
    apiKey: string;
  },
): UserRow {
  const row: UserRow = {
    id: newId(),
    tenant_id: tenantId,
    username: input.username,
    email: input.email,
    name: input.name,
    role: input.role,
    password_hash: input.passwordHash,
    password_salt: input.passwordSalt,
    api_key: input.apiKey,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users
       (id, tenant_id, username, email, name, role, password_hash, password_salt,
        api_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.tenant_id,
    row.username,
    row.email,
    row.name,
    row.role,
    row.password_hash,
    row.password_salt,
    row.api_key,
    row.created_at,
  );
  return row;
}

export function findUserByApiKey(db: Db, apiKey: string): UserRow | null {
  return one<UserRow>(db.prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey));
}

/** Usernames are globally unique, so a login needs no tenant hint. */
export function findUserByUsername(db: Db, username: string): UserRow | null {
  return one<UserRow>(
    db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase()),
  );
}

export function tenantName(db: Db, tenantId: string): string {
  const tenant = one<TenantRow>(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId));
  return tenant?.name ?? '';
}

/** Atomically allocate the next policy number for a tenant, e.g. ACME-000123. */
export function nextPolicyNumber(db: Db, tenantId: string): string {
  const tenant = one<TenantRow>(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId));
  if (!tenant) throw new Error(`Unknown tenant ${tenantId}`);
  db.prepare('UPDATE tenants SET next_policy_seq = next_policy_seq + 1 WHERE id = ?').run(tenantId);
  return `${tenant.policy_prefix}-${String(tenant.next_policy_seq).padStart(6, '0')}`;
}
