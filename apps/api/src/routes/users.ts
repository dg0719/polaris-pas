import type { Role } from '@polaris/domain';
import { apiKey } from '../bootstrap.ts';
import type { Db } from '../db.ts';
import { ApiError } from '../errors.ts';
import { created, type Router } from '../http.ts';
import { hashPassword } from '../passwords.ts';
import * as repo from '../repo.ts';
import type { TenantCtx, UserRow } from '../repo.ts';
import { requireOneOf, requireString } from '../validation.ts';
import { authenticated, body, param } from './context.ts';

/**
 * Team management, admin only. This is how sign-ins come to exist after the
 * first start: the bootstrap admin creates the rest of the team.
 */

const ROLES: readonly Role[] = ['csr', 'underwriter', 'adjuster', 'claims_supervisor', 'admin'];
const CLAIMS_ROLES = new Set<Role>(['adjuster', 'claims_supervisor', 'admin']);
const MIN_PASSWORD_LENGTH = 8;

function userDto(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    authorityLimitCents: user.authority_limit_cents,
    createdAt: user.created_at,
  };
}

function requireUsername(value: unknown): string {
  const raw = requireString(value, 'username').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(raw)) {
    throw ApiError.badRequest(
      'Username must be 3–40 characters: letters, numbers, dots, dashes or underscores',
    );
  }
  return raw;
}

function requirePassword(value: unknown): string {
  const raw = requireString(value, 'password');
  if (raw.length < MIN_PASSWORD_LENGTH) {
    throw ApiError.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return raw;
}

function requireAuthority(role: Role, value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw ApiError.badRequest('authorityLimitCents must be a non-negative whole number of cents');
  }
  if (value > 0 && !CLAIMS_ROLES.has(role)) {
    throw ApiError.badRequest(`A ${role} does not hold payment authority`);
  }
  return value;
}

function requireUser(db: Db, tenant: TenantCtx, userId: string): UserRow {
  const user = repo.getUserInTenant(db, tenant, userId);
  if (!user) throw ApiError.notFound(`User ${userId} not found`);
  return user;
}

export function registerUserRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  router.get(
    '/users',
    authed((_ctx, tenant) => ({ users: repo.listUsers(db, tenant).map(userDto) }), ['admin']),
  );

  router.post(
    '/users',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const username = requireUsername(input['username']);
      const role = requireOneOf(input['role'], 'role', ROLES);

      // Usernames are globally unique (they carry the sign-in); refuse a
      // duplicate with a clear message rather than a raw constraint error.
      if (repo.findUserByUsername(db, username)) {
        throw ApiError.conflict(`The username ${username} is already taken`, 'username_taken');
      }

      const stored = hashPassword(requirePassword(input['password']));
      const user = repo.createUser(db, tenant.tenantId, {
        username,
        email: requireString(input['email'], 'email'),
        name: requireString(input['name'], 'name'),
        role,
        passwordHash: stored.hash,
        passwordSalt: stored.salt,
        apiKey: apiKey(username),
        authorityLimitCents: requireAuthority(role, input['authorityLimitCents']),
      });
      return created({ user: userDto(user) });
    }, ['admin']),
  );

  router.post(
    '/users/:id/password',
    authed((ctx, tenant) => {
      const input = body(ctx);
      const user = requireUser(db, tenant, param(ctx, 'id'));
      repo.updateUserPassword(db, tenant, user.id, hashPassword(requirePassword(input['password'])));
      return { user: userDto(user) };
    }, ['admin']),
  );
}
