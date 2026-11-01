import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { filterLessons, groupOf, lessonCards, newlyUnlocked, orderChanged, sortLessons, unlockHint } from '../src/learning/lessonOrder';
import type { LessonListItem, SubjectLessons } from '../src/learning/types';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

// A subject's lessons, sorted by the learner's state (backend lesson_api.sort_lessons): Đang học → Đã mở → Đã hoàn
// thành → Chưa mở, each group in the curriculum's chapter and lesson order.

beforeEach(async () => {
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});

type Spec = { key: string; title: string; unlock: 'unlocked' | 'locked'; progress: 'not_started' | 'in_progress' | 'completed';
  percent?: number; planned?: boolean; requires?: { key: string; title: string; done: boolean }[] };
const card = (s: Spec, chapter: { key: string; title: string }, ci: number, li: number): LessonListItem => ({
  key: s.key, title: s.title, description: '', status: s.planned ? 'planned' : 'ready', games: [], locked: !s.planned && s.unlock === 'locked',
  requires_note: null, progress: s.planned ? null : { status: s.progress, label: '', games_passed: 0, games_total: 2, percent: s.percent ?? 0 },
  lesson_id: s.key, subject_id: 'science', grade_id: 'grade3', academic_year: 2026, chapter_key: chapter.key, chapter_title: chapter.title,
  chapter_order: ci, lesson_order: li, unlock_status: s.unlock, progress_status: s.progress, progress_percent: s.percent ?? 0,
  unlock_requirements: s.planned ? [{ type: 'content', note: 'Bài học đang được biên soạn.' }]
    : (s.requires ?? []).map((r) => ({ type: 'lesson' as const, lesson_id: r.key, title: r.title, done: r.done })),
  unlock_note: s.unlock === 'locked' ? (s.planned ? 'Bài học đang được biên soạn.' : null) : null,
  group: groupOf(s.unlock === 'unlocked', s.progress),
});
const CHAPTERS = [{ key: 'c1', title: 'Thực vật' }, { key: 'c2', title: 'Động vật' }, { key: 'c3', title: 'Trái Đất' }];
/** Chapters of lessons as the server sends them (in the curriculum's order); `lessons` sorted the server's way. */
function subject(chapters: Spec[][]): SubjectLessons {
  const out = chapters.map((lessons, ci) => ({ ...CHAPTERS[ci], order: ci + 1, lessons: lessons.map((s, li) => card(s, CHAPTERS[ci], ci + 1, li + 1)) }));
  const all = out.flatMap((c) => c.lessons);
  const ready = all.filter((l) => l.status === 'ready');
  const completed = ready.filter((l) => l.progress_status === 'completed').length;
  return { subject: { code: 'science', name: 'Tự nhiên và Xã hội', type: 'compulsory', type_label: 'Bắt buộc', note: null, unsupported: null,
    practice_note: null, icon: 'leaf-outline', bg: '#E3F5E6', color: '#22703A', chapters: 3, lessons: all.length, ready: ready.length,
    completed, in_progress: 0, status: 'partial', selected: null },
  grade: 'grade3', number: 3, label: 'Lớp 3', academic_year: 2026, academic_year_label: '2026–2027', organization: 'topic', source_note: null,
  textbook: null, chapters: out, progress: { completed, ready: ready.length, total: all.length, percent: Math.round((100 * completed) / ready.length) } };
}

const B = { key: 'b', title: 'Cây cần gì để sống' };
const BEFORE = subject([
  [{ key: 'a', title: 'Các bộ phận của cây', unlock: 'unlocked', progress: 'completed', percent: 100 },
    { ...B, unlock: 'unlocked', progress: 'in_progress', percent: 50 }],
  [{ key: 'c', title: 'Con vật quanh em', unlock: 'unlocked', progress: 'not_started' },
    { key: 'd', title: 'Vòng đời con ếch', unlock: 'locked', progress: 'not_started', requires: [{ ...B, done: false }] }],
  [{ key: 'e', title: 'Bầu trời ban ngày', unlock: 'locked', progress: 'not_started', planned: true }],
]);
// After "Cây cần gì để sống" is completed: it moves down to Đã hoàn thành and "Vòng đời con ếch" opens.
const AFTER = subject([
  [{ key: 'a', title: 'Các bộ phận của cây', unlock: 'unlocked', progress: 'completed', percent: 100 },
    { ...B, unlock: 'unlocked', progress: 'completed', percent: 100 }],
  [{ key: 'c', title: 'Con vật quanh em', unlock: 'unlocked', progress: 'not_started' },
    { key: 'd', title: 'Vòng đời con ếch', unlock: 'unlocked', progress: 'not_started', requires: [{ ...B, done: true }] }],
  [{ key: 'e', title: 'Bầu trời ban ngày', unlock: 'locked', progress: 'not_started', planned: true }],
]);

describe('the order of a subject\'s lessons', () => {
  it('puts Đang học first, then Đã mở, Đã hoàn thành and Chưa mở, each in the curriculum order', () => {
    expect(lessonCards(BEFORE).map((c) => [c.id, c.group])).toEqual([['b', 'in_progress'], ['c', 'unlocked'], ['a', 'completed'],
      ['d', 'locked'], ['e', 'locked']]);
    expect(lessonCards(AFTER).map((c) => c.id)).toEqual(['c', 'd', 'a', 'b', 'e']);
  });

  it('keeps chapter then lesson order within a group, never the order the ids or the server list come in', () => {
    const cards = lessonCards(BEFORE).map((c) => ({ ...c, group: 'unlocked' as const }));
    expect(sortLessons([...cards].reverse()).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('tells being open from being done', () => {
    expect(groupOf(true, 'completed')).toBe('completed');
    expect(groupOf(false, 'completed')).toBe('locked'); // never played while locked
    expect(groupOf(true, 'not_started')).toBe('unlocked');
  });

  it('filters, says how a locked lesson opens, and sees what changed', () => {
    const before = lessonCards(BEFORE);
    const after = lessonCards(AFTER);
    expect(filterLessons(before, 'open').map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(filterLessons(before, 'locked').map((c) => c.id)).toEqual(['d', 'e']);
    expect(unlockHint(before.find((c) => c.id === 'd')!)).toBe('Hoàn thành “Cây cần gì để sống” để mở bài này.');
    expect(unlockHint(before.find((c) => c.id === 'e')!)).toBe('Bài học đang được biên soạn.');
    expect(newlyUnlocked(before, after)).toEqual(['d']);
    expect(orderChanged(before, after)).toBe(true);
    expect(orderChanged(after, lessonCards(AFTER))).toBe(false);
  });
});

const PROGRAMME = {
  curriculum: 'Chương trình giáo dục phổ thông 2018', legal_basis: [], notes: [], types: {}, main_grade: 'grade3', resume: null,
  grade: 'grade3', number: 3, label: 'Lớp 3', is_main: true, selection: null, note: null,
  subjects: [{ ...BEFORE.subject }],
};
const LESSON_A = { key: 'a', title: 'Các bộ phận của cây', description: '', status: 'ready', grade: 3, grade_id: 'grade3', grade_label: 'Lớp 3',
  subject: { code: 'science', name: 'Tự nhiên và Xã hội' }, chapter: { key: 'c1', title: 'Thực vật' }, objectives: [], summary: ['Cây có rễ, thân, lá.'],
  examples: [], review: { status: 'checked', label: '' }, source_note: null, content_version: 'v1', completion: { min_first_try: 0.8, games: 'all' },
  progress: { status: 'completed', label: 'Đã hoàn thành', games_passed: 1, games_total: 1, percent: 100 }, locked: false, requires: [],
  requires_note: null, practice_note: null, next: null,
  games: [{ game: 'sorting', title: 'Phân loại bộ phận cây', gameplay: 'Phân loại', style: null, turns: 8, short_stage: false, playable: true, review_count: 0,
    progress: { stages: 1, completed: 1, best: 100, passed: true, open_session: null, last: null } }] };

const order = () => screen.getAllByRole('button', { name: /\. (Thực vật|Động vật|Trái Đất)\./ }).map((b) => (b.props.accessibilityLabel as string).split('.')[0]);

describe('the subject screen', () => {
  it('sorts by state, explains locks, reopens a completed lesson, and moves the cards when a lesson opens', async () => {
    let visits = 0;
    const server = mockServer({
      'GET /api/learning/programme': { status: 200, body: PROGRAMME },
      'GET /api/learning/catalog': { status: 200, body: { subjects: [], default_duration_minutes: 25, study_profile: null, programme: null } },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
      'GET /api/learning/programme/subjects/science': () => ({ status: 200, body: ++visits === 1 ? BEFORE : AFTER }),
      'GET /api/learning/lesson-catalog/a': { status: 200, body: LESSON_A },
    });
    render(<ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, age: 8, school_grade: 'grade3' } as any} defaultDuration={25} focus={null} onFreeStudy={jest.fn()} onRewards={jest.fn()} />
    </ConfirmProvider></ToastProvider>);
    fireEvent.press(await screen.findByRole('button', { name: /^Tự nhiên và Xã hội\./ }));

    // Header: the subject and the learner's grade (no grade picker), the subject's progress, the filter, the list.
    expect(await screen.findByText('Lớp 3 · Năm học 2026–2027')).toBeTruthy();
    expect(screen.getByLabelText('Tiến độ môn: 1 trên 4 bài hoàn thành')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Danh sách' })); // the journey map comes first (unlock-map.test.tsx)
    expect(order()).toEqual(['Cây cần gì để sống', 'Con vật quanh em', 'Các bộ phận của cây', 'Vòng đời con ếch', 'Bầu trời ban ngày']);
    expect(screen.queryByRole('radio', { name: /^Lớp \d/ })).toBeNull();

    // A locked lesson: neutral, and a tap says how it opens (with the lesson to do first), without opening anything.
    fireEvent.press(screen.getByRole('button', { name: /^Vòng đời con ếch\./ }));
    expect(screen.getByText('Hoàn thành “Cây cần gì để sống” để mở bài này.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mở bài Cây cần gì để sống' })).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Chưa mở' }));
    expect(order()).toEqual(['Vòng đời con ếch', 'Bầu trời ban ngày']);
    fireEvent.press(screen.getByRole('tab', { name: 'Tất cả' }));

    // A completed lesson opens again for review.
    fireEvent.press(screen.getByRole('button', { name: /^Các bộ phận của cây\..*Đã hoàn thành/ }));
    expect(await screen.findByText('Cây có rễ, thân, lá.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chơi lại' })).toBeTruthy();

    // Back: the list is there at once (no loading), then moves to the new states: the opened lesson joins Đã mở.
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(order()[0]).toBe('Cây cần gì để sống'); // the last list, shown before the server answers
    const opened = screen.getByRole('button', { name: /^Con vật quanh em\./ });
    await waitFor(() => expect(order()).toEqual(['Con vật quanh em', 'Vòng đời con ếch', 'Các bộ phận của cây', 'Cây cần gì để sống',
      'Bầu trời ban ngày']));
    expect(screen.getByRole('button', { name: /^Con vật quanh em\./ })).toBe(opened); // moved, not drawn again
    expect(screen.getByRole('button', { name: /^Vòng đời con ếch\..*Đã mở/ })).toBeTruthy();
    expect(screen.getByLabelText('Tiến độ môn: 2 trên 4 bài hoàn thành')).toBeTruthy();
    expect(server.callsTo('GET /api/learning/programme/subjects/science')).toHaveLength(2);
    expect(server.calls.some((c) => c.method !== 'GET')).toBe(false); // the app never sends a state
  });
});
