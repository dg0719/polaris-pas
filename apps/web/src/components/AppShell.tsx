import type { ReactNode } from 'react';
import { Link, useRouter } from '../lib/router.tsx';
import { useSession } from '../session.tsx';
import { roleLabel } from '../lib/format.ts';
import { Button } from './ui.tsx';

interface NavItem {
  to: string;
  label: string;
  count?: number;
  flagged?: boolean;
}

export function AppShell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { path } = useRouter();
  const { session, signOut } = useSession();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="rail-col">
        <nav className="rail" aria-label="Primary">
          <div className="rail__mark">
            <span className="rail__wordmark">Polaris</span>
          </div>

        <ul className="rail__nav">
          {nav.map((item) => {
            const current = path === item.to || path.startsWith(`${item.to}/`);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="rail__link"
                  aria-current={current ? 'page' : undefined}
                >
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 ? (
                    <span className={`rail__count${item.flagged ? ' rail__count--flag' : ''}`}>
                      {item.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="rail__foot">
          <div className="rail__user">
            <span>{session?.name}</span>
            <span className="rail__role">{session ? roleLabel(session.role) : null}</span>
            {session?.tenantName ? (
              <span className="rail__tenant-name">{session.tenantName}</span>
            ) : null}
          </div>
          <Button variant="ghost" onClick={signOut} style={{ alignSelf: 'flex-start' }}>
            Sign out
          </Button>
          </div>
        </nav>
      </div>

      <main className="main" id="main">
        <div className="main__inner">{children}</div>
      </main>
    </div>
  );
}
