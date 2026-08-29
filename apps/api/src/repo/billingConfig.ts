import type { ChargeCategory, ChargeKind, ChargePatternDef, PaymentPlanDef, Periodicity, TaxRateDef } from '@polaris/domain';
import type { Db } from '../db.ts';
import type { TenantCtx } from './shared.ts';

// ─── Billing configuration (charge patterns, payment plans, tax rates) ─────
// Read-only catalogue tables seeded by `seedBillingCatalogue` (migration
// 002). Rows are mapped to the domain `*Def` shapes here so no snake_case
// column or 0/1 flag ever reaches a service.

interface ChargePatternRawRow {
  code: string;
  name: string;
  kind: string;
  category: string;
  invoicing: string;
  priority: number;
  commissionable: number;
  taxable: number;
  filing_reference: string | null;
}

function toChargePatternDef(row: ChargePatternRawRow): ChargePatternDef {
  return {
    code: row.code,
    name: row.name,
    kind: row.kind as ChargeKind,
    category: row.category as ChargeCategory,
    invoicing: row.invoicing as 'spread' | 'single',
    priority: row.priority,
    commissionable: row.commissionable === 1,
    taxable: row.taxable === 1,
    filingReference: row.filing_reference,
  };
}

export function listChargePatterns(db: Db, ctx: TenantCtx): ChargePatternDef[] {
  const rows = db
    .prepare('SELECT * FROM charge_patterns WHERE tenant_id = ? ORDER BY priority ASC')
    .all(ctx.tenantId) as unknown as ChargePatternRawRow[];
  return rows.map(toChargePatternDef);
}

export function getChargePattern(db: Db, ctx: TenantCtx, code: string): ChargePatternDef | null {
  const row = db
    .prepare('SELECT * FROM charge_patterns WHERE tenant_id = ? AND code = ?')
    .get(ctx.tenantId, code) as ChargePatternRawRow | undefined;
  return row ? toChargePatternDef(row) : null;
}

interface PaymentPlanRawRow {
  code: string;
  name: string;
  down_payment_bps: number;
  installments: number;
  periodicity: string;
  fee_pattern_code: string | null;
  fee_bps: number;
  fee_cap_bps: number | null;
  renewal_down_payment_bps: number | null;
  products_json: string;
  provinces_json: string;
}

function toPaymentPlanDef(row: PaymentPlanRawRow): PaymentPlanDef {
  return {
    code: row.code,
    name: row.name,
    downPaymentBps: row.down_payment_bps,
    installments: row.installments,
    periodicity: row.periodicity as Periodicity,
    feePatternCode: row.fee_pattern_code,
    feeBps: row.fee_bps,
    feeCapBps: row.fee_cap_bps,
    renewalDownPaymentBps: row.renewal_down_payment_bps,
    products: JSON.parse(row.products_json) as string[],
    provinces: JSON.parse(row.provinces_json) as string[],
  };
}

export function listPaymentPlans(
  db: Db,
  ctx: TenantCtx,
  filter: { productCode?: string; province?: string } = {},
): PaymentPlanDef[] {
  const rows = db
    .prepare('SELECT * FROM payment_plans WHERE tenant_id = ? AND active = 1 ORDER BY code ASC')
    .all(ctx.tenantId) as unknown as PaymentPlanRawRow[];
  return rows
    .map(toPaymentPlanDef)
    .filter((plan) => filter.productCode === undefined || plan.products.includes(filter.productCode))
    .filter((plan) => filter.province === undefined || plan.provinces.includes(filter.province));
}

export function getPaymentPlan(db: Db, ctx: TenantCtx, code: string): PaymentPlanDef | null {
  const row = db
    .prepare('SELECT * FROM payment_plans WHERE tenant_id = ? AND code = ?')
    .get(ctx.tenantId, code) as PaymentPlanRawRow | undefined;
  return row ? toPaymentPlanDef(row) : null;
}

interface TaxRateRawRow {
  code: string;
  province: string;
  line: string;
  rate_bps: number;
  effective_from: string;
  effective_to: string | null;
  applies_on: string;
  pattern_code: string;
}

function toTaxRateDef(row: TaxRateRawRow): TaxRateDef {
  return {
    code: row.code,
    province: row.province,
    line: row.line,
    rateBps: row.rate_bps,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    appliesOn: row.applies_on as 'billed' | 'paid',
    patternCode: row.pattern_code,
  };
}

export function listTaxRates(db: Db, ctx: TenantCtx): TaxRateDef[] {
  const rows = db
    .prepare(
      'SELECT * FROM tax_rates WHERE tenant_id = ? ORDER BY province ASC, line ASC, effective_from ASC',
    )
    .all(ctx.tenantId) as unknown as TaxRateRawRow[];
  return rows.map(toTaxRateDef);
}
