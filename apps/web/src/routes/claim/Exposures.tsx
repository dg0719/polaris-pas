import { useState } from 'react';
import { request, useMutation } from '../../lib/api.ts';
import { claimantKindLabel, money } from '../../lib/format.ts';
import type { ClaimExposure, ClaimPage } from '../../lib/types.ts';
import {
  Button,
  Field,
  Money,
  Notice,
  Section,
  Select,
  Status,
  TextInput,
} from '../../components/ui.tsx';

/**
 * One row per coverage per claimant. Reserves move from here: the form posts a
 * signed movement, never an overwrite.
 */
export function Exposures({
  page,
  canWork,
  onChanged,
}: {
  page: ClaimPage;
  canWork: boolean;
  onChanged: () => void;
}) {
  const [reserving, setReserving] = useState<string | null>(null);
  const open = page.claim.status === 'Open';

  const close = useMutation<string, unknown>((exposureId) =>
    request(`/claims/${page.claim.id}/exposures/${exposureId}/close`, { method: 'POST' }),
  );
  const reopen = useMutation<string, unknown>((exposureId) =>
    request(`/claims/${page.claim.id}/exposures/${exposureId}/reopen`, { method: 'POST' }),
  );

  return (
    <Section
      title="Exposures"
      note="One per coverage per claimant, against the coverage in force on the loss date."
    >
      {close.error ? <Notice tone="error">{close.error.message}</Notice> : null}
      {reopen.error ? <Notice tone="error">{reopen.error.message}</Notice> : null}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Coverage</th>
              <th scope="col">Claimant</th>
              <th scope="col">Risk item</th>
              <th scope="col" className="num">
                Deductible
              </th>
              <th scope="col" className="num">
                Reserve
              </th>
              <th scope="col" className="num">
                Paid
              </th>
              <th scope="col">Status</th>
              {canWork ? <th scope="col" className="num">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {page.exposures.map((exposure) => (
              <tr key={exposure.id}>
                <td>{exposure.coverageName}</td>
                <td>
                  {exposure.claimantName}{' '}
                  <span className="dim">({claimantKindLabel(exposure.claimantKind)})</span>
                </td>
                <td>{exposure.riskItemLabel ?? '—'}</td>
                <td className="num">
                  {exposure.deductibleCents > 0 ? money(exposure.deductibleCents) : '—'}
                </td>
                <td className="num">
                  <Money cents={exposure.financials?.outstandingCents ?? 0} />
                </td>
                <td className="num">
                  <Money cents={exposure.financials?.paidCents ?? 0} />
                </td>
                <td>
                  <Status value={exposure.status} />
                </td>
                {canWork ? (
                  <td className="num">
                    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                      {exposure.status === 'Open' && open ? (
                        <>
                          <Button
                            onClick={() =>
                              setReserving(reserving === exposure.id ? null : exposure.id)
                            }
                            aria-expanded={reserving === exposure.id}
                          >
                            Move reserve
                          </Button>
                          <Button
                            variant="ghost"
                            loading={close.pending}
                            onClick={async () => {
                              if ((await close.run(exposure.id)) !== null) onChanged();
                            }}
                          >
                            Close
                          </Button>
                        </>
                      ) : null}
                      {exposure.status === 'Closed' && open ? (
                        <Button
                          variant="ghost"
                          loading={reopen.pending}
                          onClick={async () => {
                            if ((await reopen.run(exposure.id)) !== null) onChanged();
                          }}
                        >
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reserving ? (
        <ReserveForm
          claimId={page.claim.id}
          exposure={page.exposures.find((e) => e.id === reserving)!}
          onDone={() => {
            setReserving(null);
            onChanged();
          }}
        />
      ) : null}
    </Section>
  );
}

function ReserveForm({
  claimId,
  exposure,
  onDone,
}: {
  claimId: string;
  exposure: ClaimExposure;
  onDone: () => void;
}) {
  const [category, setCategory] = useState<'indemnity' | 'expense'>('indemnity');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [reason, setReason] = useState('');

  const post = useMutation<void, unknown>(() => {
    const dollars = Number(amount);
    const cents = Math.round(dollars * 100) * (direction === 'down' ? -1 : 1);
    return request(`/claims/${claimId}/exposures/${exposure.id}/reserves`, {
      method: 'POST',
      body: { category, amountCents: cents, reason },
    });
  });

  const valid = Number(amount) > 0 && reason.trim() !== '';

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
      <h3>
        Move the reserve on {exposure.coverageName} — {exposure.claimantName}
      </h3>
      {post.error ? <Notice tone="error">{post.error.message}</Notice> : null}
      <div className="form-grid">
        <Field label="Direction">
          {(props) => (
            <Select
              {...props}
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'up' | 'down')}
            >
              <option value="up">Increase reserve</option>
              <option value="down">Decrease reserve</option>
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
              <option value="expense">Expense — the cost of handling it</option>
            </Select>
          )}
        </Field>
        <Field label="Amount ($)">
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
        <Field label="Reason" hint="An auditor reads this; say why the estimate moved.">
          {(props) => (
            <TextInput {...props} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      </div>
      <div className="btn-row">
        <Button variant="primary" type="submit" loading={post.pending} disabled={!valid}>
          Post movement
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
