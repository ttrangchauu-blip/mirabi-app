import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { setSession } from '../src/api/client';
import type { LearningSession, VocabHistoryItem, VocabWordDetail } from '../src/learning/types';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { studiedAt } from '../src/screens/learning/VocabHistoryScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mockServer, USER } from '../test/mockServer';

const ref = (id: number, code: string, name: string) => ({ id, code, name });
const catalog = { default_duration_minutes: 25, subjects: [
  { id: 1, code: 'english', name: 'Tiếng Anh', levels: [], topics: [], lessons: [] },
  { id: 2, code: 'math', name: 'Toán', levels: [], topics: [], lessons: [] }] };
const now = new Date().toISOString();
const item = (over: Partial<VocabHistoryItem>): VocabHistoryItem => ({
  entry_key: 'bank.money', word: 'bank', meaning_vi: 'ngân hàng', context_vi: 'nơi gửi và rút tiền', part_of_speech: 'danh từ',
  first_seen_at: now, last_seen_at: now, status: 'correct', correct: 1, wrong: 0, unanswered: 0,
  directions: { vi_en: { correct: 1, wrong: 0, unanswered: 0, last_result: 'correct', last_at: now } }, ...over,
});
const items = [
  item({}),
  item({ entry_key: 'bank.river', meaning_vi: 'bờ sông', context_vi: 'vùng đất dọc hai bên sông', status: 'review', correct: 0, wrong: 1,
    directions: { en_vi: { correct: 0, wrong: 1, unanswered: 0, last_result: 'wrong', last_at: now } } }),
  item({ entry_key: 'cold.weather', word: 'cold', meaning_vi: 'lạnh', context_vi: 'về thời tiết, nhiệt độ', status: 'review', correct: 0, unanswered: 1,
    directions: { vi_en: { correct: 0, wrong: 0, unanswered: 1, last_result: 'unanswered', last_at: now } } }),
];
const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
/** The history endpoint as the backend answers it: filter, accent-insensitive search, then one page. */
function historyPage(all: VocabHistoryItem[], url: string) {
  const params = new URL(url, 'http://x').searchParams;
  const filter = params.get('filter') ?? 'all';
  const q = fold(params.get('q') ?? '');
  const limit = Number(params.get('limit') ?? 15);
  const offset = Number(params.get('offset') ?? 0);
  const matching = all.filter((i) => (filter === 'all' || i.status === filter)
    && (!q || [i.word, i.meaning_vi, i.context_vi ?? ''].some((v) => fold(v).includes(q))));
  const due = (d: 'en_vi' | 'vi_en') => all.filter((i) => i.directions[d] && i.directions[d]!.last_result !== 'correct').length;
  return { items: matching.slice(offset, offset + limit), total: matching.length, limit, offset,
    counts: { all: all.length, correct: all.filter((i) => i.status === 'correct').length, review: all.filter((i) => i.status === 'review').length },
    due: { en_vi: due('en_vi'), vi_en: due('vi_en') } };
}
/** mockServer for everything else, plus the history list answered from `all` (or `reply`); returns the list requests. */
function serve(extra: Record<string, any> = {}, all: VocabHistoryItem[] = items, reply?: (url: string) => { status: number; body: unknown }) {
  const server = mockServer({ ...routes, ...extra });
  const base = global.fetch;
  const listCalls: URLSearchParams[] = [];
  global.fetch = jest.fn(async (url: string, init?: any) => {
    if (!url.includes('/api/learning/vocabulary/history?')) return base(url, init);
    listCalls.push(new URL(url, 'http://x').searchParams);
    const r = reply ? reply(url) : { status: 200, body: historyPage(all, url) };
    return { ok: r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
  }) as any;
  return { server, listCalls };
}
const river: VocabWordDetail = { ...items[1], phonetic: null, example_en: 'We had a picnic on the river bank.', example_vi: 'Chúng tôi đi dã ngoại bên bờ sông.',
  can_practice: true, attempts: [
    { turn_id: 't2', session_id: 8, at: now, direction: 'en_vi', result: 'wrong', outcome: 'corrected', practice: false, session_open: false },
    { turn_id: 't1', session_id: 7, at: '2026-10-20T03:00:00Z', direction: 'en_vi', result: 'correct', outcome: 'first_try', practice: false, session_open: false }] };
const review = (over: Partial<LearningSession> = {}): LearningSession => ({
  id: 21, status: 'active', kind: 'review', mode: 'practice', game_type: 'meteor', variant: 'word_shooter', game: 'word_shooter',
  subject: ref(1, 'english', 'Tiếng Anh'), topic: ref(9, 'mix', 'Tổng hợp'), level: ref(1, 'auto', 'Tự điều chỉnh'),
  lesson: ref(30, 'en.vocab.mix', 'Tổng hợp'), duration_seconds: 900, active_ms: 0, remaining_ms: 900_000, time_up: false,
  hearts: 0, hearts_max: 0, score: 0, combo: 0, max_combo: 0, required_count: 1, resolved_count: 0, pending_practice: 0,
  open_turns: [], can_complete: false, end_reason: null, reward: null, version: 1, server_time: now, ...over,
});
const routes = {
  'GET /api/learning/catalog': { status: 200, body: catalog },
  'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
  'GET /api/learning/vocabulary/history/bank.river': { status: 200, body: river },
  'GET /api/learning/tutorials': { status: 200, body: { seen: ['word_shooter', 'meteor'] } }, // both guides already read
};

function renderLearning() {
  return render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, id: 1, pet: 'fox', level: 1 } as any} defaultDuration={25} focus={null} onFreeStudy={jest.fn()} onRewards={jest.fn()} />
    </ConfirmProvider></ToastProvider>,
  );
}

async function openHistory() {
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  fireEvent.press(screen.getByRole('button', { name: 'Từ đã học' }));
}

beforeEach(async () => {
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  await AsyncStorage.clear();
});

test('"Từ đã học" sits on the English game list (not on Math) and lists words newest first with search and filters', async () => {
  const { listCalls } = serve();
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Toán\./ }));
  expect(screen.queryByRole('button', { name: 'Từ đã học' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  expect(screen.getByRole('button', { name: /^Bắn thiên thạch \(Việt → Anh\)\./ })).toBeTruthy(); // the games stay as they were
  fireEvent.press(screen.getByRole('button', { name: 'Từ đã học' }));

  expect(await screen.findByText('3 từ · 2 cần ôn · mới học gần nhất trước')).toBeTruthy();
  const rows = () => screen.getAllByRole('button', { name: /, (đúng|cần ôn)$/ }).map((b) => b.props.accessibilityLabel);
  expect(rows()).toEqual(['bank, ngân hàng, đúng', 'bank, bờ sông, cần ôn', 'cold, lạnh, cần ôn']);
  expect(screen.getAllByText(/^Học gần nhất: Hôm nay, \d\d:\d\d$/)).toHaveLength(3);

  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull(); // one page: no pager

  fireEvent.changeText(screen.getByLabelText('Tìm từ đã học'), 'song'); // "sông" without accents, in the meaning
  await waitFor(() => expect(rows()).toEqual(['bank, bờ sông, cần ôn']));
  expect(listCalls.at(-1)!.get('q')).toBe('song');
  fireEvent.changeText(screen.getByLabelText('Tìm từ đã học'), 'BANK');
  await waitFor(() => expect(rows()).toHaveLength(2));
  fireEvent.changeText(screen.getByLabelText('Tìm từ đã học'), 'xyz');
  expect(await screen.findByText('Không tìm thấy từ nào')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
  await waitFor(() => expect(rows()).toHaveLength(3));

  fireEvent.press(screen.getByRole('tab', { name: 'Trả lời đúng' }));
  await waitFor(() => expect(rows()).toEqual(['bank, ngân hàng, đúng']));
  fireEvent.press(screen.getByRole('tab', { name: 'Cần ôn' }));
  await waitFor(() => expect(rows()).toEqual(['bank, bờ sông, cần ôn', 'cold, lạnh, cần ôn']));
  expect(listCalls.at(-1)!.get('filter')).toBe('review');
});

test('15 words a page: next and previous, the page is kept while a word is open, a new filter starts on page 1', async () => {
  const many = Array.from({ length: 32 }, (_, n) => item({ entry_key: `w${n}`, word: `word${n}`, meaning_vi: `nghĩa ${n}`, context_vi: null,
    status: n % 4 === 0 ? 'review' : 'correct' }));
  const { listCalls } = serve({ 'GET /api/learning/vocabulary/history/w17': { status: 200, body: { ...many[17], phonetic: null, example_en: null,
    example_vi: null, can_practice: true, attempts: [] } } }, many);
  await openHistory();
  const rows = async () => (await screen.findAllByRole('button', { name: /, (đúng|cần ôn)$/ })).map((b) => b.props.accessibilityLabel.split(',')[0]);
  expect(await rows()).toEqual(many.slice(0, 15).map((i) => i.word));
  expect(listCalls[0].get('limit')).toBe('15');
  expect(listCalls[0].get('offset')).toBe('0');
  expect(screen.getByText('Trang 1/3')).toBeTruthy();
  expect(screen.getByText('1–15 / 32 từ')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Trang trước' }).props.accessibilityState.disabled).toBe(true);

  fireEvent.press(screen.getByRole('button', { name: 'Trang sau' }));
  expect(await screen.findByText('Trang 2/3')).toBeTruthy();
  expect(await rows()).toEqual(many.slice(15, 30).map((i) => i.word));
  expect(listCalls.at(-1)!.get('offset')).toBe('15');
  fireEvent.press(screen.getByRole('button', { name: 'Trang sau' }));
  expect(await screen.findByText('31–32 / 32 từ')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Trang sau' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'Trang trước' }));
  expect(await screen.findByText('Trang 2/3')).toBeTruthy();

  // Open a word and come back: still on page 2.
  fireEvent.press(await screen.findByRole('button', { name: 'word17, nghĩa 17, đúng' }));
  expect(await screen.findByText('Lịch sử trả lời')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByText('Trang 2/3')).toBeTruthy();

  fireEvent.press(screen.getByRole('tab', { name: 'Cần ôn' })); // 8 words: one page, from the start
  await waitFor(() => expect(listCalls.at(-1)!.get('offset')).toBe('0'));
  expect(await rows()).toEqual(many.filter((i) => i.status === 'review').map((i) => i.word));
  expect(screen.queryByText(/^Trang /)).toBeNull();
});

test('a word shows its meaning, example, results per game and every answer; no pronunciation is made up', async () => {
  serve();
  const speak = jest.spyOn(Speech, 'speak').mockImplementation(() => {});
  await openHistory();
  fireEvent.press(await screen.findByRole('button', { name: 'bank, bờ sông, cần ôn' }));
  expect(await screen.findByText('bờ sông')).toBeTruthy();
  expect(screen.getByText('vùng đất dọc hai bên sông')).toBeTruthy();
  expect(screen.getByText('We had a picnic on the river bank.')).toBeTruthy();
  expect(screen.getByText('danh từ')).toBeTruthy(); // exactly the part of speech: this word has no phonetic in the data
  expect(screen.getByText('Đúng 0 · Sai 1')).toBeTruthy();
  expect(screen.getByText('Lần gần nhất: Sai')).toBeTruthy();
  expect(screen.getByText('Chưa luyện ở chiều này')).toBeTruthy(); // Việt → Anh never played for this sense
  const answers = screen.getAllByText(/^(Sai rồi sửa đúng|Đúng ngay)$/).map((t) => [t.props.children].flat().join(''));
  expect(answers).toEqual(['Sai rồi sửa đúng', 'Đúng ngay']); // newest first
  expect(screen.getByText('20/10/2026 · Anh → Việt')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Nghe phát âm bank' }));
  expect(speak).toHaveBeenCalledWith('bank', expect.objectContaining({ language: 'en-US' }));
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByText('3 từ · 2 cần ôn · mới học gần nhất trước')).toBeTruthy();
});

test('"Luyện lại" plays one word, or every "Cần ôn" word, in the game chosen', async () => {
  const { server } = serve({ 'POST /api/learning/vocabulary/practice': { status: 201, body: review() } });
  await openHistory();
  fireEvent.press(await screen.findByRole('button', { name: 'bank, bờ sông, cần ôn' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Luyện lại' }));
  expect(screen.getByText('Có từ cần ôn ở chiều này')).toBeTruthy(); // Anh → Việt is the one due
  fireEvent.press(screen.getByRole('button', { name: 'Bắn từ tiếng Anh (Anh → Việt)' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/vocabulary/practice')).toHaveLength(1));
  const [one] = server.callsTo('POST /api/learning/vocabulary/practice');
  expect(one.body).toMatchObject({ game: 'word_shooter', entry_keys: ['bank.river'], mode: 'practice', start_paused: true });
  expect(one.headers['Idempotency-Key']).toBeTruthy();
});

test('practising the whole "Cần ôn" group sends no word list (the backend takes the words due)', async () => {
  const { server } = serve({ 'POST /api/learning/vocabulary/practice': { status: 201, body: review({ game: 'meteor', variant: 'meteor', required_count: 2 }) } });
  await openHistory();
  fireEvent.press(await screen.findByRole('tab', { name: 'Cần ôn' }));
  fireEvent.press(screen.getByRole('button', { name: 'Luyện tất cả từ cần ôn (2)' }));
  fireEvent.press(screen.getByRole('button', { name: 'Bắn thiên thạch (Việt → Anh)' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/vocabulary/practice')).toHaveLength(1));
  const body = server.callsTo('POST /api/learning/vocabulary/practice')[0].body;
  expect(body.game).toBe('meteor');
  expect(body.entry_keys).toBeUndefined();
});

test('empty, loading error and retry', async () => {
  let reads = 0;
  serve({}, [], (url) => (++reads === 1 ? { status: 503, body: { detail: 'down', code: 'server_error' } } : { status: 200, body: historyPage([], url) }));
  await openHistory();
  fireEvent.press(await screen.findByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Chưa có từ nào')).toBeTruthy();
  expect(screen.queryByLabelText('Tìm từ đã học')).toBeNull();
});

test('studiedAt: today and yesterday by local time, then the date', () => {
  const base = new Date(2026, 9, 28, 15, 0);
  expect(studiedAt(new Date(2026, 9, 28, 9, 5).toISOString(), base)).toBe('Hôm nay, 09:05');
  expect(studiedAt(new Date(2026, 9, 27, 23, 59).toISOString(), base)).toBe('Hôm qua, 23:59');
  expect(studiedAt(new Date(2026, 9, 2, 8, 0).toISOString(), base)).toBe('02/10/2026');
  expect(studiedAt(null, base)).toBe('');
});
