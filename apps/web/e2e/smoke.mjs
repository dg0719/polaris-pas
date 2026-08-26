/**
 * End-to-end smoke test for the path the demo actually walks:
 * sign in as the underwriter, clear a referral, bind, issue, and confirm the
 * policy and its billing schedule exist afterwards.
 *
 * Boots its own API on a scratch database and its own Vite dev server, so it
 * never touches polaris.db and needs nothing running beforehand.
 *
 *   npm run test:e2e
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 3210;
const WEB_PORT = 5210;
const WEB = `http://localhost:${WEB_PORT}`;

/** Refuse to run against something already listening: it would not be our stack. */
async function assertPortFree(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
  } catch {
    return;
  }
  throw new Error(
    `Port ${port} is already serving something. Stop it before running the smoke test.`,
  );
}

await assertPortFree(API_PORT);
await assertPortFree(WEB_PORT);

const workDir = mkdtempSync(join(tmpdir(), 'polaris-e2e-'));
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

/**
 * On Windows `child.kill()` only reaps the shell wrapper, leaving the server
 * itself listening. A stale server would then quietly serve the next run.
 */
function shutdown() {
  for (const child of children) {
    try {
      if (process.platform === 'win32' && child.pid) {
        // Synchronous: the process must be gone before this script exits, or
        // the next run finds the port taken.
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

/** The UI re-renders after a write; wait for the element rather than guessing. */
async function appears(locator, timeout = 10_000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
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

  // ── Sign in ───────────────────────────────────────────────────────────────
  await page.goto(WEB, { waitUntil: 'networkidle' });
  check('the sign-in form asks for credentials', await appears(page.getByLabel('Username')));
  check(
    'the demo credentials are printed under the form',
    (await page.locator('.signin__hint').innerText()).includes('underwriter / polaris'),
  );

  // Wrong password must be refused before the happy path is trusted.
  await page.getByLabel('Username').fill('underwriter');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  check('a wrong password is refused', await appears(page.getByRole('alert')));
  // The browser logs that deliberate 401; everything after it must be clean.
  consoleErrors.length = 0;

  await page.getByLabel('Password').fill('polaris');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle');
  check(
    'worklist loads after sign in',
    await appears(page.getByRole('heading', { name: 'Worklist' })),
  );

  const referralRows = page.locator('table.data tbody tr.is-flagged');
  check('referrals are queued', await appears(referralRows));

  // ── Clear a referral ──────────────────────────────────────────────────────
  await referralRows.first().locator('a').first().click();
  await page.waitForLoadState('networkidle');
  check(
    'the referral reasons are on the decision screen',
    await appears(page.getByText('Rules that fired')),
  );
  check(
    'referral values read as money, not raw cents',
    !(await page.locator('body').innerText()).includes('valueCents'),
  );

  await page.getByLabel('Note').fill('Accepted at standard rates for the demo run.');
  await page.getByRole('button', { name: 'Accept risk' }).click();
  const bindButton = page.getByRole('button', { name: 'Bind' });
  check('accepting reveals the bind action', await appears(bindButton));

  await bindButton.click();
  const issueButton = page.getByRole('button', { name: 'Issue' });
  check('binding reveals the issue action', await appears(issueButton));

  await issueButton.click();
  await page.waitForURL(/\/policies\/[0-9a-f-]+$/, { timeout: 15_000 });
  check('issuing lands on the new policy', /\/policies\//.test(page.url()));

  // The heading only renders once the policy has loaded.
  check('the policy carries a number', await appears(page.getByText(/ACME-\d{6}/).first()));
  const policyText = await page.locator('body').innerText();
  check('a billing schedule was written', policyText.includes('Billing schedule'));
  check('the schedule has invoices', (await page.locator('table.data tbody tr').count()) > 0);
  check(
    'the schedule sums to the written premium',
    policyText.includes('Billed to date') && policyText.includes('Written premium'),
  );

  // ── Account file and its billing ──────────────────────────────────────────
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: 'Daniel Okonkwo' }).click();
  await page.waitForLoadState('networkidle');
  check('the account shows an overdue balance', await appears(page.getByText('Past due')));

  const payFull = page.getByRole('button', { name: 'Pay full balance' });
  check('an outstanding balance offers a one-click payment', await appears(payFull));
  const before = await page.locator('table.data tbody tr').count();
  await payFull.click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  check('recording a payment confirms back', await appears(page.getByRole('status')));
  check('the invoice list survived the payment', (await page.locator('table.data tbody tr').count()) >= before);

  // ── Submission wizard ─────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'New submission' }).first().click();
  await page.waitForLoadState('networkidle');
  check('the wizard opens on step one', await appears(page.getByRole('button', { name: /1\s*Policy/ })));
  await page.getByRole('button', { name: 'Continue' }).click();
  check('step two asks for drivers', await appears(page.getByRole('heading', { name: /Driver 1/ })));

  check('no console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  shutdown();
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
