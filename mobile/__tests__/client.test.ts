import { ApiError, apiRequest, configureSessionHandlers, getSession, NetworkError, setSession } from '../src/api/client';
import { resolveApiUrl } from '../src/config';
import { validateEmail, validateNewPassword } from '../src/auth/validation';
import { deferred, mockServer, networkDown, tokens } from '../test/mockServer';

beforeEach(() => {
  setSession({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token });
  configureSessionHandlers({});
});

it('shares one refresh between concurrent 401s (no refresh-token replay)', async () => {
  const server = mockServer({
    'GET /api/a': (req) => (req.headers.Authorization === 'Bearer access-2' ? { status: 200, body: 'a' } : { status: 401, body: {} }),
    'GET /api/b': (req) => (req.headers.Authorization === 'Bearer access-2' ? { status: 200, body: 'b' } : { status: 401, body: {} }),
    'POST /api/auth/refresh': { status: 200, body: tokens(2) },
  });
  const saved: unknown[] = [];
  configureSessionHandlers({ onTokensRefreshed: (s) => { saved.push(s); } });
  await expect(Promise.all([apiRequest('/api/a', { auth: true }), apiRequest('/api/b', { auth: true })])).resolves.toEqual(['a', 'b']);
  expect(server.callsTo('POST /api/auth/refresh')).toHaveLength(1);
  expect(saved).toEqual([{ accessToken: 'access-2', refreshToken: tokens(2).refresh_token }]);
});

it('signals session expiry when refresh is rejected', async () => {
  mockServer({ 'GET /api/a': { status: 401, body: {} }, 'POST /api/auth/refresh': { status: 401, body: {} } });
  const expired = jest.fn();
  configureSessionHandlers({ onSessionExpired: expired });
  await expect(apiRequest('/api/a', { auth: true })).rejects.toMatchObject({ code: 'session_expired' });
  expect(expired).toHaveBeenCalledTimes(1);
  expect(getSession()).toBeNull();
});

it('does not end the session when refresh fails because of the network', async () => {
  mockServer({ 'GET /api/a': { status: 401, body: {} }, 'POST /api/auth/refresh': networkDown() });
  const expired = jest.fn();
  configureSessionHandlers({ onSessionExpired: expired });
  await expect(apiRequest('/api/a', { auth: true })).rejects.toBeInstanceOf(NetworkError);
  expect(expired).not.toHaveBeenCalled();
  expect(getSession()).not.toBeNull();
});

describe('a refresh whose answer was lost', () => {
  it('says it is a retry the next time, so the server can tell it from a replay', async () => {
    let down = true;
    const server = mockServer({ 'GET /api/a': (req) => (req.headers.Authorization === 'Bearer access-2' ? { status: 200, body: 'a' } : { status: 401, body: {} }),
      'POST /api/auth/refresh': () => (down ? networkDown() : { status: 200, body: tokens(2) }) });
    await expect(apiRequest('/api/a', { auth: true })).rejects.toBeInstanceOf(NetworkError);
    down = false;
    await expect(apiRequest('/api/a', { auth: true })).resolves.toBe('a');
    const [first, second] = server.callsTo('POST /api/auth/refresh');
    expect(first.headers['Idempotency-Key']).toBeUndefined();
    expect(second.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('asks plainly again once a refresh has been answered', async () => {
    let round = 0;
    const server = mockServer({ 'GET /api/a': (req) => (req.headers.Authorization === 'Bearer access-3' ? { status: 200, body: 'a' } : { status: 401, body: {} }),
      'POST /api/auth/refresh': () => { round += 1; return round === 1 ? networkDown() : { status: 200, body: tokens(round) }; } });
    await expect(apiRequest('/api/a', { auth: true })).rejects.toBeInstanceOf(NetworkError);
    await apiRequest('/api/a', { auth: true }).catch(() => {}); // retry answered with access-2, which /api/a still refuses
    await apiRequest('/api/a', { auth: true }).catch(() => {});
    const calls = server.callsTo('POST /api/auth/refresh');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[2].headers['Idempotency-Key']).toBeUndefined();
  });

  it('does not call another session\'s refresh a retry', async () => {
    let down = true;
    const server = mockServer({ 'GET /api/a': (req) => (req.headers.Authorization === 'Bearer access-3' ? { status: 200, body: 'a' } : { status: 401, body: {} }),
      'POST /api/auth/refresh': () => (down ? networkDown() : { status: 200, body: tokens(3) }) });
    await expect(apiRequest('/api/a', { auth: true })).rejects.toBeInstanceOf(NetworkError);
    setSession({ accessToken: 'access-2', refreshToken: tokens(2).refresh_token });
    down = false;
    await expect(apiRequest('/api/a', { auth: true })).resolves.toBe('a');
    expect(server.callsTo('POST /api/auth/refresh')[1].headers['Idempotency-Key']).toBeUndefined();
  });
});

describe('a session that ended while requests were on their way', () => {
  it('a refresh answered after logout neither restores nor saves the session', async () => {
    const answer = deferred<any>();
    mockServer({ 'GET /api/a': { status: 401, body: {} }, 'POST /api/auth/refresh': () => answer.promise });
    const saved = jest.fn();
    const expired = jest.fn();
    configureSessionHandlers({ onTokensRefreshed: saved, onSessionExpired: expired });
    const pending = apiRequest('/api/a', { auth: true });
    await new Promise((r) => setTimeout(r));
    setSession(null); // logout
    answer.resolve({ status: 200, body: tokens(2) });
    await expect(pending).rejects.toMatchObject({ code: 'session_expired' });
    expect(getSession()).toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
  });

  it('a refresh answered after another account signed in leaves that account alone', async () => {
    const answer = deferred<any>();
    const server = mockServer({ 'GET /api/a': { status: 401, body: {} }, 'POST /api/auth/refresh': () => answer.promise });
    const saved = jest.fn();
    const expired = jest.fn();
    configureSessionHandlers({ onTokensRefreshed: saved, onSessionExpired: expired });
    const pending = apiRequest('/api/a', { auth: true });
    await new Promise((r) => setTimeout(r));
    const b = { accessToken: 'access-b', refreshToken: 'refresh-token-b-0123456789abcdef' };
    setSession(b);
    answer.resolve({ status: 200, body: tokens(2) });
    await expect(pending).rejects.toMatchObject({ code: 'session_expired' });
    expect(getSession()).toEqual(b);
    expect(saved).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
    expect(server.calls.filter((c) => c.headers.Authorization === 'Bearer access-b')).toEqual([]);
  });

  it('a new session never shares the old session\'s refresh', async () => {
    const answerA = deferred<any>();
    const server = mockServer({
      'GET /api/a': (req) => (req.headers.Authorization === 'Bearer access-3' ? { status: 200, body: 'b data' } : { status: 401, body: {} }),
      'POST /api/auth/refresh': (req) => (req.body.refresh_token === tokens(1).refresh_token ? answerA.promise : { status: 200, body: tokens(3) }),
    });
    const expired = jest.fn();
    configureSessionHandlers({ onSessionExpired: expired });
    const a = apiRequest('/api/a', { auth: true });
    await new Promise((r) => setTimeout(r));
    setSession({ accessToken: 'access-2', refreshToken: tokens(2).refresh_token });
    await expect(apiRequest('/api/a', { auth: true })).resolves.toBe('b data');
    answerA.resolve({ status: 401, body: {} });
    await expect(a).rejects.toMatchObject({ code: 'session_expired' });
    expect(expired).not.toHaveBeenCalled();
    expect(getSession()?.accessToken).toBe('access-3');
    expect(server.callsTo('POST /api/auth/refresh')).toHaveLength(2);
  });

  it('a 401 for the old session is never retried with the new session\'s token', async () => {
    const answer = deferred<any>();
    const server = mockServer({ 'POST /api/x': () => answer.promise });
    const pending = apiRequest('/api/x', { method: 'POST', auth: true });
    await new Promise((r) => setTimeout(r));
    setSession({ accessToken: 'access-b', refreshToken: 'refresh-token-b-0123456789abcdef' });
    answer.resolve({ status: 401, body: {} });
    await expect(pending).rejects.toMatchObject({ code: 'session_expired' });
    expect(server.callsTo('POST /api/x')).toHaveLength(1);
  });

  it('an answer for the old session never reaches its caller', async () => {
    const answer = deferred<any>();
    mockServer({ 'GET /api/dashboard': () => answer.promise });
    const pending = apiRequest('/api/dashboard', { auth: true });
    await new Promise((r) => setTimeout(r));
    setSession(null);
    answer.resolve({ status: 200, body: { user: { id: 1 } } });
    await expect(pending).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('requests that need no session are not affected', async () => {
    const answer = deferred<any>();
    mockServer({ 'POST /api/auth/logout': () => answer.promise });
    const pending = apiRequest('/api/auth/logout', { method: 'POST', body: {} });
    await new Promise((r) => setTimeout(r));
    setSession(null);
    answer.resolve({ status: 204 });
    await expect(pending).resolves.toBeUndefined();
  });

  it('a rotation of the same session is not a session change', async () => {
    const answer = deferred<any>();
    mockServer({ 'GET /api/slow': () => answer.promise, 'GET /api/a': (req) => (req.headers.Authorization === 'Bearer access-2' ? { status: 200, body: 'a' } : { status: 401, body: {} }),
      'POST /api/auth/refresh': { status: 200, body: tokens(2) } });
    const slow = apiRequest('/api/slow', { auth: true });
    await new Promise((r) => setTimeout(r));
    await expect(apiRequest('/api/a', { auth: true })).resolves.toBe('a');
    answer.resolve({ status: 200, body: 'slow' });
    await expect(slow).resolves.toBe('slow');
  });
});

it('parses structured API errors and empty 204 bodies', async () => {
  mockServer({ 'POST /api/x': { status: 409, body: { detail: 'taken', code: 'email_taken' } }, 'POST /api/y': { status: 204 } });
  const err = await apiRequest('/api/x', { method: 'POST', body: {} }).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 409, code: 'email_taken' });
  await expect(apiRequest('/api/y', { method: 'POST' })).resolves.toBeUndefined();
});

it('does not attach the access token unless asked', async () => {
  const server = mockServer({});
  await apiRequest('/api/campus/courses');
  expect(server.calls[0].headers.Authorization).toBeUndefined();
});

it('requires HTTPS outside development builds', () => {
  expect(() => resolveApiUrl('http://api.mirabi.app', false)).toThrow(/https/);
  expect(resolveApiUrl('https://api.mirabi.app/', false)).toBe('https://api.mirabi.app');
  expect(resolveApiUrl('http://192.168.1.20:8000', true)).toBe('http://192.168.1.20:8000');
});

it('defaults to the API on the Metro machine in development', () => {
  expect(resolveApiUrl(undefined, true, '192.168.1.20')).toBe('http://192.168.1.20:8011');
  expect(resolveApiUrl('', true, undefined)).toBe('http://localhost:8011');
  // Release builds never fall back to plain HTTP.
  expect(() => resolveApiUrl(undefined, false, '192.168.1.20')).toThrow(/https/);
});

it('mirrors the backend validation rules', () => {
  expect(validateEmail(' aqua@example.com ')).toBeUndefined();
  expect(validateEmail('aqua@example')).toBeDefined();
  expect(validateNewPassword('Sparkle123')).toBeUndefined();
  expect(validateNewPassword('short1')).toMatch(/8 ký tự/);
  expect(validateNewPassword('12345678')).toMatch(/chữ cái và chữ số/);
});
