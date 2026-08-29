import { useState } from 'react';
import { request, useMutation } from '../../lib/api.ts';
import { date, todayIso } from '../../lib/format.ts';
import { Button, Field, Notice, TextInput } from '../../components/ui.tsx';

/**
 * The one form behind both servicing actions on a policy. Renewal and
 * cancellation differ only in what they ask for and what they create, so they
 * share a shape rather than drifting into two near-identical forms.
 */
export function ServicingForm({
  kind,
  policyId,
  termEnd,
  onCancel,
  onCreated,
}: {
  kind: 'renewal' | 'cancellation';
  policyId: string;
  termEnd: string;
  onCancel: () => void;
  onCreated: (jobId: string) => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [reason, setReason] = useState('');

  const create = useMutation<Record<string, unknown>, { job: { id: string } }>((body) =>
    request<{ job: { id: string } }>(
      `/policies/${policyId}/${kind === 'renewal' ? 'renewal' : 'cancellation'}`,
      { method: 'POST', body },
    ),
  );

  async function submit() {
    const body =
      kind === 'renewal' ? {} : { effectiveDate, reason: reason.trim() || 'Requested by insured' };
    const result = await create.run(body);
    if (result) onCreated(result.job.id);
  }

  return (
    <form
      className="stack"
      style={{ maxWidth: '44rem' }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2>{kind === 'renewal' ? 'Renew this policy' : 'Cancel this policy'}</h2>
        <p className="section__note" style={{ marginTop: 'var(--s-2)' }}>
          {kind === 'renewal'
            ? `Creates a renewal job for the term beginning ${date(termEnd)}. It still has to be quoted, bound and issued.`
            : 'Creates a cancellation job. Quoting it works out the pro-rata refund; nothing changes until it is issued.'}
        </p>
      </div>

      {create.error ? <Notice tone="error">{create.error.message}</Notice> : null}

      {kind === 'cancellation' ? (
        <div className="form-grid">
          <Field label="Effective date" hint="The day cover stops.">
            {(props) => (
              <TextInput
                {...props}
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            )}
          </Field>
          <Field label="Reason">
            {(props) => (
              <TextInput
                {...props}
                value={reason}
                placeholder="Vehicle sold, no replacement"
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </div>
      ) : null}

      <div className="btn-row">
        <Button type="submit" variant="primary" loading={create.pending}>
          {kind === 'renewal' ? 'Create renewal' : 'Create cancellation'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
