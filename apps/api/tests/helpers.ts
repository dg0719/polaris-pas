import type { RiskData, Role } from '@polaris/domain';
import { createAccount } from '../src/accounts.ts';
import { openDb, type Db } from '../src/db.ts';
import * as repo from '../src/repo.ts';
import type { AccountRow, TenantCtx } from '../src/repo.ts';
import { seedTenant } from '../src/seed.ts';

export interface TestTenant {
  tenantId: string;
  keys: Record<Role, string>;
  ctx: Record<Role, TenantCtx>;
}

export function testDb(): Db {
  return openDb(':memory:');
}

/**
 * Usernames are globally unique, so only the first tenant in a database can
 * hold the plain `underwriter` / `csr` / `admin` logins.
 */
export function makeTenant(db: Db, name = 'Acme Insurance', prefix = 'ACME'): TestTenant {
  const seeded = seedTenant(db, name, prefix, {
    ...(prefix === 'ACME' ? {} : { usernameSuffix: prefix.toLowerCase() }),
  });
  const ctx = {} as Record<Role, TenantCtx>;
  for (const role of Object.keys(seeded.keys) as Role[]) {
    const user = repo.findUserByApiKey(db, seeded.keys[role])!;
    ctx[role] = { tenantId: user.tenant_id, userId: user.id, role };
  }
  return { ...seeded, ctx };
}

/** A customer account to hang submissions off. */
export function makeAccount(db: Db, ctx: TenantCtx, name = 'Jane Doe'): AccountRow {
  return createAccount(db, ctx, {
    account_type: 'person',
    name,
    email: 'jane.doe@example.com',
    phone: '613-555-0100',
    address_line1: '1 Wellington Street',
    address_line2: null,
    city: 'Ottawa',
    province: 'ON',
    postal_code: 'K1A 0A1',
    producer_code: 'BRK-0001',
  });
}

/** Clean risk: 15-year licensed driver, no claims — never triggers a referral. */
export function cleanRisk(): RiskData {
  return {
    termMonths: 12,
    drivers: [
      {
        id: 'd1',
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-04-12',
        licenceNumber: 'D1234-56789-01234',
        yearsLicensed: 15,
        atFaultClaims: 0,
        minorConvictions: 0,
      },
    ],
    vehicles: [
      {
        id: 'v1',
        year: 2022,
        make: 'Toyota',
        model: 'RAV4',
        vin: 'JTM123456789',
        valueCents: 3_800_000,
        rateGroup: 10,
        primaryUse: 'commute',
        annualKm: 15_000,
        postalCode: 'K1A 0A1',
        principalDriverId: 'd1',
      },
    ],
    coverages: [
      { vehicleId: 'v1', coverageCode: 'LIAB', limitCents: 100_000_000 },
      { vehicleId: 'v1', coverageCode: 'AB' },
      { vehicleId: 'v1', coverageCode: 'DCPD' },
      { vehicleId: 'v1', coverageCode: 'UA' },
    ],
  };
}

/** Same risk with a brand-new driver carrying two at-fault claims. */
export function referralRisk(): RiskData {
  const risk = cleanRisk();
  risk.drivers[0]!.yearsLicensed = 0;
  risk.drivers[0]!.atFaultClaims = 2;
  return risk;
}
