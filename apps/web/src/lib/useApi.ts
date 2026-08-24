import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api.ts';

interface QueryState<T> { data: T | null; loading: boolean; error: ApiError | null }

/** Small data-fetching hook: enough for this app, no external dependency. */
export function useQuery<T = any>(path: string | null, deps: unknown[] = []): QueryState<T> & { reload: () => void } {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: Boolean(path), error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    api.get<T>(path)
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((error: ApiError) => { if (!cancelled) setState({ data: null, loading: false, error }); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { ...state, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

/** Wraps a mutation with pending/error state so forms stay honest about failures. */
export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(async (...args: TArgs): Promise<TResult | null> => {
    setPending(true); setError(null);
    try {
      return await fn(...args);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught
        : new ApiError(0, { code: 'network', messageAr: 'تعذر الاتصال بالخادم', messageEn: 'Could not reach the server' }));
      return null;
    } finally {
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn]);

  return { run, pending, error, clearError: useCallback(() => setError(null), []) };
}
