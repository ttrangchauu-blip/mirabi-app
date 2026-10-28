import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { setSession } from '../src/api/client';
import { mockServer, networkDown, tokens, USER } from '../test/mockServer';

const store: Map<string, string> = (SecureStore as any).__store;
const SESSION_KEY = 'refmi.session.v1';
const LOGIN_BUTTON = { name: 'Bắt đầu hành trình ✨' };
const HOME_GREETING = `Chào bạn, ${USER.display_name}!`;
const POPUP_TITLE = 'CHUỖI ĐĂNG NHẬP';
const claim = (overrides: Record<string, unknown> = {}) => ({
  current_streak: 1, longest_streak: 1, last_login_date: '2030-03-10', should_show_popup: true,
  daily_exp_awarded: 2, milestone_exp_awarded: 0, already_claimed: false, ...overrides,
});
const alreadyRecorded = (overrides: Record<string, unknown> = {}) =>
  claim({ should_show_popup: false, already_claimed: true, daily_exp_awarded: 0, ...overrides });

beforeEach(() => {
  store.clear();
  setSession(null);
});

async function renderSignedOut() {
  render(<App />);
  await screen.findByText('Chào mừng bạn trở lại!', {}, { timeout: 5000 });
}

async function signIn() {
  fireEvent.changeText(screen.getByLabelText('Email'), 'aqua@example.com');
  fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'Sparkle123');
  fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
  // Home is behind the (modal) popup when one opens, so wait for the login screen to go away instead.
  await waitFor(() => expect(screen.queryByText(LOGIN_BUTTON.name, { includeHiddenElements: true })).toBeNull());
}

async function logOut() {
  fireEvent.press(screen.getByText('Tiện ích'));
  fireEvent.press(await screen.findByRole('button', { name: 'Đăng xuất' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Xác nhận đăng xuất' }));
  await screen.findByText('Chào mừng bạn trở lại!');
}

describe('daily login streak popup', () => {
  it('shows the backend streak once after the first login of the day; closing it sends nothing', async () => {
    const server = mockServer({ 'POST /api/auth/login': { status: 200, body: { ...tokens(1),
      login_streak: claim({ current_streak: 4, longest_streak: 9, daily_exp_awarded: 5 }) } } });
    await renderSignedOut();
    await signIn();
    expect(await screen.findByText(POPUP_TITLE)).toBeTruthy();
    expect(screen.getByText('4 ngày liên tiếp')).toBeTruthy();
    expect(screen.getByText('+5 EXP')).toBeTruthy();
    expect(screen.getByText('Kỷ lục 9 ngày')).toBeTruthy();
    expect(server.callsTo('POST /api/auth/login')[0].headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    const callsBefore = server.calls.length;
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
    await waitFor(() => expect(screen.queryByText(POPUP_TITLE)).toBeNull());
    expect(server.calls.slice(callsBefore).filter((c) => c.path.includes('streak'))).toEqual([]);
    // Rebuilding the UI (switching tabs and back) does not bring it back.
    fireEvent.press(screen.getByText('Tiện ích'));
    fireEvent.press(screen.getByText('Trang chủ'));
    await screen.findByText(HOME_GREETING);
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
  });

  it('opens the streak journey from the popup', async () => {
    const server = mockServer({
      'POST /api/auth/login': { status: 200, body: { ...tokens(1), login_streak: claim() } },
      'GET /api/streak': { status: 200, body: { current_streak: 1, longest_streak: 1, last_login_date: '2030-03-10', today_claimed: true,
        today_exp: 2, today_milestone_exp: 0, milestones: [{ days: 7, exp: 10, reached: false, claimed: false }],
        calendar: [{ date: '2030-03-10', checked_in: true, is_today: true, streak_count: 1, daily_exp: 2 }] } },
    });
    await renderSignedOut();
    await signIn();
    fireEvent.press(await screen.findByRole('button', { name: 'Xem hành trình' }));
    expect(await screen.findByText('Hành trình phép màu')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(POPUP_TITLE)).toBeNull());
    await waitFor(() => expect(server.callsTo('GET /api/streak')).toHaveLength(1));
  });

  it('stays hidden when the backend says the day was already recorded', async () => {
    mockServer({ 'POST /api/auth/login': { status: 200, body: { ...tokens(1), login_streak: alreadyRecorded({ current_streak: 3 }) } } });
    await renderSignedOut();
    await signIn();
    expect(await screen.findByText(HOME_GREETING)).toBeTruthy();
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
  });

  it('counts opening the app with a saved session as the day\'s login', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'POST /api/streak/check-in': { status: 200, body: claim({ current_streak: 6, longest_streak: 6, daily_exp_awarded: 5 }) } });
    render(<App />);
    expect(await screen.findByText(POPUP_TITLE, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('6 ngày liên tiếp')).toBeTruthy();
    const [checkIn] = server.callsTo('POST /api/streak/check-in');
    expect(checkIn.headers.Authorization).toBe('Bearer access-1');
    expect(checkIn.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(await screen.findByText(HOME_GREETING)).toBeTruthy();
  });

  it('stays hidden when the app is reopened on a day that was already counted', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'POST /api/streak/check-in': { status: 200, body: alreadyRecorded({ current_streak: 6 }) } });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    await waitFor(() => expect(server.callsTo('POST /api/streak/check-in')).toHaveLength(1));
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
  });

  it('checks in again when the app comes back to the foreground', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    let opens = 0;
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      // Opened late yesterday, brought back to the front after midnight.
      'POST /api/streak/check-in': () => ({ status: 200, body: ++opens === 1 ? alreadyRecorded() : claim({ current_streak: 2, longest_streak: 2 }) }) });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    await waitFor(() => expect(server.callsTo('POST /api/streak/check-in')).toHaveLength(1));
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();

    const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === 'change').map(([, fn]) => fn);
    act(() => listeners.forEach((fn) => fn('background')));
    expect(server.callsTo('POST /api/streak/check-in')).toHaveLength(1);
    act(() => listeners.forEach((fn) => fn('active')));
    expect(await screen.findByText('2 ngày liên tiếp')).toBeTruthy();
  });

  it('opens the app normally when the check-in fails', async () => {
    store.set(SESSION_KEY, JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'POST /api/streak/check-in': { status: 500, body: { detail: 'boom', code: 'server_error' } } });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    await waitFor(() => expect(server.callsTo('POST /api/streak/check-in')).toHaveLength(1));
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
  });

  it('does not come back after logging out and in again the same day', async () => {
    let attempt = 0;
    mockServer({
      'POST /api/auth/login': () => ({ status: 200, body: { ...tokens(++attempt), login_streak: attempt === 1
        ? claim({ current_streak: 2, longest_streak: 2 }) : alreadyRecorded({ current_streak: 2, longest_streak: 2 }) } }),
      'POST /api/auth/logout': { status: 204 },
    });
    await renderSignedOut();
    await signIn();
    expect(await screen.findByText('2 ngày liên tiếp')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
    await logOut();
    await signIn();
    expect(await screen.findByText(HOME_GREETING)).toBeTruthy();
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
  });

  it('retries a login with an unknown outcome under the same Idempotency-Key', async () => {
    let attempt = 0;
    const server = mockServer({ 'POST /api/auth/login': () => {
      attempt += 1;
      if (attempt === 1) return networkDown();
      if (attempt === 2) return { status: 401, body: { detail: 'Email or password is incorrect', code: 'invalid_credentials' } };
      return { status: 200, body: { ...tokens(1), login_streak: claim() } };
    } });
    await renderSignedOut();
    fireEvent.changeText(screen.getByLabelText('Email'), 'aqua@example.com');
    fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    await screen.findByText(/Không thể kết nối tới máy chủ/);
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    await screen.findByText(/Email hoặc mật khẩu không đúng/);
    fireEvent.changeText(screen.getByLabelText('Mật khẩu'), 'Sparkle123');
    fireEvent.press(screen.getByRole('button', LOGIN_BUTTON));
    expect(await screen.findByText(POPUP_TITLE)).toBeTruthy();

    const keys = server.callsTo('POST /api/auth/login').map((c) => c.headers['Idempotency-Key']);
    expect(keys[1]).toBe(keys[0]); // same attempt after a network failure
    expect(keys[2]).not.toBe(keys[1]); // the server answered, so the next press is a new attempt
  });

  it('lets the user in without a popup when the streak is missing or malformed', async () => {
    let attempt = 0;
    mockServer({
      'POST /api/auth/login': () => ({ status: 200, body: { ...tokens(++attempt), login_streak: attempt === 1
        ? null : { should_show_popup: true, current_streak: 'many' } } }),
      'POST /api/auth/logout': { status: 204 },
    });
    await renderSignedOut();
    await signIn();
    expect(await screen.findByText(HOME_GREETING)).toBeTruthy();
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
    await logOut();
    await signIn();
    expect(await screen.findByText(HOME_GREETING)).toBeTruthy();
    expect(screen.queryByText(POPUP_TITLE)).toBeNull();
  });
});
