import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request, setApiKey } from './lib/api.ts';
import type { Role } from './lib/types.ts';

export interface Session {
  apiKey: string;
  name: string;
  role: Role;
  tenantName: string;
}

const STORAGE_KEY = 'polaris.session';

interface SessionValue {
  session: Session | null;
  signIn: (session: Session) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function readStored(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStored);

  // The api module holds the key, so every request picks it up without prop drilling.
  setApiKey(session?.apiKey ?? null);

  useEffect(() => {
    if (!session) return;
    // A key from a previous seed will not exist after a reseed; drop it quietly.
    request('/me').catch(() => {
      window.localStorage.removeItem(STORAGE_KEY);
      setApiKey(null);
      setSession(null);
    });
  }, [session]);

  const value = useMemo<SessionValue>(
    () => ({
      session,
      signIn: (next) => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setApiKey(next.apiKey);
        setSession(next);
      },
      signOut: () => {
        window.localStorage.removeItem(STORAGE_KEY);
        setApiKey(null);
        setSession(null);
      },
    }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
