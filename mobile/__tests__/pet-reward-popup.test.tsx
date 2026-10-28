import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { setSession } from '../src/api/client';
import { mockServer, networkDown, tokens, USER } from '../test/mockServer';

const store: Map<string, string> = (SecureStore as any).__store;
const HOME_GREETING = `Chào bạn, ${USER.display_name}!`;
const TITLE = `${USER.pet_name} đã trở về!`;
// Each walk brings back exactly one gift: one item, or EXP.
const REWARD = { walk_id: 7, returned_at: '2030-03-10T08:00:00+00:00', exp: 0, items: [
  { id: 'small_pot', name: 'Chậu cây nhỏ', emoji: '🪴', rarity: 'rare', kind: 'decoration', quantity: 1 },
] };
const EXP_REWARD = { walk_id: 8, returned_at: '2030-03-11T08:00:00+00:00', exp: 30, items: [] };
const space = (overrides: Record<string, unknown> = {}) => ({ status: 'rested', seconds_left: 0, walk_minutes: 480, quests: [],
  last_find: null, collection: [], total_finds: 8, inventory: [], pending_reward: null, ...overrides });
const returned = () => space({ status: 'returned', pending_reward: REWARD });
const ACK = `POST /api/pet/walks/${REWARD.walk_id}/acknowledge`;

beforeEach(() => {
  store.clear();
  setSession(null);
  store.set('refmi.session.v1', JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
});

function popupIsClosed() {
  return waitFor(() => expect(screen.queryByText(TITLE, { includeHiddenElements: true })).toBeNull(), { timeout: 5000 });
}

describe('pet gift popup', () => {
  it('appears on app open for a walk that ended while the app was closed, with the backend\'s gifts', async () => {
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/pet/space': { status: 200, body: returned() } });
    render(<App />);
    expect(await screen.findByText(TITLE, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(`${USER.pet_name} đã mang về một món quà dành cho bạn!`)).toBeTruthy();
    expect(screen.getByLabelText('Chậu cây nhỏ ×1, Hiếm')).toBeTruthy();
    expect(screen.queryByText(/EXP/)).toBeNull();
    // Drawn pictures for known items; an item without a drawing falls back to its emoji.
    expect(screen.getByTestId('reward-art-small_pot', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('🪴', { includeHiddenElements: true })).toBeNull();
  });

  it('shows an EXP gift on its own', async () => {
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': { status: 200, body: space({ status: 'returned', pending_reward: EXP_REWARD }) } });
    render(<App />);
    expect(await screen.findByText('+30 EXP', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(screen.queryByTestId(/^reward-art-/, { includeHiddenElements: true })).toBeNull();
  });

  it('"Nhận quà" only confirms once, closes the popup, refreshes the numbers and never shows it again', async () => {
    let confirmed = false;
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': () => ({ status: 200, body: confirmed ? space() : returned() }),
      [ACK]: () => { confirmed = true; return { status: 200, body: { acknowledged: REWARD, ...space() } }; },
    });
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Nhận quà' }, { timeout: 5000 });
    const dashboardLoads = server.callsTo('GET /api/dashboard').length;
    fireEvent.press(button);
    fireEvent.press(button);
    await popupIsClosed();
    expect(server.callsTo(ACK)).toHaveLength(1);
    expect(server.calls.filter((c) => c.path.includes('collect'))).toEqual([]);
    await waitFor(() => expect(server.callsTo('GET /api/dashboard').length).toBeGreaterThan(dashboardLoads));

    // Coming back to the app asks the backend again; the confirmed popup stays closed.
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === 'change').map(([, fn]) => fn);
    const checks = server.callsTo('GET /api/pet/space').length;
    act(() => listeners.forEach((fn) => fn('active')));
    await waitFor(() => expect(server.callsTo('GET /api/pet/space').length).toBeGreaterThan(checks));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('keeps the popup and offers a retry when confirming fails on the network', async () => {
    let online = false;
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': () => ({ status: 200, body: online ? space() : returned() }),
      [ACK]: () => (online ? { status: 200, body: { acknowledged: REWARD, ...space() } } : networkDown()),
    });
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Nhận quà' }, { timeout: 5000 }));
    expect(await screen.findByText('Chưa kết nối được. Quà vẫn được giữ an toàn, bạn hãy thử lại nhé.', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(screen.getByLabelText('Chậu cây nhỏ ×1, Hiếm')).toBeTruthy(); // same backend gift, nothing re-created locally

    online = true;
    fireEvent.press(screen.getByRole('button', { name: 'Nhận quà' }));
    await popupIsClosed();
    expect(server.callsTo(ACK)).toHaveLength(2);
  });

  it('closes when the backend says it was already confirmed (lost response or another device)', async () => {
    let pending = true;
    mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': () => ({ status: 200, body: pending ? returned() : space() }),
      // The confirmation reached the server but its answer was lost.
      [ACK]: () => { pending = false; return networkDown(); },
    });
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Nhận quà' }, { timeout: 5000 }));
    await popupIsClosed();
    expect(screen.queryByText(/Chưa kết nối được/)).toBeNull();
  });

  it('shows up when the pet comes back while the app is open', async () => {
    let back = false;
    mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': () => ({ status: 200, body: back ? returned() : space({ status: 'walking', seconds_left: 1 }) }),
    });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    expect(screen.queryByText(TITLE)).toBeNull();
    back = true; // the walk ends; the backend grants the gifts by itself
    expect(await screen.findByLabelText('Chậu cây nhỏ ×1, Hiếm', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('reads walk times as UTC, shows the real arrival time and keeps walking until then', async () => {
    const returnsAt = new Date(Date.now() + 30 * 60 * 1000);
    // As older backends sent it from SQLite: UTC without an offset.
    const naive = returnsAt.toISOString().replace('Z', '');
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': { status: 200, body: space({ status: 'walking', seconds_left: 1800, return_at: naive, server_now: new Date().toISOString() }) },
    });
    render(<App />);
    expect(await screen.findByText('Pet đang đi dạo...', {}, { timeout: 5000 })).toBeTruthy();
    const arrival = returnsAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(`Về lúc ${arrival}`)).toBeTruthy();
    expect(screen.getByText('Pet sẽ mang quà về cho bạn khi trở về')).toBeTruthy();
    const loads = server.callsTo('GET /api/pet/space').length;
    await act(() => new Promise((resolve) => setTimeout(resolve, 2500)));
    // Still walking: no false "returned" and no reload loop.
    expect(screen.getByText('Pet đang đi dạo...')).toBeTruthy();
    expect(server.callsTo('GET /api/pet/space').length).toBe(loads);
  });

  it('"Xem quà" on the pet frame always answers: a message while gifts are not ready, then the popup', async () => {
    let ready = false;
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': () => ({ status: 200, body: ready ? returned() : space({ status: 'returned' }) }),
    });
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Xem quà' }, { timeout: 5000 }));
    expect(await screen.findByRole('alert', { name: 'Pet đang chuẩn bị quà, bạn quay lại sau ít phút nhé!' })).toBeTruthy();

    ready = true;
    const checks = server.callsTo('GET /api/pet/space').length;
    fireEvent.press(screen.getByRole('button', { name: 'Xem quà' }));
    expect(await screen.findByLabelText('Chậu cây nhỏ ×1, Hiếm')).toBeTruthy();
    expect(server.callsTo('GET /api/pet/space').length).toBeGreaterThan(checks);
  });

  it('shows nothing made up when the backend has no valid pending gift or cannot be reached', async () => {
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/pet/space': { status: 200, body: space({ status: 'returned', pending_reward: { walk_id: 'x', exp: 'lots', items: null } }) },
    });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    await waitFor(() => expect(server.callsTo('GET /api/pet/space').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Nhận quà' })).toBeNull();
  });
});

describe('reward pictures', () => {
  it('draws every item the backend can grant and falls back to the emoji for new ones', () => {
    const { RewardItemArt } = require('../src/components/RewardItemArt');
    const { REWARD_ART } = require('../src/rewardArt');
    expect(Object.keys(REWARD_ART).sort()).toEqual(['acorn', 'clover', 'crystal', 'feather', 'flower', 'moon_lantern', 'pebble', 'seedling', 'shell', 'small_pot', 'star']);
    render(<RewardItemArt id="mystery_box" emoji="🎁" />);
    expect(screen.getByText('🎁', { includeHiddenElements: true })).toBeTruthy();
  });
});
