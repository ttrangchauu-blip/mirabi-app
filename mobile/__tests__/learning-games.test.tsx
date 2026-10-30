import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';
import { setSession } from '../src/api/client';
import type { LearningSession, Turn } from '../src/learning/types';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { pressKey } from '../src/screens/learning/games/NumberPad';
import { answerKey } from '../src/learning/answerKey';
import { TUTORIAL_VERSION, VOCAB_HEARTS, VOCAB_STAGE_WORDS } from '../src/learning/tutorials';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { deferred, mockServer, networkDown, USER } from '../test/mockServer';

const ref = (id: number, code: string, name: string) => ({ id, code, name });
const turn = (over: Partial<Turn> = {}): Turn => ({
  turn_id: 'turn-0001-abcdef', position: 0, kind: 'vocab_typing', skill_label: 'Từ vựng',
  prompt: { meaning_vi: 'con mèo', context_vi: null, letters: [3], answer_keys: [answerKey('turn-0001-abcdef', 'cat')] },
  hints_shown: [], hints_total: 2, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0, ...over,
});
const session = (over: Partial<LearningSession> = {}): LearningSession => ({
  id: 5, status: 'active', kind: 'lesson', mode: 'practice', game_type: 'meteor', variant: null, game: 'meteor',
  subject: ref(1, 'english', 'Tiếng Anh'), topic: ref(1, 'animals', 'Động vật'), level: ref(1, 'starter', 'Khởi đầu'),
  lesson: ref(3, 'en.animals.starter', 'Các con vật quen thuộc'), duration_seconds: 1500, active_ms: 0, remaining_ms: 1_500_000,
  time_up: false, hearts: 0, hearts_max: 0, score: 0, combo: 0, max_combo: 0, required_count: 12, resolved_count: 0,
  pending_practice: 0, open_turns: [turn()], can_complete: false, end_reason: null, reward: null, version: 1,
  server_time: '2026-10-26T10:00:00Z', ...over,
});
const catalog = {
  default_duration_minutes: 25,
  subjects: [
    { id: 1, code: 'english', name: 'Tiếng Anh', levels: [{ id: 1, code: 'starter', name: 'Khởi đầu', description: 'Lớp 3–4' }],
      topics: [{ id: 1, code: 'animals', name: 'Động vật', skill_type: 'vocabulary', description: null, review_count: 0 },
        { id: 3, code: 'to_be', name: 'Động từ to be', skill_type: 'grammar', description: null, review_count: 0 }],
      lessons: [{ id: 3, code: 'en.animals.starter', title: 'Các con vật quen thuộc', topic_id: 1, level_id: 1, game_type: 'meteor', turns: 12, variants: ['meteor', 'word_shooter'], version: 1 },
        { id: 4, code: 'en.to_be.basic', title: 'Động từ to be', topic_id: 3, level_id: 1, game_type: 'grammar', turns: 12, variants: ['mixed', 'gate', 'bridge'], version: 1 }] },
    { id: 2, code: 'math', name: 'Toán', levels: [{ id: 2, code: 'grade3', name: 'Lớp 3', description: null }],
      topics: [{ id: 2, code: 'arithmetic', name: 'Cộng, trừ, nhân, chia', skill_type: 'arithmetic', description: null, review_count: 0 }],
      lessons: [{ id: 9, code: 'math.arithmetic.grade3', title: 'Tính trong phạm vi 1000', topic_id: 2, level_id: 2, game_type: 'defense', turns: 12, variants: [], version: 1 }] },
  ],
};
// The words drawn for this session (random every session).
const intro = { intro: { kind: 'vocabulary', title: 'Các con vật quen thuộc', tip: 'Đọc to từng từ.',
  words: [{ word: 'cat', meaning_vi: 'con mèo', context_vi: null, part_of_speech: 'noun', phonetic: '/kæt/', example_en: 'The cat sleeps.', example_vi: 'Con mèo ngủ.' }] } };
const created = () => session({ status: 'paused', open_turns: [] });
const resumed = { result: null, session: session({ version: 2 }), replayed: false };
const result = (s: LearningSession) => ({ session: s, open_review_count: 0,
  counts: { first_try: 12, hinted: 0, corrected: 0, wrong: 0, revealed: 0, missed: 0, unanswered: 0 },
  items: [{ turn_id: 'turn-0001-abcdef', position: 0, kind: 'vocab_typing', skill_label: 'cat – con mèo', prompt: { meaning_vi: 'con mèo' },
    outcome: 'first_try', practice: false, attempts: 1, hints_used: 0, error_type: null, correct_answer: 'cat', explanation: '“con mèo” là “cat”.' }] });
const correct = { turn_id: 'turn-0001-abcdef', event: 'answer', correct: true, outcome: 'first_try', resolved: true, retry_allowed: false,
  error_type: null, score_delta: 0, hearts_delta: 0, combo: 0, hint: null, correct_answer: 'cat', explanation: null, practice_added: false };
const finished = session({ resolved_count: 12, open_turns: [], can_complete: true, version: 2 });
const completed = session({ status: 'completed', resolved_count: 12, open_turns: [], reward: { status: 'granted', exp: 10 }, version: 3 });

// Captures the app-state listener so a test can send the app to the background.
let appStateListener: ((state: string) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (state: string) => void) => {
  appStateListener = fn;
  return { remove: jest.fn() };
}) as any);

const onRewards = jest.fn();
const onFreeStudy = jest.fn();

function renderLearning(focus: { status: string; clock: string } | null = null) {
  return render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, id: 1, pet: 'fox', level: 1 } as any} defaultDuration={25} focus={focus}
        onFreeStudy={onFreeStudy} onRewards={onRewards} />
    </ConfirmProvider></ToastProvider>,
  );
}

/** Effects chain the countdown one second at a time, so advance step by step. */
async function seconds(n: number) {
  for (let i = 0; i < n; i++) await act(async () => { jest.advanceTimersByTime(1000); });
}

/** Học tập → Tiếng Anh → a game: it starts at once (no topic, level or setup to choose). */
async function chooseGame(game: RegExp = /^Bắn thiên thạch \(Việt → Anh\)\./) {
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  fireEvent.press(await screen.findByRole('button', { name: game }));
}

async function startGame() {
  await chooseGame();
  await seconds(4); // 3-2-1 countdown, then the session is resumed on the server
  // The sky is measured on screen before meteors are placed; the answer box rides on the aimed meteor.
  fireEvent(await screen.findByLabelText('Bầu trời thiên thạch'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
  await screen.findByLabelText('Đáp án tiếng Anh');
  expect(screen.getByLabelText('Thiên thạch đang nhắm: con mèo')).toBeTruthy();
}

/** Every game's guide already read (the guide itself has its own tests below). */
const ALL_GAMES = ['word_shooter', 'meteor', 'gate', 'bridge', 'grammar', 'defense', 'math_bridge'];
const startRoutes = {
  'GET /api/learning/tutorials': { status: 200, body: { seen: ALL_GAMES } },
  'GET /api/learning/catalog': { status: 200, body: catalog },
  'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
  'POST /api/learning/play': { status: 201, body: created() },
  'POST /api/learning/sessions': { status: 201, body: created() },
  'GET /api/learning/sessions/5/intro': { status: 200, body: intro },
  'POST /api/learning/sessions/5/resume': { status: 200, body: resumed },
  // Falling words ask for a new word on their own timer; by default no word is left to open (an older version: kept as is).
  'POST /api/learning/sessions/5/next': { status: 200, body: { result: null, session: session({ version: 0 }), replayed: false } },
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  onRewards.mockReset(); onFreeStudy.mockReset();
});
afterEach(() => { jest.useRealTimers(); });

test('choose a game, play right away, and see the reward the server confirmed', async () => {
  const server = mockServer({
    ...startRoutes,
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: correct, session: finished, replayed: false } },
    'POST /api/learning/sessions/5/complete': { status: 200, body: { result: null, session: completed, replayed: false } },
    'GET /api/learning/sessions/5/result': { status: 200, body: result(completed) },
  });
  await startGame();
  const start = server.callsTo('POST /api/learning/play')[0];
  expect(start.body).toMatchObject({ game: 'meteor', mode: 'practice' }); // the backend picks the words
  expect(server.callsTo('POST /api/learning/sessions')).toHaveLength(0);
  expect(server.callsTo('GET /api/learning/sessions/5/intro')).toHaveLength(0); // no lesson screen before playing
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1);
  expect(start.headers['Idempotency-Key']).toMatch(/.{8,}/);
  expect(screen.getAllByText('con mèo').length).toBeGreaterThan(0); // on the question card and on the falling meteor
  expect(screen.queryByText(/EXP/)).toBeNull();

  // Học tập: the meteor visibly falls, then stops above the ground and waits (it never costs a heart).
  const top = () => StyleSheet.flatten(screen.getByLabelText('Thiên thạch đang nhắm: con mèo').props.style).top as number;
  const first = top();
  await seconds(3);
  const falling = top();
  await seconds(40);
  const waiting = top();
  await seconds(10);
  expect(screen.queryByText(/chữ cái/)).toBeNull(); // the letter boxes alone show the word's length
  expect(falling).toBeGreaterThan(first);
  expect(waiting).toBeGreaterThan(falling);
  expect(top()).toBe(waiting);
  expect(server.callsTo('POST /api/learning/sessions/5/miss')).toHaveLength(0);

  expect(screen.queryByRole('button', { name: 'Bắn' })).toBeNull(); // no "Bắn": a right answer is shot as it is typed
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'Ca');
  await seconds(2);
  expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(0); // not finished: nothing is sent
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), '  Cat ');
  // The last word was right: the stage ends once its bullet has hit and its meaning has shown, never before.
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(1));
  expect(server.callsTo('POST /api/learning/sessions/5/complete')).toHaveLength(0);
  await seconds(3);
  expect(await screen.findByText('Hoàn thành chặng!')).toBeTruthy();
  expect(screen.getByText('+10 EXP cho pet của bạn')).toBeTruthy();
  const answer = server.callsTo('POST /api/learning/sessions/5/answer')[0];
  expect(answer.body).toMatchObject({ turn_id: 'turn-0001-abcdef', answer: '  Cat ' });
  expect(answer.body.client_event_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  expect(answer.body).not.toHaveProperty('score');
  expect(server.callsTo('POST /api/learning/sessions/5/complete')).toHaveLength(1);
  expect(onRewards).toHaveBeenCalled();
});

test('a lost connection pauses the game, keeps the typed answer and retries with the same event id', async () => {
  let attempts = 0;
  const server = mockServer({
    ...startRoutes,
    'POST /api/learning/sessions/5/answer': () => (++attempts === 1 ? networkDown() : { status: 200,
      body: { result: { ...correct, correct: false, outcome: null, resolved: false, retry_allowed: true }, session: session({ version: 2 }), replayed: false } }),
  });
  await startGame();
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'dgo'); // every box filled, not right: sent after a short pause
  expect(await screen.findByText(/Mất kết nối/)).toBeTruthy();
  expect(screen.getByLabelText('Đáp án tiếng Anh').props.value).toBe('dgo');

  fireEvent.press(screen.getByRole('button', { name: 'Thử lại kết nối' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(2));
  const [first, retry] = server.callsTo('POST /api/learning/sessions/5/answer');
  expect(retry.body.client_event_id).toBe(first.body.client_event_id);
  await waitFor(() => expect(screen.queryByText(/Mất kết nối/)).toBeNull());
  expect(await screen.findByText('Chưa đúng, sửa lại nhé!')).toBeTruthy();
});

test('leaving the app pauses the session; continuing counts down before resuming', async () => {
  let resumes = 0;
  const server = mockServer({
    ...startRoutes,
    'POST /api/learning/sessions/5/pause': { status: 200, body: { result: null, session: session({ status: 'paused', version: 3 }), replayed: false } },
    'POST /api/learning/sessions/5/resume': () => ({ status: 200, body: { result: null, session: session({ version: ++resumes === 1 ? 2 : 4 }), replayed: false } }),
  });
  await startGame();
  act(() => appStateListener?.('background'));
  expect(await screen.findByText('Tạm dừng')).toBeTruthy();
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/pause')).toHaveLength(1));

  fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục học' }));
  expect(screen.getByText('3')).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1); // not again before the countdown ends
  await seconds(4);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(2));
  await waitFor(() => expect(screen.queryByText('Tạm dừng')).toBeNull());
});

test('a stage ended on another device shows its result', async () => {
  const ended = session({ status: 'abandoned', open_turns: [], end_reason: 'user_ended', reward: { status: 'not_eligible', exp: 0 }, version: 4 });
  mockServer({
    'GET /api/learning/catalog': { status: 200, body: catalog },
    'GET /api/learning/sessions/current': { status: 200, body: { session: session({ status: 'paused' }) } },
    'GET /api/learning/sessions/5': { status: 200, body: ended },
    'POST /api/learning/sessions/5/resume': { status: 409, body: { detail: 'ended', code: 'session_ended' } },
    'GET /api/learning/sessions/5/result': { status: 200, body: { ...result(ended), counts: { ...result(ended).counts, first_try: 3, unanswered: 9 } } },
  });
  renderLearning();
  expect(await screen.findByText('Tiếp tục phiên học')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(await screen.findByText('Tạm dừng')).toBeTruthy(); // restored as paused, same as on the other device
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục học' }));
  await seconds(4);
  expect(await screen.findByText('Đã kết thúc')).toBeTruthy();
  expect(screen.getByText('Hoàn thành chặng để nhận EXP nhé.')).toBeTruthy();
});

test('Học tập opens on the subject screen; English lists four games that start at once, Math keeps its setup', async () => {
  const server = mockServer({ 'GET /api/learning/catalog': { status: 200, body: catalog }, 'GET /api/learning/sessions/current': { status: 200, body: { session: null } } });
  renderLearning();
  expect(await screen.findByText('Chọn môn học')).toBeTruthy();
  for (const name of [/^Tiếng Anh\./, /^Toán\./, /^Học tự chọn\./]) expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.queryByText('Tiếp tục phiên học')).toBeNull(); // nothing left open

  fireEvent.press(screen.getByRole('button', { name: /^Tiếng Anh\./ }));
  expect(screen.getByText('Chọn trò chơi')).toBeTruthy();
  for (const name of ['Bắn từ tiếng Anh (Anh → Việt). Gõ lại từ tiếng Anh đang rơi, xem nghĩa tiếng Việt.',
    'Bắn thiên thạch (Việt → Anh). Nhìn nghĩa tiếng Việt, gõ từ tiếng Anh.',
    'Chọn đáp án ngữ pháp. Chọn đáp án đúng cho chỗ trống trong câu.', 'Sắp xếp câu. Ghép các mảnh từ thành câu đúng.']) {
    expect(screen.getByRole('button', { name })).toBeTruthy();
  }
  // No topic, level, mode or setup screen ("Thử thách" is gone: every game plays in Học tập); each game has its guide.
  expect(screen.queryByRole('radio', { name: 'Thử thách' })).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Học tập' })).toBeNull();
  expect(screen.queryByText('Thử thách')).toBeNull();
  expect(screen.getByRole('button', { name: 'Cách chơi Bắn thiên thạch' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bắt đầu' })).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Động vật' })).toBeNull();
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(0); // looking around never starts a session
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));

  fireEvent.press(await screen.findByRole('button', { name: /^Toán\./ }));
  expect(screen.getByRole('button', { name: /^Bảo vệ căn cứ\./ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Xây cầu toán học\./ })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: /^Bảo vệ căn cứ\./ }));
  expect(screen.getByText('Lớp')).toBeTruthy(); // grade first for Math
  fireEvent.press(screen.getByRole('radio', { name: 'Cộng, trừ, nhân, chia' }));
  expect(screen.queryByText('Chế độ')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Thử thách' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions')).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));

  fireEvent.press(await screen.findByRole('button', { name: /^Học tự chọn\./ }));
  expect(onFreeStudy).toHaveBeenCalled();
});

const gateTurn = turn({ kind: 'gate_choice', skill_label: 'Hiện tại hoàn thành với for / since', travel_seconds: 0,
  prompt: { sentence: 'My aunt has worked at the hospital ___ 2015.', context_vi: 'Nói về thời gian làm việc kéo dài tới nay', level: 'Mức 3',
    options: [{ id: 'o1', text: 'for' }, { id: 'o2', text: 'since' }, { id: 'o3', text: 'from' }, { id: 'o4', text: 'in' }] } });
const grammar = (over: Partial<LearningSession> = {}) => session({ game_type: 'grammar', variant: 'gate', game: 'gate', hearts: 3, hearts_max: 3,
  topic: ref(5, 'grammar_mix', 'Ngữ pháp tổng hợp'), lesson: ref(6, 'en.grammar.bank', 'Ngữ pháp tổng hợp'), ...over });

test('a grammar game plays in Học tập; a wrong choice shows the answer and its explanation', async () => {
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/play': { status: 201, body: grammar({ status: 'paused', open_turns: [] }) },
    'POST /api/learning/sessions/5/resume': { status: 200, body: { result: null, session: grammar({ open_turns: [gateTurn], version: 2 }), replayed: false } },
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: { ...correct, correct: false, outcome: 'wrong', hearts_delta: -1,
      correct_answer: 'My aunt has worked at the hospital since 2015.', practice_added: false,
      explanation: '2015 là mốc thời gian nên dùng since. Nghĩa: Dì tôi đã làm việc ở bệnh viện từ năm 2015.' },
      session: grammar({ hearts: 2, open_turns: [], version: 3 }), replayed: false } },
  });
  renderLearning({ status: 'Đang tập trung', clock: '18:20' });
  expect(await screen.findByText('Học tự chọn · Đang tập trung · còn 18:20')).toBeTruthy(); // a focus session is offered to continue
  fireEvent.press(screen.getByRole('button', { name: /^Tiếng Anh\./ }));
  fireEvent.press(screen.getByRole('button', { name: /^Chọn đáp án ngữ pháp\./ }));
  await seconds(4);
  expect(server.callsTo('POST /api/learning/play')[0].body).toMatchObject({ game: 'gate', mode: 'practice' });
  expect(await screen.findByText('My aunt has worked at the hospital ___ 2015.')).toBeTruthy();
  expect(screen.getByText('Tình huống: Nói về thời gian làm việc kéo dài tới nay')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Đáp án for' }));
  expect(await screen.findByText('My aunt has worked at the hospital since 2015.')).toBeTruthy();
  expect(screen.getByText(/2015 là mốc thời gian nên dùng since/)).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions/5/answer')[0].body).toMatchObject({ answer: 'o1' });
});

test('sentence order: each piece has its own id (the same word twice), the end mark is shown, and the order is sent', async () => {
  const bridgeTurn = turn({ kind: 'bridge_order', skill_label: 'Trạng từ chỉ tần suất', travel_seconds: 0,
    prompt: { meaning_vi: 'Con mèo ngồi trên tấm thảm.', context_vi: 'Tả căn phòng', end: '.',
      tokens: [{ id: 'w1', text: 'the' }, { id: 'w2', text: 'mat' }, { id: 'w3', text: 'sat on' }, { id: 'w4', text: 'the' }, { id: 'w5', text: 'cat' }] } });
  const bridge = (over: Partial<LearningSession> = {}) => grammar({ variant: 'bridge', game: 'bridge', ...over });
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/play': { status: 201, body: bridge({ status: 'paused', open_turns: [] }) },
    'POST /api/learning/sessions/5/resume': { status: 200, body: { result: null, session: bridge({ open_turns: [bridgeTurn], version: 2 }), replayed: false } },
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: { ...correct, correct_answer: 'The cat sat on the mat.' },
      session: bridge({ open_turns: [], resolved_count: 1, version: 3 }), replayed: false } },
  });
  await chooseGame(/^Sắp xếp câu\./);
  await seconds(4);
  expect(await screen.findByText('Con mèo ngồi trên tấm thảm.')).toBeTruthy();
  for (const id of ['w4', 'w5', 'w3', 'w1', 'w2']) {
    const text = { w1: 'the', w2: 'mat', w3: 'sat on', w4: 'the', w5: 'cat' }[id]!;
    fireEvent.press(screen.getAllByRole('button', { name: `Từ ${text}` })[0]);
  }
  expect(screen.getByLabelText('Câu: the cat sat on the mat.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra câu' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(1));
  const sent = server.callsTo('POST /api/learning/sessions/5/answer')[0].body.answer as string[];
  expect(sent).toHaveLength(5);
  expect(new Set(sent).size).toBe(5); // two "the" pieces, two different ids
});

test('a game that cannot start shows why and retries with the same request key', async () => {
  let calls = 0;
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/play': () => (++calls === 1 ? networkDown() : { status: 201, body: created() }) });
  await chooseGame();
  expect(await screen.findByRole('button', { name: 'Thử lại Bắn thiên thạch' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại Bắn thiên thạch' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(2));
  const [first, retry] = server.callsTo('POST /api/learning/play');
  expect(retry.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
  await seconds(4);
  expect(await screen.findByLabelText('Bầu trời thiên thạch')).toBeTruthy();
});

test('an open session has to be continued or dropped before another game starts', async () => {
  const open = session({ status: 'paused' });
  const server = mockServer({ ...startRoutes, 'GET /api/learning/sessions/current': { status: 200, body: { session: open } } });
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  expect(await screen.findByText(/Bạn đang có một phiên chưa xong/)).toBeTruthy();
  const game = screen.getByRole('button', { name: /^Sắp xếp câu\./ });
  expect(game).toBeDisabled();
  fireEvent.press(game);
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(0);
});

test('back while playing pauses and offers to continue learning or end the session', async () => {
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/sessions/5/pause': { status: 200, body: { result: null, session: session({ status: 'paused', version: 3 }), replayed: false } } });
  await startGame();
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByRole('button', { name: 'Tiếp tục học' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Kết thúc phiên' })).toBeTruthy();
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/pause')).toHaveLength(1));
  const top = StyleSheet.flatten(screen.getByLabelText('Thiên thạch đang nhắm: con mèo').props.style).top;
  await seconds(5);
  expect(StyleSheet.flatten(screen.getByLabelText('Thiên thạch đang nhắm: con mèo').props.style).top).toBe(top); // the game stands still
});

test('Math: closing the lesson before playing drops the unplayed session', async () => {
  const math = session({ status: 'paused', open_turns: [], subject: ref(2, 'math', 'Toán'), topic: ref(2, 'arithmetic', 'Cộng, trừ, nhân, chia'),
    level: ref(2, 'grade3', 'Lớp 3'), lesson: ref(9, 'math.arithmetic.grade3', 'Tính trong phạm vi 1000'), game_type: 'defense', game: 'defense' });
  const server = mockServer({ ...startRoutes, 'POST /api/learning/sessions': { status: 201, body: math },
    'GET /api/learning/sessions/5/intro': { status: 200, body: { intro: { kind: 'math', title: 'Cộng, trừ, nhân, chia', explanation: ['Đọc kỹ dấu.'], examples: [], tips: [] } } },
    'POST /api/learning/sessions/5/abandon': { status: 200, body: { result: null, session: session({ status: 'abandoned' }), replayed: false } } });
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Toán\./ }));
  fireEvent.press(screen.getByRole('button', { name: /^Bảo vệ căn cứ\./ }));
  fireEvent.press(await screen.findByRole('radio', { name: 'Cộng, trừ, nhân, chia' }));
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
  expect(await screen.findByRole('button', { name: 'Bắt đầu chơi' })).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions')[0].body).toMatchObject({ lesson_id: 9, start_paused: true });
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByRole('radio', { name: 'Cộng, trừ, nhân, chia', selected: true })).toBeTruthy(); // back to the same setup
  expect(server.callsTo('POST /api/learning/sessions/5/abandon')).toHaveLength(1);
});

// --- Anh → Việt: Bắn từ tiếng Anh ---------------------------------------------------------------------------------------

const word = (id: string, en: string, position: number, travel = 24): Turn =>
  turn({ turn_id: id, position, kind: 'word_spelling', skill_label: 'Gõ từ', prompt: { word: en, letters: [en.length], answer_keys: [answerKey(id, en)] },
    travel_seconds: travel });
const shooter = (over: Partial<LearningSession> = {}) => session({ game: 'word_shooter', variant: 'word_shooter',
  lesson: ref(7, 'en.vocab.mix', 'Từ vựng tổng hợp'), ...over });
const hit = (id: string, en: string, vi: string, phonetic: string) => ({ ...correct, turn_id: id, correct_answer: en, word: { en, vi, phonetic } });

async function startShooter(open: Turn[], over: Partial<LearningSession> = {}, routes: Record<string, unknown> = {}) {
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/play': { status: 201, body: shooter({ status: 'paused', open_turns: [], ...over }) },
    'POST /api/learning/sessions/5/resume': { status: 200, body: { result: null, session: shooter({ open_turns: open, version: 2, ...over }), replayed: false } },
    ...routes } as any);
  await chooseGame(/^Bắn từ tiếng Anh \(Anh → Việt\)\./);
  await seconds(4);
  expect(server.callsTo('POST /api/learning/play')[0].body).toMatchObject({ game: 'word_shooter' });
  fireEvent(await screen.findByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
  await screen.findByLabelText('Đáp án tiếng Anh');
  return server;
}

test('Anh → Việt: a right answer frees the field at once; the word falls on, breaks and counts when the bullet hits; new words keep coming', async () => {
  const next = word('turn-0002-abcdef', 'dog', 1);
  const nextReply = deferred<{ status: number; body: unknown }>();
  const server = await startShooter([word('turn-0001-abcdef', 'cat', 0)], {}, {
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: { ...hit('turn-0001-abcdef', 'cat', 'con mèo', '/kæt/'), score_delta: 10 },
      session: shooter({ open_turns: [], resolved_count: 1, score: 10, version: 3 }), replayed: false } },
    'POST /api/learning/sessions/5/next': () => nextReply.promise,
  });
  const nextCalls = () => server.callsTo('POST /api/learning/sessions/5/next');
  const field = () => screen.getByLabelText('Đáp án tiếng Anh');
  await seconds(4); // "cat" falls a while before it is answered (a new word only comes every few seconds)
  expect(nextCalls()).toHaveLength(0);
  expect(screen.getByLabelText('Từ đang nhắm: cat')).toBeTruthy();
  expect(screen.queryByText('con mèo')).toBeNull(); // the meaning only comes with the hit
  expect(screen.queryByRole('button', { name: 'Xem đáp án' })).toBeNull(); // the word to type is already on screen
  const speak = require('expo-speech').speak as jest.Mock;
  speak.mockClear();
  fireEvent.changeText(field(), 'CAT '); // right: shot at once, no Enter
  // The field is ready for the next word at once: no wait for the server or the bullet.
  expect(field().props.value).toBe('');
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(1));
  expect(server.callsTo('POST /api/learning/sessions/5/answer')[0].body).toMatchObject({ turn_id: 'turn-0001-abcdef', answer: 'CAT ', hold_next: true });
  // Shoot → hit → break → meaning: the word is still there, falling on, while the bullet flies; nothing counts yet.
  await waitFor(() => expect(screen.getByTestId('shot-turn-0001-abcdef', { includeHiddenElements: true })).toBeTruthy());
  expect(screen.queryByText(/Chính xác/)).toBeNull();
  expect(speak).not.toHaveBeenCalled();
  // No word left to answer: a new one is asked for now, while the bullet is still on its way.
  await waitFor(() => expect(nextCalls()).toHaveLength(1));
  expect(nextCalls()[0].body).toEqual({ count: 1, refill: true });
  await act(async () => { nextReply.resolve({ status: 200, body: { result: null, session: shooter({ open_turns: [next], resolved_count: 1, score: 10, version: 4 }), replayed: false } }); });
  const top = () => StyleSheet.flatten(screen.getByLabelText('Từ đang nhắm: dog').props.style).top as number;
  expect(top()).toBeLessThan(1); // at the top, with its own time
  expect(screen.getByTestId('shot-turn-0001-abcdef', { includeHiddenElements: true })).toBeTruthy(); // the shot goes on meanwhile
  // The hit: the word breaks where the bullet reached it, shows its meaning, says it and counts, once.
  expect(await screen.findByText('con mèo')).toBeTruthy();
  expect(screen.queryByTestId('shot-turn-0001-abcdef', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText('cat /kæt/')).toBeTruthy();
  expect(screen.getByText('Chính xác! +10')).toBeTruthy();
  expect(speak).toHaveBeenCalledWith('cat', expect.anything());
  // It is aimed and typed without tapping it first, from the same answer field.
  fireEvent.changeText(field(), 'dog');
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(2));
  expect(server.callsTo('POST /api/learning/sessions/5/answer')[1].body).toMatchObject({ turn_id: 'turn-0002-abcdef', answer: 'dog' });
});

test('falling words come on their own timer, several at once, never more than three', async () => {
  const [cat, dog, fox, owl] = [word('turn-0001-abcdef', 'cat', 0), word('turn-0002-abcdef', 'dog', 1), word('turn-0003-abcdef', 'fox', 2),
    word('turn-0004-abcdef', 'owl', 3)];
  const opened = [[cat, dog], [cat, dog, fox]];
  let version = 2;
  const server = await startShooter([cat], { mode: 'challenge', hearts: 3, hearts_max: 3 }, {
    'POST /api/learning/sessions/5/next': () => ({ status: 200, body: { result: null, replayed: false,
      session: shooter({ mode: 'challenge', hearts: 3, hearts_max: 3, open_turns: opened.shift() ?? [cat, dog, fox], version: ++version }) } }),
  });
  const nextCalls = () => server.callsTo('POST /api/learning/sessions/5/next');
  await seconds(3);
  expect(nextCalls()).toHaveLength(0); // "cat" is still falling, not answered: the next word waits for its time
  await seconds(1);
  await waitFor(() => expect(nextCalls()).toHaveLength(1));
  expect(nextCalls()[0].body).toEqual({ count: 2, refill: true });
  expect(screen.getByLabelText('Từ: dog')).toBeTruthy();
  await seconds(4);
  await waitFor(() => expect(nextCalls()).toHaveLength(2));
  expect(nextCalls()[1].body).toEqual({ count: 3, refill: true });
  // Three on screen, apart from each other, each falling on its own time.
  const box = (label: string) => ({ ...StyleSheet.flatten(screen.getByLabelText(label).props.style), height: label.includes('nhắm') ? 150 : 118 });
  const labels = ['Từ đang nhắm: cat', 'Từ: dog', 'Từ: fox'];
  const boxes = labels.map(box);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    expect(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height).toBe(false);
  }
  expect(boxes[0].top).toBeGreaterThan(boxes[1].top);
  expect(boxes[1].top).toBeGreaterThan(boxes[2].top);
  await seconds(5);
  expect(nextCalls()).toHaveLength(2); // three are falling: no fourth
  expect(screen.queryByLabelText(/owl/)).toBeNull();
  void owl;
});

test('Thử thách: a word answered right that reaches the ground before the bullet still counts as right, never as a miss', async () => {
  // "cat" is about to land when it is answered; the server takes a moment to confirm it.
  const cat = { ...word('turn-0001-abcdef', 'cat', 0), on_screen_ms: 23_600 };
  const reply = deferred<{ status: number; body: unknown }>();
  const server = await startShooter([cat], { mode: 'challenge', hearts: 3, hearts_max: 3 }, {
    'POST /api/learning/sessions/5/answer': () => reply.promise,
  });
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'cat');
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(1));
  await seconds(2); // on the ground now
  await act(async () => { reply.resolve({ status: 200, body: { result: { ...hit('turn-0001-abcdef', 'cat', 'con mèo', '/kæt/'), score_delta: 10 },
    session: shooter({ mode: 'challenge', hearts: 3, hearts_max: 3, open_turns: [], resolved_count: 1, score: 10, version: 3 }), replayed: false } }); });
  expect(screen.getByLabelText('Điểm 0, combo 0')).toBeTruthy(); // the points come with the hit
  expect(await screen.findByText('con mèo')).toBeTruthy(); // the bullet still reaches it, on the ground
  expect(screen.getByLabelText('Điểm 10, combo 0')).toBeTruthy();
  await seconds(3);
  expect(server.callsTo('POST /api/learning/sessions/5/miss')).toHaveLength(0);
  expect(screen.queryByText(/chạm đất/)).toBeNull();
  expect(screen.getByLabelText('Còn 3 tim')).toBeTruthy();
});

test('falling words: the card above the field and the help row under it keep their place while no word is falling', async () => {
  const cat = { ...word('turn-0001-abcdef', 'cat', 0), hints_shown: ['Từ có 3 chữ cái'] };
  await startShooter([cat], {}, {
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: hit('turn-0001-abcdef', 'cat', 'con mèo', '/kæt/'),
      session: shooter({ open_turns: [], resolved_count: 1, version: 3 }), replayed: false } },
  });
  // A hint takes the instruction's line in the card (no extra row that would push the field down).
  expect(screen.getByText('💡 Từ có 3 chữ cái')).toBeTruthy();
  expect(screen.queryByText('Gõ lại đúng từ này: đúng là pet tự bắn')).toBeNull();
  const area = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).minHeight;
  fireEvent(screen.getByTestId('game-prompt-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 72 } } });
  fireEvent(screen.getByTestId('game-help-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 54 } } });
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'cat');
  expect(await screen.findByText('con mèo')).toBeTruthy();
  // No word for a moment (the next one is on its way): the card's place and "Gợi ý" stay, nothing moves the field.
  expect(screen.queryByText('Chuẩn bị lượt tiếp theo…')).toBeNull();
  expect(screen.getByRole('button', { name: 'Gợi ý' })).toBeDisabled();
  fireEvent(screen.getByTestId('game-prompt-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 60 } } });
  expect(area('game-prompt-area')).toBe(72); // never shorter than it has been
  expect(area('game-help-area')).toBe(54);
});

test('the answer boxes ride in the aimed word frame; tapping another word answers it, keeping the text and the keyboard', async () => {
  const [cat, dog] = [word('turn-0001-abcdef', 'cat', 0), word('turn-0002-abcdef', 'dog', 1)];
  await startShooter([cat, dog]);
  expect(screen.queryByRole('button', { name: 'Bắn' })).toBeNull(); // nothing fixed at the bottom, no button to press
  const field = screen.getByLabelText('Đáp án tiếng Anh');
  const top = () => StyleSheet.flatten(screen.getByLabelText('Đáp án tiếng Anh').props.style).top as number;
  const startTop = top();
  fireEvent.changeText(field, 'do');
  expect(within(screen.getByLabelText('Từ đang nhắm: cat')).getByText('d')).toBeTruthy(); // in the word's own frame
  await seconds(3);
  expect(top()).toBeGreaterThan(startTop); // the answer moves down with its word
  expect(screen.getByLabelText('Đáp án tiếng Anh')).toBe(field); // the same field: never remounted, so never refocused
  fireEvent.press(screen.getByLabelText('Từ: dog')); // tap the other word (its boxes are in its frame)
  expect(within(screen.getByLabelText('Từ đang nhắm: dog')).getByText('d')).toBeTruthy();
  expect(screen.getByLabelText('Đáp án tiếng Anh')).toBe(field);
  expect(field.props.value).toBe('do'); // what was typed is kept
});

test('Anh → Việt, a stage started in Thử thách before: a shot hits the word the server matched, and a word reaching the ground shows its pair', async () => {
  // "cat" has already fallen half way (the game was reopened): it continues from there, not from the top.
  const [cat, dog] = [{ ...word('turn-0001-abcdef', 'cat', 0), on_screen_ms: 12000 }, word('turn-0002-abcdef', 'dog', 1)];
  let missed = false;
  const server = await startShooter([cat, dog], { mode: 'challenge', hearts: 3, hearts_max: 3 }, {
    // Aimed at "cat" (closest to the ground), typed "dog": the server says "dog" was hit.
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: hit('turn-0002-abcdef', 'dog', 'con chó', '/dɒɡ/'),
      session: shooter({ mode: 'challenge', hearts: 3, hearts_max: 3, open_turns: [cat], resolved_count: 1, version: 3 }), replayed: false } },
    'POST /api/learning/sessions/5/next': { status: 200, body: { result: null,
      session: shooter({ mode: 'challenge', hearts: 3, hearts_max: 3, open_turns: [cat], resolved_count: 1, version: 3 }), replayed: false } },
    'POST /api/learning/sessions/5/miss': () => { missed = true; return { status: 200, body: {
      result: { ...correct, event: 'miss', correct: null, outcome: 'missed', hearts_delta: -1, turn_id: 'turn-0001-abcdef',
        word: { en: 'cat', vi: 'con mèo', phonetic: '/kæt/' } },
      session: shooter({ mode: 'challenge', hearts: 2, hearts_max: 3, open_turns: [], resolved_count: 2, version: 4 }), replayed: false } }; },
  });
  expect(screen.getByLabelText('Từ đang nhắm: cat')).toBeTruthy();
  const top = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style).top as number;
  expect(top('Từ đang nhắm: cat')).toBeGreaterThan(top('Từ: dog'));
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'dog'); // right for the other word: shot at once
  expect(await screen.findByText('con chó')).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions/5/answer')[0].body).toMatchObject({ turn_id: 'turn-0001-abcdef', answer: 'dog' });
  await seconds(13); // "cat" keeps falling from half way and reaches the ground
  await waitFor(() => expect(missed).toBe(true));
  expect(await screen.findByText('Từ chạm đất! cat — con mèo · −1 tim')).toBeTruthy();
});

test('Việt → Anh: a right answer breaks the meteor with the pet\'s shot and shows the pair to remember; a wrong one shoots nothing', async () => {
  const next = turn({ turn_id: 'turn-0002-abcdef', position: 1, prompt: { meaning_vi: 'con chó', context_vi: null, letters: [3],
    answer_keys: [answerKey('turn-0002-abcdef', 'dog')] } });
  let answers = 0;
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/sessions/5/answer': () => (++answers === 1
      ? { status: 200, body: { result: { ...correct, correct: false, outcome: null, resolved: false, retry_allowed: true }, session: session({ version: 2 }), replayed: false } }
      : { status: 200, body: { result: { ...correct, correct_answer: 'cat', word: { en: 'cat', vi: 'con mèo', phonetic: '/kæt/' } },
        session: session({ open_turns: [next], resolved_count: 1, version: 3 }), replayed: false } }),
  });
  await startGame();
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'cap');
  expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(0); // not right: no shot at once
  expect(await screen.findByText('Chưa đúng, sửa lại nhé!')).toBeTruthy(); // every box filled: counted wrong after a pause
  await seconds(2);
  expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(1); // the same text is never sent twice
  expect(screen.queryAllByTestId('bullet', { includeHiddenElements: true })).toHaveLength(0); // no shot, the meteor stays
  expect(screen.getByLabelText('Thiên thạch đang nhắm: con mèo')).toBeTruthy();
  expect(screen.getByLabelText('Đáp án tiếng Anh').props.value).toBe('cap');

  await seconds(3); // "con mèo" falls a while before it is answered
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'cat');
  expect(screen.getByLabelText('Đáp án tiếng Anh').props.value).toBe(''); // ready for the next word at once
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(2));
  // This backend opened "con chó" with the answer: it falls from the top at once, beside the meteor being shot (not on
  // it, not where it was), and can be typed while the bullet is still on its way.
  const aimed = await screen.findByLabelText('Thiên thạch đang nhắm: con chó');
  const shot = screen.getByTestId('shot-turn-0001-abcdef', { includeHiddenElements: true });
  expect(StyleSheet.flatten(aimed.props.style).top).toBeLessThan(1);
  expect(StyleSheet.flatten(aimed.props.style).left).not.toBe(StyleSheet.flatten(shot.props.style).left);
  expect(screen.queryByText('cat — con mèo')).toBeNull(); // the pair comes with the hit
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'do');
  expect(within(screen.getByLabelText('Thiên thạch đang nhắm: con chó')).getByText('d')).toBeTruthy();
  expect(await screen.findByText('cat — con mèo')).toBeTruthy();
  expect(screen.getByLabelText('Đáp án tiếng Anh').props.value).toBe('do'); // the hit never touches what is being typed
});

// --- vocabulary stages: 15 words, 5 hearts ------------------------------------------------------------------------------
const stage = (over: Partial<LearningSession> = {}) => ({ required_count: VOCAB_STAGE_WORDS, hearts: VOCAB_HEARTS, hearts_max: VOCAB_HEARTS, ...over });

test('Học tập: a word that lands unbroken costs one heart, once, and counts as done; a word typed right counts when it is hit', async () => {
  const [cat, dog] = [word('turn-0001-abcdef', 'cat', 0, 6), word('turn-0002-abcdef', 'dog', 1, 24)];
  const misses: string[] = [];
  const server = await startShooter([cat, dog], stage(), {
    'POST /api/learning/sessions/5/miss': (req: { body: { client_event_id: string } }) => { misses.push(req.body.client_event_id); return { status: 200, body: {
      result: { ...correct, event: 'miss', correct: null, outcome: 'missed', hearts_delta: -1, turn_id: 'turn-0001-abcdef',
        word: { en: 'cat', vi: 'con mèo', phonetic: '/kæt/' } },
      session: shooter({ ...stage({ hearts: VOCAB_HEARTS - 1 }), open_turns: [dog], resolved_count: 1, version: 3 }), replayed: false } }; },
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: hit('turn-0002-abcdef', 'dog', 'con chó', '/dɒɡ/'),
      session: shooter({ ...stage({ hearts: VOCAB_HEARTS - 1 }), open_turns: [], resolved_count: 2, version: 4 }), replayed: false } },
  });
  // The top bar: the hearts and "Đã xử lý X/15".
  expect(screen.getByLabelText(`Còn ${VOCAB_HEARTS} tim`)).toBeTruthy();
  expect(screen.getByText(`Đã xử lý 0/${VOCAB_STAGE_WORDS}`)).toBeTruthy();
  await seconds(7); // "cat" (6 s to fall) reaches the ground in Học tập too
  await waitFor(() => expect(misses).toHaveLength(1));
  expect(await screen.findByText('Từ chạm đất! cat — con mèo · −1 tim')).toBeTruthy();
  expect(screen.getByLabelText(`Còn ${VOCAB_HEARTS - 1} tim`)).toBeTruthy();
  expect(screen.getByText(`Đã xử lý 1/${VOCAB_STAGE_WORDS}`)).toBeTruthy();
  await seconds(5);
  expect(misses).toHaveLength(1); // reported once, one heart
  // "dog" typed right: done only when the bullet reaches it, not when the server confirms it.
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'dog');
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId('shot-turn-0002-abcdef', { includeHiddenElements: true })).toBeTruthy());
  expect(screen.getByText(`Đã xử lý 1/${VOCAB_STAGE_WORDS}`)).toBeTruthy();
  expect(await screen.findByText('con chó')).toBeTruthy();
  expect(screen.getByText(`Đã xử lý 2/${VOCAB_STAGE_WORDS}`)).toBeTruthy();
  expect(screen.getByLabelText(`Còn ${VOCAB_HEARTS - 1} tim`)).toBeTruthy(); // a hit never costs a heart
});

test('a word reported as landed can no longer be shot: never both a miss and a hit', async () => {
  const cat = word('turn-0001-abcdef', 'cat', 0, 4);
  const missReply = deferred<{ status: number; body: unknown }>();
  const server = await startShooter([cat], stage(), { 'POST /api/learning/sessions/5/miss': () => missReply.promise });
  await seconds(5); // on the ground: the miss is on its way
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/miss')).toHaveLength(1));
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'cat');
  await act(async () => { missReply.resolve({ status: 200, body: {
    result: { ...correct, event: 'miss', correct: null, outcome: 'missed', hearts_delta: -1, turn_id: 'turn-0001-abcdef', word: { en: 'cat', vi: 'con mèo', phonetic: null } },
    session: shooter({ ...stage({ hearts: VOCAB_HEARTS - 1 }), open_turns: [], resolved_count: 1, version: 3 }), replayed: false } }); });
  await seconds(2);
  expect(server.callsTo('POST /api/learning/sessions/5/answer')).toHaveLength(0);
  expect(screen.queryAllByTestId('bullet', { includeHiddenElements: true }).filter((b) => StyleSheet.flatten(b.props.style).opacity > 0)).toHaveLength(0);
});

test('out of hearts: the stage ends, no new word comes, and the result shows', async () => {
  const cat = word('turn-0001-abcdef', 'cat', 0, 4);
  const failed = shooter({ ...stage({ hearts: 0 }), status: 'failed', end_reason: 'out_of_hearts', open_turns: [], resolved_count: 9,
    reward: { status: 'not_eligible', exp: 0 }, version: 3 });
  const server = await startShooter([cat], stage({ hearts: 1, resolved_count: 8 }), {
    'POST /api/learning/sessions/5/miss': { status: 200, body: {
      result: { ...correct, event: 'miss', correct: null, outcome: 'missed', hearts_delta: -1, turn_id: 'turn-0001-abcdef', word: { en: 'cat', vi: 'con mèo', phonetic: null } },
      session: failed, replayed: false } },
    'GET /api/learning/sessions/5/result': { status: 200, body: result(failed) },
  });
  await seconds(5);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/miss')).toHaveLength(1));
  const asked = server.callsTo('POST /api/learning/sessions/5/next').length;
  expect(await screen.findByText('Hết tim rồi')).toBeTruthy();
  await seconds(10);
  expect(server.callsTo('POST /api/learning/sessions/5/next')).toHaveLength(asked); // nothing more is opened
});

test('number keys build integers only and toggle the sign', () => {
  expect(pressKey('', '7')).toBe('7');
  expect(pressKey('0', '5')).toBe('5');
  expect(pressKey('12', 'sign')).toBe('-12');
  expect(pressKey('-12', 'sign')).toBe('12');
  expect(pressKey('-', '3')).toBe('-3');
  expect(pressKey('12', 'back')).toBe('1');
  expect(pressKey('1234567', '8')).toBe('1234567');
  expect(pressKey('12', 'x')).toBe('12');
});

test('ending the stage while the pause is still on its way is not lost', async () => {
  const slowPause = deferred<{ status: number; body: unknown }>();
  const ended = session({ status: 'abandoned', open_turns: [], end_reason: 'user_ended', reward: { status: 'not_eligible', exp: 0 }, version: 4 });
  const server = mockServer({
    ...startRoutes,
    'POST /api/learning/sessions/5/pause': () => slowPause.promise,
    'POST /api/learning/sessions/5/abandon': { status: 200, body: { result: null, session: ended, replayed: false } },
    'GET /api/learning/sessions/5/result': { status: 200, body: { ...result(ended), counts: { ...result(ended).counts, first_try: 0, unanswered: 12 } } },
  });
  await startGame();
  fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Kết thúc phiên' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Xác nhận kết thúc' }));
  await act(async () => { slowPause.resolve({ status: 200, body: { result: null, session: session({ status: 'paused', version: 3 }), replayed: false } }); });
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/abandon')).toHaveLength(1));
  await seconds(1);
  expect(await screen.findByText('Đã kết thúc')).toBeTruthy();
});

// --- First-time guide ("Cách chơi") and the 3-2-1 countdown -------------------------------------------------------------

const firstTime = (game: string, extra: Record<string, unknown> = {}) => ({ ...startRoutes,
  'GET /api/learning/tutorials': { status: 200, body: { seen: [] } },
  [`POST /api/learning/tutorials/${game}`]: { status: 200, body: { seen: [game] } }, ...extra } as any);

/** Through the guide's pages to "Bắt đầu". */
function readGuide(pages = 3) {
  for (let i = 1; i < pages; i++) {
    expect(screen.getByLabelText(`Trang ${i} trên ${pages}`)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
  }
  expect(screen.getByLabelText(`Trang ${pages} trên ${pages}`)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tiếp' })).toBeNull();
}

test('first time: the game\'s own guide comes first, nothing starts behind it, and "Bắt đầu" counts down to the game', async () => {
  const slowResume = deferred<{ status: number; body: unknown }>();
  const server = mockServer(firstTime('meteor', { 'POST /api/learning/sessions/5/resume': () => slowResume.promise }));
  await chooseGame();
  expect(await screen.findByText('Cách chơi')).toBeTruthy();
  // Page 1, the goal, with a moving picture of this game (not a guide shared by every game): the answer boxes ride
  // under the word closest to the ground, as on the real field.
  expect(screen.getByLabelText('Minh họa: 2 thiên thạch đang rơi, pet đứng dưới đất. Ô chữ nằm dưới “con mèo”, gần mặt đất nhất')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bắt đầu' })).toBeNull();
  await seconds(10);
  // No session, so no clock and no question behind the guide.
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
  expect(screen.getByText('Gõ từ tiếng Anh, pet tự bắn')).toBeTruthy(); // page 2: the controls
  // Typing is all it takes: no "Bắn" to press, in the text or in the picture.
  expect(screen.getByLabelText('Minh họa: Gõ “cat” vào ô chữ dưới “con mèo”: pet tự bắn, đạn đuổi theo, trúng thì vỡ và hiện “cat — con mèo”')).toBeTruthy();
  expect(screen.queryByText('Bắn')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Trước' }));
  readGuide();
  expect(screen.getByText('Khi nào xong chặng?')).toBeTruthy(); // page 3: how it ends
  expect(server.callsTo('POST /api/learning/tutorials/meteor')).toHaveLength(0); // only "Bắt đầu" finishes it

  const begin = screen.getByRole('button', { name: 'Bắt đầu' });
  fireEvent.press(begin);
  fireEvent.press(begin); // a double tap still makes one game
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(1));
  expect(server.callsTo('POST /api/learning/tutorials/meteor')).toHaveLength(1);
  expect(server.callsTo('POST /api/learning/tutorials/meteor')[0].body).toEqual({ version: TUTORIAL_VERSION });
  expect(server.callsTo('POST /api/learning/play')[0].body).toMatchObject({ mode: 'practice' });

  // The game screen with a big countdown: nothing runs, nothing can be typed until it is over.
  expect(await screen.findByText('3')).toBeTruthy();
  expect(screen.getByText('Sẵn sàng nhé!')).toBeTruthy();
  expect(screen.queryByLabelText('Đáp án tiếng Anh')).toBeNull();
  await seconds(1);
  expect(screen.getByText('2')).toBeTruthy();
  await seconds(1);
  expect(screen.getByText('1')).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(0);
  await seconds(1);
  expect(screen.getByText('Bắt đầu!')).toBeTruthy(); // stays until the server has started the clock
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1));
  expect(screen.queryByText('Tạm dừng')).toBeNull();
  await act(async () => { slowResume.resolve({ status: 200, body: resumed }); });
  await waitFor(() => expect(screen.queryByText('Bắt đầu!')).toBeNull());
  fireEvent(await screen.findByLabelText('Bầu trời thiên thạch'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
  expect(await screen.findByLabelText('Đáp án tiếng Anh')).toBeTruthy();
  expect(JSON.parse((await AsyncStorage.getItem(`mirabi.learning.tutorials.v${TUTORIAL_VERSION}:1`))!).seen).toEqual(['meteor']); // per account
});

test('a guide finished before it was rewritten shows once more, then never again', async () => {
  // This device finished the old guide (and the server only lists guides finished at the current version).
  await AsyncStorage.setItem('mirabi.learning.tutorials:1', JSON.stringify({ seen: ['meteor'], unsent: [] }));
  const server = mockServer(firstTime('meteor'));
  await chooseGame();
  expect(await screen.findByText('Cách chơi')).toBeTruthy();
  readGuide();
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/tutorials/meteor')).toHaveLength(1));
  expect(JSON.parse((await AsyncStorage.getItem(`mirabi.learning.tutorials.v${TUTORIAL_VERSION}:1`))!).seen).toEqual(['meteor']);
});

test('closing the guide starts nothing and it comes back next time; once finished it is skipped and "Cách chơi" shows it again', async () => {
  let seen: string[] = [];
  const server = mockServer({ ...startRoutes,
    'GET /api/learning/tutorials': () => ({ status: 200, body: { seen } }),
    'POST /api/learning/tutorials/gate': () => { seen = ['gate']; return { status: 200, body: { seen } }; },
    'POST /api/learning/play': { status: 201, body: grammar({ status: 'paused', open_turns: [] }) },
    'POST /api/learning/sessions/5/resume': { status: 200, body: { result: null, session: grammar({ open_turns: [gateTurn], version: 2 }), replayed: false } },
  });
  const view = renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  fireEvent.press(screen.getByRole('button', { name: /^Chọn đáp án ngữ pháp\./ }));
  expect(await screen.findByText('Chọn đáp án đúng')).toBeTruthy(); // the gate game's own goal
  fireEvent.press(screen.getByRole('button', { name: 'Đóng hướng dẫn' }));
  expect(await screen.findByText('Chọn trò chơi')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: /^Chọn đáp án ngữ pháp\./ }));
  expect(await screen.findByText('Chọn đáp án đúng')).toBeTruthy(); // not finished: shown again
  expect(server.callsTo('POST /api/learning/tutorials/gate')).toHaveLength(0);
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(0);
  readGuide();
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
  expect(await screen.findByText('3')).toBeTruthy();
  await seconds(4);
  expect(await screen.findByText('My aunt has worked at the hospital ___ 2015.')).toBeTruthy();
  view.unmount();

  // Next visit (the server knows the guide was finished): the game starts at once.
  await AsyncStorage.clear();
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  fireEvent.press(screen.getByRole('button', { name: 'Cách chơi Chọn đáp án ngữ pháp' }));
  expect(await screen.findByText('Chọn đáp án đúng')).toBeTruthy(); // read again on demand
  fireEvent.press(screen.getByRole('button', { name: 'Đóng hướng dẫn' }));
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(1);
  fireEvent.press(await screen.findByRole('button', { name: /^Chọn đáp án ngữ pháp\./ }));
  expect(await screen.findByText('3')).toBeTruthy();
  expect(screen.queryByText('Cách chơi')).toBeNull();
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(2);
});

test('every game has its own guide: goal, controls and how it ends, true to its rules', () => {
  const { TUTORIALS } = require('../src/learning/tutorials');
  const { GAME_INFO } = require('../src/learning/labels');
  expect(Object.keys(TUTORIALS).sort()).toEqual(Object.keys(GAME_INFO).sort());
  const own = new Set<string>();
  for (const pages of Object.values(TUTORIALS) as { tag: string; title: string; body: string; scene: { kind: string } }[][]) {
    expect(pages.map((p) => p.tag)).toEqual(['Mục tiêu', 'Cách thao tác', 'Kết thúc']);
    expect(pages[2].scene.kind).toBe('rules');
    own.add(`${pages[0].title}|${pages[1].body}`);
  }
  expect(own.size).toBe(Object.keys(TUTORIALS).length);
  const rules = (game: string) => JSON.stringify(TUTORIALS[game][2]);
  const all = (game: string) => JSON.stringify(TUTORIALS[game]);
  // Vocabulary games have no hearts in Học tập and a word waits above the ground; grammar and Math have 3.
  for (const game of ['word_shooter', 'meteor']) {
    // The backend's numbers: 15 words a stage, 5 hearts, a heart lost only by a word that lands.
    expect(all(game)).toMatch(new RegExp(`${VOCAB_STAGE_WORDS} (từ|thiên thạch)`));
    expect(rules(game)).toMatch(new RegExp(`Bạn có ${VOCAB_HEARTS} tim`));
    expect(rules(game)).toMatch(/chạm đất mất 1 tim/);
    expect(rules(game)).toMatch(/Gõ sai không mất tim/);
    expect(rules(game)).not.toMatch(/Hết 3 tim|dừng lại trước mặt đất|chờ bạn/);
    expect(all(game)).toMatch(/pet tự bắn/); // a right answer shoots by itself
    expect(all(game)).not.toMatch(/nhấn (Bắn|Enter)|Kiểm tra/);
    expect(all(game)).toMatch(/Đạn trúng thì/); // it breaks when the bullet reaches it
  }
  for (const game of ['gate', 'bridge', 'grammar', 'defense', 'math_bridge']) expect(rules(game)).toMatch(/Hết 3 tim/);
  // Anh → Việt: the English word is typed again (that is what is checked); its meaning shows when it breaks.
  expect(all('word_shooter')).toMatch(/Gõ lại đúng từ/);
  expect(all('word_shooter')).not.toMatch(/Xem đáp án/); // not offered in Anh → Việt
  expect(all('meteor')).toMatch(/ngữ cảnh/);
  // Only the games played by tapping show a tap; the number games press their own button.
  expect(all('gate')).toMatch(/Chạm/);
  expect(all('bridge')).toMatch(/Kiểm tra/);
  expect(all('defense')).toMatch(/Tấn công/);
  expect(all('math_bridge')).toMatch(/Đặt đoạn cầu/);
  // Nothing from the vocabulary games in the others.
  for (const game of ['gate', 'bridge', 'grammar', 'defense', 'math_bridge']) expect(all(game)).not.toMatch(/pet tự bắn|ô chữ/);
});

test('every guide page draws, and the typing picture plays: letters in the boxes under the word, the shot, the break', () => {
  const { TUTORIALS } = require('../src/learning/tutorials');
  const { GameTutorial } = require('../src/screens/learning/GameTutorial');
  for (const game of Object.keys(TUTORIALS)) {
    const view = render(<GameTutorial game={game} petId="fox" petLevel={2} reduceMotion={false} onFinish={jest.fn()} onClose={jest.fn()} />);
    for (let page = 0; page < TUTORIALS[game].length; page++) {
      if (page) fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
      fireEvent(screen.getByLabelText(/^Minh họa:/), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 330, height: 210 } } });
      act(() => { jest.advanceTimersByTime(6000); }); // every step of its animation, more than once
      expect(screen.getAllByText(TUTORIALS[game][page].title).length).toBeGreaterThan(0);
    }
    view.unmount();
  }
  render(<GameTutorial game="word_shooter" petId="fox" petLevel={2} reduceMotion={false} onFinish={jest.fn()} onClose={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
  fireEvent(screen.getByLabelText(/^Minh họa:/), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 330, height: 210 } } });
  const art = () => within(screen.getByLabelText(/^Minh họa: Gõ “cat”/));
  // The real field's pieces: the word tile and its answer boxes, the letters filling them one by one.
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    for (const ch of ['c', 'a', 't']) if (art().queryByText(ch)) seen.add(ch);
    if (art().queryByText('con mèo')) seen.add('meaning');
    act(() => { jest.advanceTimersByTime(750); });
  }
  expect([...seen].sort()).toEqual(['a', 'c', 'meaning', 't']);
  expect(art().getByText('cat')).toBeTruthy();
  expect(screen.queryByText('Bắn')).toBeNull();
});

test('Math: the guide comes after the lesson, with the session still paused; closing it returns to the lesson', async () => {
  const math = session({ status: 'paused', open_turns: [], subject: ref(2, 'math', 'Toán'), topic: ref(2, 'arithmetic', 'Cộng, trừ, nhân, chia'),
    level: ref(2, 'grade3', 'Lớp 3'), lesson: ref(9, 'math.arithmetic.grade3', 'Tính trong phạm vi 1000'), game_type: 'defense', game: 'defense', hearts: 3, hearts_max: 3 });
  const server = mockServer(firstTime('defense', { 'POST /api/learning/sessions': { status: 201, body: math },
    'GET /api/learning/sessions/5/intro': { status: 200, body: { intro: { kind: 'math', title: 'Cộng, trừ, nhân, chia', explanation: ['Đọc kỹ dấu.'], examples: [], tips: [] } } },
    'POST /api/learning/sessions/5/resume': { status: 200, body: { result: null, session: { ...math, status: 'active', version: 2 }, replayed: false } } }));
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Toán\./ }));
  fireEvent.press(screen.getByRole('button', { name: /^Bảo vệ căn cứ\./ }));
  fireEvent.press(await screen.findByRole('radio', { name: 'Cộng, trừ, nhân, chia' }));
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Bắt đầu chơi' }));
  expect(await screen.findByLabelText('Minh họa: Quái vật mang phép tính 12 + 7 tiến về căn cứ')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Đóng hướng dẫn' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Bắt đầu chơi' }));
  readGuide();
  expect(screen.getByText('Hết 3 tim thì chặng dừng lại, bạn có thể chơi lại.')).toBeTruthy();
  await seconds(5);
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(0); // still paused behind the guide
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
  expect(await screen.findByText('3')).toBeTruthy();
  await seconds(4);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1));
  expect(server.callsTo('POST /api/learning/tutorials/defense')).toHaveLength(1);
  expect(server.callsTo('POST /api/learning/sessions')).toHaveLength(1);
});

test('"Chơi lại" counts down again', async () => {
  const done = { ...completed, lesson: ref(7, 'en.vocab.mix', 'Từ vựng tổng hợp') }; // a "Chơi ngay" stage
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/sessions/5/answer': { status: 200, body: { result: correct, session: finished, replayed: false } },
    'POST /api/learning/sessions/5/complete': { status: 200, body: { result: null, session: done, replayed: false } },
    'GET /api/learning/sessions/5/result': { status: 200, body: result(done) },
  });
  await startGame();
  fireEvent.changeText(screen.getByLabelText('Đáp án tiếng Anh'), 'cat');
  await seconds(4); // the last shot hits and its meaning shows, then the stage ends
  fireEvent.press(await screen.findByRole('button', { name: 'Chơi lại' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(2));
  expect(await screen.findByText('3')).toBeTruthy();
  expect(screen.queryByText('Cách chơi')).toBeNull(); // already read
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1);
  await seconds(4);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(2));
});

test('the app sent to the background during the countdown stops it; it counts again from 3 on return', async () => {
  const server = mockServer(startRoutes);
  await chooseGame();
  expect(await screen.findByText('3')).toBeTruthy();
  await seconds(2);
  expect(screen.getByText('1')).toBeTruthy();
  act(() => appStateListener?.('background'));
  await seconds(6);
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(0); // never started in the background
  act(() => appStateListener?.('active'));
  expect(screen.getByText('3')).toBeTruthy();
  await seconds(2);
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(0);
  await seconds(2);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1));
});

test('the countdown waits for the game\'s pictures', async () => {
  const pictures = deferred<unknown[]>();
  (require('expo-asset').Asset.loadAsync as jest.Mock).mockImplementationOnce(() => pictures.promise);
  const server = mockServer(startRoutes);
  await chooseGame();
  expect(await screen.findByText('Đang chuẩn bị…')).toBeTruthy();
  await seconds(2);
  expect(screen.queryByText('3')).toBeNull();
  await act(async () => { pictures.resolve([]); });
  expect(await screen.findByText('3')).toBeTruthy();
  await seconds(4);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1));
});

test('"Cách chơi" from the pause menu: read again while paused, then the same game goes on after a countdown', async () => {
  const server = mockServer({ ...startRoutes,
    'POST /api/learning/sessions/5/pause': { status: 200, body: { result: null, session: session({ status: 'paused', version: 3 }), replayed: false } } });
  await startGame();
  fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Cách chơi' }));
  expect(screen.getByLabelText(/^Minh họa: 2 thiên thạch đang rơi/)).toBeTruthy();
  // Closing it goes back to the pause menu: still paused.
  fireEvent.press(screen.getByRole('button', { name: 'Đóng hướng dẫn' }));
  expect(screen.getByRole('button', { name: 'Tiếp tục học' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Cách chơi' }));
  readGuide();
  await seconds(5);
  expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1); // still paused while it is read
  // "Tiếp tục chơi": the same session goes on after 3, 2, 1 (no new session).
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục chơi' }));
  expect(await screen.findByText('3')).toBeTruthy();
  expect(screen.queryByText('Cách chơi')).toBeNull();
  await seconds(4);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(2));
  expect(server.callsTo('POST /api/learning/play')).toHaveLength(1);
  expect(server.callsTo('POST /api/learning/tutorials/meteor')).toHaveLength(0); // reading it again changes nothing
});

test('studying together: the countdown follows the room\'s start time, not this device', async () => {
  const { GameScreen } = require('../src/screens/learning/GameScreen');
  const server = mockServer(startRoutes);
  const prefs = { sound: false, reduceMotion: true, setSound: jest.fn(), setReduceMotion: jest.fn() };
  render(
    <ToastProvider><ConfirmProvider>
      <GameScreen initial={created()} autoStart petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} startsAt={Date.now() + 6000} />
    </ConfirmProvider></ToastProvider>,
  );
  expect(await screen.findByText('Đang chuẩn bị…')).toBeTruthy(); // the room starts in 6 s
  await seconds(3);
  expect(screen.getByText('3')).toBeTruthy();
  act(() => appStateListener?.('background'));
  await seconds(2);
  act(() => appStateListener?.('active'));
  await act(async () => { jest.advanceTimersByTime(250); });
  expect(screen.getByText('1')).toBeTruthy(); // in step with the room, not started again from 3
  await seconds(1);
  await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/5/resume')).toHaveLength(1));
});
