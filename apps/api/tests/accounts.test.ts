import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db.ts';
import { createApp } from '../src/routes.ts';
import { cleanRisk, makeTenant, referralRisk, testDb } from './helpers.ts';

let db: Db;
let server: Server;
let baseUrl: string;
let keys: Record<string, string>;

beforeEach(async () => {
  db = testDb();
  keys = makeTenant(db).keys;
  server = createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

async function call(method: string, path: string, options: { key?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key) headers['authorization'] = `Bearer ${options.key}`;
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function rec(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

const NEW_ACCOUNT = {
  accountType: 'person',
  name: 'Marguerite Hale',
  email: 'm.hale@example.com',
  phone: '613-555-0142',
  addressLine1: '18 Rideau Terrace',
  city: 'Ottawa',
  province: 'ON',
  postalCode: 'K1M 2A1',
  producerCode: 'BRK-2201',
};

async function createAccount(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await call('POST', '/accounts', {
    key: keys['csr'],
    body: { ...NEW_ACCOUNT, ...overrides },
  });
  expect(res.status).toBe(201);
  return rec(res.body['account'])['id'] as string;
}

async function issuePolicyFor(accountId: string): Promise<string> {
  const created = await call('POST', `/accounts/${accountId}/submissions`, {
    key: keys['csr'],
    body: {
      productCode: 'ON_PA',
      effectiveDate: '2026-09-01',
      billingPlan: 'monthly',
      risk: cleanRisk(),
    },
  });
  const jobId = rec(created.body['job'])['id'] as string;
  await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
  await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] });
  const issued = await call('POST', `/jobs/${jobId}/issue`, { key: keys['csr'] });
  return rec(issued.body['policy'])['id'] as string;
}

describe('accounts', () => {
  test('an account is created with a tenant-scoped number', async () => {
    const res = await call('POST', '/accounts', { key: keys['csr'], body: NEW_ACCOUNT });
    const account = rec(res.body['account']);
    expect(account['accountNumber']).toBe('ACME-A0001');
    expect(rec(account['address'])['postalCode']).toBe('K1M 2A1');
  });

  test('account numbers increment', async () => {
    await createAccount();
    const second = await call('POST', '/accounts', {
      key: keys['csr'],
      body: { ...NEW_ACCOUNT, name: 'Daniel Okonkwo' },
    });
    expect(rec(second.body['account'])['accountNumber']).toBe('ACME-A0002');
  });

  test('a bad postal code is rejected before it reaches the database', async () => {
    const res = await call('POST', '/accounts', {
      key: keys['csr'],
      body: { ...NEW_ACCOUNT, postalCode: 'NOPE' },
    });
    expect(res.status).toBe(400);
    expect(rec(res.body['error'])['message']).toMatch(/postalCode/);
  });

  test('a province outside Canada is rejected', async () => {
    const res = await call('POST', '/accounts', {
      key: keys['csr'],
      body: { ...NEW_ACCOUNT, province: 'CA' },
    });
    expect(res.status).toBe(400);
  });

  test('search matches on name, number and city', async () => {
    await createAccount();
    await createAccount({ name: 'Daniel Okonkwo', city: 'Toronto' });

    const byName = await call('GET', '/accounts?q=okonkwo', { key: keys['csr'] });
    expect((byName.body['accounts'] as unknown[]).length).toBe(1);

    const byCity = await call('GET', '/accounts?q=ottawa', { key: keys['csr'] });
    expect((byCity.body['accounts'] as unknown[]).length).toBe(1);

    const all = await call('GET', '/accounts', { key: keys['csr'] });
    expect((all.body['accounts'] as unknown[]).length).toBe(2);
  });

  test('the account page carries its policies, jobs and rollup', async () => {
    const accountId = await createAccount();
    await issuePolicyFor(accountId);

    const res = await call('GET', `/accounts/${accountId}`, { key: keys['csr'] });
    expect(res.status).toBe(200);
    expect((res.body['policies'] as unknown[]).length).toBe(1);
    expect((res.body['jobs'] as unknown[]).length).toBe(1);

    const rollup = rec(res.body['rollup']);
    expect(rollup['inForceCount']).toBe(1);
    expect(rollup['annualPremiumCents']).toBeGreaterThan(0);
    expect(rollup['balanceCents']).toBe(rollup['billedCents']);
  });

  test('an empty account reports zeroes rather than failing', async () => {
    const accountId = await createAccount();
    const res = await call('GET', `/accounts/${accountId}`, { key: keys['csr'] });
    expect(res.body['policies']).toEqual([]);
    expect(rec(res.body['rollup'])['balanceCents']).toBe(0);
  });

  test('a submission started from an account is filed under it', async () => {
    const accountId = await createAccount();
    const created = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-09-01',
        billingPlan: 'quarterly',
        risk: cleanRisk(),
      },
    });
    expect(created.status).toBe(201);
    const job = rec(created.body['job']);
    expect(job['accountId']).toBe(accountId);
    expect(job['billingPlan']).toBe('quarterly');
  });

  test('an unknown billing plan is rejected', async () => {
    const accountId = await createAccount();
    const res = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-09-01',
        billingPlan: 'weekly',
        risk: cleanRisk(),
      },
    });
    expect(res.status).toBe(400);
  });

  test('a submission for an account in another tenant is a 404', async () => {
    const accountId = await createAccount();
    const other = makeTenant(db, 'Northstar Mutual', 'NSTR');
    const res = await call('POST', `/accounts/${accountId}/submissions`, {
      key: other.keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-09-01',
        billingPlan: 'monthly',
        risk: cleanRisk(),
      },
    });
    expect(res.status).toBe(404);
  });
});

describe('billing over HTTP', () => {
  test('the billing page lists invoices and accepts a payment', async () => {
    const accountId = await createAccount();
    await issuePolicyFor(accountId);

    const before = await call('GET', `/accounts/${accountId}/billing`, { key: keys['csr'] });
    const invoices = before.body['invoices'] as Record<string, unknown>[];
    expect(invoices.length).toBe(12);

    const paid = await call('POST', `/accounts/${accountId}/payments`, {
      key: keys['csr'],
      body: {
        amountCents: invoices[0]!['amountCents'],
        method: 'card',
        reference: 'VISA-4242',
        receivedAt: '2026-09-01',
      },
    });
    expect(paid.status).toBe(201);
    expect(paid.body['unappliedCents']).toBe(0);

    const after = await call('GET', `/accounts/${accountId}/billing`, { key: keys['csr'] });
    const first = (after.body['invoices'] as Record<string, unknown>[])[0]!;
    expect(first['status']).toBe('paid');
    expect((after.body['payments'] as unknown[]).length).toBe(1);
  });

  test('an unsupported payment method is rejected', async () => {
    const accountId = await createAccount();
    await issuePolicyFor(accountId);
    const res = await call('POST', `/accounts/${accountId}/payments`, {
      key: keys['csr'],
      body: { amountCents: 1000, method: 'bitcoin', receivedAt: '2026-09-01' },
    });
    expect(res.status).toBe(400);
  });

  test('policy detail exposes the schedule alongside the record', async () => {
    const accountId = await createAccount();
    const policyId = await issuePolicyFor(accountId);
    const res = await call('GET', `/policies/${policyId}`, { key: keys['csr'] });
    const billing = rec(res.body['billing']);
    expect(billing['plan']).toBe('monthly');
    expect((billing['invoices'] as unknown[]).length).toBe(12);
    expect(rec(res.body['account'])['name']).toBe('Marguerite Hale');
  });
});

describe('the underwriter worklist', () => {
  test('referred jobs surface with their reasons and premium at stake', async () => {
    const accountId = await createAccount();
    const created = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-09-01',
        billingPlan: 'monthly',
        risk: referralRisk(),
      },
    });
    const jobId = rec(created.body['job'])['id'] as string;
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });

    const res = await call('GET', '/worklist', { key: keys['underwriter'] });
    expect(rec(res.body['counts'])['referred']).toBe(1);
    const item = (res.body['referrals'] as Record<string, unknown>[])[0]!;
    expect(item['accountName']).toBe('Marguerite Hale');
    expect((item['referrals'] as unknown[]).length).toBe(2);
    expect(item['annualPremiumCents']).toBeGreaterThan(0);
  });

  test('an approved referral moves out of the queue and into ready-to-bind', async () => {
    const accountId = await createAccount();
    const created = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-09-01',
        billingPlan: 'monthly',
        risk: referralRisk(),
      },
    });
    const jobId = rec(created.body['job'])['id'] as string;
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    await call('POST', `/jobs/${jobId}/underwrite`, {
      key: keys['underwriter'],
      body: { decision: 'approve', note: 'Accept at standard rates.' },
    });

    const res = await call('GET', '/worklist', { key: keys['underwriter'] });
    expect(rec(res.body['counts'])['referred']).toBe(0);
    expect((res.body['readyToBind'] as unknown[]).length).toBe(1);
  });

  test('a clean quote is ready to bind without an underwriter', async () => {
    const accountId = await createAccount();
    const created = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-09-01',
        billingPlan: 'monthly',
        risk: cleanRisk(),
      },
    });
    const jobId = rec(created.body['job'])['id'] as string;
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });

    const res = await call('GET', '/worklist', { key: keys['csr'] });
    expect(rec(res.body['counts'])['referred']).toBe(0);
    expect((res.body['readyToBind'] as unknown[]).length).toBe(1);
  });
});
