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
