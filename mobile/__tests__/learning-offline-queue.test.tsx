import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { NetworkError, setSession } from '../src/api/client';
import type { EventResponse, LearningSession } from '../src/learning/types';
import { useLearningSession } from '../src/learning/useLearningSession';
import { ResultScreen } from '../src/screens/learning/ResultScreen';
import { mockServer } from '../test/mockServer';

// Lost connection in a game: what was asked waits, in order, and is sent once the network is back; a pause asked meanwhile
// stays a pause.

const base = { id: 1, status: 'active', kind: 'lesson', mode: 'practice', game: 'meteor', game_type: 'meteor', version: 1, open_turns: [],
  can_complete: false, remaining_ms: 60000, time_up: false } as unknown as LearningSession;

function server() {
  const state = { online: true, status: 'active', version: 1, delivered: [] as string[] };
  const call = (name: string, status?: string) => jest.fn(async (): Promise<EventResponse> => {
    if (!state.online) throw new NetworkError('offline', 'Network request failed');
    state.delivered.push(name);
    if (status) state.status = status;
    state.version += 1;
    return { result: null, session: { ...base, status: state.status, version: state.version } } as unknown as EventResponse;
  });
  const api = { session: call('session'), intro: jest.fn(), turn: call('answer'), next: call('next'), pause: call('pause', 'paused'),
    resume: call('resume', 'active'), extend: call('extend'), complete: call('complete'), abandon: call('abandon') };
  return { state, api };
}

/** 3, 2, 1, "Bắt đầu!": each second is its own timer, set once the last has been rendered. */
async function countDown() {
  for (let i = 0; i < 5; i += 1) await act(async () => { jest.advanceTimersByTime(1000); });
}

async function playing(api: any) {
  const hook = renderHook(() => useLearningSession(base, jest.fn(), false, { api }));
  await countDown();
  expect(hook.result.current.running).toBe(true);
  return hook;
}

const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

describe('offline in a game', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('an answer waiting for the network is still sent when the game is paused meanwhile, before the pause', async () => {
    const { state, api } = server();
    const { result } = await playing(api);
    const onDone = jest.fn();
    state.online = false;
    await act(async () => { await result.current.control(() => api.turn(), onDone); });
    expect(result.current.offline).toBe(true);
    await act(async () => { result.current.pause(); });
    await flush();

    state.online = true;
    await act(async () => { await result.current.retry(); });
    expect(state.delivered).toEqual(['answer', 'pause']);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.session.status).toBe('paused');
    expect(result.current.offline).toBe(false);
  });

  test('a pause asked offline is still a pause when the network is back: no countdown, no resume', async () => {
    const { state, api } = server();
    const { result } = await playing(api);
    state.online = false;
    await act(async () => { result.current.pause(); });
    await flush();
    expect(result.current.offline).toBe(true);

    state.online = true;
    await act(async () => { await result.current.retry(); });
    expect(result.current.countdown).toBeNull();
    await countDown();
    expect(api.resume).not.toHaveBeenCalled();
    expect(result.current.paused).toBe(true);
  });

  test('an answer sent again, with no pause, plays on after the usual countdown', async () => {
    const { state, api } = server();
    const { result } = await playing(api);
    state.online = false;
    await act(async () => { await result.current.control(() => api.turn()); });
    state.online = true;
    await act(async () => { await result.current.retry(); });
    expect(state.delivered).toEqual(['answer']);
    expect(result.current.countdown).toBe(3);
    await countDown();
    expect(result.current.running).toBe(true);
  });
});

test('the result of a stage of Kho lưu trữ says which school year it reviewed, however it was started', async () => {
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  mockServer({ 'GET /api/learning/sessions/5/result': { status: 200, body: { counts: { first_try: 5 }, items: [], open_review_count: 0,
    session: { id: 5, status: 'completed', kind: 'archive', archive_year: 2026, mode: 'practice', game: 'match', required_count: 5, max_combo: 0, reward: null,
      end_reason: 'completed', lesson: { id: 1, code: 'x', name: 'Bài' }, topic: { id: 1, code: 't', name: 'Chủ đề' }, subject: { id: 1, code: 'math', name: 'Toán' },
      catalog: { lesson: 'toan2.bang_nhan_2', title: 'Bảng nhân 2', grade: 2, game: 'match', game_title: 'Ghép', short_stage: false, subject_name: 'Toán', other_games: [], next: null } } } } });
  const onLesson = jest.fn();
  render(<ResultScreen sessionId={5} petId="fox" petLevel={1} onReplay={jest.fn()} onReview={jest.fn()} onHome={jest.fn()} onLesson={onLesson} onRewards={jest.fn()} reduceMotion />);
  fireEvent.press(await screen.findByText('Về bài học'));
  expect(onLesson).toHaveBeenCalledWith('toan2.bang_nhan_2', 2026);
});
