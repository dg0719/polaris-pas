import { useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import { date, dateTime, lossCauseLabel, money } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import type { ClaimPage, ClaimsUser } from '../lib/types.ts';
import {
  Button,
  Fact,
  Facts,
  Notice,
  PageHead,
  Section,
  Select,
  Status,
} from '../components/ui.tsx';
import { useSession } from '../session.tsx';
import { Diary } from './claim/Diary.tsx';
import { Exposures } from './claim/Exposures.tsx';
import { FinancialsSummary } from './claim/Financials.tsx';
import { Payments } from './claim/Payments.tsx';
import { Recoveries } from './claim/Recoveries.tsx';

export function ClaimDetail({ claimId }: { claimId: string }) {
  const { session } = useSession();
  const page = useQuery<ClaimPage>(`/claims/${claimId}`);

  const canWork =
    session?.role === 'adjuster' ||
    session?.role === 'claims_supervisor' ||
    session?.role === 'admin';

  const act = useMutation<string, unknown>((action) =>
    request(`/claims/${claimId}/${action}`, { method: 'POST' }),
  );

  if (page.error) {
    return (
      <>
        <PageHead title="Claim" />
        <Notice tone="error">{page.error.message}</Notice>
      </>
    );
  }

  const data = page.data;
  const claim = data?.claim;
  const open = claim?.status === 'Open';

  return (
    <>
      <PageHead
        eyebrow={
          data ? (
            <Link to={`/accounts/${data.account.id}`} className="link">
              {data.account.name}
            </Link>
          ) : null
        }
        title={<span className="mono">{claim?.claimNumber ?? 'Loading…'}</span>}
        meta={
          claim ? (
            <>
              <Status value={claim.status} />
              <span>{lossCauseLabel(claim.lossCause)}</span>
              <span>Loss {date(claim.lossDate)}</span>
              {data?.policy ? (
                <Link to={`/policies/${data.policy.id}`} className="link mono">
                  {data.policy.policyNumber}
                </Link>
              ) : null}
            </>
          ) : null
        }
        actions={
          canWork && claim ? (
            open ? (
              <Button
                variant="secondary"
                loading={act.pending}
                onClick={async () => {
                  if ((await act.run('close')) !== null) page.reload();
                }}
              >
                Close claim
              </Button>
            ) : (
              <Button
                variant="secondary"
                loading={act.pending}
                onClick={async () => {
                  if ((await act.run('reopen')) !== null) page.reload();
                }}
              >
                Reopen claim
              </Button>
            )
          ) : null
        }
      />

      {act.error ? <Notice tone="error">{act.error.message}</Notice> : null}

      {claim && claim.fraudFlags.length > 0 ? (
        <Notice tone="flag">
          Flagged for review:{' '}
          {claim.fraudFlags.map((flag) => `${flag.description} (${flag.detail})`).join('; ')}. An
          indicator asks for a second look; it decides nothing by itself.
        </Notice>
      ) : null}

      {data ? (
        <>
          <Section title="Financial position">
            <FinancialsSummary financials={data.financials} />
          </Section>

          <Section title="The loss">
            <Facts>
              <Fact label="Loss date">{date(data.claim.lossDate)}</Fact>
              <Fact label="Reported">{date(data.claim.reportedDate)}</Fact>
              <Fact label="Cause">{lossCauseLabel(data.claim.lossCause)}</Fact>
              <Fact label="Where">{data.claim.lossLocation ?? '—'}</Fact>
              <Fact label="Adjuster">
                {data.assignedUserName ?? <span className="dim">Unassigned</span>}
              </Fact>
            </Facts>
            <p style={{ marginTop: 'var(--s-4)', maxWidth: '60ch' }}>{data.claim.description}</p>
            {canWork && open ? <AssignControl page={data} onChanged={page.reload} /> : null}
          </Section>

          <Section
            title="Coverage in force on the loss date"
            note={
              data.policyVersion
                ? `Version ${data.policyVersion.versionNumber} (${data.policyVersion.transactionType}), effective ${date(data.policyVersion.effectiveDate)}, term ${date(data.policyVersion.termStart)} → ${date(data.policyVersion.termEnd)}.`
                : undefined
            }
          >
            {data.policyVersion ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Coverage</th>
                      <th scope="col">Vehicle</th>
                      <th scope="col" className="num">
                        Limit
                      </th>
                      <th scope="col" className="num">
                        Deductible
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.policyVersion.risk.coverages.map((coverage, index) => {
                      const vehicle = data.policyVersion!.risk.vehicles.find(
                        (v) => v.id === coverage.vehicleId,
                      );
                      return (
                        <tr key={index}>
                          <td>{coverage.coverageCode}</td>
                          <td>
                            {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '—'}
                          </td>
                          <td className="num">
                            {coverage.limitCents ? money(coverage.limitCents) : '—'}
                          </td>
                          <td className="num">
                            {coverage.deductibleCents ? money(coverage.deductibleCents) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Notice>The version this claim was verified against is unavailable.</Notice>
            )}
          </Section>

          <Exposures page={data} canWork={canWork} onChanged={page.reload} />
          <Payments page={data} canWork={canWork} onChanged={page.reload} />
          <Recoveries page={data} canWork={canWork} onChanged={page.reload} />
          <Diary page={data} canWork={canWork} onChanged={page.reload} />

          {data.reserveMovements.length > 0 ? (
            <Section
              title="Reserve history"
              note="Movements only, never edits. The current reserve is their sum."
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Exposure</th>
                      <th scope="col">Category</th>
                      <th scope="col">Reason</th>
                      <th scope="col" className="num">
                        Movement
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reserveMovements.map((movement) => {
                      const exposure = data.exposures.find((e) => e.id === movement.exposureId);
                      return (
                        <tr key={movement.id}>
                          <td className="date">{dateTime(movement.createdAt)}</td>
                          <td>{exposure?.coverageName ?? '—'}</td>
                          <td>{movement.category === 'indemnity' ? 'Indemnity' : 'Expense'}</td>
                          <td>{movement.reason}</td>
                          <td className="num">
                            <MoneyDelta cents={movement.amountCents} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {data.events.length > 0 ? (
            <Section title="History">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Action</th>
                      <th scope="col">By</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={event.id}>
                        <td className="date">{dateTime(event.createdAt)}</td>
                        <td>{event.action}</td>
                        <td>
                          {event.actorName ?? 'Unknown'}
                          <span className="cell-sub">{event.actorRole}</span>
                        </td>
                        <td>{event.detail ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function MoneyDelta({ cents }: { cents: number }) {
  const formatted = money(Math.abs(cents));
  return (
    <span className={`mono${cents < 0 ? ' money--negative' : ''}`}>
      {cents < 0 ? `−${formatted}` : `+${formatted}`}
    </span>
  );
}

function AssignControl({ page, onChanged }: { page: ClaimPage; onChanged: () => void }) {
  const users = useQuery<{ users: ClaimsUser[] }>('/claims-users');
  const [userId, setUserId] = useState('');

  const assign = useMutation<void, unknown>(() =>
    request(`/claims/${page.claim.id}/assign`, { method: 'POST', body: { userId } }),
  );

  return (
    <form
      className="btn-row"
      style={{ marginTop: 'var(--s-4)', alignItems: 'center' }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (userId === '') return;
        if ((await assign.run()) !== null) onChanged();
      }}
    >
      <Select
        aria-label="Assign to"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        style={{ maxWidth: '18rem' }}
      >
        <option value="">Assign to…</option>
        {users.data?.users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} — authority {money(user.authorityLimitCents)}
          </option>
        ))}
      </Select>
      <Button type="submit" loading={assign.pending} disabled={userId === ''}>
        Assign
      </Button>
      {assign.error ? <Notice tone="error">{assign.error.message}</Notice> : null}
    </form>
  );
}
