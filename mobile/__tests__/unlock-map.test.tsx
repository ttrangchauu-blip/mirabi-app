import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { currentLesson, focusLesson, journey, lessonCards, nodeStatus, unlockHint, unlockNotice } from '../src/learning/lessonOrder';
import type { ContentStatus, LessonListItem, SubjectLessons, UnlockedContent, UnlockRequirement } from '../src/learning/types';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { ResultScreen } from '../src/screens/learning/ResultScreen';
import { NOTICE_MS, UnlockNotice } from '../src/screens/learning/UnlockNotice';
import { waveOffset } from '../src/screens/learning/JourneyMap';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

// Tự động mở khóa on the app: the journey map, the unlock played once when the backend says something has just opened,
// and the small notice with "Khám phá ngay". The backend decides every state; the app only sends "it was shown".

beforeEach(async () => {
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});

type Spec = { key: string; title: string; status: ContentStatus; percent?: number; planned?: boolean; optional?: boolean;
  celebrate?: boolean; requirements?: UnlockRequirement[] };
const lesson = (s: Spec, chapter: { key: string; title: string }, ci: number, li: number): LessonListItem => {
  const locked = s.status === 'LOCKED';
  const progress = s.status === 'COMPLETED' ? 'completed' : s.status === 'IN_PROGRESS' ? 'in_progress' : 'not_started';
  return { key: s.key, title: s.title, description: '', status: s.planned ? 'planned' : 'ready', games: [], locked: !s.planned && locked, requires_note: null,
    progress: s.planned ? null : { status: progress, label: '', games_passed: 0, games_total: 1, percent: s.percent ?? 0 },
    lesson_id: s.key, chapter_key: chapter.key, chapter_title: chapter.title, chapter_order: ci, lesson_order: li,
    unlock_status: locked ? 'locked' : 'unlocked', progress_status: progress, progress_percent: s.percent ?? 0, content_status: s.status,
    required: !s.optional && !s.planned, celebrate: s.celebrate ?? false, unlock_requirements: s.requirements ?? [],
    unlock_note: locked ? (s.planned ? 'Bài học đang được biên soạn.' : null) : null, group: locked ? 'locked' : progress === 'not_started' ? 'unlocked' : progress };
};
const AREAS = [{ key: 'area1', title: 'Thực vật' }, { key: 'area2', title: 'Động vật' }];
function subject(areas: { status: ContentStatus; celebrate?: boolean; required?: [number, number]; lessons: Spec[] }[], unlocked?: UnlockedContent[]): SubjectLessons {
  const chapters = areas.map((a, ci) => ({ ...AREAS[ci], order: ci + 1, lessons: a.lessons.map((s, li) => lesson(s, AREAS[ci], ci + 1, li + 1)),
    content_status: a.status, celebrate: a.celebrate ?? false, required_completed: a.required?.[0] ?? 0, required_total: a.required?.[1] ?? 0,
    unlock_note: a.status === 'LOCKED' ? `Hoàn thành chương “${AREAS[0].title}” để mở chương này.` : null }));
  return { subject: { code: 'science', name: 'Khoa học', type: 'compulsory', type_label: 'Bắt buộc', note: null, unsupported: null, practice_note: null,
    icon: 'leaf-outline', bg: '#E3F5E6', color: '#22703A', chapters: 2, lessons: 4, ready: 3, completed: 1, in_progress: 0, status: 'partial', selected: null },
  grade: 'grade3', number: 3, label: 'Lớp 3', academic_year: 2026, academic_year_label: '2026–2027', organization: 'topic', source_note: null,
  textbook: null, chapters, unlocked, progress: { completed: 1, ready: 3, total: 4, percent: 33 } };
}
const A_NEED: UnlockRequirement = { type: 'lesson', lesson_id: 'a', title: 'Các bộ phận của cây', done: false };
const AREA_NEED: UnlockRequirement = { type: 'chapter', chapter_key: 'area1', title: 'Thực vật', done: false, remaining: 1 };
const LOCKED_ALL = subject([
  { status: 'IN_PROGRESS', required: [0, 2], lessons: [
    { key: 'a', title: 'Các bộ phận của cây', status: 'IN_PROGRESS', percent: 50 },
    { key: 'o', title: 'Chuyện về cây', status: 'LOCKED', optional: true, requirements: [A_NEED] },
    { key: 'b', title: 'Cây cần gì để sống', status: 'LOCKED', requirements: [A_NEED] },
    { key: 'p', title: 'Bài sắp viết', status: 'LOCKED', planned: true, requirements: [{ type: 'content', note: 'Bài học đang được biên soạn.' }] }] },
  { status: 'LOCKED', lessons: [{ key: 'c', title: 'Con vật quanh em', status: 'LOCKED', requirements: [AREA_NEED] }] },
]);
const unlock = (id: number, type: 'lesson' | 'chapter', key: string, title: string, target: string | null, chapter = 'area1'): UnlockedContent => ({
  id, type, key, title, subject: 'science', subject_name: 'Khoa học', grade: 3, chapter_key: chapter, chapter_title: 'Thực vật', lesson: target,
  source: 'completed', trigger: 'a', unlocked_at: '2026-11-01T08:00:00+00:00' });
const NEWS = [unlock(7, 'lesson', 'b', 'Cây cần gì để sống', 'b')];
const OPENED = subject([
  { status: 'IN_PROGRESS', required: [1, 2], lessons: [
    { key: 'a', title: 'Các bộ phận của cây', status: 'COMPLETED', percent: 100 },
    { key: 'o', title: 'Chuyện về cây', status: 'UNLOCKED', optional: true },
    { key: 'b', title: 'Cây cần gì để sống', status: 'UNLOCKED', celebrate: true, requirements: [{ ...A_NEED, done: true } as UnlockRequirement] },
    { key: 'p', title: 'Bài sắp viết', status: 'LOCKED', planned: true, requirements: [{ type: 'content', note: 'Bài học đang được biên soạn.' }] }] },
  { status: 'LOCKED', lessons: [{ key: 'c', title: 'Con vật quanh em', status: 'LOCKED', requirements: [AREA_NEED] }] },
], NEWS);

const PROGRAMME = { curriculum: 'CT GDPT 2018', legal_basis: '', notes: [], types: {}, main_grade: 'grade3', academic_year: 2026, academic_year_label: '2026–2027', resume: null,
  grade: 'grade3', number: 3, label: 'Lớp 3', is_main: true, selection: null, note: null, subjects: [{ ...LOCKED_ALL.subject, status: 'ready' }] };

function open(routes: Record<string, any>) {
  const server = mockServer({
    'GET /api/learning/programme': { status: 200, body: PROGRAMME },
    'GET /api/learning/catalog': { status: 200, body: { subjects: [], default_duration_minutes: 25, study_profile: null, programme: null } },
    'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
    ...routes,
  });
  render(<ToastProvider><ConfirmProvider>
    <LearningScreen user={{ ...USER, age: 8, school_grade: 'grade3' } as any} defaultDuration={25} focus={null} onFreeStudy={jest.fn()} onRewards={jest.fn()} />
  </ConfirmProvider></ToastProvider>);
  return server;
}
const enterSubject = async () => fireEvent.press(await screen.findByRole('button', { name: /^Khoa học\./ }));

describe('the journey of a subject', () => {
  it('keeps the curriculum order by chapter, whatever the state of each lesson', () => {
    const sections = journey(OPENED);
    expect(sections.map((s) => [s.key, s.status, s.requiredCompleted, s.requiredTotal])).toEqual([['area1', 'IN_PROGRESS', 1, 2], ['area2', 'LOCKED', 0, 0]]);
    expect(sections[0].nodes.map((n) => [n.id, nodeStatus(n)])).toEqual([['a', 'COMPLETED'], ['o', 'UNLOCKED'], ['b', 'UNLOCKED'], ['p', 'LOCKED']]);
    expect(sections[0].nodes[1].required).toBe(false);
    expect(sections[0].nodes[2].celebrate).toBe(true);
  });

  it('reads a chapter from its lessons when an older server does not say', () => {
    const older = { ...OPENED, chapters: OPENED.chapters.map(({ content_status, required_total, required_completed, celebrate, unlock_note, ...c }) => c) };
    expect(journey(older as SubjectLessons).map((s) => s.status)).toEqual(['IN_PROGRESS', 'LOCKED']);
  });

  it('puts the pet where the learner is: what is being studied, else the first open lesson that takes them forward', () => {
    expect(currentLesson(journey(LOCKED_ALL))).toBe('a');
    expect(currentLesson(journey(OPENED))).toBe('b'); // not the optional "Chuyện về cây" before it
    expect(currentLesson([])).toBeNull();
    const onlyOptional = journey(subject([{ status: 'UNLOCKED', lessons: [{ key: 'o', title: 'Chuyện về cây', status: 'UNLOCKED', optional: true }] }]));
    expect(currentLesson(onlyOptional)).toBe('o');
  });

  it('brings into view what has just opened, else where the learner is', () => {
    expect(focusLesson(journey(OPENED), ['o'])).toBe('o');
    expect(focusLesson(journey(OPENED), [])).toBe('b');
    expect(focusLesson(journey(OPENED), ['area1'])).toBe('b'); // an area alone: where the learner is
  });

  it('says what opens a lesson of a locked area', () => {
    const card = lessonCards(LOCKED_ALL).find((c) => c.id === 'c')!;
    expect(unlockHint(card)).toBe('Hoàn thành chương “Thực vật” để mở bài này.');
  });

  it('winds on across the chapters', () => {
    expect([0, 1, 2, 3, 4].map(waveOffset)).toEqual([0, 62, 0, -62, 0]);
  });
});

describe('the small notice', () => {
  it('names a new area first and leads to its lesson, otherwise the lesson', () => {
    expect(unlockNotice([])).toBeNull();
    expect(unlockNotice(NEWS)).toEqual({ title: 'Cây cần gì để sống', more: 0, lesson: 'b' });
    const both = [unlock(9, 'lesson', 'c', 'Con vật quanh em', 'c', 'area2'), unlock(8, 'chapter', 'area2', 'Động vật', 'c', 'area2'),
      unlock(7, 'lesson', 'b', 'Cây cần gì để sống', 'b')];
    expect(unlockNotice(both)).toEqual({ title: 'Khu vực mới: Động vật', more: 1, lesson: 'c' });
  });

  it('says once it was shown, leaves on its own and never covers the screen', () => {
    jest.useFakeTimers();
    const seen = jest.fn();
    const close = jest.fn();
    const explore = jest.fn();
    render(<UnlockNotice news={NEWS} petId="fox" petLevel={1} reduceMotion onSeen={seen} onExplore={explore} onClose={close} />);
    expect(seen).toHaveBeenCalledWith([7]);
    expect(screen.getByText('Vừa mở khóa')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Khám phá ngay: Cây cần gì để sống' }));
    expect(explore).toHaveBeenCalledWith('b');
    expect(close).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(NOTICE_MS); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('the result of a stage', () => {
  const result = (next: { key: string; title: string; ready: boolean; locked?: boolean }) => ({ counts: { first_try: 10 }, items: [], open_review_count: 0,
    session: { id: 5, status: 'completed', kind: 'lesson', mode: 'practice', game: 'defense', required_count: 10, max_combo: 0, reward: null, end_reason: 'completed',
      lesson: { id: 1, code: 'x', name: 'Bài' }, topic: { id: 1, code: 't', name: 'Chủ đề' }, subject: { id: 1, code: 'math', name: 'Toán' },
      catalog: { lesson: 'a', title: 'Bài A', grade: 3, game: 'defense', game_title: 'Trò', short_stage: false, subject_name: 'Toán', other_games: [], next, world: null } } });
  const show = async (next: { key: string; title: string; ready: boolean; locked?: boolean }) => {
    mockServer({ 'GET /api/learning/sessions/5/result': { status: 200, body: result(next) } });
    render(<ResultScreen sessionId={5} petId="fox" petLevel={1} onReplay={jest.fn()} onReview={jest.fn()} onHome={jest.fn()} onLesson={jest.fn()} onRewards={jest.fn()} reduceMotion />);
    await screen.findByText('Đúng ngay 10/10 câu');
  };

  it('leads to the next lesson once it is open', async () => {
    await show({ key: 'b', title: 'Bài B', ready: true, locked: false });
    expect(screen.getByRole('button', { name: /Bài tiếp theo: Bài B/ })).toBeTruthy();
  });

  it('does not lead to a lesson that is still locked', async () => {
    await show({ key: 'b', title: 'Bài B', ready: true, locked: true });
    expect(screen.queryByRole('button', { name: /Bài tiếp theo/ })).toBeNull();
  });
});

describe('the map on the subject screen', () => {
  it('shows every state, explains a lock on a tap, and sends nothing while nothing has opened', async () => {
    const server = open({ 'GET /api/learning/programme/subjects/science': { status: 200, body: LOCKED_ALL } });
    await enterSubject();
    expect(await screen.findByRole('tab', { name: 'Bản đồ' })).toBeTruthy();
    expect(screen.getByRole('header', { name: /^Thực vật\. Đang khám phá, 0 trên 2 bài bắt buộc/ })).toBeTruthy();
    expect(screen.getByRole('header', { name: /^Động vật\. Chưa mở/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Các bộ phận của cây\. Thực vật\. Đang học, 50%/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Bài sắp viết\. Thực vật\. Sắp có/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Con vật quanh em\. Động vật\. Chưa mở/ })).toBeTruthy();
    expect(screen.getByTestId('map-pet', { includeHiddenElements: true })).toBeTruthy(); // by the lesson being studied
    expect(screen.queryByTestId('map-unlocking')).toBeNull();
    expect(screen.queryByTestId('unlock-notice')).toBeNull();

    // A locked lesson says how it opens, with the lesson to do first, without opening anything.
    fireEvent.press(screen.getByRole('button', { name: /^Cây cần gì để sống\./ }));
    expect(screen.getByText('Hoàn thành “Các bộ phận của cây” để mở bài này.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mở bài Các bộ phận của cây' })).toBeTruthy();
    expect(server.calls.some((c) => c.method !== 'GET')).toBe(false); // the app never sends a state or opens anything
  });

  it('with reduced motion, nothing moves but the notice still says what opened', async () => {
    const server = open({ 'GET /api/learning/programme/subjects/science': { status: 200, body: OPENED } });
    await enterSubject();
    expect(await screen.findByTestId('unlock-notice')).toBeTruthy();
    expect(screen.queryByTestId('map-unlocking')).toBeNull();
    expect(screen.getByRole('button', { name: /^Cây cần gì để sống\. Thực vật\. Đã mở/ })).toBeTruthy();
    await waitFor(() => expect(server.callsTo('POST /api/learning/unlocks/celebrated')).toHaveLength(1));
  });

  it('plays the unlock only for what has just opened, then tells the backend it was shown', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const server = open({ 'GET /api/learning/programme/subjects/science': { status: 200, body: OPENED } });
    await enterSubject();
    expect(await screen.findByTestId('unlock-notice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Khám phá ngay: Cây cần gì để sống' })).toBeTruthy();
    expect(screen.getAllByTestId('map-unlocking')).toHaveLength(1);
    await waitFor(() => expect(server.callsTo('POST /api/learning/unlocks/celebrated')).toHaveLength(1));
    expect(server.callsTo('POST /api/learning/unlocks/celebrated')[0].body).toEqual({ ids: [7] });
    // Nothing is blocked meanwhile: a lesson can be opened while it plays.
    expect(screen.getByRole('button', { name: /^Cây cần gì để sống\. Thực vật\. Đã mở/ })).toBeTruthy();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  });

  it('goes to what has just opened with "Khám phá ngay"', async () => {
    open({ 'GET /api/learning/programme/subjects/science': { status: 200, body: OPENED },
      'GET /api/learning/lesson-catalog/b': { status: 200, body: { key: 'b', title: 'Cây cần gì để sống', description: '', status: 'ready', grade: 3, grade_id: 'grade3', grade_label: 'Lớp 3',
        subject: { code: 'science', name: 'Khoa học' }, chapter: { key: 'area1', title: 'Thực vật' }, objectives: [], summary: ['Cây cần nước.'], examples: [],
        review: { status: 'checked', label: '' }, source_note: null, content_version: 'v1', completion: { min_first_try: 0.8, games: 'all' }, progress: null, locked: false, requires: [],
        requires_note: null, practice_note: null, next: null, games: [] } } });
    await enterSubject();
    fireEvent.press(await screen.findByRole('button', { name: 'Khám phá ngay: Cây cần gì để sống' }));
    expect(await screen.findByText('Cây cần nước.')).toBeTruthy();
    expect(screen.queryByTestId('unlock-notice')).toBeNull();
  });

  it('switches between the map and the list of the same lessons', async () => {
    open({ 'GET /api/learning/programme/subjects/science': { status: 200, body: LOCKED_ALL } });
    await enterSubject();
    fireEvent.press(await screen.findByRole('tab', { name: 'Danh sách' }));
    expect(screen.getByRole('tab', { name: 'Chưa mở' })).toBeTruthy();
    expect(screen.queryByTestId('map-pet', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByRole('button', { name: /^Cây cần gì để sống\./ })).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Bản đồ' }));
    expect(screen.queryByRole('tab', { name: 'Chưa mở' })).toBeNull();
    expect(screen.getByTestId('map-pet', { includeHiddenElements: true })).toBeTruthy();
  });
});
