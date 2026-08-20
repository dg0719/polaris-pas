import { useCallback, useEffect, useRef, useState } from 'react';

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let apiKey: string | null = null;

export function setApiKey(key: string | null): void {
  apiKey = key;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the Polaris API. Is it running?');
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? 'error',
      error?.message ?? `Request failed with ${response.status}`,
    );
  }
  return payload as T;
}

export interface Query<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch on mount and whenever `path` changes. Stale responses are discarded. */
export function useQuery<T>(path: string | null): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const ticket = ++latest.current;
    setLoading(true);
    request<T>(path)
      .then((result) => {
        if (ticket !== latest.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (ticket !== latest.current) return;
        setError(err instanceof ApiError ? err : new ApiError(0, 'error', String(err)));
      })
      .finally(() => {
        if (ticket === latest.current) setLoading(false);
      });
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export interface Mutation<TArgs, TResult> {
  run: (args: TArgs) => Promise<TResult | null>;
  pending: boolean;
  error: ApiError | null;
  reset: () => void;
}

/** A single in-flight write with its own pending and error state. */
export function useMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): Mutation<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const callback = useRef(fn);
  callback.current = fn;

  const run = useCallback(async (args: TArgs) => {
    setPending(true);
    setError(null);
    try {
      return await callback.current(args);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', String(err)));
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, reset: () => setError(null) };
}
