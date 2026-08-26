import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { signIn } from '../src/auth.ts';
import type { Db } from '../src/db.ts';
import { DEFAULT_ACCOUNTS } from '../src/demo.ts';
import { ApiError } from '../src/errors.ts';
import { hashPassword, verifyPassword } from '../src/passwords.ts';
import { createApp } from '../src/routes.ts';
import { makeTenant, testDb } from './helpers.ts';

let db: Db;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  db = testDb();
  makeTenant(db);
  server = createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

async function login(body: unknown) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('password storage', () => {
  test('the stored value is never the password', () => {
    const stored = hashPassword('polaris');
    expect(stored.hash).not.toContain('polaris');
    expect(stored.hash).toHaveLength(128);
    expect(stored.salt).toHaveLength(32);
  });

  test('the same password hashes differently for each user', () => {
    expect(hashPassword('polaris').hash).not.toBe(hashPassword('polaris').hash);
  });

  test('verification accepts the password and rejects everything else', () => {
    const stored = hashPassword('polaris');
    expect(verifyPassword('polaris', stored)).toBe(true);
    expect(verifyPassword('Polaris', stored)).toBe(false);
    expect(verifyPassword('polaris ', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  test('a malformed stored hash fails closed', () => {
    expect(verifyPassword('polaris', { hash: 'deadbeef', salt: 'abc' })).toBe(false);
  });
});

describe('signing in', () => {
  test('every seeded role can sign in', () => {
    for (const account of DEFAULT_ACCOUNTS) {
      const result = signIn(db, account.username, account.password);
      expect(result.user.role).toBe(account.role);
      expect(result.user.tenantName).toBe('Acme Insurance');
      expect(result.token).toMatch(/^acme_/);
    }
  });

  test('the username is case-insensitive and trimmed', () => {
    expect(signIn(db, '  UNDERWRITER ', 'polaris').user.role).toBe('underwriter');
  });

  test('a wrong password is refused', () => {
    expect(() => signIn(db, 'underwriter', 'wrong')).toThrow(ApiError);
  });

  test('an unknown user and a wrong password are indistinguishable', () => {
    const messageFor = (username: string, password: string): string => {
      try {
        signIn(db, username, password);
        return 'signed in';
      } catch (err) {
        return (err as ApiError).message;
      }
    };
    // Same wording either way, so the response cannot be used to enumerate users.
    expect(messageFor('nobody', 'polaris')).toBe(messageFor('underwriter', 'wrong'));
  });
});

describe('the login endpoint', () => {
  test('valid credentials return a usable token', async () => {
    const res = await login({ username: 'underwriter', password: 'polaris' });
    expect(res.status).toBe(200);
    expect((res.body['user'] as Record<string, unknown>)['name']).toBe('Uma Wright');

    const me = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${res.body['token'] as string}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as Record<string, unknown>)['role']).toBe('underwriter');
  });

  test('bad credentials are a 401', async () => {
    expect((await login({ username: 'underwriter', password: 'nope' })).status).toBe(401);
    expect((await login({ username: 'ghost', password: 'polaris' })).status).toBe(401);
  });

  test('a missing or non-string field is a 401, not a crash', async () => {
    expect((await login({})).status).toBe(401);
    expect((await login({ username: 42, password: [] })).status).toBe(401);
  });

  test('the credential hint is not served unless the demo flag is set', async () => {
    // POLARIS_DEMO is unset in the test environment.
    const res = await fetch(`${baseUrl}/api/demo/credentials`);
    expect(res.status).toBe(404);
  });
});
