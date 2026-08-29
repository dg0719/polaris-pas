import { createServer } from 'node:http';
import { runBillingDay } from './billing/billingDay.ts';
import { bootstrapIfEmpty } from './bootstrap.ts';
import { todayIso } from './dates.ts';
import { openDb, type Db } from './db.ts';
import * as repo from './repo.ts';
import { createApp } from './routes.ts';
import { staticSite } from './static.ts';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const port = Number(process.env.PORT ?? 3000);
const db = openDb();
bootstrapIfEmpty(db);

/**
 * How often the billing day wakes up. Four times a day, not once: the run is
 * idempotent per tenant and date, so the extra passes cost nothing and a
 * process restarted at an awkward hour still gets its day's work done.
 */
const BILLING_DAY_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * How long after the port opens the first run starts. `node:sqlite` is
 * synchronous, so a billing day blocks the event loop for as long as it
 * takes; running it before `listen` would hold the port shut through the
 * whole of it, and every health check with it. Deferring puts the process in
 * service first and takes the pause afterwards.
 */
const STARTUP_DELAY_MS = 5_000;

/**
 * The timer has no caller to take a tenant from, so it runs once per tenant
 * with a system context. One tenant's failure must not stop the next one's
 * run, so each is caught and logged on its own.
 */
function runBillingDayForEveryTenant(database: Db): void {
  const date = todayIso();
  for (const tenantId of repo.listTenantIds(database)) {
    try {
      const result = runBillingDay(database, { tenantId, userId: 'system', role: 'admin' }, date);
      if (!result.skipped) {
        log(
          `billing day ${date} tenant ${tenantId}: ` +
            `${result.billedInvoices} invoice(s) billed, ${result.earnedCents} cents earned`,
        );
      }
    } catch (err) {
      log(`billing day ${date} tenant ${tenantId} failed: ${(err as Error).message}`);
    }
  }
}

const billingDayTimer = setInterval(() => runBillingDayForEveryTenant(db), BILLING_DAY_INTERVAL_MS);
// Never hold the process open on the timer alone.
billingDayTimer.unref();

// Serving the client is opt-out: if a build exists, one process hosts
// everything. In development Vite serves the client instead.
const site = process.env.POLARIS_SERVE_WEB === '0'
  ? null
  : staticSite(process.env.POLARIS_WEB_DIR ?? 'apps/web/dist');

const server = createServer(createApp(db, site));

server.listen(port, () => {
  log(
    site
      ? `polaris-pas listening on http://localhost:${port} (api under /api, client served)`
      : `polaris-pas api listening on http://localhost:${port}/api`,
  );
});

// The first run waits until the port is open; see STARTUP_DELAY_MS.
const startupBillingDay = setTimeout(() => runBillingDayForEveryTenant(db), STARTUP_DELAY_MS);
startupBillingDay.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`\n${signal} received, shutting down`);
    clearTimeout(startupBillingDay);
    clearInterval(billingDayTimer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
