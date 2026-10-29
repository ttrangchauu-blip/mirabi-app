import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { setSession } from '../src/api/client';
import { deferred, mockServer, networkDown, tokens, USER } from '../test/mockServer';

// "Reduce motion" is on in tests (jest.setup), so the egg hatches at once and the congratulations follow.
const store: Map<string, string> = (SecureStore as any).__store;
const EGG = { ...USER, level: 0, xp: 310 };
const HATCHED = { ...USER, level: 1, xp: 310 };
const CONGRATS = `Chúc mừng! ${USER.pet_name} đã nở!`;
const HATCH = 'POST /api/pet/hatch';
const space = (overrides: Record<string, unknown> = {}) => ({ status: 'locked', seconds_left: 0, walk_minutes: 480, quests: [],
  last_find: null, collection: [], total_finds: 8, inventory: [], pending_reward: null, hatch: { status: 'none', level: null }, ...overrides });
const waitingToHatch = () => space({ status: 'waiting_hatch', hatch: { status: 'ready', level: 1 } });
const walking = () => space({ status: 'walking', seconds_left: 8 * 3600, return_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString() });

function server(state: { hatched: boolean }, hatchReply?: () => any) {
  return mockServer({
    'GET /api/auth/me': { status: 200, body: state.hatched ? HATCHED : EGG },
    'GET /api/dashboard': () => ({ status: 200, body: { user: state.hatched ? HATCHED : EGG, study: { total_minutes: 0, today_sessions: 0 } } }),
    'GET /api/pet/space': () => ({ status: 200, body: state.hatched ? walking() : waitingToHatch() }),
    [HATCH]: hatchReply ?? (() => { state.hatched = true; return { status: 200, body: { hatched: true, pet_level: 1, xp: 310, ...walking() } }; }),
  });
}

// Whole-screen renders are slow when every test file runs in parallel; give them room.
jest.setTimeout(30000);

beforeEach(async () => {
  store.clear();
  await AsyncStorage.clear();
  setSession(null);
  store.set('refmi.session.v1', JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
});

describe('hatching before the walk', () => {
  it('hatches the egg first, and the walk starts only once the congratulations are closed', async () => {
    const state = { hatched: false };
    const api = server(state);
    render(<App />);
    expect(await screen.findByText(CONGRATS, {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByText(`${USER.pet_name} sẽ bắt đầu đi khám phá ngay sau đây`)).toBeTruthy();
    expect(screen.getByText('Pet sẽ đi khám phá sau khi nở xong', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Pet đang đi dạo...', { includeHiddenElements: true })).toBeNull();
    expect(api.callsTo(HATCH)).toHaveLength(0); // not before the congratulations are closed

    fireEvent.press(screen.getByRole('button', { name: 'Tuyệt vời' }));
    expect(await screen.findByText('Pet đang đi dạo...', {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByText(CONGRATS)).toBeNull();
    expect(api.callsTo(HATCH)).toHaveLength(1);
  });

  it('an app closed mid-hatch shows it again when reopened, without hatching on its own', async () => {
    const state = { hatched: false };
    const api = server(state);
    const first = render(<App />);
    await screen.findByText(CONGRATS, {}, { timeout: 15000 });
    first.unmount();
    render(<App />);
    expect(await screen.findByText(CONGRATS, {}, { timeout: 15000 })).toBeTruthy();
    expect(api.callsTo(HATCH)).toHaveLength(0);
  });

  it('confirms once however many times the button is tapped', async () => {
    const state = { hatched: false };
    const reply = deferred<any>();
    const api = server(state, () => reply.promise);
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Tuyệt vời' }, { timeout: 15000 });
    fireEvent.press(button); fireEvent.press(button); fireEvent.press(button);
    state.hatched = true;
    reply.resolve({ status: 200, body: { hatched: true, pet_level: 1, xp: 310, ...walking() } });
    await waitFor(() => expect(screen.queryByText(CONGRATS)).toBeNull(), { timeout: 15000 });
    expect(api.callsTo(HATCH)).toHaveLength(1);
  });

  it('closes when the hatch went through but its answer was lost', async () => {
    const state = { hatched: false };
    server(state, () => { state.hatched = true; return networkDown(); });
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Tuyệt vời' }, { timeout: 15000 }));
    expect(await screen.findByText('Pet đang đi dạo...', {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByText(CONGRATS)).toBeNull();
  });

  it('keeps the egg on its walk when it gets its EXP while out, and says it hatches on return', async () => {
    const api = mockServer({
      'GET /api/auth/me': { status: 200, body: EGG },
      'GET /api/dashboard': { status: 200, body: { user: EGG, study: { total_minutes: 0, today_sessions: 0 } } },
      'GET /api/pet/space': { status: 200, body: { ...walking(), hatch: { status: 'waiting_return', level: 1 } } },
    });
    render(<App />);
    expect(await screen.findByText('Trứng đã đủ EXP · sẽ nở khi Pet trở về', {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByText('Pet đang đi dạo...')).toBeTruthy();
    expect(screen.queryByText(CONGRATS)).toBeNull();
    expect(api.callsTo(HATCH)).toHaveLength(0);
  });
});
