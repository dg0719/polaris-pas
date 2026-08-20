import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db.ts';
import { createApp } from '../src/routes.ts';
import { cleanRisk, makeAccount, makeTenant, referralRisk, testDb } from './helpers.ts';

let db: Db;
let server: Server;
let baseUrl: string;
let keys: Record<string, string>;
let accountId: string;

beforeEach(async () => {
  db = testDb();
  const tenant = makeTenant(db);
  keys = tenant.keys;
  accountId = makeAccount(db, tenant.ctx.csr).id;
  server = createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

interface Call {
  status: number;
  body: Record<string, never> & Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  options: { key?: string; body?: unknown } = {},
): Promise<Call> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key) headers['authorization'] = `Bearer ${options.key}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: (await res.json()) as Call['body'] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

async function newBusinessJob(risk = cleanRisk()): Promise<string> {
  const created = await call('POST', `/accounts/${accountId}/submissions`, {
    key: keys['csr'],
    body: { productCode: 'ON_PA', effectiveDate: '2026-09-01', billingPlan: 'monthly', risk },
  });
  expect(created.status).toBe(201);
  return asRecord(created.body['job'])['id'] as string;
}

describe('public routes', () => {
  test('health needs no key', async () => {
    const res = await call('GET', '/health');
    expect(res).toEqual({ status: 200, body: { status: 'ok' } });
  });

  test('products are listed with the sample-rates flag', async () => {
    const res = await call('GET', '/products');
    const products = res.body['products'] as Record<string, unknown>[];
    expect(products[0]!['productCode']).toBe('ON_PA');
    expect(products[0]!['sample']).toBe(true);
  });

  test('an unknown product is a 400', async () => {
    const res = await call('GET', '/products/QC_PA');
    expect(res.status).toBe(400);
    expect(asRecord(res.body['error'])['code']).toBe('unknown_product');
  });

  test('unknown routes are 404 and wrong methods are 405', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    expect((await call('GET', '/jobs/abc/quote')).status).toBe(405);
  });
});

describe('authentication', () => {
  test('protected routes reject a missing key', async () => {
    const res = await call('GET', '/jobs');
    expect(res.status).toBe(401);
  });

  test('protected routes reject an unknown key', async () => {
    const res = await call('GET', '/jobs', { key: 'not-a-key' });
    expect(res.status).toBe(401);
  });

  test('/me reflects the calling user', async () => {
    const res = await call('GET', '/me', { key: keys['underwriter'] });
    expect(res.status).toBe(200);
    expect(res.body['role']).toBe('underwriter');
  });
});

describe('job lifecycle over HTTP', () => {
  test('submission through issue returns the policy and transaction', async () => {
    const jobId = await newBusinessJob();

    const quoted = await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    expect(quoted.status).toBe(200);
    const quote = asRecord(quoted.body['quote']);
    expect(quote['kind']).toBe('risk');
    expect(quote['annualPremiumCents']).toBeGreaterThan(0);

    expect((await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] })).status).toBe(200);

    const issued = await call('POST', `/jobs/${jobId}/issue`, { key: keys['csr'] });
    expect(issued.status).toBe(200);
    expect(asRecord(issued.body['job'])['status']).toBe('Issued');
    expect(asRecord(issued.body['policy'])['policyNumber']).toBe('ACME-000001');
    expect(asRecord(issued.body['transaction'])['type']).toBe('NewBusiness');
  });

  test('the job detail endpoint exposes the audit trail', async () => {
    const jobId = await newBusinessJob();
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    const res = await call('GET', `/jobs/${jobId}`, { key: keys['csr'] });
    const events = res.body['events'] as Record<string, unknown>[];
    expect(events.map((e) => e['action'])).toEqual(['create', 'quote']);
    expect(events[1]!['actorRole']).toBe('csr');
  });

  test('jobs can be filtered by status', async () => {
    const jobId = await newBusinessJob();
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    await newBusinessJob();

    const quoted = await call('GET', '/jobs?status=Quoted', { key: keys['csr'] });
    expect((quoted.body['jobs'] as unknown[]).length).toBe(1);
    const drafts = await call('GET', '/jobs?status=Draft', { key: keys['csr'] });
    expect((drafts.body['jobs'] as unknown[]).length).toBe(1);
  });

  test('binding out of order is a 409', async () => {
    const jobId = await newBusinessJob();
    const res = await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] });
    expect(res.status).toBe(409);
    expect(asRecord(res.body['error'])['code']).toBe('conflict');
  });

  test('a CSR cannot underwrite', async () => {
    const jobId = await newBusinessJob(referralRisk());
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    const res = await call('POST', `/jobs/${jobId}/underwrite`, {
      key: keys['csr'],
      body: { decision: 'approve' },
    });
    expect(res.status).toBe(403);
  });

  test('an underwriter can approve, unblocking bind', async () => {
    const jobId = await newBusinessJob(referralRisk());
    const quoted = await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    expect((asRecord(quoted.body['quote'])['referrals'] as unknown[]).length).toBe(2);

    expect((await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] })).status).toBe(409);

    const approved = await call('POST', `/jobs/${jobId}/underwrite`, {
      key: keys['underwriter'],
      body: { decision: 'approve', note: 'accepted with surcharge' },
    });
    expect(approved.status).toBe(200);
    expect(asRecord(approved.body['job'])['uwApproved']).toBe(true);
    expect((await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] })).status).toBe(200);
  });

  test('an invalid underwriting decision is a 400', async () => {
    const jobId = await newBusinessJob(referralRisk());
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    const res = await call('POST', `/jobs/${jobId}/underwrite`, {
      key: keys['underwriter'],
      body: { decision: 'maybe' },
    });
    expect(res.status).toBe(400);
  });
});

describe('request validation', () => {
  test('a malformed risk is rejected with a field-level message', async () => {
    const risk = cleanRisk();
    (risk.vehicles[0] as unknown as Record<string, unknown>)['rateGroup'] = 99;
    const res = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: { productCode: 'ON_PA', effectiveDate: '2026-09-01', billingPlan: 'monthly', risk },
    });
    expect(res.status).toBe(400);
    expect(asRecord(res.body['error'])['message']).toMatch(/rateGroup/);
  });

  test('a coverage pointing at an unknown vehicle is rejected', async () => {
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v9', coverageCode: 'COLL', deductibleCents: 100_000 });
    const res = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: { productCode: 'ON_PA', effectiveDate: '2026-09-01', billingPlan: 'monthly', risk },
    });
    expect(res.status).toBe(400);
    expect(asRecord(res.body['error'])['message']).toMatch(/unknown vehicle/);
  });

  test('a loose date format is rejected', async () => {
    const res = await call('POST', `/accounts/${accountId}/submissions`, {
      key: keys['csr'],
      body: {
        productCode: 'ON_PA',
        effectiveDate: '2026-9-1',
        billingPlan: 'monthly',
        risk: cleanRisk(),
      },
    });
    expect(res.status).toBe(400);
  });

  test('a missing mandatory coverage surfaces as a rating error at quote time', async () => {
    const risk = cleanRisk();
    risk.coverages = risk.coverages.filter((c) => c.coverageCode !== 'DCPD');
    const jobId = await newBusinessJob(risk);
    const res = await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    expect(res.status).toBe(400);
    expect(asRecord(res.body['error'])['code']).toBe('rating_error');
  });
});

describe('policy endpoints', () => {
  async function issuedPolicyId(): Promise<string> {
    const jobId = await newBusinessJob();
    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] });
    const issued = await call('POST', `/jobs/${jobId}/issue`, { key: keys['csr'] });
    return asRecord(issued.body['policy'])['id'] as string;
  }

  test('policy detail includes versions and transactions', async () => {
    const policyId = await issuedPolicyId();
    const res = await call('GET', `/policies/${policyId}`, { key: keys['csr'] });
    expect(res.status).toBe(200);
    expect(asRecord(res.body['currentVersion'])['versionNumber']).toBe(1);
    expect((res.body['versions'] as unknown[]).length).toBe(1);
    expect((res.body['transactions'] as unknown[]).length).toBe(1);
  });

  test('an endorsement appends a second version', async () => {
    const policyId = await issuedPolicyId();
    const risk = cleanRisk();
    risk.coverages.push({ vehicleId: 'v1', coverageCode: 'COLL', deductibleCents: 100_000 });

    const change = await call('POST', `/policies/${policyId}/changes`, {
      key: keys['csr'],
      body: { effectiveDate: '2027-03-01', risk },
    });
    expect(change.status).toBe(201);
    const jobId = asRecord(change.body['job'])['id'] as string;

    await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] });
    await call('POST', `/jobs/${jobId}/issue`, { key: keys['csr'] });

    const res = await call('GET', `/policies/${policyId}`, { key: keys['csr'] });
    expect((res.body['versions'] as unknown[]).length).toBe(2);
    expect(asRecord(res.body['currentVersion'])['transactionType']).toBe('Endorsement');
  });

  test('cancellation closes the policy and records a refund', async () => {
    const policyId = await issuedPolicyId();
    const created = await call('POST', `/policies/${policyId}/cancellation`, {
      key: keys['csr'],
      body: { effectiveDate: '2027-03-01', reason: 'vehicle sold' },
    });
    const jobId = asRecord(created.body['job'])['id'] as string;

    const quoted = await call('POST', `/jobs/${jobId}/quote`, { key: keys['csr'] });
    expect(asRecord(quoted.body['quote'])['refundCents']).toBeGreaterThan(0);

    await call('POST', `/jobs/${jobId}/bind`, { key: keys['csr'] });
    const issued = await call('POST', `/jobs/${jobId}/issue`, { key: keys['csr'] });
    expect(asRecord(issued.body['policy'])['status']).toBe('Cancelled');
    expect(asRecord(issued.body['transaction'])['amountCents']).toBeLessThan(0);
  });

  test('renewal creates a job for the following term', async () => {
    const policyId = await issuedPolicyId();
    const res = await call('POST', `/policies/${policyId}/renewal`, { key: keys['csr'], body: {} });
    expect(res.status).toBe(201);
    const job = asRecord(res.body['job']);
    expect(job['termStart']).toBe('2027-09-01');
    expect(job['termEnd']).toBe('2028-09-01');
  });

  test('a policy from another tenant is a 404', async () => {
    const policyId = await issuedPolicyId();
    const other = makeTenant(db, 'Northstar Mutual', 'NSTR');
    const res = await call('GET', `/policies/${policyId}`, { key: other.keys['csr'] });
    expect(res.status).toBe(404);
  });
});
