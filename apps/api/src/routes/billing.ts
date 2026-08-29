import { runBillingDay } from '../billing/billingDay.ts';
import { invoiceView } from '../billing/readModel.ts';
import { isIsoDate, todayIso } from '../dates.ts';
import type { Db } from '../db.ts';
import { invoiceDto, journalEntryDto } from '../dto.ts';
import { ApiError } from '../errors.ts';
import type { Router } from '../http.ts';
import * as repo from '../repo.ts';
import type { BillingRunRow } from '../repo.ts';
import { authenticated, param } from './context.ts';

// ─── Billing operations ────────────────────────────────────────────────────
// Registered before every other group of routes: the router matches the first
// route with the right number of segments, so `/billing/run` has to be seen
// before anything shaped like `/:id/:action`.

function billingRunDto(run: BillingRunRow) {
  return {
    id: run.id,
    runDate: run.run_date,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    summary: JSON.parse(run.summary_json) as Record<string, unknown>,
  };
}

export function registerBillingRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  // Runs the day's work on demand. The timer in `server.ts` calls the same
  // function; both are idempotent per tenant and date.
  router.post(
    '/billing/run',
    authed((ctx, tenant) => {
      const date = ctx.query.get('date') ?? todayIso();
      if (!isIsoDate(date)) throw ApiError.badRequest('date must be YYYY-MM-DD');
      const result = runBillingDay(db, tenant, date);
      return {
        run: {
          id: result.runId,
          runDate: date,
          billedInvoices: result.billedInvoices,
          earnedCents: result.earnedCents,
          skipped: result.skipped,
        },
      };
    }, ['admin', 'finance']),
  );

  router.get(
    '/billing/runs',
    authed(
      (_ctx, tenant) => ({ runs: repo.listBillingRuns(db, tenant).map(billingRunDto) }),
      ['admin', 'finance', 'billing'],
    ),
  );

  // The catalogue behind the quote wizard's plan choice and the finance
  // screens: what a carrier may bill, on what plan, with what tax. Any
  // authenticated role: an underwriter quotes on a plan and an adjuster
  // reading a policy sees the plan it is billed on, so a narrower gate would
  // break those screens for no gain — this is product configuration, the same
  // class of data as the product definition, not anyone's money.
  router.get(
    '/billing/plans',
    authed((ctx, tenant) => {
      const productCode = ctx.query.get('productCode') ?? undefined;
      const province = ctx.query.get('province') ?? undefined;
      return {
        paymentPlans: repo.listPaymentPlans(db, tenant, { productCode, province }),
        chargePatterns: repo.listChargePatterns(db, tenant),
        taxRates: repo.listTaxRates(db, tenant),
      };
    }),
  );

  // What one invoice is worth, what it is made of, and the postings behind
  // it. Any authenticated role: an adjuster taking a call needs to see it.
  router.get(
    '/invoices/:id',
    authed((ctx, tenant) => {
      const invoiceId = param(ctx, 'id');
      const view = invoiceView(db, tenant, invoiceId, todayIso());
      if (!view) throw ApiError.notFound(`Invoice ${invoiceId} not found`);
      const chargeIds = [...new Set(view.lines.map((line) => line.charge_id))];
      return {
        invoice: invoiceDto(view),
        entries: chargeIds
          .flatMap((chargeId) => repo.listEntries(db, tenant, { kind: 'charge', id: chargeId }))
          .map(journalEntryDto),
      };
    }),
  );
}
