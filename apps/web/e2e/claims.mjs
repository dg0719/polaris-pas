/**
 * End-to-end test for the claims path: sign in as the adjuster, report a loss
 * against a policy, watch coverage verified on the loss date (including a
 * refusal for a date before the term), set a reserve, request a payment above
 * the adjuster's authority, approve it as the supervisor, issue it, and close
 * the file.
 *
 * Boots its own API on a scratch database and its own Vite dev server, so it
 * never touches polaris.db and needs nothing running beforehand.
 *
 *   node apps/web/e2e/claims.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 3211;
const WEB_PORT = 5211;
const WEB = `http://localhost:${WEB_PORT}`;

async function assertPortFree(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
  } catch {
    return;
  }
  throw new Error(`Port ${port} is already serving something. Stop it before running this test.`);
}

await assertPortFree(API_PORT);
await assertPortFree(WEB_PORT);

const workDir = mkdtempSync(join(tmpdir(), 'polaris-claims-e2e-'));
const dbFile = join(workDir, 'e2e.db');
const children = [];

function run(command, args, env) {
  const windows = process.platform === 'win32';
  const child = spawn(windows ? `${command} ${args.join(' ')}` : command, windows ? [] : args, {
    env: { ...process.env, ...env },
    stdio: 'pipe',
    shell: windows,
  });
  children.push(child);
  return child;
}

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not start at ${url}`);
}

function shutdown() {
  for (const child of children) {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    } catch {
      // already gone
    }
  }
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  process.stdout.write(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

async function appears(locator, timeout = 10_000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

let browser;
try {
  process.stdout.write('seeding scratch database\n');
  await new Promise((resolve, reject) => {
    const seed = run('node', ['--experimental-transform-types', 'apps/api/tests/e2eSeed.ts'], {
      POLARIS_DB: dbFile,
    });
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });

  run('node', ['--experimental-transform-types', 'apps/api/src/server.ts'], {
    POLARIS_DB: dbFile,
    POLARIS_DEMO: '1',
    PORT: String(API_PORT),
  });
  await waitFor(`http://localhost:${API_PORT}/health`, 'api');

  run('npm', ['run', 'dev', '-w', '@polaris/web', '--', '--port', String(WEB_PORT), '--strictPort'], {
    POLARIS_API: `http://localhost:${API_PORT}`,
  });
  await waitFor(WEB, 'web');

  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  async function signIn(username) {
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill('polaris');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForLoadState('networkidle');
  }

  // ── The adjuster's morning ────────────────────────────────────────────────
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await signIn('adjuster');
  check('the adjuster lands signed in', await appears(page.getByText('Ana Diaz')));

  await page.getByRole('link', { name: /^Claims/ }).click();
  await page.waitForLoadState('networkidle');
  check('the claims screen opens', await appears(page.getByRole('heading', { name: 'Claims' })));
  const claimsText = await page.locator('body').innerText();
  check('a seeded payment waits for approval', claimsText.includes('awaiting approval'));
  check('the seeded book of claims is listed', claimsText.includes('ACMEC-'));
  check('a fraud-flagged claim is queued', claimsText.includes('Flagged for review'));

  // ── Report a claim, including a refusal ───────────────────────────────────
  await page.getByRole('link', { name: 'Policies' }).click();
  await page.waitForLoadState('networkidle');
  await page
    .locator('table.data tbody tr', { hasText: 'Marguerite Hale' })
    .locator('a')
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  const reportButton = page.getByRole('button', { name: 'Report a claim' });
  check('the policy offers Report a claim', await appears(reportButton));

  await reportButton.click();
  await page.waitForLoadState('networkidle');
  check('the FNOL wizard opens', await appears(page.getByRole('heading', { name: 'Report a claim' })));

  // A loss date before the term must be refused with an explanation.
  await page.getByLabel('Date of loss').fill(isoDaysAgo(600));
  await page.getByLabel('What happened', { exact: true }).fill('Backed into a bollard.');
  await page.getByRole('button', { name: 'Continue' }).click();
  check(
    'a loss date before the term is refused with a reason',
    await appears(page.getByText(/No coverage was in force/)),
  );

  // Back to fix the date; a loss inside the term verifies.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByLabel('Date of loss').fill(isoDaysAgo(10));
  await page.getByRole('button', { name: 'Continue' }).click();
  check('coverage on the loss date verifies', await appears(page.getByText('In force')));

  await page.getByLabel('Cause of loss').selectOption({ label: 'Collision' });
  await page.getByRole('button', { name: 'Continue' }).click();
  check(
    'responding coverages become exposures',
    await appears(page.getByText(/COLL — 2023 Subaru Outback/)),
  );

  await page.getByRole('button', { name: 'Continue' }).click();
  check('the review step summarises the claim', await appears(page.getByText('to open')));

  await page.getByRole('button', { name: 'Report claim' }).click();
  await page.waitForURL(/\/claims\/[0-9a-f-]+$/, { timeout: 15_000 });
  const claimUrl = page.url();
  check('reporting lands on the new claim', /\/claims\//.test(claimUrl));
  check('the claim carries a claim number', await appears(page.getByText(/ACMEC-\d{6}/).first()));
  check(
    'the claim shows the coverage in force on the loss date',
    await appears(page.getByText('Coverage in force on the loss date')),
  );

  // ── Reserve, then a payment above authority ───────────────────────────────
  await page.getByRole('button', { name: 'Move reserve' }).first().click();
  await page.getByLabel('Amount ($)').fill('15000');
  await page.getByLabel('Reason').fill('Initial repair and injury estimate');
  await page.getByRole('button', { name: 'Post movement' }).click();
  check('the reserve movement lands in the history', await appears(page.getByText('Reserve history')));

  await page.getByRole('button', { name: 'Request a payment' }).click();
  await page.getByLabel('Amount ($)', { exact: true }).fill('12000');
  await page.getByLabel('Payee', { exact: true }).fill('Marguerite Hale');
  await page.getByRole('button', { name: 'Request payment' }).click();
  check(
    'a payment above the adjuster authority waits as Requested',
    await appears(page.locator('table.data').getByText('Requested')),
  );

  // ── The supervisor approves; the adjuster issues ─────────────────────────
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn('supervisor');
  check('the supervisor signs in', await appears(page.getByText('Sam Osei')));

  await page.goto(claimUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Approve' }).first().click();
  check('the supervisor approval sticks', await appears(page.locator('table.data').getByText('Approved')));

  const issueButton = page.getByRole('button', { name: 'Issue' });
  check('an approved payment offers Issue', await appears(issueButton));
  await issueButton.first().click();
  check('the payment issues', await appears(page.locator('table.data').getByText('Issued')));

  // ── Close the file ────────────────────────────────────────────────────────
  // Close every open exposure; the remaining reserve is taken down for each.
  for (let i = 0; i < 8; i++) {
    await page.waitForLoadState('networkidle');
    const closeButton = page.locator('table.data button:not([disabled])', {
      hasText: /^Close$/,
    });
    const before = await closeButton.count();
    if (before === 0) break;
    await closeButton.first().click();
    // Wait until the click has actually landed (one fewer Close button), so
    // the next iteration never clicks a stale row mid-reload.
    for (let waited = 0; waited < 10_000; waited += 250) {
      await page.waitForTimeout(250);
      if ((await closeButton.count()) < before) break;
    }
  }
  check(
    'every exposure is closed',
    (await page.locator('table.data').getByRole('button', { name: 'Close', exact: true }).count()) === 0,
  );

  await page.getByRole('button', { name: 'Close claim' }).click();
  check('the claim closes', await appears(page.getByRole('button', { name: 'Reopen claim' })));

  check('no console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  shutdown();
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
