import { useState } from 'react';
import { request, useMutation } from '../../lib/api.ts';
import { recoveryTypeLabel } from '../../lib/format.ts';
import type { ClaimPage, ClaimRecovery } from '../../lib/types.ts';
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

/** Money coming back: subrogation, salvage, or the insured's deductible. */
export function Recoveries({
  page,
  canWork,
  onChanged,
}: {
  page: ClaimPage;
  canWork: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
  const open = page.claim.status === 'Open';

  const close = useMutation<string, unknown>((recoveryId) =>
    request(`/claims/${page.claim.id}/recoveries/${recoveryId}/close`, { method: 'POST' }),
  );

  return (
    <Section
      title="Recoveries"
      note="Opened with an expectation, received over time, closed when done or written off."
      actions={
        canWork && open && page.exposures.length > 0 ? (
          <Button onClick={() => setAdding(!adding)} aria-expanded={adding}>
            Open a recovery
          </Button>
        ) : null
      }
    >
      {close.error ? <Notice tone="error">{close.error.message}</Notice> : null}

      {page.recoveries.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Counterparty</th>
                <th scope="col" className="num">
                  Expected
                </th>
                <th scope="col" className="num">
                  Received
                </th>
                <th scope="col">Status</th>
                {canWork ? <th scope="col" className="num">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {page.recoveries.map((recovery) => (
                <tr key={recovery.id}>
                  <td>{recoveryTypeLabel(recovery.recoveryType)}</td>
                  <td>{recovery.counterparty}</td>
                  <td className="num">
                    <Money cents={recovery.expectedCents} />
                  </td>
                  <td className="num">
                    <Money cents={recovery.receivedCents} />
                  </td>
                  <td>
                    <Status value={recovery.status} />
                  </td>
                  {canWork ? (
                    <td className="num">
                      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                        {recovery.status !== 'Closed' ? (
                          <>
                            <Button
                              onClick={() =>
                                setReceiving(receiving === recovery.id ? null : recovery.id)
                              }
                              aria-expanded={receiving === recovery.id}
                            >
                              Record receipt
                            </Button>
                            <Button
                              variant="ghost"
                              loading={close.pending}
                              onClick={async () => {
                                if ((await close.run(recovery.id)) !== null) onChanged();
                              }}
                            >
                              Close
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Nothing to recover yet"
          body="Subrogation against a liable party, salvage on the property, or the insured's deductible."
        />
      )}

      {receiving ? (
        <ReceiveForm
          claimId={page.claim.id}
          recovery={page.recoveries.find((r) => r.id === receiving)!}
          onDone={() => {
            setReceiving(null);
            onChanged();
          }}
        />
      ) : null}

      {adding ? (
        <RecoveryForm
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

function ReceiveForm({
  claimId,
  recovery,
  onDone,
}: {
  claimId: string;
  recovery: ClaimRecovery;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const post = useMutation<void, unknown>(() =>
    request(`/claims/${claimId}/recoveries/${recovery.id}/receive`, {
      method: 'POST',
      body: { amountCents: Math.round(Number(amount) * 100) },
    }),
  );
  const valid = Number(amount) > 0;

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
        Record a receipt from {recovery.counterparty}
      </h3>
      {post.error ? <Notice tone="error">{post.error.message}</Notice> : null}
      <div className="form-grid form-grid--narrow">
        <Field label="Amount received ($)">
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
      </div>
      <div className="btn-row">
        <Button variant="primary" type="submit" loading={post.pending} disabled={!valid}>
          Record receipt
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecoveryForm({ page, onDone }: { page: ClaimPage; onDone: () => void }) {
  const [exposureId, setExposureId] = useState(page.exposures[0]?.id ?? '');
  const [recoveryType, setRecoveryType] = useState('subrogation');
  const [counterparty, setCounterparty] = useState('');
  const [expected, setExpected] = useState('');

  const post = useMutation<void, unknown>(() =>
    request(`/claims/${page.claim.id}/recoveries`, {
      method: 'POST',
      body: {
        exposureId,
        recoveryType,
        category: 'indemnity',
        counterparty,
        expectedCents: Math.round(Number(expected) * 100),
      },
    }),
  );

  const valid = exposureId !== '' && counterparty.trim() !== '' && Number(expected) > 0;

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
      <h3>Open a recovery</h3>
      {post.error ? <Notice tone="error">{post.error.message}</Notice> : null}
      <div className="form-grid">
        <Field label="Exposure">
          {(props) => (
            <Select {...props} value={exposureId} onChange={(e) => setExposureId(e.target.value)}>
              {page.exposures.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.coverageName} — {e.claimantName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(props) => (
            <Select
              {...props}
              value={recoveryType}
              onChange={(e) => setRecoveryType(e.target.value)}
            >
              <option value="subrogation">Subrogation — a liable third party</option>
              <option value="salvage">Salvage — what is left of the property</option>
              <option value="deductible">Deductible — recovered for the insured</option>
            </Select>
          )}
        </Field>
        <Field label="Counterparty" hint="Who the money comes from.">
          {(props) => (
            <TextInput
              {...props}
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
            />
          )}
        </Field>
        <Field label="Expected ($)">
          {(props) => (
            <TextInput
              {...props}
              type="number"
              min="0.01"
              step="0.01"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="btn-row">
        <Button variant="primary" type="submit" loading={post.pending} disabled={!valid}>
          Open recovery
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
