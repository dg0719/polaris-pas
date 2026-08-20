import { useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import {
  date,
  jobTypeLabel,
  money,
  planName,
  relativeDays,
  todayIso,
} from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import type {
  Account,
  AccountRollup,
  Invoice,
  Job,
  Payment,
  PolicySummary,
} from '../lib/types.ts';
import {
  Button,
  Empty,
  Fact,
  Facts,
  Field,
  Money,
  Notice,
  PageHead,
  Section,
  Select,
  Status,
  TextInput,
  Toast,
} from '../components/ui.tsx';

interface AccountPage {
  account: Account;
  rollup: AccountRollup;
  policies: PolicySummary[];
  jobs: Job[];
}

interface BillingPage {
  rollup: AccountRollup;
  invoices: Invoice[];
  payments: Payment[];
}

const OPEN_STATUSES = new Set(['Draft', 'Quoted', 'Bound']);

export function AccountDetail({ accountId }: { accountId: string }) {
  const page = useQuery<AccountPage>(`/accounts/${accountId}`);
  const billing = useQuery<BillingPage>(`/accounts/${accountId}/billing`);
  const [toast, setToast] = useState<string | null>(null);

  if (page.error) {
    return (
      <>
        <PageHead title="Account" />
        <Notice tone="error">{page.error.message}</Notice>
      </>
    );
  }

  const account = page.data?.account;
  const rollup = page.data?.rollup;
  const openJobs = (page.data?.jobs ?? []).filter((job) => OPEN_STATUSES.has(job.status));

  return (
    <>
      <PageHead
        eyebrow={<Link to="/accounts" className="link">Accounts</Link>}
        title={account?.name ?? 'Loading…'}
        meta={
          account ? (
            <>
              <span className="mono">{account.accountNumber}</span>
              <span>{account.accountType === 'person' ? 'Personal' : 'Commercial'}</span>
              {account.producerCode ? <span>Producer {account.producerCode}</span> : null}
            </>
          ) : null
        }
        actions={
          <Link to={`/accounts/${accountId}/new-submission`} className="btn btn--primary">
            New submission
          </Link>
        }
      />

      <Section>
        <Facts>
          <Fact label="Premium in force" lead>
            {rollup ? money(rollup.annualPremiumCents) : '—'}
          </Fact>
          <Fact label="Balance" lead>
            {rollup ? <Money cents={rollup.balanceCents} balance /> : '—'}
          </Fact>
          <Fact label="Past due">
            {rollup && rollup.pastDueCents > 0 ? (
              <>
                <Money cents={rollup.pastDueCents} />{' '}
                <Status value="overdue" label="Action needed" />
              </>
            ) : (
              'Nothing overdue'
            )}
          </Fact>
          <Fact label="Policies">
            {rollup ? `${rollup.inForceCount} in force of ${rollup.policyCount}` : '—'}
          </Fact>
        </Facts>
      </Section>

      <Section title="Contact">
        <Facts tight>
          <Fact label="Email">{account?.email ?? 'Not provided'}</Fact>
          <Fact label="Phone">{account?.phone ?? 'Not provided'}</Fact>
          <Fact label="Mailing address">
            {account ? (
              <>
                {account.address.line1}
                <br />
                {account.address.city}, {account.address.province}{' '}
                <span className="mono">{account.address.postalCode}</span>
              </>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Customer since">{date(account?.createdAt)}</Fact>
        </Facts>
      </Section>

      <Section title="Policies">
        {page.data && page.data.policies.length === 0 ? (
          <Empty
            title="No policies on this account"
            body="Start a submission to quote one. It is filed here the moment it is issued."
            action={
              <Link to={`/accounts/${accountId}/new-submission`} className="btn btn--primary">
                New submission
              </Link>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Policy</th>
                  <th scope="col">Status</th>
                  <th scope="col">Term</th>
                  <th scope="col" className="num">
                    Annual premium
                  </th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                  <th scope="col">Next due</th>
                </tr>
              </thead>
              <tbody>
                {page.data?.policies.map((policy) => (
                  <tr key={policy.id}>
                    <td className="anchor">
                      <Link to={`/policies/${policy.id}`} className="row-link">
                        <span className="cell-title mono">{policy.policyNumber}</span>
                      </Link>
                      <span className="cell-sub">{policy.productCode}</span>
                    </td>
                    <td>
                      <Status value={policy.status} />
                    </td>
                    <td>
                      {date(policy.termStart)} → {date(policy.termEnd)}
                    </td>
                    <td className="num">
                      <Money cents={policy.annualPremiumCents} />
                    </td>
                    <td className="num">
                      <Money cents={policy.balanceCents} balance />
                    </td>
                    <td>
                      {policy.nextDue ? (
                        <>
                          {date(policy.nextDue.dueDate)}
                          <span className="cell-sub">{money(policy.nextDue.amountCents)}</span>
                        </>
                      ) : (
                        <span className="status status--muted">Settled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {openJobs.length > 0 ? (
        <Section title="Open work" note="Submissions, changes and renewals that are not yet issued.">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Effective</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {openJobs.map((job) => (
                  <tr key={job.id} className={job.quote?.referrals.length ? 'is-flagged' : undefined}>
                    <td className="anchor">
                      <Link to={`/jobs/${job.id}`} className="row-link">
                        <span className="cell-title">{jobTypeLabel(job.jobType)}</span>
                      </Link>
                      <span className="cell-sub">
                        {job.quote?.referrals.length
                          ? `${job.quote.referrals.length} referral${job.quote.referrals.length > 1 ? 's' : ''}`
                          : planName(job.billingPlan)}
                      </span>
                    </td>
                    <td>
                      <Status value={job.quote?.referrals.length && !job.uwApproved ? 'Referred' : job.status} />
                    </td>
                    <td>
                      {date(job.effectiveDate)}
                      <span className="cell-sub">{relativeDays(job.effectiveDate)}</span>
                    </td>
                    <td className="num">
                      {job.quote ? <Money cents={job.quote.changeAmountCents} delta /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section
        title="Billing"
        note={
          billing.data
            ? `${billing.data.invoices.filter((i) => i.status !== 'void').length} invoices across every policy on this account.`
            : undefined
        }
      >
        <div className="split">
          <div>
            {billing.data && billing.data.invoices.length === 0 ? (
              <Empty
                title="Nothing billed yet"
                body="An installment schedule is laid down the moment a policy is issued."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Due</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col" className="num">
                        Outstanding
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.data?.invoices.map((invoice) => (
                      <tr key={invoice.id} className={invoice.status === 'overdue' ? 'is-flagged' : undefined}>
                        <td className="mono">{invoice.invoiceNumber}</td>
                        <td className="date">{date(invoice.dueDate)}</td>
                        <td>
                          <Status value={invoice.status} />
                        </td>
                        <td className="num">
                          <Money cents={invoice.amountCents} delta={invoice.amountCents < 0} />
                        </td>
                        <td className="num">
                          {invoice.status === 'void' ? '—' : money(invoice.outstandingCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="stack">
            <RecordPayment
              accountId={accountId}
              suggested={Math.max(0, billing.data?.rollup.balanceCents ?? 0)}
              onRecorded={(message) => {
                setToast(message);
                billing.reload();
                page.reload();
                window.setTimeout(() => setToast(null), 4000);
              }}
            />

            {billing.data && billing.data.payments.length > 0 ? (
              <div>
                <h3 style={{ marginBottom: 'var(--s-3)' }}>Recent payments</h3>
                <ul className="stack stack--tight">
                  {billing.data.payments.slice(0, 6).map((payment) => (
                    <li key={payment.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>
                        {date(payment.receivedAt)}
                        <span className="cell-sub">
                          {payment.method}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </span>
                      </span>
                      <Money cents={payment.amountCents} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      {toast ? <Toast message={toast} /> : null}
      {page.loading && !page.data ? <p className="section__note">Loading account…</p> : null}
    </>
  );
}

function RecordPayment({
  accountId,
  suggested,
  onRecorded,
}: {
  accountId: string;
  suggested: number;
  onRecorded: (message: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('eft');
  const [reference, setReference] = useState('');

  const pay = useMutation<
    { amountCents: number; method: string; reference?: string; receivedAt: string },
    { appliedCents: number; unappliedCents: number }
  >((body) =>
    request<{ appliedCents: number; unappliedCents: number }>(`/accounts/${accountId}/payments`, {
      method: 'POST',
      body,
    }),
  );

  const cents = Math.round(Number.parseFloat(amount || '0') * 100);
  const valid = Number.isFinite(cents) && cents > 0;

  async function submit() {
    const result = await pay.run({
      amountCents: cents,
      method,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      receivedAt: todayIso(),
    });
    if (!result) return;
    setAmount('');
    setReference('');
    onRecorded(
      result.unappliedCents > 0
        ? `Payment recorded. ${money(result.appliedCents)} applied, ${money(result.unappliedCents)} held as credit.`
        : `Payment of ${money(result.appliedCents)} applied.`,
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <h3>Record a payment</h3>
        <p className="section__note" style={{ marginTop: 'var(--s-2)' }}>
          Applied to the oldest outstanding invoice first. Anything left over is held as credit.
        </p>
      </div>

      {pay.error ? <Notice tone="error">{pay.error.message}</Notice> : null}

      <Field
        label="Amount"
        hint={suggested > 0 ? `Full balance is ${money(suggested)}.` : 'Nothing is outstanding.'}
      >
        {(props) => (
          <TextInput
            {...props}
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            onChange={(event) => setAmount(event.target.value)}
          />
        )}
      </Field>

      <Field label="Method">
        {(props) => (
          <Select {...props} value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="eft">EFT</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
          </Select>
        )}
      </Field>

      <Field label="Reference" hint="Optional. Cheque number, authorisation code.">
        {(props) => (
          <TextInput
            {...props}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        )}
      </Field>

      <div className="btn-row">
        <Button type="submit" variant="primary" loading={pay.pending} disabled={!valid}>
          Record payment
        </Button>
        {suggested > 0 ? (
          <Button variant="ghost" onClick={() => setAmount((suggested / 100).toFixed(2))}>
            Pay full balance
          </Button>
        ) : null}
      </div>
    </form>
  );
}
