import { ApiError, apiRequest, configureSessionHandlers, getSession, NetworkError, setSession } from '../src/api/client';
import { resolveApiUrl } from '../src/config';
import { validateEmail, validateNewPassword } from '../src/auth/validation';
import { mockServer, networkDown, tokens } from '../test/mockServer';

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
