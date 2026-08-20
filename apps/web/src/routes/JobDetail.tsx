import { useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import {
  date,
  dateTime,
  jobTypeLabel,
  kilometres,
  money,
  planName,
  relativeDays,
  useLabel,
} from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type { Job, JobEvent, RiskData } from '../lib/types.ts';
import { useSession } from '../session.tsx';
import {
  Button,
  Fact,
  Facts,
  Field,
  Money,
  Notice,
  PageHead,
  Section,
  Status,
  TextInput,
  Toast,
} from '../components/ui.tsx';

interface JobPage {
  job: Job;
  events: JobEvent[];
}

export function JobDetail({ jobId }: { jobId: string }) {
  const { navigate } = useRouter();
  const { session } = useSession();
  const page = useQuery<JobPage>(`/jobs/${jobId}`);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const act = useMutation<{ path: string; body?: unknown }, unknown>(({ path, body }) =>
    request(path, { method: 'POST', body }),
  );

  if (page.error) {
    return (
      <>
        <PageHead title="Job" />
        <Notice tone="error">{page.error.message}</Notice>
      </>
    );
  }

  const job = page.data?.job;
  const quote = job?.quote ?? null;
  const referrals = quote?.referrals ?? [];
  const blocked = referrals.length > 0 && !job?.uwApproved;
  const canUnderwrite = session?.role === 'underwriter' || session?.role === 'admin';
  const multiVehicle = (job?.risk.vehicles.length ?? 0) > 1;

  async function run(action: string, body?: unknown, message?: string) {
    const result = await act.run({ path: `/jobs/${jobId}/${action}`, body });
    if (result === null) return;
    page.reload();
    setNote('');
    if (message) {
      setToast(message);
      window.setTimeout(() => setToast(null), 4000);
    }
  }

  async function issue() {
    const result = (await act.run({ path: `/jobs/${jobId}/issue` })) as
      | { policy?: { id: string } }
      | null;
    if (result?.policy?.id) navigate(`/policies/${result.policy.id}`);
  }

  return (
    <>
      <PageHead
        eyebrow={
          job ? (
            <Link to={`/accounts/${job.accountId}`} className="link">
              Account file
            </Link>
          ) : null
        }
        title={job ? jobTypeLabel(job.jobType) : 'Loading…'}
        meta={
          job ? (
            <>
              <Status value={blocked ? 'Referred' : job.status} />
              <span>Effective {date(job.effectiveDate)}</span>
              <span>{relativeDays(job.effectiveDate)}</span>
              <span>{planName(job.billingPlan)}</span>
            </>
          ) : null
        }
      />

      {job ? (
        <Section>
          <div className="split">
            <div className="stack">
              {blocked ? (
                <div className="stack stack--tight">
                  <Notice tone="flag">
                    <strong>Referred to underwriting.</strong> This job cannot be bound until an
                    underwriter accepts it.
                  </Notice>
                  <div className="table-wrap">
                  <table className="data">
                    <caption>Rules that fired</caption>
                    <thead>
                      <tr>
                        <th scope="col">Rule</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Value on this risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrals.map((referral) => (
                        <tr key={referral.ruleCode} className="is-flagged">
                          <td className="mono">{referral.ruleCode}</td>
                          <td>{referral.description}</td>
                          <td>{referral.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              ) : null}

              {job.uwApproved ? (
                <Notice>
                  <strong>Accepted by underwriting.</strong>
                  {job.uwNote ? ` ${job.uwNote}` : ''}
                </Notice>
              ) : null}

              {quote ? (
                <Facts>
                  <Fact label="Annual premium" lead>
                    {money(quote.annualPremiumCents)}
                  </Fact>
                  <Fact
                    label={quote.kind === 'cancellation' ? 'Refund due' : 'Amount for this job'}
                    lead
                  >
                    <Money cents={quote.changeAmountCents} delta />
                  </Fact>
                  <Fact label="Term">
                    {date(quote.termStart)} → {date(quote.termEnd)}
                  </Fact>
                  {quote.priorAnnualPremiumCents ? (
                    <Fact label="Previous annual premium">
                      {money(quote.priorAnnualPremiumCents)}
                    </Fact>
                  ) : null}
                </Facts>
              ) : (
                <Notice>
                  Not quoted yet. Rate it to see the premium and any underwriting referrals.
                </Notice>
              )}
            </div>

            <div className="stack">
              <h2>Decision</h2>
              {act.error ? <Notice tone="error">{act.error.message}</Notice> : null}

              {job.status === 'Draft' ? (
                <>
                  <p className="section__note">
                    Rating this job prices every coverage and runs the underwriting rules.
                  </p>
                  <Button
                    variant="primary"
                    loading={act.pending}
                    onClick={() => void run('quote', undefined, 'Quoted.')}
                  >
                    Rate this job
                  </Button>
                </>
              ) : null}

              {job.status === 'Quoted' && blocked ? (
                canUnderwrite ? (
                  <>
                    <Field
                      label="Note"
                      hint="Recorded against the job. Say why, not just what."
                    >
                      {(props) => (
                        <TextInput
                          {...props}
                          value={note}
                          placeholder="Accept at standard rates."
                          onChange={(event) => setNote(event.target.value)}
                        />
                      )}
                    </Field>
                    <div className="btn-row">
                      <Button
                        variant="primary"
                        loading={act.pending}
                        onClick={() =>
                          void run(
                            'underwrite',
                            { decision: 'approve', ...(note.trim() ? { note: note.trim() } : {}) },
                            'Accepted. Clear to bind.',
                          )
                        }
                      >
                        Accept risk
                      </Button>
                      <Button
                        variant="danger"
                        loading={act.pending}
                        onClick={() =>
                          void run(
                            'underwrite',
                            { decision: 'decline', ...(note.trim() ? { note: note.trim() } : {}) },
                            'Declined.',
                          )
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="section__note">
                    Waiting on an underwriter. You are signed in as {session?.role}.
                  </p>
                )
              ) : null}

              {job.status === 'Quoted' && !blocked ? (
                <>
                  <p className="section__note">
                    Binding locks the quote. Issuing then creates the policy version and its billing
                    schedule.
                  </p>
                  <Button
                    variant="primary"
                    loading={act.pending}
                    onClick={() => void run('bind', undefined, 'Bound.')}
                  >
                    Bind
                  </Button>
                </>
              ) : null}

              {job.status === 'Bound' ? (
                <>
                  <p className="section__note">
                    Issuing writes the policy version, the financial transaction and the installment
                    schedule in one step.
                  </p>
                  <Button variant="primary" loading={act.pending} onClick={() => void issue()}>
                    Issue
                  </Button>
                </>
              ) : null}

              {job.status === 'Issued' ? (
                <p className="section__note">
                  Issued.{' '}
                  {job.policyId ? (
                    <Link to={`/policies/${job.policyId}`} className="link">
                      Open the policy
                    </Link>
                  ) : null}
                </p>
              ) : null}

              {job.status === 'Declined' || job.status === 'Withdrawn' ? (
                <p className="section__note">
                  This job is {job.status.toLowerCase()} and cannot be worked further.
                </p>
              ) : null}

              {['Draft', 'Quoted', 'Bound'].includes(job.status) ? (
                <Button
                  variant="ghost"
                  loading={act.pending}
                  onClick={() => void run('withdraw', undefined, 'Withdrawn.')}
                >
                  Withdraw job
                </Button>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      {quote?.rating ? (
        <Section
          title="Coverages"
          note={
            multiVehicle
              ? 'Priced per vehicle at the rates filed for this product version.'
              : 'Priced at the rates filed for this product version.'
          }
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Coverage</th>
                  {multiVehicle ? <th scope="col">Vehicle</th> : null}
                  <th scope="col" className="num">
                    Annual premium
                  </th>
                </tr>
              </thead>
              <tbody>
                {quote.rating.lines.map((line, index) => (
                  <tr key={`${line.vehicleId}-${line.coverageCode}-${index}`}>
                    <td>
                      <span className="cell-title">{line.coverageName}</span>
                      <span className="cell-sub mono">{line.coverageCode}</span>
                    </td>
                    {multiVehicle ? <td>{vehicleLabel(job?.risk, line.vehicleId)}</td> : null}
                    <td className="num">
                      <Money cents={line.annualPremiumCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={multiVehicle ? 2 : 1}>
                    Total annual premium
                  </th>
                  <td className="num">
                    <strong>
                      <Money cents={quote.rating.totalAnnualPremiumCents} />
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      ) : null}

      {job ? <RiskDetail risk={job.risk} /> : null}

      {page.data && page.data.events.length > 0 ? (
        <Section title="History">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">By</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {page.data.events.map((event) => (
                  <tr key={event.id}>
                    <td className="date">{dateTime(event.createdAt)}</td>
                    <td>
                      {event.action}
                      <span className="cell-sub">
                        {event.fromStatus} → {event.toStatus}
                      </span>
                    </td>
                    <td>
                      {event.actorName ?? 'Unknown'}
                      <span className="cell-sub">{event.actorRole}</span>
                    </td>
                    <td>{event.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </>
  );
}

function vehicleLabel(risk: RiskData | undefined, vehicleId: string): string {
  const vehicle = risk?.vehicles.find((v) => v.id === vehicleId);
  return vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : vehicleId;
}

export function RiskDetail({ risk }: { risk: RiskData }) {
  return (
    <>
      <Section title="Drivers">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">Born</th>
                <th scope="col">Licence</th>
                <th scope="col" className="num">
                  Years licensed
                </th>
                <th scope="col" className="num">
                  At-fault claims
                </th>
                <th scope="col" className="num">
                  Convictions
                </th>
              </tr>
            </thead>
            <tbody>
              {risk.drivers.map((driver) => (
                <tr
                  key={driver.id}
                  className={driver.atFaultClaims >= 2 || driver.yearsLicensed < 1 ? 'is-flagged' : undefined}
                >
                  <td>
                    <span className="cell-title">
                      {driver.firstName} {driver.lastName}
                    </span>
                  </td>
                  <td className="date">{date(driver.dateOfBirth)}</td>
                  <td className="mono">{driver.licenceNumber}</td>
                  <td className="num">{driver.yearsLicensed}</td>
                  <td className="num">{driver.atFaultClaims}</td>
                  <td className="num">{driver.minorConvictions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Vehicles">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">VIN</th>
                <th scope="col">Garaged</th>
                <th scope="col">Use</th>
                <th scope="col" className="num">
                  Value
                </th>
                <th scope="col" className="num">
                  Rate group
                </th>
              </tr>
            </thead>
            <tbody>
              {risk.vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td>
                    <span className="cell-title">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </span>
                    <span className="cell-sub">{kilometres(vehicle.annualKm)}</span>
                  </td>
                  <td className="mono">{vehicle.vin}</td>
                  <td className="mono">{vehicle.postalCode}</td>
                  <td>{useLabel(vehicle.primaryUse)}</td>
                  <td className="num">
                    <Money cents={vehicle.valueCents} />
                  </td>
                  <td className="num">{vehicle.rateGroup}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
