import { useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import { roleLabel } from '../lib/format.ts';
import type { DemoCredential, Role } from '../lib/types.ts';
import { useSession } from '../session.tsx';
import { Button, Field, Notice, TextInput } from '../components/ui.tsx';

interface LoginResponse {
  token: string;
  user: { id: string; name: string; role: Role; tenantName: string };
}

/** What a first-time viewer is actually looking at, stated plainly. */
const WHATS_HERE = [
  {
    term: 'One product',
    detail: 'Ontario personal auto: OAP 1 coverages, OPCF endorsements, territory by postal code.',
  },
  {
    term: 'Four job types',
    detail: 'Submission, mid-term change, renewal and cancellation, on one guarded lifecycle.',
  },
  {
    term: 'Underwriting referrals',
    detail: 'Rules fire at quote time and block bind until an underwriter accepts the risk.',
  },
  {
    term: 'Installment billing',
    detail: 'Schedules, invoices and payments that re-spread when the premium moves.',
  },
  {
    term: 'Two tenants',
    detail: 'Acme and Northstar share the deployment and can see nothing of each other.',
  },
];

export function SignIn() {
  const { signIn } = useSession();
  const hints = useQuery<{ credentials: DemoCredential[] }>('/demo/credentials');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation<{ username: string; password: string }, LoginResponse>((body) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body }),
  );

  async function submit() {
    const result = await login.run({ username: username.trim(), password });
    if (!result) return;
    signIn({
      apiKey: result.token,
      userId: result.user.id,
      name: result.user.name,
      role: result.user.role,
      tenantName: result.user.tenantName,
    });
  }

  const unreachable = login.error?.status === 0 || hints.error?.status === 0;

  return (
    <div className="signin">
      <div className="signin__brand">
        <div>
          <h1 className="signin__title">Polaris</h1>
          <p className="signin__lede">
            Policy administration for Ontario personal auto. Quote, refer, bind, endorse, renew and
            bill, with every version of the record kept.
          </p>
        </div>

        <dl className="signin__facts">
          {WHATS_HERE.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>

        <p className="signin__note">
          Rates and underwriting rules in this build are illustrative samples, not filed rates.
          Coverage codes and OPCF endorsement numbers follow the public Ontario structure.
        </p>
      </div>

      <div className="signin__panel">
        <form
          className="signin__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <h2>Sign in</h2>
            <p className="section__note" style={{ marginTop: 'var(--s-2)' }}>
              Your role decides what you can do. Only an underwriter can accept a referred risk.
            </p>
          </div>

          {unreachable ? (
            <Notice tone="error">
              The API is not answering on port 3000. Start it with{' '}
              <code className="mono">npm run dev:api</code>.
            </Notice>
          ) : login.error ? (
            <Notice tone="error">{login.error.message}</Notice>
          ) : null}

          <Field label="Username">
            {(props) => (
              <TextInput
                {...props}
                value={username}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                onChange={(event) => setUsername(event.target.value)}
              />
            )}
          </Field>

          <Field label="Password">
            {(props) => (
              <TextInput
                {...props}
                type="password"
                value={password}
                autoComplete="current-password"
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            loading={login.pending}
            disabled={username.trim() === '' || password === ''}
          >
            Sign in
          </Button>
        </form>

        {hints.data?.credentials.length ? (
          <div className="signin__hint">
            <p className="signin__hint-lead">Demo logins, one per role:</p>
            <dl className="signin__hint-list">
              {hints.data.credentials.map((credential) => (
                <div key={credential.username}>
                  <dt>{roleLabel(credential.role)}</dt>
                  <dd className="mono">
                    {credential.username} / {credential.password}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="signin__hint-lead">
              Shown because this build runs with POLARIS_DEMO=1.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
