import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import { setSession } from '../src/api/client';
import { normalizeAnswer } from '../src/learning/answerKey';
import { DemoSession } from '../src/learning/tutorial/demoSession';
import { INITIAL, reduce, TutorialEvent, TutorialSnapshot } from '../src/learning/tutorial/machine';
import { handsOnSteps, TutorialDefinition, unsupported } from '../src/learning/tutorial/registry';
import { InteractiveTutorial } from '../src/screens/learning/tutorial/InteractiveTutorial';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';
import fixtures from '../test/tutorialFixtures.json';

// The definitions are the backend's own (generated from app/game_tutorials.py public()).
const defs = fixtures.definitions as unknown as Record<string, TutorialDefinition>;
const answers = fixtures.answers as Record<string, Record<string, string | string[]>>;
const REVEAL = new Set(['gate_choice', 'bridge_order', 'compare', 'choice_explain']);

jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as any);

/** The check endpoint, as the backend answers it (right or wrong; a reveal game resolves a wrong answer too). */
function checked(game: string, body: { turn_id: string; answer: string | string[] }) {
  const def = defs[game];
  const turn = def.demo.find((t) => t.turn_id === body.turn_id)!;
  const right = answers[game][body.turn_id];
  const correct = typeof right === 'string'
    ? normalizeAnswer(String(body.answer), turn.prompt.answer_lang) === normalizeAnswer(right, turn.prompt.answer_lang)
    : JSON.stringify(body.answer) === JSON.stringify(right);
  const resolved = correct || REVEAL.has(turn.kind);
  return { status: 200, body: { result: { turn_id: body.turn_id, event: 'answer', correct, outcome: resolved ? (correct ? 'first_try' : 'wrong') : null,
    resolved, retry_allowed: !resolved, error_type: correct ? null : 'wrong', score_delta: 0, hearts_delta: 0, combo: 0, hint: null,
    correct_answer: resolved ? String(right) : null, explanation: resolved ? 'Giải thích mẫu.' : null, practice_added: false, word: null,
    feedback: correct ? null : 'Chưa đúng.', kept: null, correct_options: resolved && typeof right === 'string' ? [right] : null, prompt: null } } };
}

function routes(game: string, extra: Record<string, unknown> = {}) {
  return {
    [`GET /api/games/${game}/tutorial`]: { status: 200, body: defs[game] },
    [`POST /api/games/${game}/tutorial/check`]: (req: { body: any }) => checked(game, req.body),
    [`POST /api/games/${game}/tutorial/progress`]: { status: 200, body: {} },
    [`POST /api/games/${game}/tutorial/complete`]: { status: 200, body: {} },
    ...extra,
  } as any;
}

const prefs = { sound: false, volume: 'mid' as const, reduceMotion: false, setSound: jest.fn(), setVolume: jest.fn(), setReduceMotion: jest.fn() };

function renderTutorial(game: string, props: Partial<React.ComponentProps<typeof InteractiveTutorial>> = {}) {
  const onStart = jest.fn();
  const onClose = jest.fn();
  const progress = { needs: jest.fn(() => true), finish: jest.fn(), skip: jest.fn(), left: jest.fn(), dismiss: jest.fn() };
  render(
    <ToastProvider><ConfirmProvider>
      <InteractiveTutorial game={game as any} petId="fox" petLevel={1} prefs={prefs} onStart={onStart} onClose={onClose} progress={progress}
        onSkip={onStart} {...props} />
    </ConfirmProvider></ToastProvider>,
  );
  return { onStart, onClose, progress };
}

const wait = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const noStage = (server: ReturnType<typeof mockServer>) => server.calls.filter((c) => c.method !== 'GET' && (c.path.startsWith('/api/learning/sessions') || c.path === '/api/learning/play'));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});
afterEach(() => { jest.useRealTimers(); });

// --- the state machine -------------------------------------------------------------------------------------------

describe('tutorial state machine', () => {
  const steps = defs.word_shooter.steps;
  const run = (events: TutorialEvent[], from: TutorialSnapshot = INITIAL) => events.reduce((s, e) => reduce(steps, s, e), from);

  it('goes intro → demonstrating → waiting → validating → step completed → next step, and completes after the last', () => {
    let s = run([{ type: 'start' }]);
    expect(s).toMatchObject({ state: 'INTRO', index: 0 });
    s = run([{ type: 'intro_done', animate: true }], s);
    expect(s.state).toBe('DEMONSTRATING');
    s = run([{ type: 'next' }, { type: 'step_done' }], s); // an observe step: "Tiếp"
    expect(s).toMatchObject({ state: 'INTRO', index: 1 });
    s = run([{ type: 'intro_done', animate: true }, { type: 'demo_done' }], s);
    expect(s.state).toBe('WAITING_FOR_ACTION');
    s = run([{ type: 'submitted' }], s);
    expect(s.state).toBe('VALIDATING_ACTION');
    s = run([{ type: 'answer', correct: true }], s);
    expect(s).toMatchObject({ state: 'STEP_COMPLETED', feedback: { tone: 'good' } });
    s = run([{ type: 'step_done' }, { type: 'next' }, { type: 'step_done' }], s);
    expect(s.state).toBe('TUTORIAL_COMPLETED');
    expect(s.done).toEqual(['watch', 'type', 'break']);
  });

  it('a wrong action keeps the step with its retry feedback; it never moves on or skips by itself', () => {
    let s = run([{ type: 'start' }, { type: 'next' }, { type: 'step_done' }, { type: 'intro_done', animate: false }]);
    expect(s).toMatchObject({ state: 'WAITING_FOR_ACTION', index: 1 });
    s = run([{ type: 'submitted' }, { type: 'answer', correct: false }], s);
    expect(s).toMatchObject({ state: 'WAITING_FOR_ACTION', index: 1, attempts: 1, feedback: { tone: 'bad', text: steps[1].retry_feedback } });
    s = run([{ type: 'next' }, { type: 'continue' }, { type: 'step_done' }], s); // nothing else moves it on
    expect(s).toMatchObject({ state: 'WAITING_FOR_ACTION', index: 1 });
    s = run([{ type: 'submitted' }, { type: 'failed' }], s); // no result: try again
    expect(s.state).toBe('WAITING_FOR_ACTION');
  });

  it('reduced motion goes straight to the action; skipping is kept apart from completing', () => {
    let s = run([{ type: 'start' }, { type: 'intro_done', animate: false }]);
    expect(s.state).toBe('WAITING_FOR_ACTION');
    s = run([{ type: 'skip' }], s);
    expect(s.state).toBe('SKIPPED');
    expect(run([{ type: 'answer', correct: true }, { type: 'step_done' }], s).state).toBe('SKIPPED');
  });

  it('a landing is the step of an observe-a-landing step', () => {
    const meteor = defs.meteor.steps;
    let s: TutorialSnapshot = { ...INITIAL, state: 'WAITING_FOR_ACTION', index: 3 };
    s = reduce(meteor, s, { type: 'next' });
    expect(s.state).toBe('WAITING_FOR_ACTION'); // "Tiếp" does not replace watching it land
    s = reduce(meteor, s, { type: 'miss' });
    expect(s.state).toBe('STEP_COMPLETED');
  });
});

describe('definitions', () => {
  it('every definition served is playable here, and has hands-on steps', () => {
    for (const def of Object.values(defs)) {
      expect(unsupported(def)).toEqual([]);
      expect(handsOnSteps(def).length).toBeGreaterThan(0);
    }
  });

  it('an unknown action, target or animation is refused rather than shown wrong', () => {
    const def = defs.defense;
    expect(unsupported({ ...def, steps: [{ ...def.steps[1], action: 'teleport' as any }] })).toEqual(expect.arrayContaining([expect.stringMatching(/action/)]));
    expect(unsupported({ ...def, steps: [{ ...def.steps[1], target: 'moon' as any }] })).toEqual(expect.arrayContaining([expect.stringMatching(/target/)]));
    expect(unsupported({ ...def, steps: [{ ...def.steps[1], demo_animation: 'laser' as any }] })).toEqual(expect.arrayContaining([expect.stringMatching(/animation/)]));
    expect(unsupported({ ...def, steps: [def.steps[0]] })).toContain('no hands-on step');
  });
});

// --- the demo session --------------------------------------------------------------------------------------------

describe('demo session', () => {
  it('brings turns in only when a step releases them, and an answer never touches a stage', async () => {
    const check = jest.fn(async (turnId: string, answer: unknown) => checked('defense', { turn_id: turnId, answer: answer as string }).body.result);
    const demo = new DemoSession(defs.defense, check as any);
    const pushed = jest.fn();
    demo.subscribe(pushed);
    expect(demo.snapshot.open_turns).toEqual([]);
    expect(demo.snapshot).toMatchObject({ id: -1, game: 'defense', game_type: 'defense', hearts: 3, hearts_max: 3, timed: false, can_complete: false });
    demo.release(['t1']);
    demo.release(['t1']); // never twice
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(demo.snapshot.open_turns.map((t) => t.turn_id)).toEqual(['t1']);
    const wrong = await demo.turn(-1, { type: 'answer', turnId: 't1', answer: '8', eventId: 'e1' });
    expect(wrong.result).toMatchObject({ correct: false, resolved: false, retry_allowed: true, hearts_delta: 0, score_delta: 0 });
    expect(demo.snapshot.hearts).toBe(3); // a tutorial never takes a heart for a wrong answer
    const right = await demo.turn(-1, { type: 'answer', turnId: 't1', answer: '7', eventId: 'e2' });
    expect(right.result).toMatchObject({ correct: true, resolved: true });
    expect(right.session).toMatchObject({ resolved_count: 1, open_turns: [], can_complete: false });
    expect(check).toHaveBeenCalledWith('t1', '7');
    expect((await demo.complete()).result).toBeNull(); // finished by its steps, never as a stage
  });

  it('a reveal game shows the answer, then plays the same question once more (as a stage does)', async () => {
    const demo = new DemoSession(defs.gate, (async (turnId: string, answer: string) => checked('gate', { turn_id: turnId, answer }).body.result) as any);
    demo.release(['t1']);
    const wrong = await demo.turn(-1, { type: 'answer', turnId: 't1', answer: 'o1', eventId: 'e1' });
    expect(wrong.result).toMatchObject({ correct: false, resolved: true });
    const again = wrong.session.open_turns;
    expect(again).toHaveLength(1);
    expect(again[0].turn_id).not.toBe('t1');
    const check = jest.fn(async (turnId: string, answer: string) => checked('gate', { turn_id: turnId, answer }).body.result);
    (demo as any).check = check;
    await demo.turn(-1, { type: 'answer', turnId: again[0].turn_id, answer: 'o2', eventId: 'e2' });
    expect(check).toHaveBeenCalledWith('t1', 'o2'); // the copy is checked as the demo turn it repeats
  });

  it('a landing takes a demo heart, never the last one, and tells the word', async () => {
    const check = jest.fn(async () => ({ word: { en: 'dog', vi: 'con chó', phonetic: null }, correct_answer: 'dog' }));
    const demo = new DemoSession({ ...defs.meteor, hearts: 1 }, check as any);
    demo.release(['t2'], 6);
    expect(demo.snapshot.open_turns[0].travel_seconds).toBe(6);
    const landed = await demo.turn(-1, { type: 'miss', turnId: 't2', eventId: 'e1' });
    expect(landed.result).toMatchObject({ event: 'miss', word: { en: 'dog' }, hearts_delta: 0 });
    expect(landed.session.hearts).toBe(1);
    expect(check).toHaveBeenCalledWith('t2', null, 'miss');
  });
});

// --- played in the real game -------------------------------------------------------------------------------------

describe('played in the real game screen', () => {
  it('Math Battle: the real battle and number pad; a wrong attack is retried, a right one hits; nothing counts', async () => {
    const server = mockServer(routes('defense'));
    const { onStart, progress } = renderTutorial('defense');
    expect(await screen.findByText('Quái vật mang phép tính đang tiến tới!')).toBeTruthy();
    expect(screen.getByText('Hướng dẫn · Bước 1/3')).toBeTruthy();
    expect(screen.getByTestId('game-play-area').props.pointerEvents).toBe('none'); // a step to watch: the game's input is held
    expect(screen.queryByText('Nháp')).toBeNull(); // nothing of a stage's extras
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
    await wait(400);
    expect(await screen.findByText('Bấm 7 trên bàn phím số rồi nhấn Tấn công')).toBeTruthy();
    expect(screen.getByTestId('game-play-area').props.pointerEvents).toBe('auto');
    expect(screen.getByTestId('game-input-area').props.pointerEvents).toBe('auto');
    // The real number pad of the game.
    fireEvent.press(screen.getByRole('button', { name: '8' }));
    fireEvent.press(screen.getByRole('button', { name: 'Tấn công' }));
    expect(await screen.findByText('3 + 4 = 7. Bấm 7 rồi nhấn Tấn công nhé.')).toBeTruthy();
    expect(screen.getByText('Hướng dẫn · Bước 2/3')).toBeTruthy(); // stays on the step
    await wait(2500); // the game's own reaction to the wrong answer plays first (as in a stage)
    fireEvent.press(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.press(screen.getByRole('button', { name: '7' }));
    fireEvent.press(screen.getByRole('button', { name: 'Tấn công' }));
    expect(await screen.findByText(/Trúng đòn! Quái vật mất máu!/)).toBeTruthy();
    await wait(1500);
    expect(await screen.findByText('Thanh máu của quái vật giảm dần. Pet thắng!')).toBeTruthy();
    await wait(3000); // moves on by itself once watched
    expect(await screen.findByText('Bạn đã sẵn sàng!')).toBeTruthy();
    expect(progress.finish).toHaveBeenCalledWith(expect.objectContaining({ game_id: 'defense' }), ['watch', 'attack', 'hit']);
    const checks = server.callsTo('POST /api/games/defense/tutorial/check');
    expect(checks.map((c) => c.body.answer)).toEqual(['8', '7']);
    expect(checks[0].body).toMatchObject({ tutorial_version: defs.defense.tutorial_version, turn_id: 't1' });
    expect(noStage(server)).toEqual([]); // no stage: no score, hearts, EXP or progress
    const start = screen.getByRole('button', { name: 'Bắt đầu chơi' });
    fireEvent.press(start);
    fireEvent.press(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('Xây câu: the real train; tiles loaded and checked, then the explanation closed', async () => {
    const server = mockServer(routes('sentence'));
    const { progress } = renderTutorial('sentence');
    expect(await screen.findByText('Kéo I → like → cats. lên toa; để thẻ “is” lại')).toBeTruthy();
    await wait(2600);
    expect(screen.getByLabelText('Nghĩa của câu: Tôi thích mèo.')).toBeTruthy(); // the game's own scene
    for (const word of ['like', 'I', 'cats.']) fireEvent.press(screen.getByRole('button', { name: `Thẻ ${word}` }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(await screen.findByText(/Toa sai viền đỏ/)).toBeTruthy();
    expect(server.callsTo('POST /api/games/sentence/tutorial/check')[0].body.answer).toEqual(['t3', 't4', 't1']);
    fireEvent.press(screen.getByRole('button', { name: 'Xếp lại' }));
    for (const word of ['I', 'like', 'cats.']) fireEvent.press(screen.getByRole('button', { name: `Thẻ ${word}` }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(await screen.findByText(/Câu đúng! Tàu sáng đèn!/)).toBeTruthy();
    await wait(6000); // the world's reaction, then the next step
    expect(await screen.findByText('Đọc giải thích rồi nhấn Tiếp tục')).toBeTruthy();
    fireEvent.press(await screen.findByRole('button', { name: 'Tiếp tục' }));
    await wait(500);
    expect(await screen.findByText('Bạn đã sẵn sàng!')).toBeTruthy();
    expect(progress.finish).toHaveBeenCalledWith(expect.anything(), ['build', 'read']);
  });

  it('"Bỏ qua" records it as skipped (not completed) and starts the game; leaving from the pause menu saves nothing as done', async () => {
    mockServer(routes('gate'));
    const first = renderTutorial('gate');
    fireEvent.press(await screen.findByRole('button', { name: 'Bỏ qua hướng dẫn' }));
    expect(first.progress.skip).toHaveBeenCalledWith(expect.objectContaining({ game_id: 'gate' }));
    expect(first.progress.finish).not.toHaveBeenCalled();
    expect(first.onStart).toHaveBeenCalledTimes(1);
    screen.unmount();

    const second = renderTutorial('gate');
    await screen.findByText('Chạm vào cổng có từ đúng để điền chỗ trống');
    expect(second.progress.left).toHaveBeenCalledWith(expect.objectContaining({ game_id: 'gate' }), 0); // where it was left
    act(() => { BackHandler.exitApp = jest.fn(); });
    fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(await screen.findByText('Tạm dừng hướng dẫn')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Thoát hướng dẫn' }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.progress.finish).not.toHaveBeenCalled();
  });

  it('a game without a tutorial says so and is logged; it never borrows another game\'s', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const server = mockServer({ 'GET /api/games/balance/tutorial': { status: 404, body: { detail: 'not set up', code: 'tutorial_missing' } } });
    const { onStart, progress } = renderTutorial('balance');
    expect(await screen.findByText('Hướng dẫn chưa sẵn sàng')).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('balance'));
    expect(server.calls.filter((c) => c.path.startsWith('/api/games/') && !c.path.startsWith('/api/games/balance/'))).toEqual([]);
    fireEvent.press(screen.getByRole('button', { name: 'Chơi luôn' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(progress.dismiss).toHaveBeenCalledWith('balance'); // said once, not before every game
    warn.mockRestore();
  });

  it('a newer tutorial on the server reloads it instead of going on with the old one', async () => {
    let served = 0;
    mockServer(routes('defense', {
      'GET /api/games/defense/tutorial': () => { served += 1; return { status: 200, body: defs.defense }; },
      'POST /api/games/defense/tutorial/check': { status: 409, body: { detail: 'reload', code: 'tutorial_outdated' } },
    }));
    renderTutorial('defense');
    fireEvent.press(await screen.findByRole('button', { name: 'Tiếp' }));
    await wait(400);
    fireEvent.press(await screen.findByRole('button', { name: '7' }));
    fireEvent.press(screen.getByRole('button', { name: 'Tấn công' }));
    await waitFor(() => expect(served).toBe(2));
  });
});

// --- from the subject's game list ---------------------------------------------------------------------------------

describe('first time a game is played', () => {
  const { LearningScreen } = require('../src/screens/learning/LearningScreen');
  const catalog = { default_duration_minutes: 10, subjects: [{ id: 1, code: 'english', name: 'Tiếng Anh', levels: [], topics: [], lessons: [] }],
    programme: { curriculum: 'GDPT2018', grade: 'grade3', level: null, outside_school: false, label: 'Lớp 3', note: null,
      subjects: [{ code: 'english', name: 'Tiếng Anh', games: [{ id: 'word_shooter', grades: '3-12' }, { id: 'meteor', grades: '3-12' }] }] } };
  const stage = { id: 5, status: 'paused', kind: 'lesson', mode: 'practice', game_type: 'meteor', variant: 'word_shooter', game: 'word_shooter',
    subject: { id: 1, code: 'english', name: 'Tiếng Anh' }, topic: { id: 1, code: 'animals', name: 'Con vật' }, level: { id: 1, code: 'a1', name: 'A1' },
    lesson: { id: 7, code: 'en.vocab.mix', name: 'Từ vựng' }, duration_seconds: 600, active_ms: 0, remaining_ms: 600000, time_up: false,
    hearts: 5, hearts_max: 5, score: 0, combo: 0, max_combo: 0, required_count: 15, resolved_count: 0, pending_practice: 0, open_turns: [],
    can_complete: false, end_reason: null, reward: null, version: 1, server_time: new Date().toISOString() };

  it('plays the tutorial in the game itself, then "Bắt đầu chơi" creates the real stage with its countdown', async () => {
    const server = mockServer({
      ...routes('word_shooter'),
      'GET /api/games/tutorials/progress': { status: 200, body: { games: { word_shooter: { game_id: 'word_shooter', required: true,
        tutorial_version: defs.word_shooter.tutorial_version, gameplay_version: 1, status: 'not_started', current_step: 0, completed_at: null } } } },
      'GET /api/learning/catalog': { status: 200, body: catalog },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
      'POST /api/learning/play': { status: 201, body: stage },
    });
    render(<ToastProvider><ConfirmProvider><LearningScreen user={{ ...USER, id: 1, pet: 'fox', level: 1 } as any} defaultDuration={25} focus={null}
      onFreeStudy={jest.fn()} onRewards={jest.fn()} /></ConfirmProvider></ToastProvider>);
    fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
    fireEvent.press(await screen.findByRole('button', { name: /^Bắn từ tiếng Anh/ }));
    expect(await screen.findByText('Nhìn kìa! Một từ đang rơi xuống!')).toBeTruthy();
    // The real falling-word field, with the demo word in it.
    fireEvent(await screen.findByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
    await wait(400);
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
    await wait(700);
    expect(await screen.findByText('Gõ nghĩa của “apple”: quả táo')).toBeTruthy();
    const field = await screen.findByLabelText('Nghĩa tiếng Việt');
    fireEvent.changeText(field, 'quả cam');
    fireEvent(field, 'submitEditing');
    expect(await screen.findByText(/Chưa đúng\. Gõ “quả táo” nhé/)).toBeTruthy();
    fireEvent.changeText(field, 'qua tao'); // right without tone marks: the pet shoots at once, as in a stage
    expect(await screen.findByText(/Chính xác! Pet bắn ngay!/)).toBeTruthy();
    await wait(1500);
    expect(await screen.findByText('Đạn trúng: từ vỡ ra và hiện nghĩa tiếng Việt.')).toBeTruthy();
    await wait(3000);
    expect(await screen.findByText('Giỏi lắm! Bạn đã biết cách bắn từ rồi!')).toBeTruthy();
    await waitFor(() => expect(server.callsTo('POST /api/games/word_shooter/tutorial/complete')).toHaveLength(1));
    expect(server.callsTo('POST /api/games/word_shooter/tutorial/complete')[0].body).toEqual({ game_mode: 'practice',
      tutorial_version: defs.word_shooter.tutorial_version, gameplay_version: 1, steps_done: ['watch', 'type', 'break'] });
    expect(server.callsTo('POST /api/games/word_shooter/tutorial/check').map((c) => c.body.answer)).toEqual(['quả cam', 'qua tao']);
    expect(noStage(server)).toEqual([]); // nothing of a stage during the tutorial
    fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu chơi' }));
    await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(1));
    expect(await screen.findByText('3')).toBeTruthy(); // the real game's 3-2-1 countdown
    expect(screen.queryByTestId('tutorial-coach')).toBeNull(); // no demo left in Play Mode
    expect(JSON.parse((await AsyncStorage.getItem('mirabi.learning.tutorials.interactive:1'))!).done.word_shooter)
      .toEqual({ status: 'completed', tutorial_version: defs.word_shooter.tutorial_version, gameplay_version: 1 });
  });
});

// --- watched again during a game --------------------------------------------------------------------------------------

describe('watched again from the pause menu', () => {
  const { GameScreen } = require('../src/screens/learning/GameScreen');
  const monster = { turn_id: 'turn-1', position: 1, kind: 'math_input', skill_label: 'Phép cộng', prompt: { expression: '12 + 5', allow_negative: false },
    hints_shown: [], hints_total: 1, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 };
  const real = (patch: Record<string, unknown> = {}) => ({ id: 5, status: 'active', kind: 'lesson', mode: 'practice', game_type: 'defense', variant: null,
    game: 'defense', subject: { id: 2, code: 'math', name: 'Toán' }, topic: { id: 2, code: 'arithmetic', name: 'Cộng' }, level: { id: 2, code: 'g3', name: 'Lớp 3' },
    lesson: { id: 9, code: 'math.add', name: 'Cộng' }, duration_seconds: 600, active_ms: 0, remaining_ms: 600000, time_up: false, hearts: 2, hearts_max: 3,
    score: 0, combo: 0, max_combo: 0, required_count: 10, resolved_count: 4, pending_practice: 0, open_turns: [monster], can_complete: false,
    end_reason: null, reward: null, version: 7, server_time: new Date().toISOString(), ...patch });

  it('the real game stays paused and untouched; "Tiếp tục chơi" goes on with the same game after 3-2-1', async () => {
    const server = mockServer({ ...routes('defense'),
      'POST /api/learning/sessions/5/pause': { status: 200, body: { result: null, session: real({ status: 'paused', version: 8 }), replayed: false } },
      'POST /api/learning/sessions/5/resume': { status: 200, body: { result: null, session: real({ version: 9 }), replayed: false } } });
    render(<ToastProvider><ConfirmProvider>
      <GameScreen initial={real({ status: 'paused' })} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} />
    </ConfirmProvider></ToastProvider>);
    fireEvent.press(await screen.findByRole('button', { name: 'Xem lại hướng dẫn' }));
    // The tutorial's own demo (3 hearts, its own monster), over the paused game (2 hearts, 4/10 done, its own monster).
    expect(await screen.findByText('Quái vật mang phép tính đang tiến tới!')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
    await wait(400);
    // The paused game underneath has its own number pad: the tutorial's is the one drawn over it.
    const sevens = await screen.findAllByRole('button', { name: '7' });
    fireEvent.press(sevens[sevens.length - 1]);
    const attacks = screen.getAllByRole('button', { name: 'Tấn công' });
    fireEvent.press(attacks[attacks.length - 1]);
    expect(await screen.findByText(/Trúng đòn!/)).toBeTruthy();
    await wait(1500);
    expect(await screen.findByText('Thanh máu của quái vật giảm dần. Pet thắng!')).toBeTruthy();
    await wait(3000);
    expect(await screen.findByText('Bạn đã sẵn sàng!')).toBeTruthy();
    expect(server.calls.filter((c) => c.path.startsWith('/api/learning/sessions/5'))).toEqual([]); // the real game was never touched
    expect(server.callsTo('POST /api/games/defense/tutorial/complete')).toHaveLength(0); // watching again saves nothing
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục chơi' }));
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.queryByTestId('interactive-tutorial')).toBeNull();
    await wait(1000); await wait(1000); await wait(1000); await wait(1000);
    await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1));
    expect(await screen.findByText('12 + 5 = ?')).toBeTruthy(); // the same monster as before, nothing reset
  });
});
