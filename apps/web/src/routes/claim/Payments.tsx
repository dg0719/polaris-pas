import { useState } from 'react';
import { request, useMutation } from '../../lib/api.ts';
import { date, money, payMethodLabel } from '../../lib/format.ts';
import type { ClaimPage, ClaimPayment } from '../../lib/types.ts';
import {
  Button,
  Empty,
  Field,
  Money,
  Notice,
  Section,
  Select,
  Status,
  TextInput,
} from '../../components/ui.tsx';
import { useSession } from '../../session.tsx';

/**
 * Money out. A payment within the adjuster's authority is approved as it is
 * requested; one above it waits for a second person. The deductible comes off
 * the first indemnity payment on an exposure and is shown, not hidden.
 */
export function Payments({
  page,
  canWork,
  onChanged,
}: {
  page: ClaimPage;
  canWork: boolean;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const [adding, setAdding] = useState(false);
  const open = page.claim.status === 'Open';
  const openExposures = page.exposures.filter((e) => e.status === 'Open');

  const act = useMutation<{ paymentId: string; action: string }, unknown>(
    ({ paymentId, action }) =>
      request(`/claims/${page.claim.id}/payments/${paymentId}/${action}`, { method: 'POST' }),
  );

  function actions(payment: ClaimPayment) {
    if (!canWork || !open) return null;
    const run = async (action: string) => {
      if ((await act.run({ paymentId: payment.id, action })) !== null) onChanged();
    };
    // Approving your own request is refused server-side; hide the dead button.
    const own = payment.requestedBy === session?.userId;
    return (
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        {payment.status === 'Requested' && !own ? (
          <Button loading={act.pending} onClick={() => void run('approve')}>
            Approve
          </Button>
        ) : null}
        {payment.status === 'Requested' ? (
          <Button variant="ghost" loading={act.pending} onClick={() => void run('reject')}>
            Reject
          </Button>
        ) : null}
        {payment.status === 'Approved' ? (
          <Button variant="primary" loading={act.pending} onClick={() => void run('issue')}>
            Issue
          </Button>
        ) : null}
        {payment.status === 'Issued' ? (
          <Button variant="ghost" loading={act.pending} onClick={() => void run('void')}>
            Void
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <Section
      title="Payments"
      note="Requested, approved within authority, then issued. Nothing leaves without the authority to send it."
      actions={
        canWork && open && openExposures.length > 0 ? (
          <Button onClick={() => setAdding(!adding)} aria-expanded={adding}>
            Request a payment
          </Button>
        ) : null
      }
    >
      {act.error ? <Notice tone="error">{act.error.message}</Notice> : null}

      {page.payments.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Payee</th>
                <th scope="col">Exposure</th>
                <th scope="col">Category</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">
                  Deductible applied
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Status</th>
                {canWork ? <th scope="col" className="num">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {page.payments.map((payment) => {
                const exposure = page.exposures.find((e) => e.id === payment.exposureId);
                return (
                  <tr key={payment.id}>
                    <td>{payment.payeeName}</td>
                    <td>{exposure?.coverageName ?? '—'}</td>
                    <td>{payment.category === 'indemnity' ? 'Indemnity' : 'Expense'}</td>
                    <td>
                      {payMethodLabel(payment.method)}
                      {payment.issuedAt ? (
                        <span className="dim"> · {date(payment.issuedAt.slice(0, 10))}</span>
                      ) : null}
                    </td>
                    <td className="num">
                      {payment.deductibleAppliedCents > 0
                        ? money(payment.deductibleAppliedCents)
                        : '—'}
                    </td>
                    <td className="num">
                      <Money cents={payment.amountCents} />
                    </td>
                    <td>
                      <Status value={payment.status} />
                    </td>
                    {canWork ? <td className="num">{actions(payment)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Nothing paid yet"
          body="Payments requested here move through approval and issue, and the deductible is applied automatically."
        />
      )}

      {adding ? (
        <PaymentForm
          page={page}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : null}
    </Section>
  );
}

function PaymentForm({ page, onDone }: { page: ClaimPage; onDone: () => void }) {
  const openExposures = page.exposures.filter((e) => e.status === 'Open');
  const [exposureId, setExposureId] = useState(openExposures[0]?.id ?? '');
  const [category, setCategory] = useState<'indemnity' | 'expense'>('indemnity');
  const [amount, setAmount] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeeKind, setPayeeKind] = useState('insured');
  const [method, setMethod] = useState('eft');
  const [memo, setMemo] = useState('');

  const exposure = page.exposures.find((e) => e.id === exposureId);
  const deductibleNote =
    category === 'indemnity' && exposure && exposure.deductibleCents > 0
      ? `The gross amount; the ${money(exposure.deductibleCents)} deductible comes off the first indemnity payment.`
      : 'What this payment covers.';

  const post = useMutation<void, unknown>(() =>
    request(`/claims/${page.claim.id}/payments`, {
      method: 'POST',
      body: {
        exposureId,
        category,
        amountCents: Math.round(Number(amount) * 100),
        payeeName,
        payeeKind,
        method,
        memo: memo.trim() === '' ? undefined : memo,
      },
    }),
  );

  const valid = exposureId !== '' && Number(amount) > 0 && payeeName.trim() !== '';

  return (
    <form
      className="stack"
      style={{ maxWidth: '44rem', marginTop: 'var(--s-6)' }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid) return;
        if ((await post.run()) !== null) onDone();
      }}
    >
      <h3>Request a payment</h3>
      {post.error ? <Notice tone="error">{post.error.message}</Notice> : null}
      <div className="form-grid">
        <Field label="Exposure">
          {(props) => (
            <Select {...props} value={exposureId} onChange={(e) => setExposureId(e.target.value)}>
              {openExposures.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.coverageName} — {e.claimantName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {(props) => (
            <Select
              {...props}
              value={category}
              onChange={(e) => setCategory(e.target.value as 'indemnity' | 'expense')}
            >
              <option value="indemnity">Indemnity — the loss itself</option>
              <option value="expense">Expense — appraisals, legal, handling</option>
            </Select>
          )}
        </Field>
        <Field label="Amount ($)" hint={deductibleNote}>
          {(props) => (
            <TextInput
              {...props}
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Payee">
          {(props) => (
            <TextInput {...props} value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
          )}
        </Field>
        <Field label="Payee type">
          {(props) => (
            <Select {...props} value={payeeKind} onChange={(e) => setPayeeKind(e.target.value)}>
              <option value="insured">Insured</option>
              <option value="claimant">Claimant</option>
              <option value="vendor">Vendor</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="Method">
          {(props) => (
            <Select {...props} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="eft">EFT</option>
              <option value="cheque">Cheque</option>
            </Select>
          )}
        </Field>
        <Field label="Memo" hint="Optional; appears on the file.">
          {(props) => <TextInput {...props} value={memo} onChange={(e) => setMemo(e.target.value)} />}
        </Field>
      </div>
      <div className="btn-row">
        <Button variant="primary" type="submit" loading={post.pending} disabled={!valid}>
          Request payment
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
