import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import type { VocabProgress } from '../src/learning/types';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mockServer, USER } from '../test/mockServer';

// Khám phá từ mới / Ôn tập of the two vocabulary games: the strip under each game, the topic, the end of new words and
// the one-time celebration of a completed level.

const catalog = { default_duration_minutes: 25, subjects: [
  { id: 1, code: 'english', name: 'Tiếng Anh', levels: [], topics: [], lessons: [] },
  { id: 2, code: 'math', name: 'Toán', levels: [], topics: [], lessons: [] }] };
const progress = (game: 'meteor' | 'word_shooter', over: Partial<VocabProgress> = {}): VocabProgress => ({
  game, game_name: game === 'meteor' ? 'Bắn thiên thạch' : 'Từ rơi', grade: 'grade4', grade_label: 'Lớp 4', academic_year: 2026,
  levels: [{ level: 1, name: 'Rất dễ', status: 'unlocked', total: 420, discovered: 35 },
    { level: 2, name: 'Dễ', status: 'locked', total: 900, discovered: 0 },
    { level: 3, name: 'Trung bình', status: 'above_grade', total: 0, discovered: 0 },
    { level: 4, name: 'Khó', status: 'above_grade', total: 0, discovered: 0 },
    { level: 5, name: 'Nâng cao', status: 'above_grade', total: 0, discovered: 0 }],
  current_level: 1, max_level: 2, discovered: 35, discovered_this_year: 35, new_words_left: 385, challenge: 40, review_due: 6,
  topics: [{ code: 'animals', name: 'Động vật', total: 60, new_words_left: 48 }, { code: 'food', name: 'Ăn uống', total: 70, new_words_left: 0 }],
  celebration: null, ...over,
});
const party = { level: 1, name: 'Rất dễ', words: 420, next_level: 2, title: 'Chúc mừng! Bạn đã khám phá hết từ vựng cấp 1 – Rất dễ!',
  message: 'Bạn đã khám phá 420 từ. Cấp độ mới đang chờ bạn!' };
const base = {
  'GET /api/learning/catalog': { status: 200, body: catalog },
  'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
  'GET /api/learning/tutorials': { status: 200, body: { seen: ['word_shooter', 'meteor'] } },
  'GET /api/learning/vocabulary/progress?game=meteor': { status: 200, body: progress('meteor') },
  'GET /api/learning/vocabulary/progress?game=word_shooter': { status: 200, body: progress('word_shooter', { review_due: 0 }) },
};

function renderLearning() {
  return render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, id: 1, pet: 'fox', level: 1 } as any} defaultDuration={25} focus={null} onFreeStudy={jest.fn()} onRewards={jest.fn()} />
    </ConfirmProvider></ToastProvider>,
  );
}
async function openEnglish() {
  renderLearning();
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
}

beforeEach(async () => {
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  await AsyncStorage.clear();
});

test('each vocabulary game shows its level, new words left and Ôn tập; a tap discovers new words of the topic chosen', async () => {
  const server = mockServer({ ...base, 'POST /api/learning/play': { status: 409, body: { detail: 'x', code: 'open_session_exists' } } });
  await openEnglish();
  expect(await screen.findAllByLabelText('Cấp 1, Rất dễ: đã khám phá 35 trên 420 từ')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Ôn tập, 6 từ cần ôn' })).toBeTruthy();
  expect(screen.getAllByText('385 từ mới')).toHaveLength(2);

  // Pick a topic for Bắn thiên thạch: the sheet lists the open topics with their new words left.
  fireEvent.press(screen.getAllByRole('button', { name: 'Chủ đề: Mọi chủ đề' })[1]);
  expect(await screen.findByText('Đã khám phá hết')).toBeTruthy(); // Ăn uống
  fireEvent.press(screen.getByRole('checkbox', { name: 'Động vật' }));
  expect(await screen.findByRole('button', { name: 'Chủ đề: Động vật' })).toBeTruthy();
  expect(screen.getByText('48 từ mới')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: /^Bắn thiên thạch \(Việt → Anh\)\./ }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(1));
  expect(server.callsTo('POST /api/learning/play')[0].body).toMatchObject({ game: 'meteor', vocab: 'discover', topic: 'animals' });

  expect(await screen.findByText('Bạn đang có một chặng chưa xong. Hãy tiếp tục hoặc kết thúc chặng đó trước.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Ôn tập, 6 từ cần ôn' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(2));
  expect(server.callsTo('POST /api/learning/play')[1].body).toMatchObject({ game: 'meteor', vocab: 'review' });
  expect(server.callsTo('POST /api/learning/play')[1].body.topic).toBeUndefined();
});

test('when no new word is left, the game says so and offers another topic or Ôn tập (never the old words again)', async () => {
  let calls = 0;
  const server = mockServer({ ...base,
    'POST /api/learning/play': () => (++calls === 1
      ? { status: 409, body: { detail: 'Bạn đã khám phá hết từ mới ở đây.', code: 'vocabulary_exhausted' } }
      : { status: 409, body: { detail: 'x', code: 'nothing_to_review' } }) });
  await openEnglish();
  await screen.findAllByLabelText(/^Cấp 1, Rất dễ/);
  fireEvent.press(screen.getByRole('button', { name: /^Bắn từ tiếng Anh \(Anh → Việt\)\./ }));
  expect(await screen.findByText('Bạn đã khám phá hết từ mới ở đây! Hãy chọn chủ đề khác hoặc Ôn tập từ đã học.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Chọn chủ đề khác' }));
  expect(await screen.findByText('Chọn chủ đề')).toBeTruthy();
  fireEvent.press(screen.getAllByRole('button', { name: 'Đóng' }).at(-1)!);
  fireEvent.press(screen.getByRole('button', { name: 'Ôn tập từ đã học' }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(2));
  expect(server.callsTo('POST /api/learning/play')[1].body).toMatchObject({ game: 'word_shooter', vocab: 'review' });
});

test('a completed level is celebrated once: shown, recorded as seen, and gone the next time', async () => {
  let shown = false;
  const server = mockServer({ ...base,
    'GET /api/learning/vocabulary/progress?game=meteor': () => ({ status: 200, body: progress('meteor', {
      celebration: shown ? null : party, current_level: 2,
      levels: progress('meteor').levels.map((l) => (l.level === 1 ? { ...l, status: 'completed', discovered: 420 } : l.level === 2 ? { ...l, status: 'unlocked' } : l)) }) }),
    'POST /api/learning/vocabulary/levels/meteor/1/celebrated': () => { shown = true; return { status: 200, body: { celebrated: true } }; },
    'POST /api/learning/play': { status: 409, body: { detail: 'x', code: 'open_session_exists' } } });
  await openEnglish();
  const overlay = await screen.findByTestId('vocab-celebration');
  expect(within(overlay).getByText(party.title)).toBeTruthy();
  expect(within(overlay).getByText('Bạn đã khám phá 420 từ. Cấp độ mới đang chờ bạn!')).toBeTruthy();
  await waitFor(() => expect(server.callsTo('POST /api/learning/vocabulary/levels/meteor/1/celebrated')).toHaveLength(1));
  fireEvent.press(within(overlay).getByRole('button', { name: 'Khám phá cấp độ mới' }));
  await waitFor(() => expect(screen.queryByTestId('vocab-celebration')).toBeNull());
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(1));
  expect(server.callsTo('POST /api/learning/play')[0].body).toMatchObject({ game: 'meteor', vocab: 'discover' });
  // Back on the list later: nothing to celebrate any more.
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  fireEvent.press(await screen.findByRole('button', { name: /^Tiếng Anh\./ }));
  await screen.findAllByLabelText(/^Cấp 2, Dễ/);
  expect(screen.queryByTestId('vocab-celebration')).toBeNull();
  expect(server.callsTo('POST /api/learning/vocabulary/levels/meteor/1/celebrated')).toHaveLength(1);
});

test('an older server without levels: the games play as before, no strip', async () => {
  const server = mockServer({ ...base,
    'GET /api/learning/vocabulary/progress?game=meteor': { status: 404, body: { detail: 'Not found', code: 'not_found' } },
    'GET /api/learning/vocabulary/progress?game=word_shooter': { status: 404, body: { detail: 'Not found', code: 'not_found' } },
    'POST /api/learning/play': { status: 409, body: { detail: 'x', code: 'open_session_exists' } } });
  await openEnglish();
  fireEvent.press(await screen.findByRole('button', { name: /^Bắn thiên thạch \(Việt → Anh\)\./ }));
  await waitFor(() => expect(server.callsTo('POST /api/learning/play')).toHaveLength(1));
  expect(screen.queryByLabelText(/^Cấp \d/)).toBeNull();
  expect(screen.queryByRole('button', { name: /^Ôn tập/ })).toBeNull();
});
