import { useQuery } from '../lib/api.ts';
import { date } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import type { PolicySummary } from '../lib/types.ts';
import { Empty, Money, Notice, PageHead, Status, TableSkeleton } from '../components/ui.tsx';

export function Policies() {
  const { data, error, loading } = useQuery<{ policies: PolicySummary[] }>('/policies');
  const policies = data?.policies ?? [];

  return (
    <>
      <PageHead
        title="Policies"
        meta={data ? <span>{policies.filter((p) => p.status === 'InForce').length} in force</span> : null}
      />

      <section className="section">
        {error ? <Notice tone="error">{error.message}</Notice> : null}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Policy</th>
                <th scope="col">Insured</th>
                <th scope="col">Status</th>
                <th scope="col">Term</th>
                <th scope="col" className="num">
                  Annual premium
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton columns={6} />
            ) : (
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id} className={policy.pastDueCents > 0 ? 'is-flagged' : undefined}>
                    <td className="anchor">
                      <Link to={`/policies/${policy.id}`} className="row-link">
                        <span className="cell-title mono">{policy.policyNumber}</span>
                      </Link>
                      <span className="cell-sub">{policy.productCode}</span>
                    </td>
                    <td>
                      {policy.accountName}
                      <span className="cell-sub mono">{policy.accountNumber}</span>
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
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {!loading && policies.length === 0 ? (
          <Empty
            title="No policies yet"
            body="Policies appear here once a submission is issued. Start one from an account."
            action={
              <Link to="/accounts" className="btn btn--primary">
                Go to accounts
              </Link>
            }
          />
        ) : null}
      </section>
    </>
  );
}
