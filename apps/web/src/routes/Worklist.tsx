import { useQuery } from '../lib/api.ts';
import { date, jobTypeLabel, relativeDays } from '../lib/format.ts';
import { Link } from '../lib/router.tsx';
import type { Worklist as WorklistData, WorklistItem } from '../lib/types.ts';
import { Empty, Money, Notice, PageHead, Section, Status, TableSkeleton } from '../components/ui.tsx';

export function Worklist() {
  const { data, error, loading } = useQuery<WorklistData>('/worklist');

  return (
    <>
      <PageHead
        title="Worklist"
        meta={
          data ? (
            <>
              <span>
                <strong className="mono">{data.counts.referred}</strong> referred
              </span>
              <span>
                <strong className="mono">{data.counts.awaitingBind}</strong> ready to bind
              </span>
              <span>
                <strong className="mono">{data.counts.draft}</strong> in draft
              </span>
            </>
          ) : null
        }
      />

      {error ? <Notice tone="error">{error.message}</Notice> : null}

      <Section
        title="Referred to underwriting"
        note="Quoted work the rating engine would not clear on its own. Highest premium at stake first."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Type</th>
                <th scope="col">Why it referred</th>
                <th scope="col">Effective</th>
                <th scope="col" className="num">
                  Annual premium
                </th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton columns={5} />
            ) : (
              <tbody>
                {data?.referrals.map((item) => (
                  <ReferralRow key={item.jobId} item={item} />
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && data?.referrals.length === 0 ? (
          <Empty
            title="Nothing is waiting on you"
            body="Quoted submissions that trip an underwriting rule land here. The queue is clear."
          />
        ) : null}
      </Section>

      <Section
        title="Ready to bind"
        note="Quoted and clear: either nothing referred, or an underwriter has already accepted it."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Effective</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton columns={5} />
            ) : (
              <tbody>
                {data?.readyToBind.map((item) => (
                  <tr key={item.jobId}>
                    <td className="anchor">
                      <Link to={`/jobs/${item.jobId}`} className="row-link">
                        <span className="cell-title">{item.accountName}</span>
                      </Link>
                      <span className="cell-sub mono">{item.accountNumber}</span>
                    </td>
                    <td>{jobTypeLabel(item.jobType)}</td>
                    <td>
                      <Status value={item.uwApproved ? 'Approved' : 'Quoted'} />
                    </td>
                    <td>
                      {date(item.effectiveDate)}
                      <span className="cell-sub">{relativeDays(item.effectiveDate)}</span>
                    </td>
                    <td className="num">
                      <Money cents={item.changeAmountCents} delta />
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && data?.readyToBind.length === 0 ? (
          <Empty
            title="Nothing is ready to bind"
            body="Quote a submission from an account and it will appear here once it is clear of underwriting."
          />
        ) : null}
      </Section>
    </>
  );
}

function ReferralRow({ item }: { item: WorklistItem }) {
  return (
    <tr className="is-flagged">
      <td className="anchor">
        <Link to={`/jobs/${item.jobId}`} className="row-link">
          <span className="cell-title">{item.accountName}</span>
        </Link>
        <span className="cell-sub mono">{item.accountNumber}</span>
      </td>
      <td>{jobTypeLabel(item.jobType)}</td>
      <td>
        <ul className="stack stack--tight">
          {item.referrals.map((referral) => (
            <li key={referral.ruleCode}>
              <span style={{ display: 'block' }}>{referral.description}</span>
              <span className="cell-sub">{referral.detail}</span>
            </li>
          ))}
        </ul>
      </td>
      <td>
        {date(item.effectiveDate)}
        <span className="cell-sub">{relativeDays(item.effectiveDate)}</span>
      </td>
      <td className="num">
        <Money cents={item.annualPremiumCents} />
      </td>
    </tr>
  );
}
