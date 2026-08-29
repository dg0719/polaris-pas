// ─── Chart of accounts and posting rules (pure) ─────────────────────────────
// Turns a billing event into a balanced double-entry journal entry. Persisting
// the result is a later task's job; this file only computes it.

import type { BillingEvent, Dimension, JournalEntryInput, JournalLineInput, LedgerAccountCode } from './types.ts';

export const LEDGER_ACCOUNTS: Record<LedgerAccountCode, { name: string; side: 'debit' | 'credit' }> = {
  '1100': { name: 'Premium receivable', side: 'debit' },
  '1150': { name: 'Producer receivable', side: 'debit' },
  '1200': { name: 'Cash clearing', side: 'debit' },
  '2100': { name: 'Unapplied cash', side: 'credit' },
  '2200': { name: 'Unearned premium', side: 'credit' },
  '2300': { name: 'Tax payable', side: 'credit' },
  '2400': { name: 'Commission payable', side: 'credit' },
  '2500': { name: 'Suspense', side: 'credit' },
  '2600': { name: 'Disbursement payable', side: 'credit' },
  '4100': { name: 'Earned premium', side: 'credit' },
  '4200': { name: 'Fee income', side: 'credit' },
  '5100': { name: 'Commission expense', side: 'debit' },
  '5200': { name: 'Write-offs', side: 'debit' },
};

export class UnbalancedEntryError extends Error {}

/** Refuses an entry whose debits and credits do not match, or that has fewer
 * than two lines (a journal entry with one line cannot balance by definition). */
export function assertBalanced(entry: JournalEntryInput): void {
  const debits = entry.lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credits = entry.lines.reduce((sum, line) => sum + line.creditCents, 0);
  if (debits !== credits || entry.lines.length < 2) {
    throw new UnbalancedEntryError(`Entry ${entry.eventType} does not balance: ${debits} vs ${credits}`);
  }
}

/** Two lines: debit `from`, credit `to`. A negative amount swaps the sides so
 * a reversal (e.g. a negative charge) still produces a balanced entry. */
function pair(
  from: LedgerAccountCode,
  to: LedgerAccountCode,
  amountCents: number,
  dim: Dimension,
  toDim: Dimension = dim,
): JournalLineInput[] {
  const amount = Math.abs(amountCents);
  if (amountCents >= 0) {
    return [
      { account: from, dimension: dim, debitCents: amount, creditCents: 0 },
      { account: to, dimension: toDim, debitCents: 0, creditCents: amount },
    ];
  }
  return [
    { account: to, dimension: toDim, debitCents: amount, creditCents: 0 },
    { account: from, dimension: dim, debitCents: 0, creditCents: amount },
  ];
}

const CREDIT_SIDE_FOR_CATEGORY = { premium: '2200', tax: '2300', fee: '4200', other: '4200' } as const;

/** The posting rule for each billing event. Pure; the API persists the result. */
export function postingsFor(ev: BillingEvent): JournalEntryInput {
  switch (ev.type) {
    case 'chargeBilled': {
      const dim = { accountId: ev.accountId, policyId: ev.policyId };
      const to = CREDIT_SIDE_FOR_CATEGORY[ev.category];
      const toDim = ev.category === 'tax' ? { ...dim, province: ev.province } : dim;
      return {
        effectiveDate: ev.effectiveDate, eventType: 'chargeBilled', referenceKind: 'charge', referenceId: ev.chargeId, reason: null,
        lines: pair('1100', to, ev.amountCents, dim, toDim),
      };
    }
    case 'earning': {
      const dim = { accountId: ev.accountId, policyId: ev.policyId };
      return {
        effectiveDate: ev.effectiveDate, eventType: 'earning', referenceKind: 'policyVersion', referenceId: ev.versionId, reason: null,
        lines: pair('2200', '4100', ev.amountCents, dim),
      };
    }
    case 'paymentReceived': {
      return {
        effectiveDate: ev.effectiveDate, eventType: 'paymentReceived', referenceKind: 'payment', referenceId: ev.paymentId, reason: null,
        lines: pair('1200', '2100', ev.amountCents, { accountId: ev.accountId, method: ev.method }, { accountId: ev.accountId }),
      };
    }
    case 'distribution': {
      return {
        effectiveDate: ev.effectiveDate, eventType: 'distribution', referenceKind: 'paymentApplication', referenceId: ev.applicationId, reason: null,
        lines: pair('2100', '1100', ev.amountCents, { accountId: ev.accountId }, { accountId: ev.accountId, policyId: ev.policyId }),
      };
    }
  }
}
