import { useState } from 'react';
import { useQuery } from '../lib/api.ts';
import {
  date,
  jobTypeLabel,
  money,
  lossCauseLabel,
  planLabel,
  planName,
  todayIso,
  transactionLabel,
} from '../lib/format.ts';
import { usePaymentPlans } from '../lib/plans.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type {
  Account,
  ClaimSummary,
  Job,
  LedgerTransaction,
  Policy,
  PolicyBilling,
  PolicyVersion,
} from '../lib/types.ts';
import {
  Button,
  Fact,
  Facts,
  Money,
  Notice,
  PageHead,
  Section,
  Status,
} from '../components/ui.tsx';
import { RiskDetail } from './JobDetail.tsx';
import { BillingSchedule } from './policy/BillingSchedule.tsx';
import { ServicingForm } from './policy/ServicingForm.tsx';

interface PolicyPage {
  policy: Policy;
  account: Account;
  currentVersion: PolicyVersion | null;
  versions: PolicyVersion[];
  transactions: LedgerTransaction[];
  billing: PolicyBilling;
  jobs: Job[];
}

export function PolicyDetail({ policyId }: { policyId: string }) {
  const { navigate } = useRouter();
  const page = useQuery<PolicyPage>(`/policies/${policyId}`);
  const [servicing, setServicing] = useState<'renewal' | 'cancellation' | null>(null);

  // Plan names are carrier configuration, so they are read from the billing
  // catalogue rather than guessed from the code stored on the policy.
  const { plans: catalogue } = usePaymentPlans(
    page.data?.policy.productCode,
    page.data?.account.address.province,
  );

  if (page.error) {
    return (
      <>
        <PageHead title="Policy" />
        <Notice tone="error">{page.error.message}</Notice>
      </>
    );
  }

  const { policy, account, currentVersion, billing } = page.data ?? {};
  const inForce = policy?.status === 'InForce';

  return (
    <>
      <PageHead
        eyebrow={
          account ? (
            <Link to={`/accounts/${account.id}`} className="link">
              {account.name}
            </Link>
          ) : null
        }
        title={<span className="mono">{policy?.policyNumber ?? 'Loading…'}</span>}
        meta={
          policy ? (
            <>
              <Status value={policy.status} />
              <span>{policy.productCode}</span>
              {currentVersion ? (
                <span>
                  Term {currentVersion.termNumber}: {date(currentVersion.termStart)} →{' '}
                  {date(currentVersion.termEnd)}
                </span>
              ) : null}
              <span>{planName(policy.billingPlan, catalogue)}</span>
            </>
          ) : null
        }
        actions={
          policy ? (
            <>
              <Button variant="secondary" onClick={() => navigate(`/policies/${policyId}/fnol`)}>
                Report a claim
              </Button>
              {inForce ? (
                <>
              <Button
                variant="secondary"
                onClick={() => setServicing(servicing === 'renewal' ? null : 'renewal')}
                aria-expanded={servicing === 'renewal'}
              >
                Renew
              </Button>
              <Button
                variant="danger"
                onClick={() => setServicing(servicing === 'cancellation' ? null : 'cancellation')}
                aria-expanded={servicing === 'cancellation'}
              >
                Cancel policy
              </Button>
                </>
              ) : null}
            </>
          ) : null
        }
      />

      {servicing ? (
        <Section>
          <ServicingForm
            kind={servicing}
            policyId={policyId}
            termEnd={currentVersion?.termEnd ?? todayIso()}
            onCancel={() => setServicing(null)}
            onCreated={(jobId) => navigate(`/jobs/${jobId}`)}
          />
        </Section>
      ) : null}

      <Section>
        <Facts>
          <Fact label="Annual premium" lead>
            {currentVersion ? money(currentVersion.annualPremiumCents) : '—'}
          </Fact>
          <Fact label="Balance" lead>
            {billing ? <Money cents={billing.balanceCents} balance /> : '—'}
          </Fact>
          <Fact label="Next due">
            {billing?.nextDue ? (
              <>
                {date(billing.nextDue.dueDate)}
                <span className="cell-sub">{money(billing.nextDue.amountCents)}</span>
              </>
            ) : (
              'Nothing outstanding'
            )}
          </Fact>
          <Fact label="Past due">
            {billing && billing.pastDueCents > 0 ? (
              <Money cents={billing.pastDueCents} />
            ) : (
              'Nothing overdue'
            )}
          </Fact>
        </Facts>
      </Section>

      <Section
        title="Billing schedule"
        note={billing ? planLabel(billing.plan, catalogue) : undefined}
      >
        <BillingSchedule billing={billing} />
        {account ? (
          <p className="section__note" style={{ marginTop: 'var(--s-4)' }}>
            Payments are recorded against the{' '}
            <Link to={`/accounts/${account.id}`} className="link">
              account
            </Link>
            , since one payment can settle invoices across several policies.
          </p>
        ) : null}
      </Section>

      <Section title="Transaction history" note="Every financial movement on this policy, in order.">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Transaction</th>
                <th scope="col">Effective</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {page.data?.transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="anchor">
                    <Link to={`/jobs/${tx.jobId}`} className="row-link">
                      <span className="cell-title">{transactionLabel(tx.type)}</span>
                    </Link>
                    <span className="cell-sub">Recorded {date(tx.createdAt)}</span>
                  </td>
                  <td className="date">{date(tx.effectiveDate)}</td>
                  <td className="num">
                    <Money cents={tx.amountCents} delta />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} className="total-label">
                  Written premium
                </th>
                <td className="num">
                  <strong>
                    <Money
                      cents={(page.data?.transactions ?? []).reduce((s, t) => s + t.amountCents, 0)}
                    />
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <PolicyClaims policyId={policyId} />

      <Section title="Versions" note="Each issued transaction leaves a snapshot that is never edited.">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col" className="num">
                  Version
                </th>
                <th scope="col">Reason</th>
                <th scope="col">Effective</th>
                <th scope="col">Term</th>
                <th scope="col" className="num">
                  Annual premium
                </th>
              </tr>
            </thead>
            <tbody>
              {page.data?.versions.map((version) => (
                <tr key={version.id}>
                  <td className="num">{version.versionNumber}</td>
                  <td>{transactionLabel(version.transactionType)}</td>
                  <td className="date">{date(version.effectiveDate)}</td>
                  <td>
                    Term {version.termNumber}
                    <span className="cell-sub">
                      {date(version.termStart)} → {date(version.termEnd)}
                    </span>
                  </td>
                  <td className="num">
                    <Money cents={version.annualPremiumCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {page.data?.jobs.length ? (
        <Section title="Work on this policy">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Effective</th>
                </tr>
              </thead>
              <tbody>
                {page.data.jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="anchor">
                      <Link to={`/jobs/${job.id}`} className="row-link">
                        <span className="cell-title">{jobTypeLabel(job.jobType)}</span>
                      </Link>
                    </td>
                    <td>
                      <Status value={job.status} />
                    </td>
                    <td className="date">{date(job.effectiveDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {currentVersion ? <RiskDetail risk={currentVersion.risk} /> : null}
    </>
  );
}

function PolicyClaims({ policyId }: { policyId: string }) {
  const claims = useQuery<{ claims: ClaimSummary[] }>(`/claims?policyId=${policyId}`);
  if (!claims.data || claims.data.claims.length === 0) return null;
  return (
    <Section title="Claims" note="Losses reported against this policy.">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Claim</th>
              <th scope="col">Loss date</th>
              <th scope="col">Cause</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Incurred
              </th>
            </tr>
          </thead>
          <tbody>
            {claims.data.claims.map((claim) => (
              <tr key={claim.id}>
                <td>
                  <Link to={`/claims/${claim.id}`} className="link mono">
                    {claim.claimNumber}
                  </Link>
                </td>
                <td className="date">{date(claim.lossDate)}</td>
                <td>{lossCauseLabel(claim.lossCause)}</td>
                <td>
                  <Status value={claim.status} />
                </td>
                <td className="num">
                  <Money cents={claim.incurredCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
