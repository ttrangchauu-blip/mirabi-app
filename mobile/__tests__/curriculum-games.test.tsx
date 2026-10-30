import React from 'react';
import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { blockCount, walk, type Block } from '../src/learning/codePath';
import type { LearningSession, Turn } from '../src/learning/types';
import { GameScreen } from '../src/screens/learning/GameScreen';
import { zoneAt } from '../src/screens/learning/games/CurriculumGames';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

const ref = (id: number, code: string, name: string) => ({ id, code, name });
const subjects = [
  { ...ref(1, 'english', 'Tiếng Anh'), levels: [], topics: [], lessons: [] },
  { ...ref(2, 'math', 'Toán'), levels: [], topics: [], lessons: [] },
  { ...ref(3, 'vietnamese', 'Tiếng Việt'), levels: [], topics: [], lessons: [] },
  { ...ref(4, 'science', 'Tự nhiên và Khoa học'), levels: [], topics: [], lessons: [] },
  { ...ref(5, 'informatics', 'Tin học'), levels: [], topics: [], lessons: [] },
];
const programme = (grade: string | null, label: string, list: { code: string; name: string; games: [string, string][] }[], extra = {}) => ({
  curriculum: 'Chương trình giáo dục phổ thông 2018', grade, level: null, outside_school: false, label, note: null, levels: [],
  subjects: list.map((s) => ({ code: s.code, name: s.name, games: s.games.map(([id, grades]) => ({ id, grades })) })), ...extra });
const GRADE1 = programme('grade1', 'Lớp 1', [
  { code: 'vietnamese', name: 'Tiếng Việt', games: [['word_builder', 'Lớp 1–2']] },
  { code: 'science', name: 'Tự nhiên và Xã hội', games: [['sorting', 'Lớp 1–5']] }]);
const GRADE4 = programme('grade4', 'Lớp 4', [
  { code: 'vietnamese', name: 'Tiếng Việt', games: [['spelling_detective', 'Lớp 2–5']] },
  { code: 'english', name: 'Tiếng Anh', games: [['word_shooter', 'Lớp 3–12 · người học tự do']] },
  { code: 'science', name: 'Khoa học', games: [['sorting', 'Lớp 1–5']] },
  { code: 'informatics', name: 'Tin học', games: [['code_path', 'Lớp 3–12 · người học tự do']] }]);
const catalog = (p: unknown) => ({ default_duration_minutes: 25, study_profile: null, subjects, programme: p });

const prefs = { sound: false, reduceMotion: true, setSound: jest.fn(), setReduceMotion: jest.fn() };

beforeEach(async () => {
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});

function renderLearning(user: object) {
  render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, age: 6, school_grade: 'grade1', ...user } as any} defaultDuration={25} focus={null}
        onFreeStudy={jest.fn()} onRewards={jest.fn()} />
    </ConfirmProvider></ToastProvider>,
  );
}

describe('Học tập follows the grade', () => {
  it('shows only the subjects and games with content for the grade, named as at school', async () => {
    mockServer({ 'GET /api/learning/catalog': { status: 200, body: catalog(GRADE1) },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } } });
    renderLearning({});
    expect(await screen.findByRole('button', { name: /^Tiếng Việt\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Tự nhiên và Xã hội\./ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tiếng Anh\./ })).toBeNull(); // English starts in grade 3
    expect(screen.queryByRole('button', { name: /^Toán\./ })).toBeNull(); // no Math content for grade 1 yet
    expect(screen.getByRole('button', { name: /^Học tự chọn\./ })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Tiếng Việt\./ }));
    expect(await screen.findByRole('button', { name: /^Ghép chữ\./ })).toBeTruthy();
    expect(screen.getByText('Lớp 1–2')).toBeTruthy(); // the grades the game supports
    expect(screen.queryByRole('button', { name: /^Thám tử chính tả\./ })).toBeNull();
  });

  it('first time: the guide (the spec\'s three steps), then the game starts for the grade on screen', async () => {
    const server = mockServer({
      'GET /api/learning/catalog': { status: 200, body: catalog(GRADE1) },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
      'GET /api/learning/tutorials': { status: 200, body: { seen: [] } },
      'POST /api/learning/play': { status: 409, body: { detail: 'No content', code: 'game_not_available' } },
    });
    renderLearning({});
    fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Việt\./ }));
    fireEvent.press(await screen.findByRole('button', { name: /^Ghép chữ\./ }));
    expect(await screen.findByText('Nhìn hình và đoán từ.')).toBeTruthy();
    expect(server.callsTo('POST /api/learning/play')).toHaveLength(0); // nothing starts behind the guide
    fireEvent.press(screen.getByRole('button', { name: /^Tiếp/ }));
    expect(screen.getByText('Chọn các chữ theo đúng thứ tự.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Tiếp/ }));
    expect(screen.getByText('Ghép đủ 10 từ để hoàn thành.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
    await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(1));
    expect(server.callsTo('POST /api/learning/play')[0].body).toMatchObject({ game: 'word_builder', grade: 'grade1' });
    expect(server.callsTo('POST /api/learning/tutorials/word_builder')).toHaveLength(1);
  });

  it('another grade can be studied for a while; the confirmed grade is not changed', async () => {
    const server = mockServer({
      'GET /api/learning/catalog': { status: 200, body: catalog(GRADE1) },
      'GET /api/learning/catalog?grade=grade4': { status: 200, body: catalog(GRADE4) },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
    });
    renderLearning({});
    fireEvent.press(await screen.findByRole('button', { name: 'Chọn lớp khác để ôn hoặc học trước' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Lớp 4' }));
    expect(await screen.findByText('Đang ôn / học trước: Lớp 4')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Khoa học\./ })).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'Về lớp chính' }));
    expect(await screen.findByRole('button', { name: /^Tự nhiên và Xã hội\./ })).toBeTruthy();
  });

  it('outside school the learner picks a level; it is kept on the device', async () => {
    const asked = programme(null, 'Người đi làm/Học tự do', [], { outside_school: true, grade: 'adult',
      note: 'Chọn trình độ để xem các môn và trò chơi phù hợp.',
      levels: [{ id: 'basic', label: 'Cơ bản' }, { id: 'intermediate', label: 'Trung cấp' }, { id: 'advanced', label: 'Nâng cao' }] });
    const chosen = { ...asked, level: 'intermediate', note: null, label: 'Người đi làm/Học tự do · Trung cấp',
      subjects: [{ code: 'informatics', name: 'Tin học', games: [{ id: 'code_path', grades: 'Lớp 3–12 · người học tự do' }] }] };
    mockServer({
      'GET /api/learning/catalog': { status: 200, body: catalog(asked) },
      'GET /api/learning/catalog?level=intermediate': { status: 200, body: catalog(chosen) },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
    });
    renderLearning({ age: 30, school_grade: 'adult' });
    expect(await screen.findByText('Chọn trình độ để xem các môn và trò chơi phù hợp.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chọn lớp khác để ôn hoặc học trước' })).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: 'Trình độ Trung cấp' }));
    expect(await screen.findByRole('button', { name: /^Tin học\./ })).toBeTruthy();
    expect(await AsyncStorage.getItem(`mirabi.learning.level:${USER.id}`)).toBe('intermediate');
  });
});

// --- The games ---------------------------------------------------------------------------------------------------------

const turn = (kind: Turn['kind'], prompt: Turn['prompt'], over: Partial<Turn> = {}): Turn => ({ turn_id: 'turn-c1', position: 0, kind,
  skill_label: 'x', prompt, hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0, on_screen_ms: 0, ...over });
const session = (game: string, open: Turn[], over: Partial<LearningSession> = {}): LearningSession => ({
  id: 7, status: 'active', kind: 'lesson', mode: 'practice', game_type: game as any, variant: null, game: game as any,
  subject: ref(3, 'vietnamese', 'Tiếng Việt'), topic: ref(9, 'ghep_chu', 'Ghép chữ'), level: ref(1, 'g1', 'Lớp 1'), lesson: ref(5, 'vi.word_builder.g1', 'Ghép chữ'),
  duration_seconds: 3600, active_ms: 0, remaining_ms: 3_600_000, time_up: false, timed: false, hearts: 0, hearts_max: 0, score: 0, combo: 0, max_combo: 0,
  required_count: 10, resolved_count: 0, pending_practice: 0, open_turns: open, can_complete: false, end_reason: null, reward: null, version: 1,
  server_time: '2026-10-30T10:00:00Z', ...over });
const event = (result: object, s: LearningSession) => ({ status: 200, body: { result: { turn_id: 'turn-c1', event: 'answer', correct: false, outcome: null,
  resolved: false, retry_allowed: false, error_type: null, score_delta: 0, hearts_delta: 0, combo: 0, hint: null, correct_answer: null, explanation: null,
  practice_added: false, feedback: null, ...result }, session: s, replayed: false } });

function play(s: LearningSession) {
  render(<ToastProvider><ConfirmProvider>
    <GameScreen initial={s} petId="fox" petLevel={1} prefs={prefs} onEnded={jest.fn()} />
  </ConfirmProvider></ToastProvider>);
}

/** 3-2-1 (the pictures are ready at once in tests), then the session is resumed on the server. */
async function afterCountdown() {
  for (let i = 0; i < 5; i++) await act(async () => { jest.advanceTimersByTime(1000); });
}

describe('the games', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('Ghép chữ: tap the letters in order and check; a wrong word stays to be fixed, without hearts or clock', async () => {
    const t1 = turn('word_build', { picture: '🐱', unit: 'letter', tiles: [{ id: 't1', text: 'o' }, { id: 't2', text: 'm' }, { id: 't3', text: 'è' }] });
    const s = session('word_builder', [t1]);
    const server = mockServer({ 'POST /api/learning/sessions/7/answer': (req) => (req.body.answer.join() === 't2,t3,t1'
      ? event({ correct: true, resolved: true, outcome: 'corrected', correct_answer: 'mèo' }, session('word_builder', [], { resolved_count: 1 }))
      : event({ retry_allowed: true, error_type: 'wrong_order', feedback: 'Chưa đúng: “omè”. Thử đổi thứ tự các chữ nhé.' }, s)),
    'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: s, replayed: false } } });
    play(s);
    await afterCountdown();
    expect(await screen.findByLabelText('Hình gợi ý')).toBeTruthy();
    expect(screen.queryByLabelText(/Thời gian còn lại/)).toBeNull(); // no clock
    expect(screen.queryByLabelText(/Còn \d+ tim/)).toBeNull(); // no hearts
    expect(screen.queryByRole('button', { name: 'Xem đáp án' })).toBeNull();
    for (const x of ['o', 'm', 'è']) fireEvent.press(screen.getByRole('button', { name: `Chữ ${x}` }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(await screen.findByText('Chưa đúng: “omè”. Thử đổi thứ tự các chữ nhé.')).toBeTruthy();
    // The pieces stay: take "o" out and put it at the end.
    fireEvent.press(screen.getByRole('button', { name: 'Gỡ o' }));
    fireEvent.press(screen.getByRole('button', { name: 'Chữ o' }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(2));
    expect(server.callsTo('POST /api/learning/sessions/7/answer')[1].body.answer).toEqual(['t2', 't3', 't1']);
  });

  it('Thám tử chính tả: the word first, then its spelling; the explanation before the next sentence', async () => {
    const tokens = [{ id: 'w1', text: 'Bé' }, { id: 'w2', text: 'uống' }, { id: 'w3', text: 'lước' }];
    const find = session('spelling_detective', [turn('spell_fix', { step: 'find', tokens })]);
    const fix = session('spelling_detective', [turn('spell_fix', { step: 'fix', tokens, found: 'w3',
      options: [{ id: 'o1', text: 'lước' }, { id: 'o2', text: 'nước' }] })]);
    const server = mockServer({
      'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: find, replayed: false } },
      'POST /api/learning/sessions/7/answer': (req) => (req.body.answer.length === 1
        ? (req.body.answer[0] === 'w3' ? event({ correct: true, feedback: 'Đúng rồi, “lước” viết sai! Giờ chọn cách viết đúng.' }, fix)
          : event({ retry_allowed: true, error_type: 'wrong_word', feedback: '“uống” viết đúng rồi. Đọc lại câu và tìm tiếng viết sai nhé.' }, find))
        : event({ correct: true, resolved: true, outcome: 'corrected', correct_answer: 'Bé uống nước.', explanation: '“Nước” viết bằng n.' },
          session('spelling_detective', [], { resolved_count: 1 }))),
    });
    play(find);
    await afterCountdown();
    expect(screen.queryByRole('button', { name: /^Cách viết/ })).toBeNull(); // no spellings before the word is found
    fireEvent.press(await screen.findByRole('button', { name: 'uống' }));
    expect(await screen.findByText('“uống” viết đúng rồi. Đọc lại câu và tìm tiếng viết sai nhé.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'lước' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Cách viết nước' }));
    expect(await screen.findByText('“Nước” viết bằng n.')).toBeTruthy();
    expect(screen.getByText('Chính xác!')).toBeTruthy();
    expect(server.callsTo('POST /api/learning/sessions/7/answer').map((c) => c.body.answer)).toEqual([['w2'], ['w3'], ['w3', 'o2']]);
    fireEvent.press(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    await waitFor(() => expect(screen.queryByText('“Nước” viết bằng n.')).toBeNull());
  });

  it('Phân loại cùng pet: a card dropped (or a group tapped) is sent; a wrong group is explained', async () => {
    const groups = [{ id: 'dong_vat', label: 'Động vật', icon: '🐾' }, { id: 'thuc_vat', label: 'Thực vật', icon: '🌱' }];
    const s = session('sorting', [turn('sort_card', { title: 'Động vật hay thực vật?', groups, card: { text: 'Con ếch', picture: '🐸' } })]);
    const server = mockServer({
      'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: s, replayed: false } },
      'POST /api/learning/sessions/7/answer': event({ retry_allowed: true, error_type: 'wrong_group',
        feedback: 'Chưa đúng, thẻ chưa thuộc nhóm “Thực vật”. Con ếch là động vật.' }, s),
    });
    play(s);
    await afterCountdown();
    fireEvent.press(await screen.findByRole('button', { name: 'Nhóm Thực vật' }));
    expect(await screen.findByText('Chưa đúng, thẻ chưa thuộc nhóm “Thực vật”. Con ếch là động vật.')).toBeTruthy();
    expect(server.callsTo('POST /api/learning/sessions/7/answer')[0].body.answer).toBe('thuc_vat');
    expect(zoneAt({ x: 50, y: 210 }, [{ id: 'a', x: 0, y: 200, width: 100, height: 80 }, { id: 'b', x: 120, y: 200, width: 100, height: 80 }])).toBe('a');
    expect(zoneAt({ x: 110, y: 210 }, [{ id: 'a', x: 0, y: 200, width: 100, height: 80 }])).toBeNull();
  });

  it('Lập trình đường đi: blocks, a loop, "Chạy" walks the pet and sends the program; the limit is kept', async () => {
    const level = { number: 1, cols: 7, rows: 3, start: { x: 0, y: 1, dir: 'E' as const }, goal: { x: 6, y: 1 }, walls: [] as [number, number][],
      blocks: ['forward', 'left', 'right', 'repeat'], max_blocks: 3 };
    const s = session('code_path', [turn('code_path', level, { hints_total: 2 })], { required_count: 5 });
    const server = mockServer({
      'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: s, replayed: false } },
      'POST /api/learning/sessions/7/answer': (req) => (JSON.stringify(req.body.answer) === JSON.stringify(['repeat:6', 'forward', 'end'])
        ? event({ correct: true, resolved: true, outcome: 'corrected' }, session('code_path', [], { resolved_count: 1, required_count: 5 }))
        : event({ retry_allowed: true, error_type: 'path_short', feedback: 'Pet đã chạy hết lệnh nhưng chưa tới đích. Thêm hoặc sửa lệnh nhé.' }, s)),
    });
    play(s);
    await afterCountdown();
    for (let i = 0; i < 3; i++) fireEvent.press(await screen.findByRole('button', { name: 'Thêm lệnh Tiến' }));
    expect(screen.getByLabelText('Đã dùng 3 trên 3 lệnh')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm lệnh Tiến' }).props.accessibilityState?.disabled ?? true).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Chạy' }));
    expect(await screen.findByText('Pet đã chạy hết lệnh nhưng chưa tới đích. Thêm hoặc sửa lệnh nhé.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Xóa hết lệnh' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thêm khối Lặp lại' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thêm lệnh Tiến' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đóng khối Lặp lại' }));
    for (let i = 0; i < 4; i++) fireEvent.press(screen.getByRole('button', { name: /^Đổi số lần lặp/ })); // 2 → 6
    fireEvent.press(screen.getByRole('button', { name: 'Chạy' }));
    await waitFor(() => expect(server.callsTo('POST /api/learning/sessions/7/answer')).toHaveLength(2));
    expect(server.callsTo('POST /api/learning/sessions/7/answer')[1].body.answer).toEqual(['repeat:6', 'forward', 'end']);
  });
});

describe('Lập trình đường đi on the device', () => {
  it('walks every level as the backend does (the reviewed levels and their solutions)', () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/app/data/curriculum/code_path.json'), 'utf8'));
    for (const level of data.levels) {
      const result = walk({ ...level, walls: level.walls }, level.solution as Block[]);
      expect(result?.ok).toBe(true);
      expect(blockCount(level.solution)).toBeLessThanOrEqual(level.max_blocks);
    }
    const b4 = data.levels.find((l: { key: string }) => l.key === 'b4');
    expect(walk(b4, ['forward', 'forward'])).toMatchObject({ ok: false, reason: 'wall' });
    expect(walk(b4, ['repeat:2', 'forward'])).toBeNull(); // an open loop is not a program
  });
});
