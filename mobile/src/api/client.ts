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
// Changes when a session starts or ends, not when its tokens rotate: whatever was on its way for an earlier one is over.
let generation = 0;
// A refresh with no answer: the server may have rotated this token without the app hearing. The next try says so.
let lostRefresh: { token: string; key: string } | null = null;

export function configureSessionHandlers(next: SessionHandlers) { handlers = next; }
export function setSession(next: Session | null) {
  session = next;
  generation += 1;
  refreshInFlight = null;
  lostRefresh = null;
}
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
    const flight: Promise<boolean> = (async () => {
      const current = session;
      const started = generation;
      if (!current) return false;
      const retryKey = lostRefresh?.token === current.refreshToken ? lostRefresh.key : undefined;
      let res: Awaited<ReturnType<typeof send>>;
      try {
        res = await send('/api/auth/refresh', { method: 'POST', body: { refresh_token: current.refreshToken },
          headers: retryKey ? { 'Idempotency-Key': retryKey } : undefined });
      } catch (e) {
        if (started === generation) lostRefresh = { token: current.refreshToken, key: retryKey ?? newIdempotencyKey() };
        throw e;
      }
      // Signed out, or into another account, while this was on its way: these tokens belong to a session that is over.
      if (started !== generation) return false;
      lostRefresh = null;
      if (!res.ok) {
        if (res.status === 400 || res.status === 401 || res.status === 403) return false;
        throw toApiError(res.status, res.data);
      }
      const next = { accessToken: res.data.access_token, refreshToken: res.data.refresh_token };
      session = next;
      await handlers.onTokensRefreshed?.(next);
      return true;
    })().finally(() => { if (refreshInFlight === flight) refreshInFlight = null; });
    refreshInFlight = flight;
  }
  return refreshInFlight;
}

const sessionEnded = () => new ApiError(401, 'session_expired', 'Session expired');

export async function apiRequest<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const started = generation;
  // An answer for a session that has ended never reaches its caller, and is never retried as the session after it.
  const outdated = () => !!options.auth && started !== generation;
  try {
    const usedToken = options.auth ? session?.accessToken : undefined;
    let res = await send(path, options, usedToken);
    if (outdated()) throw sessionEnded();
    if (res.status === 401 && options.auth && session) {
      // Another request may already have rotated the tokens while this one was in flight.
      const renewed = session.accessToken !== usedToken || await refreshSession();
      if (outdated()) throw sessionEnded();
      if (!renewed) {
        setSession(null);
        handlers.onSessionExpired?.();
        throw sessionEnded();
      }
      res = await send(path, options, session?.accessToken);
      if (outdated()) throw sessionEnded();
    }
    if (!res.ok) throw toApiError(res.status, res.data);
    return res.data as T;
  } catch (e) {
    throw outdated() ? sessionEnded() : e;
  }
}
