import { useMutation, request, useQuery } from '../lib/api.ts';
import { date, lossCauseLabel, relativeDays } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type { ClaimSummary, ClaimsWorklist as WorklistData } from '../lib/types.ts';
import {
  Button,
  Empty,
  Money,
  Notice,
  PageHead,
  Section,
  Status,
  TableSkeleton,
} from '../components/ui.tsx';
import { useSession } from '../session.tsx';

/**
 * The claims landing screen: what needs a decision first, then the whole book.
 * Approvals by amount at stake, diary by due date.
 */
export function ClaimsWorklist() {
  const { session } = useSession();
  const { navigate } = useRouter();
  const worklist = useQuery<WorklistData>('/claims/queues');
  const all = useQuery<{ claims: ClaimSummary[] }>('/claims');

  const approve = useMutation<{ claimId: string; paymentId: string }, unknown>(
    ({ claimId, paymentId }) =>
      request(`/claims/${claimId}/payments/${paymentId}/approve`, { method: 'POST' }),
  );

  const canApprove =
    session?.role === 'claims_supervisor' || session?.role === 'admin' || session?.role === 'adjuster';
  const data = worklist.data;

  return (
    <>
      <PageHead
        title="Claims"
        meta={
          data ? (
            <>
              <span>
                <strong className="mono">{data.counts.approvals}</strong> awaiting approval
              </span>
              <span>
                <strong className="mono">{data.counts.unassigned}</strong> unassigned
              </span>
              <span>
                <strong className="mono">{data.counts.overdueDiary}</strong> diary overdue
              </span>
              <span>
                <strong className="mono">{data.counts.flagged}</strong> flagged
              </span>
            </>
          ) : null
        }
      />

      {worklist.error ? <Notice tone="error">{worklist.error.message}</Notice> : null}
      {approve.error ? <Notice tone="error">{approve.error.message}</Notice> : null}

      <Section
        title="Payments awaiting approval"
        note="Requested above the adjuster's own authority. Largest amount at stake first."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Account</th>
                <th scope="col">Exposure</th>
                <th scope="col">Payee</th>
                <th scope="col">Requested by</th>
                <th scope="col" className="num">
                  Amount
                </th>
                {canApprove ? <th scope="col" className="num">Decision</th> : null}
              </tr>
            </thead>
            {worklist.loading ? (
              <TableSkeleton columns={canApprove ? 7 : 6} />
            ) : (
              <tbody>
                {data?.approvals.map((item) => (
                  <tr key={item.paymentId}>
                    <td>
                      <Link to={`/claims/${item.claimId}`} className="link mono">
                        {item.claimNumber}
                      </Link>
                    </td>
                    <td>{item.accountName}</td>
                    <td>{item.exposureLabel}</td>
                    <td>{item.payeeName}</td>
                    <td>{item.requestedByName}</td>
                    <td className="num">
                      <Money cents={item.amountCents} />
                    </td>
                    {canApprove ? (
                      <td className="num">
                        <Button
                          variant="secondary"
                          loading={approve.pending}
                          onClick={async () => {
                            const ok = await approve.run({
                              claimId: item.claimId,
                              paymentId: item.paymentId,
                            });
                            if (ok !== null) {
                              worklist.reload();
                              all.reload();
                            }
                          }}
                        >
                          Approve
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!worklist.loading && data?.approvals.length === 0 ? (
          <Empty
            title="Nothing is waiting on an approval"
            body="Payments requested above an adjuster's authority land here for a second person."
          />
        ) : null}
      </Section>

      {data && data.diary.length > 0 ? (
        <Section title="My diary" note="Dated follow-ups on open files, soonest due first.">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.diary.map((item) => (
                  <tr key={item.taskId}>
                    <td>
                      <Link to={`/claims/${item.claimId}`} className="link mono">
                        {item.claimNumber}
                      </Link>
                    </td>
                    <td>{item.subject}</td>
                    <td>
                      {date(item.dueDate)} <span className="dim">({relativeDays(item.dueDate)})</span>
                    </td>
                    <td>
                      <Status value={item.overdue ? 'overdue' : 'open'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {data && data.flagged.length > 0 ? (
        <Section
          title="Flagged for review"
          note="Open claims carrying fraud indicators. Indicators ask for a look; they decide nothing."
        >
          <ClaimQueueTable items={data.flagged} showFlags />
        </Section>
      ) : null}

      {data && data.unassigned.length > 0 ? (
        <Section title="Unassigned" note="Reported and waiting for an adjuster to take the file.">
          <ClaimQueueTable items={data.unassigned} />
        </Section>
      ) : null}

      <Section
        title="All claims"
        note="Every claim this tenant has on file, newest first."
        actions={
          <Button variant="secondary" onClick={() => navigate('/policies')}>
            Report a claim from a policy
          </Button>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Insured</th>
                <th scope="col">Loss date</th>
                <th scope="col">Cause</th>
                <th scope="col">Status</th>
                <th scope="col">Adjuster</th>
                <th scope="col" className="num">
                  Incurred
                </th>
                <th scope="col" className="num">
                  Outstanding
                </th>
              </tr>
            </thead>
            {all.loading ? (
              <TableSkeleton columns={8} />
            ) : (
              <tbody>
                {all.data?.claims.map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <Link to={`/claims/${claim.id}`} className="link mono">
                        {claim.claimNumber}
                      </Link>
                    </td>
                    <td>{claim.accountName}</td>
                    <td>{date(claim.lossDate)}</td>
                    <td>{lossCauseLabel(claim.lossCause)}</td>
                    <td>
                      <Status value={claim.status} />
                      {claim.fraudFlags.length > 0 ? (
                        <>
                          {' '}
                          <Status value="Referred" label="Flagged" />
                        </>
                      ) : null}
                    </td>
                    <td>{claim.assignedUserName ?? <span className="dim">Unassigned</span>}</td>
                    <td className="num">
                      <Money cents={claim.incurredCents} />
                    </td>
                    <td className="num">
                      <Money cents={claim.outstandingCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!all.loading && all.data?.claims.length === 0 ? (
          <Empty
            title="No claims on file"
            body="Report a loss from the policy it happened under: open the policy and choose Report a claim."
          />
        ) : null}
      </Section>
    </>
  );
}

function ClaimQueueTable({
  items,
  showFlags = false,
}: {
  items: WorklistData['myClaims'];
  showFlags?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Insured</th>
            <th scope="col">Loss date</th>
            <th scope="col">Cause</th>
            {showFlags ? <th scope="col">Why it flagged</th> : <th scope="col">Adjuster</th>}
            <th scope="col" className="num">
              Outstanding
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.claimId}>
              <td>
                <Link to={`/claims/${item.claimId}`} className="link mono">
                  {item.claimNumber}
                </Link>
              </td>
              <td>{item.accountName}</td>
              <td>{date(item.lossDate)}</td>
              <td>{lossCauseLabel(item.lossCause)}</td>
              {showFlags ? (
                <td>{item.fraudFlags.map((f) => f.description).join('; ')}</td>
              ) : (
                <td>{item.assignedUserName ?? <span className="dim">Unassigned</span>}</td>
              )}
              <td className="num">
                <Money cents={item.outstandingCents} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
