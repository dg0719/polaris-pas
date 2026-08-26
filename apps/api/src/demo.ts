import type { Role } from '@polaris/domain';

/**
 * The default sign-ins: one per role, created by first-start bootstrap. Any
 * further tenant gets suffixed usernames, because usernames are globally
 * unique.
 */

export interface DemoAccount {
  username: string;
  password: string;
  name: string;
  email: string;
  role: Role;
  /** Claim payment authority in cents; 0 for roles that never pay claims. */
  authorityLimitCents: number;
}

const PASSWORD = 'polaris';

export const DEFAULT_ACCOUNTS: DemoAccount[] = [
  {
    username: 'underwriter',
    password: PASSWORD,
    name: 'Uma Wright',
    email: 'uma.wright@example.com',
    role: 'underwriter',
    authorityLimitCents: 0,
  },
  {
    username: 'csr',
    password: PASSWORD,
    name: 'Casey Reid',
    email: 'casey.reid@example.com',
    role: 'csr',
    authorityLimitCents: 0,
  },
  {
    username: 'adjuster',
    password: PASSWORD,
    name: 'Ana Diaz',
    email: 'ana.diaz@example.com',
    role: 'adjuster',
    authorityLimitCents: 1_000_000, // $10,000
  },
  {
    username: 'supervisor',
    password: PASSWORD,
    name: 'Sam Osei',
    email: 'sam.osei@example.com',
    role: 'claims_supervisor',
    authorityLimitCents: 10_000_000, // $100,000
  },
  {
    username: 'admin',
    password: PASSWORD,
    name: 'Ade Mina',
    email: 'ade.mina@example.com',
    role: 'admin',
    authorityLimitCents: 25_000_000, // $250,000
  },
];

/** Second-tenant logins: same roles, suffixed usernames, never advertised. */
export function accountsForSecondTenant(suffix: string): DemoAccount[] {
  return DEFAULT_ACCOUNTS.map((account) => ({
    ...account,
    username: `${account.username}.${suffix}`,
    email: account.email.replace('@', `.${suffix}@`),
  }));
}

export interface DemoCredential {
  role: Role;
  username: string;
  password: string;
}

/** What the sign-in screen prints under the form. Gated by POLARIS_DEMO=1. */
export function listDemoCredentials(): DemoCredential[] {
  return DEFAULT_ACCOUNTS.map(({ role, username, password }) => ({ role, username, password }));
}
