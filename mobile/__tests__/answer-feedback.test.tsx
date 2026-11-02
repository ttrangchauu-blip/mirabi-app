import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { setSession } from '../src/api/client';
import type { LearningSession, Turn, TurnResult } from '../src/learning/types';
import { GameScreen } from '../src/screens/learning/GameScreen';
import { AnswerFeedback } from '../src/screens/learning/games/AnswerFeedback';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

// The answer's feedback in the quiz games: no popup. The question and its options stay, locked and marked (the one chosen
// green or red, the right one green); one card under them says right or wrong, gives the answer and the explanation and
// waits for "Tiếp theo" ("Xem kết quả" after the last question). Nothing moves on by itself.

const ref = (id: number, code: string, name: string) => ({ id, code, name });
const turn = (id: string, kind: Turn['kind'], prompt: Turn['prompt']): Turn => ({ turn_id: id, position: 0, kind, skill_label: 'x', prompt,
  hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0, on_screen_ms: 0 });
const q1 = turn('turn-c1', 'choice_explain', { style: 'quiz', question: 'Hiến chương Liên Hợp Quốc có hiệu lực ngày nào?',
  options: [{ id: 'o1', text: '26/6/1945' }, { id: 'o2', text: '24/10/1945' }] });
const q2 = turn('turn-c2', 'choice_explain', { style: 'quiz', question: 'Liên Hợp Quốc có trụ sở chính ở đâu?',
  options: [{ id: 'o3', text: 'New York' }, { id: 'o4', text: 'Paris' }] });
const session = (over: Partial<LearningSession> = {}): LearningSession => ({
  id: 7, status: 'active', kind: 'lesson', mode: 'practice', game_type: 'choice' as any, variant: null, game: 'choice' as any,
  subject: ref(6, 'music', 'Âm nhạc'), topic: ref(9, 't', 't'), level: ref(1, 'g9', 'Lớp 9'), lesson: ref(5, 'l', 'l'),
  duration_seconds: 3600, active_ms: 0, remaining_ms: 3_600_000, time_up: false, timed: false, hearts: 0, hearts_max: 0, score: 0, combo: 0,
  max_combo: 0, required_count: 2, resolved_count: 0, pending_practice: 0, open_turns: [q1], can_complete: false, end_reason: null,
  reward: null, version: 1, server_time: '2026-11-01T10:00:00Z',
  catalog: { lesson: 'ls9.lhq', title: 'Bài', grade: 9, game: 'choice' as any, game_title: 'Chọn đáp án', short_stage: false, subject_name: null,
    other_games: [], next: null, world: null }, ...over });
const result = (over: Partial<TurnResult>): TurnResult => ({ turn_id: 'turn-c1', event: 'answer', correct: true, outcome: 'first_try',
  resolved: true, retry_allowed: false, error_type: null, score_delta: 0, hearts_delta: 0, combo: 0, hint: null, correct_answer: null,
  explanation: null, practice_added: false, feedback: null, ...over });
const EXPLAIN_1 = 'Hiến chương Liên Hợp Quốc được ký ngày 26/6/1945 và chính thức có hiệu lực ngày 24/10/1945.';
const EXPLAIN_2 = 'Trụ sở chính của Liên Hợp Quốc đặt tại New York (Hoa Kỳ).';
const prefs = { sound: false, volume: 'mid' as const, reduceMotion: true, setSound: jest.fn(), setVolume: jest.fn(), setReduceMotion: jest.fn() };
const ms = (n: number) => act(async () => { jest.advanceTimersByTime(n); });
/** The answer's reply comes first (a promise), then the world's short reaction plays out. */
const answered = async () => { await ms(0); await ms(400); };

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});
afterEach(() => { jest.useRealTimers(); });

async function play(s: LearningSession, routes: Record<string, unknown>, motion = false) {
  const server = mockServer({ 'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: s, replayed: false } }, ...routes } as never);
  const onEnded = jest.fn();
  render(<ToastProvider><ConfirmProvider>
    <GameScreen initial={s} petId="fox" petLevel={1} prefs={{ ...prefs, reduceMotion: !motion }} onEnded={onEnded} />
  </ConfirmProvider></ToastProvider>);
  for (let i = 0; i < 5; i++) await ms(1000);
  return { server, onEnded };
}

const quizRoutes = {
  'POST /api/learning/sessions/7/answer': (req: { body: { turn_id: string; answer: string } }) => (req.body.turn_id === 'turn-c1'
    ? { status: 200, body: { result: result({ correct: false, outcome: 'wrong', correct_answer: '24/10/1945', correct_options: ['o2'],
      explanation: EXPLAIN_1, feedback: 'Đó là ngày ký, chưa phải ngày có hiệu lực.' }),
    session: session({ open_turns: [q2], resolved_count: 1, version: 3 }), replayed: false } }
    : { status: 200, body: { result: result({ turn_id: 'turn-c2', correct_answer: 'New York', correct_options: ['o3'], explanation: EXPLAIN_2 }),
      session: session({ open_turns: [], resolved_count: 2, can_complete: true, version: 4 }), replayed: false } }),
  'POST /api/learning/sessions/7/complete': { status: 200, body: { result: null,
    session: session({ status: 'completed', open_turns: [], resolved_count: 2, version: 5 }), replayed: false } },
};

it('a wrong answer: marked red, the right option green, the explanation under the options; no popup, no auto-advance', async () => {
  const { server } = await play(session(), quizRoutes, true);
  fireEvent.press(await screen.findByRole('button', { name: '26/6/1945' }));
  await answered();
  // The question and its options stay on screen, marked; one card under them.
  expect(screen.getByText('Hiến chương Liên Hợp Quốc có hiệu lực ngày nào?')).toBeTruthy();
  expect(screen.getByRole('button', { name: '26/6/1945, chưa đúng' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '24/10/1945, đáp án đúng' })).toBeTruthy();
  expect(screen.getByText('Chưa chính xác!')).toBeTruthy();
  expect(screen.getByText('Đáp án đúng: 24/10/1945')).toBeTruthy();
  expect(screen.getByText('Giải thích:')).toBeTruthy();
  expect(screen.getByText(EXPLAIN_1)).toBeTruthy();
  expect(screen.getByText('Đó là ngày ký, chưa phải ngày có hiệu lực.')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('answer-feedback').props.style).backgroundColor).toBe('#FFF4F1');
  // Locked: the options cannot be answered again.
  fireEvent.press(screen.getByRole('button', { name: '24/10/1945, đáp án đúng' }));
  expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);
  // Nothing moves on by itself.
  await ms(15000);
  expect(screen.getByText(EXPLAIN_1)).toBeTruthy();
  expect(screen.queryByText('Liên Hợp Quốc có trụ sở chính ở đâu?')).toBeNull();
});

it('"Tiếp theo" moves on once, even tapped twice; the next question starts clean; the last one says "Xem kết quả"', async () => {
  const { server, onEnded } = await play(session(), quizRoutes);
  fireEvent.press(await screen.findByRole('button', { name: '26/6/1945' }));
  await answered();
  const next = screen.getByRole('button', { name: 'Tiếp theo' });
  fireEvent.press(next);
  fireEvent.press(next);
  await ms(100);
  expect(screen.getByText('Liên Hợp Quốc có trụ sở chính ở đâu?')).toBeTruthy();
  expect(screen.queryByText(EXPLAIN_1)).toBeNull(); // the last question's explanation is gone
  expect(screen.queryByTestId('answer-feedback')).toBeNull();
  expect(screen.getByRole('button', { name: 'New York' })).toBeTruthy(); // not marked, playable
  expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(1);

  fireEvent.press(screen.getByRole('button', { name: 'New York' }));
  await answered();
  expect(screen.getByRole('button', { name: 'New York, đúng' })).toBeTruthy();
  expect(screen.getByText('Chính xác!')).toBeTruthy();
  expect(screen.getByText('Đáp án: New York')).toBeTruthy();
  expect(screen.getByText(EXPLAIN_2)).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('answer-feedback').props.style).backgroundColor).toBe('#F0FAF5');
  expect(screen.queryByRole('button', { name: 'Tiếp theo' })).toBeNull();
  // The stage finishes only once the last explanation is closed.
  await ms(10000);
  expect(server.callsTo('POST /api/learning/sessions/7/complete')).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Xem kết quả' }));
  await answered();
  await ms(1000);
  expect(server.callsTo('POST /api/learning/sessions/7/complete')).toHaveLength(1);
  expect(onEnded).toHaveBeenCalledTimes(1);
  expect(server.callsTo('POST /api/learning/sessions/7/answer').map((c) => c.body.answer)).toEqual(['o1', 'o3']);
});

it('Chọn cổng: a right answer stays with its explanation until "Tiếp theo" (it no longer moves on by itself)', async () => {
  const gate = turn('turn-g1', 'gate_choice', { sentence: 'She ___ a student.', options: [{ id: 'o1', text: 'is' }, { id: 'o2', text: 'are' }] });
  const gate2 = turn('turn-g2', 'gate_choice', { sentence: 'They ___ friends.', options: [{ id: 'o1', text: 'is' }, { id: 'o2', text: 'are' }] });
  const grammar = (over: Partial<LearningSession> = {}) => session({ game_type: 'grammar', game: 'gate', variant: 'gate', subject: ref(1, 'english', 'Tiếng Anh'),
    timed: true, hearts: 3, hearts_max: 3, catalog: undefined, open_turns: [gate], required_count: 12, ...over });
  await play(grammar(), { 'POST /api/learning/sessions/7/answer': { status: 200, body: { result: result({ turn_id: 'turn-g1',
    correct_answer: 'She is a student.', correct_options: ['o1'], explanation: '“She” đi với “is”.' }),
  session: grammar({ open_turns: [gate2], resolved_count: 1, version: 3 }), replayed: false } } });
  fireEvent.press(await screen.findByRole('button', { name: 'Đáp án is' }));
  await answered();
  expect(screen.getByRole('button', { name: 'Đáp án is, đúng' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đáp án are' })).toBeTruthy(); // neither chosen nor right: unmarked
  expect(screen.getByText('Chính xác!')).toBeTruthy();
  expect(screen.getByText('“She” đi với “is”.')).toBeTruthy();
  await ms(10000);
  expect(screen.getByText('She ___ a student.')).toBeTruthy();
  expect(screen.queryByText('They ___ friends.')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp theo' }));
  await ms(100);
  expect(screen.getByText('They ___ friends.')).toBeTruthy();
});

it('one card for right and wrong: same layout, only the colours and the words change; a long explanation is shown whole', () => {
  const long = 'Giải thích dài. '.repeat(60).trim();
  const onNext = jest.fn();
  const view = render(<AnswerFeedback result={result({ correct: true, correct_answer: '24/10/1945', explanation: long })} kind="choice_explain"
    nextLabel="Tiếp theo" onNext={onNext} reduceMotion />);
  expect(screen.getByText('Chính xác!')).toBeTruthy();
  expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp theo' }));
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp theo' }));
  expect(onNext).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<AnswerFeedback result={result({ correct: false, outcome: 'wrong', correct_answer: '24/10/1945', explanation: long, hearts_delta: -1 })}
    kind="choice_explain" nextLabel="Xem kết quả" onNext={onNext} reduceMotion />);
  expect(screen.getByText('Chưa chính xác! · −1 tim')).toBeTruthy();
  expect(screen.getByText('Đáp án đúng: 24/10/1945')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xem kết quả' })).toBeTruthy();
});

it('a question asked again to practise (same words, another turn) starts clean and says "Luyện lại"; it is told apart by its id', async () => {
  // The server asks a question again only later in the stage (never as the next one), its options in another order.
  const q3 = turn('turn-c3', 'choice_explain', { style: 'quiz', question: 'Thủ đô của Pháp là gì?', options: [{ id: 'o5', text: 'Paris' }, { id: 'o6', text: 'Lyon' }] });
  const again = { ...q1, turn_id: 'turn-c1p', practice: true, prompt: { ...q1.prompt, options: [...q1.prompt.options!].reverse() } };
  const server = mockServer({
    'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: session({ required_count: 2, open_turns: [q1] }), replayed: false } },
    'POST /api/learning/sessions/7/answer': (req: { body: { turn_id: string } }) => ({ status: 200, body: req.body.turn_id === 'turn-c1'
      ? { result: result({ correct: false, outcome: 'wrong', correct_answer: '24/10/1945', correct_options: ['o2'], explanation: EXPLAIN_1, practice_added: true }),
        session: session({ open_turns: [q3], resolved_count: 1, pending_practice: 1, version: 3 }), replayed: false }
      : req.body.turn_id === 'turn-c3'
        ? { result: result({ turn_id: 'turn-c3', correct_answer: 'Paris', correct_options: ['o5'], explanation: 'Paris.' }),
          session: session({ open_turns: [again], resolved_count: 2, pending_practice: 1, version: 4 }), replayed: false }
        : { result: result({ turn_id: 'turn-c1p', correct_answer: '24/10/1945', correct_options: ['o2'], explanation: EXPLAIN_1 }),
          session: session({ open_turns: [], resolved_count: 2, pending_practice: 0, can_complete: true, version: 5 }), replayed: false } }),
  } as never);
  render(<ToastProvider><ConfirmProvider>
    <GameScreen initial={session()} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} />
  </ConfirmProvider></ToastProvider>);
  for (let i = 0; i < 5; i++) await ms(1000);
  fireEvent.press(await screen.findByRole('button', { name: '26/6/1945' }));
  await answered();
  expect(screen.getByText('Câu này sẽ quay lại để bạn luyện thêm một lần.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp theo' }));
  await ms(100);
  expect(screen.getByText('Thủ đô của Pháp là gì?')).toBeTruthy(); // the next question is another one
  expect(screen.queryByText('Hiến chương Liên Hợp Quốc có hiệu lực ngày nào?')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Paris' }));
  await answered();
  fireEvent.press(screen.getByRole('button', { name: 'Tiếp theo' }));
  await ms(100);
  // The practice: the same words, unmarked and playable, the explanation of the first time gone.
  expect(screen.getByText('Hiến chương Liên Hợp Quốc có hiệu lực ngày nào?')).toBeTruthy();
  expect(screen.getByText(/^Luyện lại · /)).toBeTruthy();
  expect(screen.getByRole('button', { name: '26/6/1945' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '24/10/1945' })).toBeTruthy();
  expect(screen.queryByText(EXPLAIN_1)).toBeNull();
  expect(screen.queryByTestId('answer-feedback')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: '24/10/1945' }));
  await answered();
  expect(screen.getByRole('button', { name: 'Xem kết quả' })).toBeTruthy();
  expect(server.callsTo('POST /api/learning/sessions/7/answer').map((c) => [c.body.turn_id, c.body.answer]))
    .toEqual([['turn-c1', 'o1'], ['turn-c3', 'o5'], ['turn-c1p', 'o2']]);
});
