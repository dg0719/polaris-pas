import type { IncomingMessage } from 'node:http';
import type { Role } from '@polaris/domain';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';
import { verifyPassword } from './passwords.ts';
import {
  findUserByApiKey,
  findUserByUsername,
  tenantName,
  type TenantCtx,
  type UserRow,
} from './repo.ts';

function extractApiKey(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null;
  }
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  return null;
}

/**
 * Resolve the caller from their API key. The returned context is the *only*
 * source of tenant identity — never read a tenant id from the request body.
 */
export function authenticate(db: Db, req: IncomingMessage): { ctx: TenantCtx; user: UserRow } {
  const apiKey = extractApiKey(req);
  if (!apiKey) throw ApiError.unauthorized();
  const user = findUserByApiKey(db, apiKey);
  if (!user) throw ApiError.unauthorized();
  return {
    ctx: { tenantId: user.tenant_id, userId: user.id, role: user.role },
    user,
  };
}

export interface SignInResult {
  token: string;
  user: { id: string; name: string; role: Role; tenantName: string };
}

/**
 * Exchange a username and password for the caller's API key.
 *
 * This is a demo sign-in, not an authentication system: the token is the
 * long-lived API key rather than an expiring session, and there is no rate
 * limiting behind it. The failure message is deliberately identical for an
 * unknown user and a wrong password.
 */
export function signIn(db: Db, username: unknown, password: unknown): SignInResult {
  const badCredentials = ApiError.unauthorized('Username or password is not recognised');
  if (typeof username !== 'string' || typeof password !== 'string') throw badCredentials;

  const user = findUserByUsername(db, username);
  if (!user) throw badCredentials;
  if (!verifyPassword(password, { hash: user.password_hash, salt: user.password_salt })) {
    throw badCredentials;
  }

  return {
    token: user.api_key,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      tenantName: tenantName(db, user.tenant_id),
    },
  };
}

export function requireRole(ctx: TenantCtx, ...roles: Role[]): void {
  if (!roles.includes(ctx.role)) {
    throw ApiError.forbidden(`Requires role: ${roles.join(' or ')}`);
  }
}
