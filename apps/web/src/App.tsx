import { AppShell } from './components/AppShell.tsx';
import { Notice, PageHead } from './components/ui.tsx';
import { useQuery } from './lib/api.ts';
import { Link, matchPath, useRouter } from './lib/router.tsx';
import type { ClaimsWorklist as ClaimsWorklistData, Worklist as WorklistData } from './lib/types.ts';
import { AccountDetail } from './routes/AccountDetail.tsx';
import { Accounts } from './routes/Accounts.tsx';
import { ClaimDetail } from './routes/ClaimDetail.tsx';
import { ClaimsWorklist } from './routes/ClaimsWorklist.tsx';
import { Fnol } from './routes/Fnol.tsx';
import { JobDetail } from './routes/JobDetail.tsx';
import { NewAccount } from './routes/NewAccount.tsx';
import { Policies } from './routes/Policies.tsx';
import { PolicyDetail } from './routes/PolicyDetail.tsx';
import { SignIn } from './routes/SignIn.tsx';
import { SubmissionWizard } from './routes/SubmissionWizard.tsx';
import { Team } from './routes/Team.tsx';
import { Worklist } from './routes/Worklist.tsx';
import { useSession } from './session.tsx';

export function App() {
  const { session } = useSession();
  if (!session) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const { path } = useRouter();
  const { session } = useSession();
  const worklist = useQuery<WorklistData>('/worklist');
  const claims = useQuery<ClaimsWorklistData>('/claims/queues');

  // What needs a decision: payment approvals and overdue diary items.
  const claimsCount =
    (claims.data?.counts.approvals ?? 0) + (claims.data?.counts.overdueDiary ?? 0);

  const nav = [
    { to: '/worklist', label: 'Worklist', count: worklist.data?.counts.referred, flagged: true },
    { to: '/accounts', label: 'Accounts' },
    { to: '/policies', label: 'Policies' },
    { to: '/claims', label: 'Claims', count: claimsCount, flagged: true },
    ...(session?.role === 'admin' ? [{ to: '/team', label: 'Team' }] : []),
  ];

  return <AppShell nav={nav}>{renderRoute(path)}</AppShell>;
}

function renderRoute(path: string) {
  if (path === '/' || path === '/worklist') return <Worklist />;
  if (path === '/accounts') return <Accounts />;
  if (path === '/accounts/new') return <NewAccount />;
  if (path === '/policies') return <Policies />;
  if (path === '/claims') return <ClaimsWorklist />;
  if (path === '/team') return <Team />;

  const submission = matchPath('/accounts/:id/new-submission', path);
  if (submission) return <SubmissionWizard accountId={submission['id']!} />;

  const fnol = matchPath('/policies/:id/fnol', path);
  if (fnol) return <Fnol policyId={fnol['id']!} />;

  const account = matchPath('/accounts/:id', path);
  if (account) return <AccountDetail accountId={account['id']!} />;

  const job = matchPath('/jobs/:id', path);
  if (job) return <JobDetail jobId={job['id']!} />;

  const claim = matchPath('/claims/:id', path);
  if (claim) return <ClaimDetail claimId={claim['id']!} />;

  const policy = matchPath('/policies/:id', path);
  if (policy) return <PolicyDetail policyId={policy['id']!} />;

  return <NotFound path={path} />;
}

function NotFound({ path }: { path: string }) {
  return (
    <>
      <PageHead title="No such page" />
      <section className="section">
        <Notice>
          Nothing is routed at <code className="mono">{path}</code>.{' '}
          <Link to="/worklist" className="link">
            Back to the worklist
          </Link>
          .
        </Notice>
      </section>
    </>
  );
}
