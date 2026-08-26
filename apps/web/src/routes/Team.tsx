import { useState } from 'react';
import { request, useMutation, useQuery } from '../lib/api.ts';
import { money, roleLabel } from '../lib/format.ts';
import type { Role } from '../lib/types.ts';
import {
  Button,
  Empty,
  Field,
  Notice,
  PageHead,
  Section,
  Select,
  TextInput,
  Toast,
} from '../components/ui.tsx';
import { useSession } from '../session.tsx';

interface TeamUser {
  id: string;
  username: string;
  email: string;
  name: string;
  role: Role;
  authorityLimitCents: number;
}

const ROLES: Role[] = ['csr', 'underwriter', 'adjuster', 'claims_supervisor', 'admin'];
const CLAIMS_ROLES = new Set<Role>(['adjuster', 'claims_supervisor', 'admin']);

const ROLE_NOTES: Record<Role, string> = {
  csr: 'Creates accounts and submissions, services policies, records payments.',
  underwriter: 'Decides referred risks; nothing referred binds without them.',
  adjuster: 'Works claims: reserves, payments within their authority, diary.',
  claims_supervisor: 'Approves claim payments above an adjuster’s authority.',
  admin: 'Everything, including this screen.',
};

/** Admin-only: how sign-ins come to exist after the first start. */
export function Team() {
  const { session } = useSession();
  const users = useQuery<{ users: TeamUser[] }>('/users');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (session?.role !== 'admin') {
    return (
      <>
        <PageHead title="Team" />
        <Notice tone="error">Only an admin can manage the team.</Notice>
      </>
    );
  }

  function done(message: string) {
    setAdding(false);
    setResetting(null);
    setToast(message);
    setTimeout(() => setToast(null), 4000);
    users.reload();
  }

  return (
    <>
      <PageHead
        title="Team"
        meta={users.data ? <span>{users.data.users.length} people</span> : null}
        actions={
          <Button variant="primary" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            Add a person
          </Button>
        }
      />

      {users.error ? <Notice tone="error">{users.error.message}</Notice> : null}

      {adding ? <CreateForm onDone={done} /> : null}

      <Section
        title="People"
        note="Each person signs in with their own username; their role decides what they can do."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Username</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col" className="num">
                  Payment authority
                </th>
                <th scope="col" className="num">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data?.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td className="mono">{user.username}</td>
                  <td>{user.email}</td>
                  <td>{roleLabel(user.role)}</td>
                  <td className="num">
                    {CLAIMS_ROLES.has(user.role) ? money(user.authorityLimitCents) : '—'}
                  </td>
                  <td className="num">
                    <Button
                      variant="ghost"
                      onClick={() => setResetting(resetting === user.id ? null : user.id)}
                      aria-expanded={resetting === user.id}
                    >
                      Reset password
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!users.loading && users.data?.users.length === 0 ? (
          <Empty title="Nobody here yet" body="Add the first person with the button above." />
        ) : null}
      </Section>

      {resetting && users.data ? (
        <ResetForm user={users.data.users.find((u) => u.id === resetting)!} onDone={done} />
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </>
  );
}

function CreateForm({ onDone }: { onDone: (message: string) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('csr');
  const [password, setPassword] = useState('');
  const [authority, setAuthority] = useState('');

  const create = useMutation<void, unknown>(() =>
    request('/users', {
      method: 'POST',
      body: {
        name,
        username,
        email,
        role,
        password,
        authorityLimitCents: CLAIMS_ROLES.has(role)
          ? Math.round(Number(authority || '0') * 100)
          : 0,
      },
    }),
  );

  const valid =
    name.trim() !== '' &&
    username.trim().length >= 3 &&
    email.trim() !== '' &&
    password.length >= 8;

  return (
    <Section title="Add a person">
      <form
        className="stack"
        style={{ maxWidth: '44rem' }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid) return;
          if ((await create.run()) !== null) onDone(`${name} can now sign in as ${username}`);
        }}
      >
        {create.error ? <Notice tone="error">{create.error.message}</Notice> : null}
        <div className="form-grid">
          <Field label="Full name">
            {(props) => (
              <TextInput {...props} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Username" hint="What they type to sign in. Letters, numbers, dots.">
            {(props) => (
              <TextInput
                {...props}
                value={username}
                autoCapitalize="none"
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>
          <Field label="Email">
            {(props) => (
              <TextInput
                {...props}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Role" hint={ROLE_NOTES[role]}>
            {(props) => (
              <Select {...props} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Password" hint="At least 8 characters. They should change it — via you, for now.">
            {(props) => (
              <TextInput
                {...props}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {CLAIMS_ROLES.has(role) ? (
            <Field
              label="Payment authority ($)"
              hint="The largest claim payment they can authorize alone."
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min="0"
                  step="100"
                  value={authority}
                  onChange={(e) => setAuthority(e.target.value)}
                />
              )}
            </Field>
          ) : null}
        </div>
        <div className="btn-row">
          <Button variant="primary" type="submit" loading={create.pending} disabled={!valid}>
            Create sign-in
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ResetForm({ user, onDone }: { user: TeamUser; onDone: (message: string) => void }) {
  const [password, setPassword] = useState('');
  const reset = useMutation<void, unknown>(() =>
    request(`/users/${user.id}/password`, { method: 'POST', body: { password } }),
  );

  return (
    <Section title={`Reset ${user.name}'s password`}>
      <form
        className="stack"
        style={{ maxWidth: '28rem' }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (password.length < 8) return;
          if ((await reset.run()) !== null) onDone(`Password changed for ${user.username}`);
        }}
      >
        {reset.error ? <Notice tone="error">{reset.error.message}</Notice> : null}
        <Field label="New password" hint="At least 8 characters. Their old password stops working immediately.">
          {(props) => (
            <TextInput
              {...props}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="btn-row">
          <Button
            variant="primary"
            type="submit"
            loading={reset.pending}
            disabled={password.length < 8}
          >
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}
