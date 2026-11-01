import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NetworkError, setSession } from '../src/api/client';
import { ENTER_MS, FlowTimers, LEAVE_MS, QuestionFlow, STEP_MAX_MS } from '../src/games/engine/questionFlow';
import type { GameBackend } from '../src/learning/api';
import type { EventResponse, LearningSession, Turn, TurnResult } from '../src/learning/types';
import { GameScreen } from '../src/screens/learning/GameScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

// How every game answered one question at a time moves on (games/engine/questionFlow.ts): right or wrong, the question
// stays with its result, the answer and the explanation until "Tiếp theo", which brings exactly one new question in.
// These tests read the tree that is really rendered (`screen.toJSON()`), not only React's own: a question left behind on
// screen by two children sharing a key is invisible to `queryByText`.

const ref = (id: number, code: string, name: string) => ({ id, code, name });
const turn = (id: string, kind: Turn['kind'], prompt: Turn['prompt'], over: Partial<Turn> = {}): Turn => ({ turn_id: id, position: 0, kind, skill_label: 'x', prompt,
  hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0, on_screen_ms: 0, ...over });
const q = (n: number, over: Partial<Turn> = {}) => turn(`turn-${n}`, 'choice_explain', { style: 'quiz', question: `Câu hỏi số ${n}?`,
  options: [{ id: `r${n}`, text: `Đúng ${n}` }, { id: `w${n}`, text: `Sai ${n}` }] }, over);
const base = (over: Partial<LearningSession> = {}): LearningSession => ({
  id: 7, status: 'active', kind: 'lesson', mode: 'practice', game_type: 'choice' as any, variant: null, game: 'choice' as any,
  subject: ref(1, 'music', 'Âm nhạc'), topic: ref(9, 't', 't'), level: ref(1, 'g3', 'Lớp 3'), lesson: ref(5, 'l', 'l'),
  duration_seconds: 3600, active_ms: 0, remaining_ms: 3_600_000, time_up: false, timed: false, hearts: 0, hearts_max: 0, score: 0, combo: 0,
  max_combo: 0, required_count: 3, resolved_count: 0, pending_practice: 0, open_turns: [q(1)], can_complete: false, end_reason: null,
  reward: null, version: 1, server_time: '2026-11-01T10:00:00Z',
  catalog: { lesson: 'x', title: 'Bài', grade: 3, game: 'choice' as any, game_title: 'Chọn đáp án', short_stage: false, subject_name: null,
    other_games: [], next: null, world: null }, ...over });
const result = (over: Partial<TurnResult>): TurnResult => ({ turn_id: 'turn-1', event: 'answer', correct: true, outcome: 'first_try',
  resolved: true, retry_allowed: false, error_type: null, score_delta: 0, hearts_delta: 0, combo: 0, hint: null, correct_answer: 'Đáp án A',
  explanation: 'Vì lý do A.', practice_added: false, feedback: null, ...over });
const prefs = { sound: false, volume: 'mid' as const, reduceMotion: false, setSound: jest.fn(), setVolume: jest.fn(), setReduceMotion: jest.fn() };
const ms = (n: number) => act(async () => { jest.advanceTimersByTime(n); });
/** The server's reply (a promise) comes first, then the time goes by. */
const wait = async (n: number) => { await ms(0); await ms(0); await ms(n); };
/** What is really on screen. */
const onScreen = () => JSON.stringify(screen.toJSON());
const next = () => screen.getByRole('button', { name: 'Tiếp theo' });

let duplicateKeys: jest.SpyInstance;
beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  duplicateKeys = jest.spyOn(console, 'error');
});
afterEach(() => {
  expect(duplicateKeys.mock.calls.filter((c) => String(c[0]).includes('same key'))).toEqual([]);
  duplicateKeys.mockRestore();
  jest.useRealTimers();
});

async function play(s: LearningSession, routes: Record<string, unknown>, motion = true) {
  const server = mockServer({ 'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: s, replayed: false } }, ...routes } as never);
  const onEnded = jest.fn();
  const view = render(<ToastProvider><ConfirmProvider>
    <GameScreen key={s.id} initial={s} petId="fox" petLevel={1} prefs={{ ...prefs, reduceMotion: !motion }} onEnded={onEnded} />
  </ConfirmProvider></ToastProvider>);
  for (let i = 0; i < 5; i++) await ms(1000);
  return { server, onEnded, view };
}

/** A stage of three questions: the first two wrong or right as asked, each answer already opening the next question. */
const threeQuestions = () => ({
  'POST /api/learning/sessions/7/answer': (req: { body: { turn_id: string; answer: string } }) => {
    const n = Number(req.body.turn_id.split('-')[1]);
    const right = req.body.answer === `r${n}`;
    return { status: 200, body: {
      result: result({ turn_id: req.body.turn_id, correct: right, outcome: right ? 'first_try' : 'wrong', correct_answer: `Đúng ${n}`, correct_options: [`r${n}`],
        explanation: `Giải thích câu ${n}.`, feedback: right ? null : `Sai ${n} chưa phù hợp.` }),
      session: base({ open_turns: n < 3 ? [q(n + 1)] : [], resolved_count: n, can_complete: n === 3, version: n + 1 }), replayed: false } };
  },
  'POST /api/learning/sessions/7/complete': { status: 200, body: { result: null, session: base({ status: 'completed', open_turns: [], resolved_count: 3, version: 9 }), replayed: false } },
});

describe('the flow', () => {
  const steppedTimers = () => {
    const pending = new Map<number, () => void>();
    let seq = 0;
    const timers: FlowTimers = { set: (fn) => { pending.set(++seq, fn); return seq; }, clear: (h) => { pending.delete(h as number); } };
    return { timers, fire: () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } }, pending };
  };

  it('goes ANSWERING → FEEDBACK → TRANSITIONING → NEXT_QUESTION → ANSWERING, holding the question until it has left', () => {
    const { timers } = steppedTimers();
    const flow = new QuestionFlow<string>(timers);
    expect(flow.answered('q1')).toBe(true);
    expect(flow.getSnapshot()).toMatchObject({ phase: 'FEEDBACK', held: 'q1' });
    expect(flow.next()).toBe(true);
    const { transition } = flow.getSnapshot();
    expect(flow.getSnapshot()).toMatchObject({ phase: 'TRANSITIONING', held: 'q1' });
    flow.left(transition);
    expect(flow.getSnapshot()).toMatchObject({ phase: 'NEXT_QUESTION', held: null });
    flow.entered(transition);
    expect(flow.trail).toEqual(['ANSWERING', 'FEEDBACK', 'TRANSITIONING', 'NEXT_QUESTION', 'ANSWERING']);
  });

  it('moves on once per press, and never without an answer', () => {
    const flow = new QuestionFlow<string>(steppedTimers().timers);
    expect(flow.next()).toBe(false);
    flow.answered('q1');
    expect(flow.next()).toBe(true);
    expect(flow.next()).toBe(false);
    expect(flow.next()).toBe(false);
    expect(flow.trail.filter((p) => p === 'TRANSITIONING')).toHaveLength(1);
  });

  it('a late answer never replaces the question held; the callback of an old animation never touches the new question', () => {
    const flow = new QuestionFlow<string>(steppedTimers().timers);
    flow.answered('q1');
    expect(flow.answered('late')).toBe(false);
    expect(flow.getSnapshot().held).toBe('q1');
    flow.next();
    const old = flow.getSnapshot().transition;
    flow.left(old);
    flow.entered(old);
    flow.answered('q2');
    flow.next(); // the next transition has begun
    flow.left(old);
    flow.entered(old);
    expect(flow.getSnapshot()).toMatchObject({ phase: 'TRANSITIONING', held: 'q2' });
  });

  it('an animation that never reports back cannot jam the game', () => {
    const { timers, fire, pending } = steppedTimers();
    const flow = new QuestionFlow<string>(timers);
    flow.answered('q1');
    expect(pending.size).toBe(0);
    flow.next();
    fire();
    expect(flow.getSnapshot().phase).toBe('NEXT_QUESTION');
    fire();
    expect(flow.getSnapshot().phase).toBe('ANSWERING');
    expect(pending.size).toBe(0);
  });

  it('the transition takes 250–450 ms in all', () => {
    expect(LEAVE_MS + ENTER_MS).toBeGreaterThanOrEqual(250);
    expect(LEAVE_MS + ENTER_MS).toBeLessThanOrEqual(450);
    expect(STEP_MAX_MS).toBeGreaterThan(ENTER_MS);
  });

  it('with nothing replaced on screen (a falling word), it goes straight back to answering', () => {
    const flow = new QuestionFlow<string>(steppedTimers().timers);
    flow.answered('q1');
    flow.next(true);
    expect(flow.getSnapshot()).toMatchObject({ phase: 'ANSWERING', held: null });
  });
});

describe('the required cases, on the real game screen', () => {
  it('a right answer: the explanation and "Tiếp theo", no popup, nothing moves on by itself', async () => {
    await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    await wait(1500);
    expect(screen.getByText('Chính xác!')).toBeTruthy();
    expect(screen.getByText('Giải thích câu 1.')).toBeTruthy();
    expect(next()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đúng 1, đúng' }).props.accessibilityState.disabled).toBe(true);
    await wait(30000);
    expect(screen.getByText('Câu hỏi số 1?')).toBeTruthy();
    expect(screen.queryByText('Câu hỏi số 2?')).toBeNull();
  });

  it('a wrong answer: the right answer, why, the explanation and "Tiếp theo"; never by itself', async () => {
    await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Sai 1' }));
    await wait(1500);
    expect(screen.getByText('Chưa chính xác!')).toBeTruthy();
    expect(screen.getByText('Đáp án đúng: Đúng 1')).toBeTruthy();
    expect(screen.getByText('Giải thích câu 1.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đúng 1, đáp án đúng' })).toBeTruthy();
    await wait(30000);
    expect(screen.getByText('Câu hỏi số 1?')).toBeTruthy();
    expect(next()).toBeTruthy();
  });

  it('"Tiếp theo": exactly one new question, and nothing of the old one is left on screen', async () => {
    const { server } = await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Sai 1' }));
    await wait(1500);
    fireEvent.press(next());
    await wait(1200);
    const shown = onScreen();
    expect(shown).toContain('Câu hỏi số 2?');
    for (const old of ['Câu hỏi số 1?', 'Sai 1', 'Giải thích câu 1.', 'Chưa chính xác!']) expect(shown).not.toContain(old);
    expect(screen.getByRole('button', { name: 'Đúng 2' }).props.accessibilityState.disabled).toBeFalsy();
    expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);
    expect(server.callsTo('POST /api/learning/sessions/7/next')).toHaveLength(0); // the session had already moved on
  });

  it('"Tiếp theo" pressed again and again never skips a question', async () => {
    await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    await wait(1500);
    const button = next();
    fireEvent.press(button);
    fireEvent.press(button);
    await ms(10);
    expect(screen.queryByRole('button', { name: 'Tiếp theo' })?.props.accessibilityState?.disabled ?? true).toBe(true);
    await wait(1200);
    expect(onScreen()).toContain('Câu hỏi số 2?');
    expect(onScreen()).not.toContain('Câu hỏi số 3?');
  });

  it('the new question is there once the transition has played, without waiting for its watchdog', async () => {
    await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    await wait(1500);
    fireEvent.press(next());
    await ms(LEAVE_MS + 20);
    expect(onScreen()).toContain('Câu hỏi số 2?');
    await ms(ENTER_MS + 20);
    expect(screen.getByRole('button', { name: 'Đúng 2' }).props.accessibilityState.disabled).toBeFalsy();
  });

  it('while the transition plays, nothing can be touched and the old question is still the one held', async () => {
    const { server } = await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Sai 1' }));
    await wait(1500);
    fireEvent.press(next());
    // Mid-leave: the question answered, locked; the next one not yet.
    expect(onScreen()).toContain('Câu hỏi số 1?');
    expect(onScreen()).not.toContain('Câu hỏi số 2?');
    fireEvent.press(screen.getByRole('button', { name: /^Đúng 1/ }));
    await wait(1200);
    expect(onScreen()).toContain('Câu hỏi số 2?');
    expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);
  });

  it('the next question cannot be answered before it has come in, then can', async () => {
    const { server } = await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    await wait(1500);
    fireEvent.press(next());
    await ms(LEAVE_MS + 20); // it has just left
    const coming = screen.queryByRole('button', { name: 'Đúng 2' });
    if (coming) fireEvent.press(coming);
    expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);
    await wait(1200);
    fireEvent.press(screen.getByRole('button', { name: 'Đúng 2' }));
    await ms(50);
    expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(2);
  });

  it('a slow network: until the reply comes nothing can be sent again and nothing moves on; then its own result shows', async () => {
    let reply: (value: EventResponse) => void = () => {};
    const backend = {
      session: async () => base(), resume: async () => ({ result: null, session: base(), replayed: false }),
      turn: () => new Promise<EventResponse>((resolve) => { reply = resolve; }), pause: async () => ({ result: null, session: base(), replayed: false }),
    } as unknown as GameBackend;
    render(<ToastProvider><ConfirmProvider><GameScreen initial={base()} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} backend={backend} /></ConfirmProvider></ToastProvider>);
    for (let i = 0; i < 5; i++) await ms(1000);
    const send = jest.spyOn(backend, 'turn');
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    fireEvent.press(screen.getByRole('button', { name: 'Sai 1' }));
    await wait(8000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onScreen()).toContain('Câu hỏi số 1?');
    expect(screen.queryByRole('button', { name: 'Tiếp theo' })).toBeNull();
    await act(async () => { reply({ result: result({ correct_options: ['r1'], explanation: 'Giải thích câu 1.' }), session: base({ open_turns: [q(2)], resolved_count: 1, version: 2 }), replayed: false }); });
    await wait(1500);
    expect(onScreen()).toContain('Câu hỏi số 1?');
    expect(onScreen()).toContain('Giải thích câu 1.');
    expect(onScreen()).not.toContain('Câu hỏi số 2?');
  });

  it('the network fails on an answer: the question stays, it is sent again with the same id, its result shows once', async () => {
    let tries = 0;
    const ids: string[] = [];
    const backend = {
      session: async () => base(), resume: async () => ({ result: null, session: base(), replayed: false }),
      pause: async () => ({ result: null, session: base(), replayed: false }),
      turn: async (_: number, action: { eventId: string }) => {
        ids.push(action.eventId);
        if (++tries === 1) throw new NetworkError('offline', 'x');
        return { result: result({ correct_options: ['r1'] }), session: base({ open_turns: [q(2)], resolved_count: 1, version: 2 }), replayed: false };
      },
    } as unknown as GameBackend;
    render(<ToastProvider><ConfirmProvider><GameScreen initial={base()} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} backend={backend} /></ConfirmProvider></ToastProvider>);
    for (let i = 0; i < 5; i++) await ms(1000);
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    await ms(50);
    expect(onScreen()).toContain('Câu hỏi số 1?');
    expect(onScreen()).not.toContain('Câu hỏi số 2?');
    expect(screen.queryByRole('button', { name: 'Tiếp theo' })).toBeNull();
    await ms(3100); // retried by itself
    for (let i = 0; i < 8; i++) await ms(1000); // the countdown after coming back
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(screen.getByText('Vì lý do A.')).toBeTruthy();
    expect(onScreen()).not.toContain('Câu hỏi số 2?');
  });

  it('the last question: "Xem kết quả" goes to the summary, once, after the question has left', async () => {
    const { onEnded, server } = await play(base({ open_turns: [q(3)], resolved_count: 2 }), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 3' }));
    await wait(1500);
    expect(server.callsTo('POST /api/learning/sessions/7/complete')).toHaveLength(0); // not before it is read
    const last = screen.getByRole('button', { name: 'Xem kết quả' });
    fireEvent.press(last);
    fireEvent.press(last);
    for (let i = 0; i < 6; i++) await wait(500);
    expect(server.callsTo('POST /api/learning/sessions/7/complete')).toHaveLength(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('coming back to a game: the progress is where it was, with the next question, not the old one', async () => {
    const { view } = await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Đúng 1' }));
    await wait(1500);
    view.unmount();
    // The app is reopened: the session the server kept.
    const back = base({ open_turns: [q(2)], resolved_count: 1, version: 2 });
    await play(back, threeQuestions());
    expect(onScreen()).toContain('Câu hỏi số 2?');
    expect(onScreen()).not.toContain('Câu hỏi số 1?');
    expect(screen.getByLabelText('Đã xong 1 trên 3 lượt')).toBeTruthy();
  });

  it('many questions in a row: each exactly once, in order, the score and the hearts kept', async () => {
    const hearts = (n: number) => ({ hearts: 3 - (n >= 2 ? 1 : 0), hearts_max: 3, score: n * 10 });
    const first = base({ ...hearts(0) });
    const { server, onEnded } = await play(first, {
      'POST /api/learning/sessions/7/answer': (req: { body: { turn_id: string; answer: string } }) => {
        const n = Number(req.body.turn_id.split('-')[1]);
        return { status: 200, body: { result: result({ turn_id: req.body.turn_id, correct: req.body.answer === `r${n}`, correct_options: [`r${n}`], explanation: `Giải thích câu ${n}.` }),
          session: base({ ...hearts(n), open_turns: n < 3 ? [q(n + 1)] : [], resolved_count: n, can_complete: n === 3, version: n + 1 }), replayed: false } };
      },
      'POST /api/learning/sessions/7/complete': { status: 200, body: { result: null, session: base({ status: 'completed', open_turns: [], resolved_count: 3, version: 9 }), replayed: false } },
    });
    for (const n of [1, 2, 3]) {
      expect(onScreen()).toContain(`Câu hỏi số ${n}?`);
      for (const other of [1, 2, 3].filter((x) => x !== n)) expect(onScreen()).not.toContain(`Câu hỏi số ${other}?`);
      fireEvent.press(await screen.findByRole('button', { name: n === 2 ? 'Sai 2' : `Đúng ${n}` }));
      await wait(1500);
      fireEvent.press(screen.getByRole('button', { name: n === 3 ? 'Xem kết quả' : 'Tiếp theo' }));
      await wait(1200);
      if (n === 2) expect(screen.getByLabelText('Còn 2 tim')).toBeTruthy(); // kept from one question to the next
    }
    for (let i = 0; i < 4; i++) await wait(500);
    expect(server.callsTo('POST /api/learning/sessions/7/answer').map((c) => c.body.turn_id)).toEqual(['turn-1', 'turn-2', 'turn-3']);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('a question practised again (another id, the same words) starts clean, not marked', async () => {
    const again = q(1, { turn_id: 'turn-1~1', practice: true });
    await play(base({ open_turns: [q(1)] }), {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ correct: false, outcome: 'wrong', correct_options: ['r1'], practice_added: true }),
        session: base({ open_turns: [again], resolved_count: 1, version: 2 }), replayed: false } },
    });
    fireEvent.press(await screen.findByRole('button', { name: 'Sai 1' }));
    await wait(1500);
    fireEvent.press(next());
    await wait(1200);
    expect(screen.getByRole('button', { name: 'Sai 1' }).props.accessibilityState.disabled).toBeFalsy();
    expect(screen.queryByRole('button', { name: 'Sai 1, chưa đúng' })).toBeNull();
    expect(screen.queryByText('Chưa chính xác!')).toBeNull();
    expect(onScreen().split('Câu hỏi số 1?').length).toBe(2); // once, not next to a copy left behind
  });

  it('from one game to another: nothing of the first one carries over', async () => {
    const other = base({ id: 8, game_type: 'math_bridge', game: 'math_bridge', open_turns: [turn('turn-m', 'missing_number', { equation: '2 + ▢ = 5' } as never)] });
    const { view } = await play(base(), threeQuestions());
    fireEvent.press(await screen.findByRole('button', { name: 'Sai 1' }));
    await wait(1500);
    view.rerender(<ToastProvider><ConfirmProvider>
      <GameScreen key={other.id} initial={other} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} />
    </ConfirmProvider></ToastProvider>);
    for (let i = 0; i < 5; i++) await ms(1000);
    const shown = onScreen();
    for (const old of ['Câu hỏi số 1?', 'Sai 1', 'Giải thích câu 1.', 'Chưa chính xác!', 'Tiếp theo']) expect(shown).not.toContain(old);
    expect(screen.getByRole('button', { name: 'Đặt đoạn cầu' })).toBeTruthy();
  });
});

describe('every game goes the same way', () => {
  // One question of each kind, how to answer it, and what to press: the same result card and the same "Tiếp theo".
  const tokens = [{ id: 'w1', text: 'Bé' }, { id: 'w2', text: 'lước' }];
  const cases: [string, Turn, () => void][] = [
    ['Chọn đáp án', turn('t1', 'choice_explain', { style: 'quiz', question: 'Hỏi?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }), () => fireEvent.press(screen.getByRole('button', { name: 'A' }))],
    ['Chọn cổng', turn('t1', 'gate_choice', { sentence: 'She __ a cat.', options: [{ id: 'a', text: 'is' }, { id: 'b', text: 'are' }] }), () => fireEvent.press(screen.getByRole('button', { name: 'Đáp án is' }))],
    ['Xếp câu', turn('t1', 'bridge_order', { tokens: [{ id: 'a', text: 'I' }], end: '.' }), () => { fireEvent.press(screen.getByRole('button', { name: 'Từ I' })); fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra câu' })); }],
    ['So sánh', turn('t1', 'compare', { left: '9', right: '6', options: [{ id: '>', text: '>' }, { id: '<', text: '<' }] }), () => fireEvent.press(screen.getByRole('button', { name: 'Dấu >' }))],
    ['Xây cầu toán học', turn('t1', 'missing_number', { equation: '2 + ▢ = 5' } as never), () => { fireEvent.press(screen.getByRole('button', { name: '3' })); fireEvent.press(screen.getByRole('button', { name: 'Đặt đoạn cầu' })); }],
    ['Ghép chữ (Xây cầu)', turn('t1', 'word_build', { picture: '🐱', unit: 'letter', tiles: [{ id: 'a', text: 'm' }] }), () => { fireEvent.press(screen.getByRole('button', { name: 'Chữ m' })); fireEvent.press(screen.getByRole('button', { name: 'Xây cầu' })); }],
    ['Thám tử chính tả', turn('t1', 'spell_fix', { step: 'fix', tokens, found: 'w2', options: [{ id: 'o1', text: 'nước' }] }), () => fireEvent.press(screen.getByRole('button', { name: 'Cách viết nước' }))],
    ['Phân loại', turn('t1', 'sort_card', { title: 'Nhóm?', groups: [{ id: 'g', label: 'Động vật', icon: '🐾' }], card: { text: 'Mèo', picture: '🐱' } }), () => fireEvent.press(screen.getByRole('button', { name: 'Nhóm Động vật' }))],
    ['Sắp xếp', turn('t1', 'order_steps', { prompt: 'Xếp', cards: [{ id: 'c', text: 'Một' }] }), () => { fireEvent.press(screen.getByRole('button', { name: 'Thẻ Một' })); fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' })); }],
  ];

  it.each(cases)('%s: wrong, then "Tiếp theo" brings one new question and leaves nothing behind', async (_name, first, answer) => {
    const second = q(2);
    const s = base({ open_turns: [first] });
    await play(s, {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ turn_id: 't1', correct: false, outcome: 'wrong', correct_answer: 'Đáp án A', correct_options: [], explanation: 'Vì lý do A.' }),
        session: base({ open_turns: [second], resolved_count: 1, version: 2 }), replayed: false } },
    });
    answer();
    await wait(3000);
    expect(screen.getByText('Chưa chính xác!')).toBeTruthy();
    expect(screen.getByText(/: Đáp án A$/)).toBeTruthy(); // the right answer, named after the game ("Thứ tự đúng"…)
    expect(screen.getByText('Vì lý do A.')).toBeTruthy();
    expect(onScreen()).not.toContain('Câu hỏi số 2?');
    fireEvent.press(next());
    await wait(3000);
    const shown = onScreen();
    expect(shown).toContain('Câu hỏi số 2?');
    expect(shown).not.toContain('Vì lý do A.');
    expect(shown).not.toContain('Chưa chính xác!');
    expect(screen.getByRole('button', { name: 'Đúng 2' }).props.accessibilityState.disabled).toBeFalsy();
  });

  it.each(cases)('%s: right, then the explanation and "Tiếp theo", never by itself', async (_name, first, answer) => {
    const s = base({ open_turns: [first] });
    await play(s, {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ turn_id: 't1', correct_options: [] }),
        session: base({ open_turns: [q(2)], resolved_count: 1, version: 2 }), replayed: false } },
    });
    answer();
    await wait(8000);
    expect(screen.getByText('Chính xác!')).toBeTruthy();
    expect(screen.getByText('Vì lý do A.')).toBeTruthy();
    expect(next()).toBeTruthy();
    expect(onScreen()).not.toContain('Câu hỏi số 2?');
  });

  it('in a world: a wrong answer never plays the right answer\'s victory; a right practice does', async () => {
    const math = (over: Partial<LearningSession>) => base({ subject: ref(1, 'math', 'Toán'), required_count: 4,
      catalog: { lesson: 'x', title: 'Bài', grade: 3, game: 'choice' as any, game_title: 'Chọn đáp án', short_stage: false, subject_name: null, other_games: [], next: null, world: 'kingdom' as any }, ...over });
    await play(math({}), {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ correct: false, outcome: 'wrong', correct_options: ['r1'] }),
        session: math({ open_turns: [q(2)], resolved_count: 1, version: 2 }), replayed: false } },
    });
    const health = () => screen.getByLabelText(/^Máu của /).props.accessibilityLabel;
    const before = health();
    fireEvent.press(await screen.findByRole('button', { name: 'Sai 1' }));
    await wait(3000);
    expect(health()).toBe(before); // the monster took no hit
    expect(next()).toBeTruthy();
  });

  it('a falling word stays what it is: no question held, no "Tiếp theo" after a right word', async () => {
    const word = turn('v1', 'vocab_typing', { meaning_vi: 'con mèo', letters: [3], answer_keys: [] } as never, { travel_seconds: 20 });
    const s = base({ game_type: 'meteor', game: 'meteor', variant: 'meteor' as any, open_turns: [word], hearts: 3, hearts_max: 3, timed: true, catalog: null });
    await play(s, {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ turn_id: 'v1', word: { en: 'cat', vi: 'con mèo', phonetic: null } }),
        session: base({ game_type: 'meteor', game: 'meteor', variant: 'meteor' as any, open_turns: [], resolved_count: 1, hearts: 3, hearts_max: 3, timed: true, catalog: null, version: 2 }), replayed: false } },
    });
    expect(screen.queryByRole('button', { name: 'Tiếp theo' })).toBeNull();
  });
});
