import { useEffect, useState } from 'react';
import { useQuery } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import type { Account, AccountRollup } from '../lib/types.ts';
import {
  Button,
  Empty,
  Field,
  Money,
  Notice,
  PageHead,
  Status,
  TableSkeleton,
  TextInput,
} from '../components/ui.tsx';

type AccountRow = Account & { rollup: AccountRollup };

export function Accounts() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(term.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [term]);

  const { data, error, loading } = useQuery<{ accounts: AccountRow[] }>(
    query ? `/accounts?q=${encodeURIComponent(query)}` : '/accounts',
  );

  const accounts = data?.accounts ?? [];

  return (
    <>
      <PageHead
        title="Accounts"
        meta={data ? <span>{accounts.length} on file</span> : null}
        actions={
          <Link to="/accounts/new" className="btn btn--primary">
            New account
          </Link>
        }
      />

      <section className="section">
        <div style={{ maxWidth: '28rem', marginBottom: 'var(--s-6)' }}>
          <Field label="Search" hint="Name, account number, city or email.">
            {(props) => (
              <TextInput
                {...props}
                type="search"
                value={term}
                placeholder="Okonkwo, ACME-A0002, Toronto…"
                onChange={(event) => setTerm(event.target.value)}
              />
            )}
          </Field>
        </div>

        {error ? <Notice tone="error">{error.message}</Notice> : null}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Location</th>
                <th scope="col" className="num">
                  Policies
                </th>
                <th scope="col" className="num">
                  Premium in force
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
                <th scope="col">Standing</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton columns={6} />
            ) : (
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="anchor">
                      <Link to={`/accounts/${account.id}`} className="row-link">
                        <span className="cell-title">{account.name}</span>
                      </Link>
                      <span className="cell-sub mono">{account.accountNumber}</span>
                    </td>
                    <td>
                      {account.address.city}, {account.address.province}
                      <span className="cell-sub mono">{account.address.postalCode}</span>
                    </td>
                    <td className="num">{account.rollup.inForceCount}</td>
                    <td className="num">
                      <Money cents={account.rollup.annualPremiumCents} />
                    </td>
                    <td className="num">
                      <Money cents={account.rollup.balanceCents} balance />
                    </td>
                    <td>
                      {account.rollup.pastDueCents > 0 ? (
                        <Status value="overdue" label="Past due" />
                      ) : account.rollup.balanceCents < 0 ? (
                        <Status value="credit" label="In credit" />
                      ) : account.rollup.policyCount === 0 ? (
                        <Status value="none" label="No policies" />
                      ) : (
                        <Status value="paid" label="Up to date" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {!loading && accounts.length === 0 ? (
          query ? (
            <Empty
              title={`Nothing matches "${query}"`}
              body="Search covers the account name, its number, the city and the email on file."
              action={
                <Button onClick={() => setTerm('')} variant="secondary">
                  Clear search
                </Button>
              }
            />
          ) : (
            <Empty
              title="No accounts yet"
              body="An account is the customer of record. Create one, then start a submission from it."
              action={
                <Link to="/accounts/new" className="btn btn--primary">
                  New account
                </Link>
              }
            />
          )
        ) : null}
      </section>
    </>
  );
}
