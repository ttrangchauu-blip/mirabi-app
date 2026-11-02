import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, networkDown, USER } from '../test/mockServer';

// The locked grade, the school year header, Kho lưu trữ học tập and the one-time "lên lớp" celebration
// (backend education.py).

beforeEach(async () => {
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});

const PROGRAMME = { curriculum: 'Chương trình giáo dục phổ thông 2018', grade: 'grade2', level: null, outside_school: false, label: 'Lớp 2',
  note: null, levels: [], subjects: [{ code: 'math', name: 'Toán', games: [{ id: 'defense', grades: 'Lớp 1–12' }] }] };
const CATALOG = { default_duration_minutes: 25, study_profile: null, subjects: [], programme: PROGRAMME };
const STATE = {
  enrolled: true, locked: true, grade: 'grade2', grade_label: 'Lớp 2', initial_grade: 'grade1', academic_year: 2027,
  academic_year_label: '2027–2028', status: 'studying', progress: { lessons_ready: 10, lessons_completed: 3, lessons_in_progress: 1, percent: 30 },
  promotion_pending: false, archives: 1, celebration: null,
  next_promotion: { academic_year: 2028, academic_year_label: '2028–2029', date: '2028-08-28', to_grade: 'grade3', to_grade_label: 'Lớp 3', completes: false },
};
const CELEBRATION = { id: 41, kind: 'promotion', grade: 'grade2', grade_label: 'Lớp 2', from_grade: 'grade1', academic_year: 2027,
  academic_year_label: '2027–2028', message: 'Chúc mừng! Bạn đã lên lớp 2!' };
const ARCHIVE = { academic_year: 2026, academic_year_label: '2026–2027', grade: 'grade1', grade_label: 'Lớp 1', subjects: 9,
  lessons_completed: 4, lessons_ready: 8, percent: 50, had_activity: true, archived_at: '2027-08-30T00:00:00Z' };
const YEAR = { ...ARCHIVE, snapshot_version: 1, read_only: true,
  stats: { sessions: 6, stages_completed: 5, active_minutes: 40, score: 900, exp: 50, days_active: 4, answers: 60, first_try: 51, accuracy: 85,
    lessons_total: 12, lessons_ready: 8, lessons_completed: 4, percent: 50 },
  subjects: [{ code: 'math', name: 'Toán', type: 'compulsory', icon: 'calculator-outline', bg: '#FFF1D6', color: '#B86A00', lessons: 2, ready: 2,
    completed: 1, started: 1, chapters: [{ key: 'toan1.so', title: 'Các số đến 10', lessons: [
      { key: 'toan1.dem', title: 'Đếm đến 10', status: 'ready', content_version: 'v1',
        progress: { status: 'completed', label: 'Đã hoàn thành', percent: 100 } }] }] }],
  free_practice: [], lesson_results: [{ lesson: 'toan1.dem', game: 'match', subject: 'math', stages: 2, completed: 2, best: 90, passed: true, content_version: 'v1' }],
  knowledge: [{ key: 'toan1.dem', title: 'Đếm đến 10', subject: 'math', subject_name: 'Toán', chapter: 'Các số đến 10' }],
  vocabulary: [{ key: 'en.word.cat', word: 'cat', meaning_vi: 'con mèo', phonetic: null, outcome: 'first_try' }],
  mistakes: [{ key: 'q1', label: '3 + 4', answer: '7', reason: 'wrong', subject: 'math', lesson: 'toan1.dem' }],
  reviews: { stages: 0, completed: 0, best_score: null, open_session: null, last: null } };
const LESSON = { key: 'toan1.dem', title: 'Đếm đến 10', description: null, grade: 1, subject: 'math', subject_name: 'Toán', chapter: 'Các số đến 10',
  objectives: ['Đếm các số đến 10'], summary: ['Đếm lần lượt 1, 2, 3…'], examples: [], content_version: 'v1', academic_year: 2026,
  academic_year_label: '2026–2027', grade_label: 'Lớp 1', frozen: true, current_content_version: 'v1', read_only: true,
  results: [{ game: 'match', stages: 2, completed: 2, best: 90, passed: true }],
  games: [{ game: 'match', title: 'Ghép số với hình', gameplay: 'Ghép cặp', playable: true,
    review: { stages: 0, completed: 0, best_score: null, open_session: null, last: null } }] };

function renderLearning(user: object = {}) {
  render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, age: 7, school_grade: 'grade2', ...user } as any} defaultDuration={25} focus={null}
        onFreeStudy={jest.fn()} onRewards={jest.fn()} />
    </ConfirmProvider></ToastProvider>,
  );
}

const base = (state: object = STATE) => ({
  'GET /api/learning/catalog': { status: 200, body: CATALOG },
  'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
  'GET /api/learning/tutorials': { status: 200, body: { seen: ['match'] } },
  'GET /api/education': { status: 200, body: state },
});

describe('Học tập follows the locked grade and school year', () => {
  it('shows the grade and the school year, with no way to change the grade; the year progress is in Kho lưu trữ', async () => {
    mockServer({ ...base(), 'GET /api/education/archives': { status: 200, body: { visible_years: 3, items: [] } } });
    renderLearning();
    expect(await screen.findByText('Lớp 2 — Năm học 2027–2028')).toBeTruthy();
    expect(screen.getByLabelText('Lớp học cố định theo đăng ký')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sổ tay kiến thức Lớp 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chọn lớp khác để ôn hoặc học trước' })).toBeNull();
    expect(screen.queryByText(/bài hoàn thành/)).toBeNull(); // the main screen stays short
    fireEvent.press(screen.getByRole('button', { name: 'Kho lưu trữ học tập' }));
    expect(await screen.findByText('3/10 bài hoàn thành · 30% năm học')).toBeTruthy();
    expect(screen.getByText('Tự động lên lớp 3 vào ngày 28/08/2028 (năm học 2028–2029).')).toBeTruthy();
    expect(await screen.findByText(/Chưa có năm học nào kết thúc/)).toBeTruthy();
  });

  it('opens Kho lưu trữ: a card per finished year, then the year, then a lesson to review apart', async () => {
    const server = mockServer({
      ...base(),
      'GET /api/education/archives': { status: 200, body: { visible_years: 3, items: [ARCHIVE] } },
      'GET /api/education/archives/2026': { status: 200, body: YEAR },
      'GET /api/education/archives/2026/lessons/toan1.dem': { status: 200, body: LESSON },
      'POST /api/education/archives/2026/lessons/toan1.dem/play': { status: 409, body: { detail: 'x', code: 'lesson_not_published' } },
    });
    renderLearning();
    fireEvent.press(await screen.findByRole('button', { name: 'Kho lưu trữ học tập' }));
    const year = await screen.findByRole('button', { name: 'Lớp 1, năm học 2026–2027. 9 môn, 4 bài hoàn thành, tiến độ 50%' });
    expect(screen.queryByText(/Đổi sang lớp này/)).toBeNull(); // read and review only
    fireEvent.press(year);
    expect(await screen.findByText('Năm học 2026–2027 · Chỉ xem và ôn tập')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Từ vựng (1)' }));
    expect(screen.getByText('con mèo')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Câu sai (1)' }));
    expect(screen.getByText('Đáp án: 7')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Môn học' }));
    fireEvent.press(screen.getByRole('button', { name: /^Toán\./ }));
    fireEvent.press(screen.getByRole('button', { name: /^Đếm đến 10\./ }));
    expect(await screen.findByText('Bài của năm học cũ · chỉ xem và ôn tập')).toBeTruthy();
    expect(screen.getByText('Đếm lần lượt 1, 2, 3…')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Ôn tập' }));
    await waitFor(() => expect(server.callsTo('POST /api/education/archives/2026/lessons/toan1.dem/play')).toHaveLength(1));
    expect(server.callsTo('POST /api/education/archives/2026/lessons/toan1.dem/play')[0].body).toMatchObject({ game: 'match' });
    expect(server.calls.some((c) => c.method === 'PUT')).toBe(false); // nothing changes the grade
  });

  it('celebrates a promotion once, then records it as seen', async () => {
    let state: object = { ...STATE, celebration: CELEBRATION };
    const server = mockServer({
      ...base(),
      'GET /api/education': () => ({ status: 200, body: state }),
      'POST /api/education/celebrations/41/seen': () => { state = STATE; return { status: 200, body: { seen: true } }; },
    });
    renderLearning();
    expect(await screen.findByText('Chúc mừng! Bạn đã lên lớp 2!')).toBeTruthy();
    expect(screen.getByText('Lớp 2 · Năm học 2027–2028')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Khám phá lớp học mới' }));
    await waitFor(() => expect(server.callsTo('POST /api/education/celebrations/41/seen')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Chúc mừng! Bạn đã lên lớp 2!')).toBeNull());
    expect(await screen.findByText('Lớp 2 — Năm học 2027–2028')).toBeTruthy();
  });

  it('offline: shows the last school year known on this device, and the backend\'s as soon as it answers', async () => {
    await AsyncStorage.setItem(`mirabi.education:${USER.id}`, JSON.stringify({ ...STATE, grade_label: 'Lớp 1', academic_year_label: '2026–2027' }));
    mockServer({ ...base(), 'GET /api/education': networkDown() });
    renderLearning();
    expect(await screen.findByText('Lớp 1 — Năm học 2026–2027')).toBeTruthy();
  });

  it('back online after a new school year: the backend\'s new grade replaces the copy on the device', async () => {
    await AsyncStorage.setItem(`mirabi.education:${USER.id}`, JSON.stringify({ ...STATE, grade_label: 'Lớp 1', academic_year_label: '2026–2027' }));
    mockServer(base());
    renderLearning();
    expect(await screen.findByText('Lớp 2 — Năm học 2027–2028')).toBeTruthy();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(`mirabi.education:${USER.id}`))!).grade_label).toBe('Lớp 2'));
  });
});

describe('Sổ tay kiến thức: tóm tắt and ghi chú của tôi', () => {
  const LESSONS_PROGRAMME = { curriculum: 'Chương trình giáo dục phổ thông 2018', legal_basis: [], notes: [], types: {}, main_grade: 'grade2',
    resume: null, grade: 'grade2', number: 2, label: 'Lớp 2', is_main: true, selection: null, note: null, academic_year: 2027,
    academic_year_label: '2027–2028', subjects: [{ code: 'math', name: 'Toán', type: 'compulsory', type_label: 'Bắt buộc', note: null,
      unsupported: null, practice_note: null, icon: 'calculator-outline', bg: '#FFF1D6', color: '#B86A00', chapters: 1, lessons: 1, ready: 1,
      completed: 0, in_progress: 0, status: 'ready', selected: null }] };
  const NOTEBOOK = { academic_year: 2027, academic_year_label: '2027–2028', grade_label: 'Lớp 2', entries: [{ key: 'toan2.bang_nhan_2',
    title: 'Bảng nhân 2', description: null, grade: 2, subject: 'math', subject_name: 'Toán', chapter: 'Phép nhân', objectives: ['Thuộc bảng nhân 2'],
    summary: ['2 × 3 = 6'], examples: [], content_version: 'v1' }] };
  const NOTE = { id: 9, academic_year: 2027, academic_year_label: '2027–2028', grade: 'grade2', grade_label: 'Lớp 2', subject: 'math',
    subject_name: 'Toán', lesson_key: 'toan2.bang_nhan_2', lesson_title: 'Bảng nhân 2', title: 'Nhớ nè', body: 'Đếm thêm 2',
    created_at: '2027-09-10T03:00:00+00:00', updated_at: '2027-09-10T03:00:00+00:00' };

  it('the header opens the notebook: the summary of the lessons studied, then the learner\'s own notes', async () => {
    mockServer({ ...base(), 'GET /api/learning/programme': { status: 200, body: LESSONS_PROGRAMME },
      'GET /api/education/notebook': { status: 200, body: NOTEBOOK },
      'GET /api/education/notes?academic_year=2027': { status: 200, body: { items: [NOTE], total: 1 } } });
    renderLearning();
    fireEvent.press(await screen.findByRole('button', { name: 'Sổ tay kiến thức Lớp 2' }));
    expect(await screen.findByText('Bảng nhân 2')).toBeTruthy(); // Tóm tắt
    fireEvent.press(screen.getByRole('tab', { name: 'Ghi chú của tôi' }));
    expect(await screen.findByText('Đếm thêm 2')).toBeTruthy();
    expect(screen.getByText('Toán · Bảng nhân 2 · Lớp 2 · 2027–2028')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Thêm ghi chú' }));
    expect(screen.getByRole('radio', { name: 'Toán' }).props.accessibilityState.checked).toBe(true); // the grade's only subject
  });

  it('a finished year shows its notes (they are kept when moving up)', async () => {
    mockServer({ ...base(), 'GET /api/education/archives/2026': { status: 200, body: { ...YEAR, notes: [{ ...NOTE, academic_year: 2026,
      academic_year_label: '2026–2027', grade_label: 'Lớp 1', body: 'Ghi chú lớp 1' }] } },
      'GET /api/education/archives': { status: 200, body: { visible_years: 3, items: [ARCHIVE] } } });
    renderLearning();
    fireEvent.press(await screen.findByRole('button', { name: 'Kho lưu trữ học tập' }));
    fireEvent.press(await screen.findByRole('button', { name: /Lớp 1, năm học 2026–2027/ }));
    fireEvent.press(await screen.findByRole('tab', { name: 'Ghi chú (1)' }));
    expect(screen.getByText('Ghi chú lớp 1')).toBeTruthy();
  });
});
