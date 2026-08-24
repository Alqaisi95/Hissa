/** Thin API client. Errors carry both locales, so the UI never invents wording. */
export interface ApiErrorShape {
  code: string;
  messageAr: string;
  messageEn: string;
  details?: Record<string, unknown>;
  fields?: { path: string; message: string }[];
  correlationId?: string;
}

export class ApiError extends Error {
  status: number;
  payload: ApiErrorShape;
  constructor(status: number, payload: ApiErrorShape) {
    super(payload.messageEn || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

const TOKEN_KEY = 'hissa.token';

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (token: string | null): void => {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

export async function request<T = any>(
  method: string, path: string, body?: unknown, options: { raw?: boolean } = {},
): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (options.raw) {
    if (!response.ok) throw new ApiError(response.status, await safeError(response));
    return response as unknown as T;
  }

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, parsed?.error ?? {
      code: 'unknown', messageAr: 'تعذر إكمال الطلب', messageEn: 'The request could not be completed',
    });
  }
  return parsed as T;
}

async function safeError(response: Response): Promise<ApiErrorShape> {
  try {
    const parsed = JSON.parse(await response.text());
    return parsed.error;
  } catch {
    return { code: 'unknown', messageAr: 'تعذر إكمال الطلب', messageEn: 'The request could not be completed' };
  }
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
};

/** §14 — client funnel events. Never send identifiers or document contents. */
export function trackEvent(name: string, properties: Record<string, string | number | boolean> = {}, poolId?: string): void {
  void fetch('/api/analytics/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify({ name, properties, ...(poolId ? { poolId } : {}) }),
  }).catch(() => { /* analytics must never break a journey */ });
}
