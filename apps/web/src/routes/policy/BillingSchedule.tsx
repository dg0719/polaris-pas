import { useState } from 'react';
import { date, lineLabel, money } from '../../lib/format.ts';
import type { Invoice, PolicyBilling } from '../../lib/types.ts';
import { Money, Status } from '../../components/ui.tsx';

/**
 * The schedule as the carrier bills it: one row per invoice, opening to the
 * lines it is made of. An invoice total is never explained by arithmetic the
 * reader has to do themselves.
 */
export function BillingSchedule({ billing }: { billing: PolicyBilling | undefined }) {
  return (
    <div className="table-wrap table-wrap--wide">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col" className="date">
              Bill date
            </th>
            <th scope="col" className="date">
              Due
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Paid
            </th>
            <th scope="col" className="num">
              Outstanding
            </th>
          </tr>
        </thead>
        <tbody>
          {billing?.invoices.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={4} className="total-label">
              Billed to date
            </th>
            <td className="num">{billing ? <Money cents={billing.billedCents} /> : null}</td>
            <td className="num">{billing ? <Money cents={billing.paidCents} /> : null}</td>
            <td className="num">
              <strong>{billing ? <Money cents={billing.balanceCents} balance /> : null}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);
  const voided = invoice.status === 'void';

  return (
    <>
      <tr className={invoice.status === 'overdue' ? 'is-flagged' : undefined}>
        <td>
          {/* A disclosure button carries its own state. No `aria-controls`: the
              line rows do not exist while the invoice is closed, and pointing
              at absent ids is worse for a screen reader than pointing at none. */}
          <button
            type="button"
            className="row-toggle"
            aria-expanded={open}
            disabled={invoice.lines.length === 0}
            onClick={() => setOpen((current) => !current)}
          >
            <span className="row-toggle__caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            <span className="mono">{invoice.invoiceNumber}</span>
            <span className="sr-only"> line items</span>
          </button>
        </td>
        <td className="date">{date(invoice.billDate)}</td>
        <td className="date">{date(invoice.dueDate)}</td>
        <td>
          <Status value={invoice.status} />
        </td>
        <td className="num">
          <Money cents={invoice.totalCents} balance />
        </td>
        <td className="num">{voided ? '—' : money(invoice.paidCents)}</td>
        <td className="num">
          {/* A credit note owes nothing: it reads as a credit, never as a minus. */}
          {voided ? '—' : <Money cents={invoice.outstandingCents} balance />}
        </td>
      </tr>

      {open
        ? invoice.lines.map((line) => (
            <tr key={line.id} className="row-line">
              <td colSpan={4} className="row-line__label">
                {lineLabel(line)}
              </td>
              <td className="num">
                <Money cents={line.amountCents} balance />
              </td>
              <td className="num">{money(line.paidCents)}</td>
              <td />
            </tr>
          ))
        : null}
    </>
  );
}
