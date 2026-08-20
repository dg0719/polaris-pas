import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { InstallmentPlan, RiskData, Role } from '@polaris/domain';
import { createAccount } from './accounts.ts';
import { recordPayment } from './billing.ts';
import { addDays, addMonths, todayIso } from './dates.ts';
import { openDb, type Db } from './db.ts';
import { DEMO_ACCOUNTS, accountsForSecondTenant } from './demo.ts';
import { hashPassword } from './passwords.ts';
import { issueJob } from './issue.ts';
import {
  bindJob,
  createCancellation,
  createPolicyChange,
  createRenewal,
  createSubmission,
  quoteJob,
  underwriteJob,
} from './jobs.ts';
import * as repo from './repo.ts';
import type { AccountRow, TenantCtx } from './repo.ts';
import { account, coverages, driver, risk, vehicle } from './seed/fixtures.ts';

/**
 * Development seed. Builds two tenants (proving isolation) and, for the first,
 * a book of business with every state an underwriter actually meets: referrals
 * waiting on a decision, an endorsed policy, an overdue account, a cancellation
 * with a refund, a renewal in progress and a half-finished draft.
 *
 * API keys are generated per run and printed. Nothing secret is committed.
 */

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function apiKey(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

/**
 * One login per role. The primary tenant gets the advertised usernames
 * (`underwriter`, `csr`, `admin`); any further tenant gets suffixed ones so
 * usernames stay globally unique and isolation is still demonstrable.
 */
export function seedTenant(
  db: Db,
  name: string,
  prefix: string,
  options: { usernameSuffix?: string } = {},
): { tenantId: string; keys: Record<Role, string> } {
  const tenant = repo.createTenant(db, name, prefix);
  const accounts = options.usernameSuffix
    ? accountsForSecondTenant(options.usernameSuffix)
    : DEMO_ACCOUNTS;

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
    });
    keys[account.role] = key;
  }
  return { tenantId: tenant.id, keys };
}

interface Ctxs {
  csr: TenantCtx;
  underwriter: TenantCtx;
}

function contexts(db: Db, keys: Record<Role, string>): Ctxs {
  const resolve = (role: Role): TenantCtx => {
    const user = repo.findUserByApiKey(db, keys[role])!;
    return { tenantId: user.tenant_id, userId: user.id, role };
  };
  return { csr: resolve('csr'), underwriter: resolve('underwriter') };
}

// ─── Scenario helpers ───────────────────────────────────────────────────────

function submit(
  db: Db,
  ctx: TenantCtx,
  acct: AccountRow,
  effectiveDate: string,
  plan: InstallmentPlan,
  riskData: RiskData,
) {
  return createSubmission(db, ctx, {
    accountId: acct.id,
    productCode: 'ON_PA',
    effectiveDate,
    billingPlan: plan,
    risk: riskData,
  });
}

/** Submission all the way to an issued policy. */
function issuePolicy(
  db: Db,
  ctx: TenantCtx,
  acct: AccountRow,
  effectiveDate: string,
  plan: InstallmentPlan,
  riskData: RiskData,
) {
  const job = submit(db, ctx, acct, effectiveDate, plan, riskData);
  quoteJob(db, ctx, job.id);
  bindJob(db, ctx, job.id);
  return issueJob(db, ctx, job.id);
}

/** Pay the first `count` invoices that are still outstanding. */
function payInvoices(db: Db, ctx: TenantCtx, accountId: string, count: number): void {
  const outstanding = repo
    .listInvoicesForAccount(db, ctx, accountId)
    .filter((i) => i.status === 'open' && i.amount_cents > i.paid_cents)
    .slice(0, count);
  for (const invoice of outstanding) {
    recordPayment(db, ctx, {
      accountId,
      amountCents: invoice.amount_cents - invoice.paid_cents,
      method: 'eft',
      reference: `EFT-${invoice.invoice_number}`,
      receivedAt: invoice.due_date,
    });
  }
}

// ─── The book of business ───────────────────────────────────────────────────

/** Backdate an account so "customer since" predates the policies on it. */
function backdate(db: Db, ctx: TenantCtx, accountId: string, isoDate: string): void {
  db.prepare('UPDATE accounts SET created_at = ? WHERE tenant_id = ? AND id = ?').run(
    `${isoDate}T09:00:00.000Z`,
    ctx.tenantId,
    accountId,
  );
}

function seedBook(db: Db, ctxs: Ctxs): void {
  const { csr, underwriter } = ctxs;
  const today = todayIso();
  const monthsAgo = (n: number) => addMonths(today, -n);

  // 1. A clean, healthy policy: eight months in, paying monthly, up to date.
  const hale = createAccount(
    db,
    csr,
    account({
      name: 'Marguerite Hale',
      email: 'm.hale@example.com',
      phone: '613-555-0142',
      addressLine1: '18 Rideau Terrace',
      city: 'Ottawa',
      postalCode: 'K1M 2A1',
    }),
  );
  const halePolicy = issuePolicy(
    db,
    csr,
    hale,
    monthsAgo(8),
    'monthly',
    risk(
      [driver({ id: 'd1', firstName: 'Marguerite', lastName: 'Hale', dateOfBirth: '1979-03-22', yearsLicensed: 24 })],
      [vehicle({ id: 'v1', year: 2023, make: 'Subaru', model: 'Outback', valueCents: 4_250_000, rateGroup: 12, postalCode: 'K1M 2A1', principalDriverId: 'd1' })],
      coverages('v1', { deductibleCents: 100_000 }),
    ),
  );
  backdate(db, csr, hale.id, monthsAgo(14));
  payInvoices(db, csr, hale.id, 9); // paid up to date

  // 2. Endorsed mid-term: a second vehicle added, additional premium spread
  //    across the remaining installments.
  const okonkwo = createAccount(
    db,
    csr,
    account({
      name: 'Daniel Okonkwo',
      email: 'd.okonkwo@example.com',
      phone: '416-555-0188',
      addressLine1: '440 Queens Quay W, Unit 1102',
      city: 'Toronto',
      postalCode: 'M5V 2Y4',
      producerCode: 'BRK-3390',
    }),
  );
  const okonkwoDriver = driver({
    id: 'd1',
    firstName: 'Daniel',
    lastName: 'Okonkwo',
    dateOfBirth: '1988-11-04',
    yearsLicensed: 15,
    minorConvictions: 1,
  });
  const okonkwoCar = vehicle({
    id: 'v1',
    year: 2021,
    make: 'Honda',
    model: 'Civic',
    valueCents: 2_640_000,
    rateGroup: 9,
    postalCode: 'M5V 2Y4',
    principalDriverId: 'd1',
  });
  const okonkwoPolicy = issuePolicy(
    db,
    csr,
    okonkwo,
    monthsAgo(5),
    'quarterly',
    risk([okonkwoDriver], [okonkwoCar], coverages('v1', { endorsements: ['OPCF20'] })),
  );
  backdate(db, csr, okonkwo.id, monthsAgo(30));
  payInvoices(db, csr, okonkwo.id, 1);
  const secondCar = vehicle({
    id: 'v2',
    year: 2019,
    make: 'Mazda',
    model: 'CX-5',
    valueCents: 2_100_000,
    rateGroup: 11,
    postalCode: 'M5V 2Y4',
    principalDriverId: 'd1',
    primaryUse: 'pleasure',
    annualKm: 9_000,
  });
  const endorsement = createPolicyChange(db, csr, {
    policyId: okonkwoPolicy.policy.id,
    effectiveDate: monthsAgo(1),
    risk: risk(
      [okonkwoDriver],
      [okonkwoCar, secondCar],
      [...coverages('v1', { endorsements: ['OPCF20'] }), ...coverages('v2')],
    ),
  });
  quoteJob(db, csr, endorsement.id);
  bindJob(db, csr, endorsement.id);
  issueJob(db, csr, endorsement.id);

  // 3. Referral waiting on an underwriter: two at-fault claims.
  const tremblay = createAccount(
    db,
    csr,
    account({
      name: 'Sophie Tremblay',
      email: 's.tremblay@example.com',
      phone: '705-555-0119',
      addressLine1: '77 Lakeshore Road',
      city: 'Sudbury',
      postalCode: 'P3E 2C6',
    }),
  );
  backdate(db, csr, tremblay.id, monthsAgo(1));
  const tremblaySubmission = submit(
    db,
    csr,
    tremblay,
    addDays(today, 12),
    'monthly',
    risk(
      [driver({ id: 'd1', firstName: 'Sophie', lastName: 'Tremblay', dateOfBirth: '1993-06-18', yearsLicensed: 8, atFaultClaims: 2, minorConvictions: 1 })],
      [vehicle({ id: 'v1', year: 2024, make: 'Toyota', model: 'RAV4', valueCents: 4_680_000, rateGroup: 13, postalCode: 'P3E 2C6', principalDriverId: 'd1' })],
      coverages('v1', { limitCents: 200_000_000, deductibleCents: 50_000 }),
    ),
  );
  quoteJob(db, csr, tremblaySubmission.id);

  // 4. Referral on a high-value vehicle driven by a newly licensed driver.
  const bergstrom = createAccount(
    db,
    csr,
    account({
      name: 'Bergström Family Trust',
      accountType: 'organization',
      email: 'admin@bergstromtrust.example.com',
      phone: '905-555-0177',
      addressLine1: '2 Lorne Park Estates',
      city: 'Mississauga',
      postalCode: 'L5H 3A9',
      producerCode: 'BRK-1104',
    }),
  );
  backdate(db, csr, bergstrom.id, monthsAgo(2));
  const bergstromSubmission = submit(
    db,
    csr,
    bergstrom,
    addDays(today, 21),
    'full',
    risk(
      [driver({ id: 'd1', firstName: 'Elias', lastName: 'Bergström', dateOfBirth: '2007-02-09', yearsLicensed: 0 })],
      [vehicle({ id: 'v1', year: 2025, make: 'Porsche', model: 'Macan', valueCents: 16_400_000, rateGroup: 20, postalCode: 'L5H 3A9', principalDriverId: 'd1', annualKm: 6_000 })],
      coverages('v1', { limitCents: 200_000_000, deductibleCents: 200_000, endorsements: ['OPCF43', 'OPCF44R'] }),
    ),
  );
  quoteJob(db, csr, bergstromSubmission.id);

  // 5. Approved referral, quoted and clear to bind.
  const nkemdirim = createAccount(
    db,
    csr,
    account({
      name: 'Chidi Nkemdirim',
      email: 'c.nkemdirim@example.com',
      phone: '519-555-0163',
      addressLine1: '311 Colborne Street',
      city: 'London',
      postalCode: 'N6B 3N4',
    }),
  );
  backdate(db, csr, nkemdirim.id, monthsAgo(1));
  const approved = submit(
    db,
    csr,
    nkemdirim,
    addDays(today, 5),
    'monthly',
    risk(
      [driver({ id: 'd1', firstName: 'Chidi', lastName: 'Nkemdirim', dateOfBirth: '1996-09-30', yearsLicensed: 2 })],
      [vehicle({ id: 'v1', year: 2020, make: 'Volkswagen', model: 'Golf', valueCents: 2_150_000, rateGroup: 8, postalCode: 'N6B 3N4', principalDriverId: 'd1' })],
      coverages('v1'),
    ),
  );
  quoteJob(db, csr, approved.id);
  underwriteJob(db, underwriter, approved.id, 'approve', 'Single new driver, modest vehicle. Accept at standard rates.');

  // 6. Overdue: three months in on a monthly plan, nothing paid since the first.
  const arsenault = createAccount(
    db,
    csr,
    account({
      name: 'Léa Arsenault',
      email: 'l.arsenault@example.com',
      phone: '613-555-0155',
      addressLine1: '9 Rue Principale',
      city: 'Hawkesbury',
      postalCode: 'K6A 1A3',
    }),
  );
  issuePolicy(
    db,
    csr,
    arsenault,
    monthsAgo(3),
    'monthly',
    risk(
      [driver({ id: 'd1', firstName: 'Léa', lastName: 'Arsenault', dateOfBirth: '1985-01-14', yearsLicensed: 19, atFaultClaims: 1 })],
      [vehicle({ id: 'v1', year: 2018, make: 'Ford', model: 'Escape', valueCents: 1_580_000, rateGroup: 7, postalCode: 'K6A 1A3', principalDriverId: 'd1' })],
      coverages('v1', { deductibleCents: 200_000 }),
    ),
  );
  backdate(db, csr, arsenault.id, monthsAgo(40));
  payInvoices(db, csr, arsenault.id, 1);

  // 7. Cancelled mid-term, leaving a refund the customer is owed.
  const whitefeather = createAccount(
    db,
    csr,
    account({
      name: 'Joanne Whitefeather',
      email: 'j.whitefeather@example.com',
      phone: '807-555-0121',
      addressLine1: '52 Algoma Street N',
      city: 'Thunder Bay',
      postalCode: 'P7A 4Z5',
    }),
  );
  const cancelled = issuePolicy(
    db,
    csr,
    whitefeather,
    monthsAgo(7),
    'full',
    risk(
      [driver({ id: 'd1', firstName: 'Joanne', lastName: 'Whitefeather', dateOfBirth: '1971-07-27', yearsLicensed: 31 })],
      [vehicle({ id: 'v1', year: 2017, make: 'Chevrolet', model: 'Equinox', valueCents: 1_320_000, rateGroup: 6, postalCode: 'P7A 4Z5', principalDriverId: 'd1' })],
      coverages('v1'),
    ),
  );
  backdate(db, csr, whitefeather.id, monthsAgo(19));
  payInvoices(db, csr, whitefeather.id, 1);
  const cancellation = createCancellation(db, csr, {
    policyId: cancelled.policy.id,
    effectiveDate: monthsAgo(1),
    reason: 'Vehicle sold, no replacement',
  });
  quoteJob(db, csr, cancellation.id);
  bindJob(db, csr, cancellation.id);
  issueJob(db, csr, cancellation.id);

  // 8. A renewal quoted for the term that starts when Hale's expires.
  const renewal = createRenewal(db, csr, { policyId: halePolicy.policy.id });
  quoteJob(db, csr, renewal.id);

  // 9. A submission still being typed: quoted once, then edited back to draft.
  const draftAccount = createAccount(
    db,
    csr,
    account({
      name: 'Priya Raghunathan',
      email: 'p.raghunathan@example.com',
      phone: '289-555-0134',
      addressLine1: '14 Bronte Road',
      city: 'Oakville',
      postalCode: 'L6L 3B7',
    }),
  );
  backdate(db, csr, draftAccount.id, monthsAgo(1));
  submit(
    db,
    csr,
    draftAccount,
    addDays(today, 30),
    'quarterly',
    risk(
      [driver({ id: 'd1', firstName: 'Priya', lastName: 'Raghunathan', dateOfBirth: '1990-12-02', yearsLicensed: 12 })],
      [vehicle({ id: 'v1', year: 2022, make: 'Hyundai', model: 'Tucson', valueCents: 3_100_000, rateGroup: 10, postalCode: 'L6L 3B7', principalDriverId: 'd1' })],
      coverages('v1'),
    ),
  );
}

function main(): void {
  const db = openDb();
  const acme = seedTenant(db, 'Acme Insurance', 'ACME');
  const northstar = seedTenant(db, 'Northstar Mutual', 'NSTR', { usernameSuffix: 'northstar' });

  seedBook(db, contexts(db, acme.keys));

  // A second tenant with its own book, so isolation is visible in the demo.
  const nstr = contexts(db, northstar.keys);
  const other = createAccount(
    db,
    nstr.csr,
    account({
      name: 'Fiona Doyle',
      email: 'f.doyle@example.com',
      phone: '204-555-0190',
      addressLine1: '88 Wellington Crescent',
      city: 'Kingston',
      postalCode: 'K7L 3N6',
    }),
  );
  issuePolicy(
    db,
    nstr.csr,
    other,
    addMonths(todayIso(), -2),
    'monthly',
    risk(
      [driver({ id: 'd1', firstName: 'Fiona', lastName: 'Doyle', dateOfBirth: '1982-05-08', yearsLicensed: 21 })],
      [vehicle({ id: 'v1', year: 2020, make: 'Nissan', model: 'Rogue', valueCents: 2_400_000, rateGroup: 9, postalCode: 'K7L 3N6', principalDriverId: 'd1' })],
      coverages('v1'),
    ),
  );

  log('Sign in with:');
  for (const account of DEMO_ACCOUNTS) {
    log(`  ${account.role.padEnd(12)} ${account.username.padEnd(14)} ${account.password}`);
  }
  log(`
Acme Insurance   ${acme.tenantId}`);
  log(`Northstar Mutual ${northstar.tenantId} (usernames suffixed .northstar)`);

  const csr = contexts(db, acme.keys).csr;
  log(
    `\nAcme book: ${repo.listAccounts(db, csr).length} accounts, ` +
      `${repo.listPolicies(db, csr).length} policies, ` +
      `${repo.listJobs(db, csr).length} jobs.`,
  );
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
