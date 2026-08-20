import type { Role } from '@polaris/domain';

/**
 * The seeded logins. One account per role, which is what the demo needs: the
 * sign-in screen advertises these three, and the seed is the only thing that
 * creates them.
 *
 * The second tenant gets its own suffixed accounts so tenant isolation stays
 * demonstrable, but they are not advertised anywhere.
 */

export interface DemoAccount {
  username: string;
  password: string;
  name: string;
  email: string;
  role: Role;
}

const PASSWORD = 'polaris';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    username: 'underwriter',
    password: PASSWORD,
    name: 'Uma Wright',
    email: 'uma.wright@example.com',
    role: 'underwriter',
  },
  {
    username: 'csr',
    password: PASSWORD,
    name: 'Casey Reid',
    email: 'casey.reid@example.com',
    role: 'csr',
  },
  {
    username: 'admin',
    password: PASSWORD,
    name: 'Ade Mina',
    email: 'ade.mina@example.com',
    role: 'admin',
  },
];

/** Second-tenant logins: same roles, suffixed usernames, never advertised. */
export function accountsForSecondTenant(suffix: string): DemoAccount[] {
  return DEMO_ACCOUNTS.map((account) => ({
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
  return DEMO_ACCOUNTS.map(({ role, username, password }) => ({ role, username, password }));
}
