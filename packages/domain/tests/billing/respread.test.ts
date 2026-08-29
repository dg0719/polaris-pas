import { describe, expect, test } from 'vitest';
import { respreadOnChange } from '../../src/billing/respread.ts';

const planned = [
  { invoiceId: 'i3', eventDate: '2026-11-01', outstandingCents: 10_000 },
  { invoiceId: 'i4', eventDate: '2026-12-01', outstandingCents: 10_000 },
  { invoiceId: 'i5', eventDate: '2027-01-01', outstandingCents: 10_000 },
];

describe('respreadOnChange', () => {
  test('additional premium spreads evenly, remainder last', () => {
    const r = respreadOnChange(1_000, planned);
    expect(r.onInvoices.map((x) => x.amountCents)).toEqual([333, 333, 334]);
    expect(r.unabsorbedCents).toBe(0);
  });
  test('return premium comes off the latest invoices first and never below zero', () => {
    const r = respreadOnChange(-25_000, planned);
    expect(r.onInvoices).toEqual([
      { invoiceId: 'i5', eventDate: '2027-01-01', amountCents: -10_000 },
      { invoiceId: 'i4', eventDate: '2026-12-01', amountCents: -10_000 },
      { invoiceId: 'i3', eventDate: '2026-11-01', amountCents: -5_000 },
    ]);
    expect(r.unabsorbedCents).toBe(0);
  });
  test('what the planned invoices cannot absorb is reported back as credit', () => {
    const r = respreadOnChange(-35_000, planned);
    expect(r.unabsorbedCents).toBe(-5_000);
  });
  test('with nothing planned the whole delta is unabsorbed', () => {
    expect(respreadOnChange(700, [])).toEqual({ onInvoices: [], unabsorbedCents: 700 });
  });
});

// Spec §4: return premium reduces planned invoices first, then billed ones
// that are still unpaid, then credits what is left.
const mixed = [
  { invoiceId: 'b1', eventDate: '2026-09-01', outstandingCents: 10_000, billed: true },
  { invoiceId: 'b2', eventDate: '2026-10-01', outstandingCents: 10_000, billed: true },
  { invoiceId: 'p1', eventDate: '2026-11-01', outstandingCents: 10_000 },
  { invoiceId: 'p2', eventDate: '2026-12-01', outstandingCents: 10_000 },
];

describe('respreadOnChange across planned and billed invoices', () => {
  test('return premium takes planned invoices first, latest of each group first', () => {
    const r = respreadOnChange(-35_000, mixed);
    expect(r.onInvoices.map((x) => x.invoiceId)).toEqual(['p2', 'p1', 'b2', 'b1']);
    expect(r.onInvoices.map((x) => x.amountCents)).toEqual([-10_000, -10_000, -10_000, -5_000]);
    expect(r.unabsorbedCents).toBe(0);
  });

  test('what neither group can absorb is still reported back as credit', () => {
    expect(respreadOnChange(-45_000, mixed).unabsorbedCents).toBe(-5_000);
  });

  test('additional premium never lands on an invoice already sent out', () => {
    const r = respreadOnChange(600, mixed);
    expect(r.onInvoices.map((x) => x.invoiceId)).toEqual(['p1', 'p2']);
    expect(r.onInvoices.map((x) => x.amountCents)).toEqual([300, 300]);
    expect(r.unabsorbedCents).toBe(0);
  });

  test('with only billed invoices open, additional premium is wholly unabsorbed', () => {
    expect(respreadOnChange(700, mixed.filter((i) => i.billed))).toEqual({
      onInvoices: [],
      unabsorbedCents: 700,
    });
  });
});
