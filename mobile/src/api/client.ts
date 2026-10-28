import { resolveApiUrl } from '../config';

export type Session = { accessToken: string; refreshToken: string };
export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(public reason: 'offline' | 'timeout' | 'config', message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

type SessionHandlers = {
  /** Persist rotated tokens. */
  onTokensRefreshed?: (session: Session) => Promise<void> | void;
  /** Refresh failed: the session is gone and the user must sign in again. */
  onSessionExpired?: () => void;
};

let session: Session | null = null;
let handlers: SessionHandlers = {};
let refreshInFlight: Promise<boolean> | null = null;

export function configureSessionHandlers(next: SessionHandlers) { handlers = next; }
export function setSession(next: Session | null) { session = next; }
export function getSession() { return session; }

/** Identifies one attempt of a request so the server can recognise a retry (sent as the Idempotency-Key header). */
export function newIdempotencyKey() {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const TIMEOUT_MS = 15000;

type RequestOptions = { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number; headers?: Record<string, string> };

async function send(path: string, { method = 'GET', body, timeoutMs = TIMEOUT_MS, headers }: RequestOptions, accessToken?: string) {
  let base: string;
  try { base = resolveApiUrl(); }
  catch (e) { throw new NetworkError('config', (e as Error).message); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = undefined;
    if (text) { try { data = JSON.parse(text); } catch { data = undefined; } }
    return { status: response.status, ok: response.ok, data };
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'AbortError') throw new NetworkError('timeout', 'Request timed out');
    throw new NetworkError('offline', 'Network request failed');
  } finally {
    clearTimeout(timer);
  }
}

function toApiError(status: number, data: any): ApiError {
  const detail = typeof data?.detail === 'string' ? data.detail : `Request failed (${status})`;
  const code = typeof data?.code === 'string' ? data.code : status >= 500 ? 'server_error' : 'error';
  return new ApiError(status, code, detail, Array.isArray(data?.errors) ? data.errors : []);
}

/** Rotate tokens once, sharing the in-flight refresh between concurrent callers (the server treats reuse as theft). */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const current = session;
      if (!current) return false;
      const res = await send('/api/auth/refresh', { method: 'POST', body: { refresh_token: current.refreshToken } });
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) return false;
        throw toApiError(res.status, res.data);
      }
      const next = { accessToken: res.data.access_token, refreshToken: res.data.refresh_token };
      session = next;
      await handlers.onTokensRefreshed?.(next);
      return true;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function apiRequest<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const usedToken = options.auth ? session?.accessToken : undefined;
  let res = await send(path, options, usedToken);
  if (res.status === 401 && options.auth && session) {
    // Another request may already have rotated the tokens while this one was in flight.
    const renewed = session.accessToken !== usedToken || await refreshSession();
    if (!renewed) {
      session = null;
      handlers.onSessionExpired?.();
      throw new ApiError(401, 'session_expired', 'Session expired');
    }
    res = await send(path, options, session?.accessToken);
  }
  if (!res.ok) throw toApiError(res.status, res.data);
  return res.data as T;
}
