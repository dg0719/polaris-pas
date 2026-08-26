import { beforeEach, describe, expect, test } from 'vitest';
import { signIn } from '../src/auth.ts';
import { bootstrapIfEmpty, bootstrapTenant } from '../src/bootstrap.ts';
import type { Db } from '../src/db.ts';
import { DEFAULT_ACCOUNTS } from '../src/demo.ts';
import { buildRouter } from '../src/routes.ts';
import * as repo from '../src/repo.ts';
import { makeTenant, testDb, type TestTenant } from './helpers.ts';

/**
 * First start and team management: an empty database bootstraps itself with
 * one carrier and the default sign-ins; after that, the admin creates the
 * rest of the team through the API.
 */

describe('bootstrap on first start', () => {
  test('an empty database gets one carrier and one sign-in per role', () => {
    const db = testDb();
    bootstrapIfEmpty(db);

    const tenants = db.prepare('SELECT * FROM tenants').all() as { name: string }[];
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.name).toBe('Polaris Insurance');

    for (const account of DEFAULT_ACCOUNTS) {
      const result = signIn(db, account.username, account.password);
      expect(result.user.role).toBe(account.role);
    }
  });

  test('the book of business starts empty', () => {
    const db = testDb();
    bootstrapIfEmpty(db);
    const user = repo.findUserByUsername(db, 'admin')!;
    const ctx = { tenantId: user.tenant_id, userId: user.id, role: user.role };
    expect(repo.listAccounts(db, ctx)).toHaveLength(0);
    expect(repo.listPolicies(db, ctx)).toHaveLength(0);
    expect(repo.listClaims(db, ctx)).toHaveLength(0);
    expect(repo.listJobs(db, ctx)).toHaveLength(0);
  });

  test('a populated database is left exactly as it is', () => {
    const db = testDb();
    bootstrapTenant(db, 'Existing Carrier', 'EXST');
    bootstrapIfEmpty(db);
    bootstrapIfEmpty(db); // idempotent across restarts
    const tenants = db.prepare('SELECT * FROM tenants').all() as { name: string }[];
    expect(tenants).toHaveLength(1);
    expect(tenants[0]!.name).toBe('Existing Carrier');
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({
      n: DEFAULT_ACCOUNTS.length,
    });
  });

  test('carrier name and prefix come from the environment', () => {
    process.env.POLARIS_CARRIER_NAME = 'Maple Mutual';
    process.env.POLARIS_CARRIER_PREFIX = 'MPL';
    try {
      const db = testDb();
      bootstrapIfEmpty(db);
      const tenant = db.prepare('SELECT * FROM tenants').get() as {
        name: string;
        policy_prefix: string;
      };
      expect(tenant.name).toBe('Maple Mutual');
      expect(tenant.policy_prefix).toBe('MPL');
    } finally {
      delete process.env.POLARIS_CARRIER_NAME;
      delete process.env.POLARIS_CARRIER_PREFIX;
    }
  });
});

// ─── Team management over the API ───────────────────────────────────────────

interface Invocation {
  status: number;
  payload: unknown;
}

/** Drive a route handler directly, the way api.test.ts style tests do. */
async function call(
  db: Db,
  apiKeyValue: string | null,
  method: string,
  path: string,
  bodyValue?: unknown,
): Promise<Invocation> {
  const router = buildRouter(db);
  const match = router.match(method, path);
  if (!match) return { status: 404, payload: null };
  try {
    const result = await match.handler({
      req: {
        headers: apiKeyValue ? { authorization: `Bearer ${apiKeyValue}` } : {},
      } as never,
      res: {} as never,
      params: match.params,
      query: new URLSearchParams(),
      body: bodyValue,
    });
    if (result && typeof result === 'object' && 'status' in result && 'payload' in result) {
      return result as Invocation;
    }
    return { status: 200, payload: result };
  } catch (err) {
    const apiErr = err as { status?: number; message: string };
    return { status: apiErr.status ?? 500, payload: { message: apiErr.message } };
  }
}

let db: Db;
let tenant: TestTenant;

beforeEach(() => {
  db = testDb();
  tenant = makeTenant(db);
});

const newUser = {
  username: 'jordan.lee',
  email: 'jordan.lee@example.com',
  name: 'Jordan Lee',
  role: 'underwriter',
  password: 'a-long-password',
};

describe('team management', () => {
  test('admin lists the team', async () => {
    const result = await call(db, tenant.keys.admin, 'GET', '/users');
    expect(result.status).toBe(200);
    const users = (result.payload as { users: { username: string }[] }).users;
    expect(users.map((u) => u.username).sort()).toEqual([
      'adjuster',
      'admin',
      'csr',
      'supervisor',
      'underwriter',
    ]);
  });

  test('admin creates a user who can then sign in', async () => {
    const created = await call(db, tenant.keys.admin, 'POST', '/users', newUser);
    expect(created.status).toBe(201);
    const result = signIn(db, 'jordan.lee', 'a-long-password');
    expect(result.user.role).toBe('underwriter');
  });

  test('a CSR may not read or create users', async () => {
    expect((await call(db, tenant.keys.csr, 'GET', '/users')).status).toBe(403);
    expect((await call(db, tenant.keys.csr, 'POST', '/users', newUser)).status).toBe(403);
  });

  test('a duplicate username is refused with a clear message', async () => {
    const result = await call(db, tenant.keys.admin, 'POST', '/users', {
      ...newUser,
      username: 'admin',
    });
    expect(result.status).toBe(409);
    expect((result.payload as { message: string }).message).toContain('already taken');
  });

  test('a short password is refused', async () => {
    const result = await call(db, tenant.keys.admin, 'POST', '/users', {
      ...newUser,
      password: 'short',
    });
    expect(result.status).toBe(400);
  });

  test('payment authority is refused on a role that cannot hold it', async () => {
    const result = await call(db, tenant.keys.admin, 'POST', '/users', {
      ...newUser,
      role: 'csr',
      authorityLimitCents: 1_000_000,
    });
    expect(result.status).toBe(400);
  });

  test('an adjuster is created with their authority limit', async () => {
    const result = await call(db, tenant.keys.admin, 'POST', '/users', {
      ...newUser,
      username: 'new.adjuster',
      role: 'adjuster',
      authorityLimitCents: 2_500_000,
    });
    expect(result.status).toBe(201);
    const user = repo.findUserByUsername(db, 'new.adjuster')!;
    expect(user.authority_limit_cents).toBe(2_500_000);
  });

  test('admin resets a password and the new one works', async () => {
    await call(db, tenant.keys.admin, 'POST', '/users', newUser);
    const user = repo.findUserByUsername(db, 'jordan.lee')!;
    const reset = await call(db, tenant.keys.admin, 'POST', `/users/${user.id}/password`, {
      password: 'a-new-password',
    });
    expect(reset.status).toBe(200);
    expect(() => signIn(db, 'jordan.lee', 'a-long-password')).toThrow();
    expect(signIn(db, 'jordan.lee', 'a-new-password').user.name).toBe('Jordan Lee');
  });

  test('user routes are tenant-scoped', async () => {
    const other = makeTenant(db, 'Northstar Mutual', 'NSTR');
    await call(db, tenant.keys.admin, 'POST', '/users', newUser);
    const user = repo.findUserByUsername(db, 'jordan.lee')!;

    // The other tenant's admin can neither see nor touch them.
    const list = await call(db, other.keys.admin, 'GET', '/users');
    const usernames = (list.payload as { users: { username: string }[] }).users.map(
      (u) => u.username,
    );
    expect(usernames).not.toContain('jordan.lee');
    const reset = await call(db, other.keys.admin, 'POST', `/users/${user.id}/password`, {
      password: 'stolen-password',
    });
    expect(reset.status).toBe(404);
  });
});
