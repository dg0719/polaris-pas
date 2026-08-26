import { randomBytes } from 'node:crypto';
import type { Role } from '@polaris/domain';
import type { Db } from './db.ts';
import { DEFAULT_ACCOUNTS, accountsForSecondTenant } from './demo.ts';
import { hashPassword } from './passwords.ts';
import * as repo from './repo.ts';

/**
 * First start: an empty database gets one carrier and one sign-in per role,
 * and nothing else. No accounts, no policies, no claims — the book begins
 * empty and everything in it is entered by a person.
 */

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function apiKey(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

/**
 * One login per role. The first tenant gets the plain usernames
 * (`underwriter`, `csr`, `adjuster`, `supervisor`, `admin`); any further
 * tenant gets suffixed ones, because usernames are globally unique.
 */
export function bootstrapTenant(
  db: Db,
  name: string,
  prefix: string,
  options: { usernameSuffix?: string } = {},
): { tenantId: string; keys: Record<Role, string> } {
  const tenant = repo.createTenant(db, name, prefix);
  const accounts = options.usernameSuffix
    ? accountsForSecondTenant(options.usernameSuffix)
    : DEFAULT_ACCOUNTS;

  const keys = {} as Record<Role, string>;
  for (const account of accounts) {
    const key = apiKey(prefix.toLowerCase());
    const stored = hashPassword(account.password);
    repo.createUser(db, tenant.id, {
      username: account.username,
      email: account.email,
      name: account.name,
      role: account.role,
      passwordHash: stored.hash,
      passwordSalt: stored.salt,
      apiKey: key,
      authorityLimitCents: account.authorityLimitCents,
    });
    keys[account.role] = key;
  }
  return { tenantId: tenant.id, keys };
}

function countTenants(db: Db): number {
  return (db.prepare('SELECT count(*) AS n FROM tenants').get() as { n: number }).n;
}

/**
 * Runs at every server start; acts only when the database holds no tenant at
 * all. An existing database — whatever is in it — is never touched.
 */
export function bootstrapIfEmpty(db: Db): void {
  if (countTenants(db) > 0) return;

  const name = process.env.POLARIS_CARRIER_NAME ?? 'Polaris Insurance';
  const prefix = process.env.POLARIS_CARRIER_PREFIX ?? 'POL';
  bootstrapTenant(db, name, prefix);

  log(`First start: created carrier "${name}" (prefix ${prefix}) with these sign-ins:`);
  for (const account of DEFAULT_ACCOUNTS) {
    log(`  ${account.role.padEnd(18)} ${account.username.padEnd(14)} ${account.password}`);
  }
  log('The book of business is empty. Change these passwords from the Team screen.');
}
