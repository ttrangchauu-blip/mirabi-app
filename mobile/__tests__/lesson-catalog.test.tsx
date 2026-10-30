import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import type { Turn } from '../src/learning/types';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { fold } from '../src/screens/learning/LessonScreens';
import { ChoiceExplain, MatchPairs, OrderSteps } from '../src/screens/learning/games/LessonGames';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

// Học tập theo bài: Học tập → Chọn môn → Chọn bài → màn bài học → Cách chơi → chơi, and the lesson games' boards.

beforeEach(async () => {
  await AsyncStorage.clear();
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
});

const subject = (code: string, name: string, extra = {}) => ({ code, name, type: 'compulsory', type_label: 'Bắt buộc', note: null,
  unsupported: null, practice_note: null, icon: 'calculator-outline', bg: '#FFF1D6', color: '#B86A00', chapters: 1, lessons: 3, ready: 2,
  completed: 0, in_progress: 0, status: 'partial', selected: null, ...extra });
const PROGRAMME = {
  curriculum: 'Chương trình giáo dục phổ thông 2018', legal_basis: ['Thông tư 32/2018/TT-BGDĐT (26/12/2018)'], notes: [], types: {},
  main_grade: 'grade2', grades: [], resume: null, grade: 'grade2', number: 2, label: 'Lớp 2', is_main: true, selection: null, note: null,
  subjects: [subject('math', 'Toán'),
    subject('local', 'Nội dung giáo dục của địa phương', { status: 'unsupported', unsupported: 'Nội dung do từng tỉnh biên soạn.', ready: 0, lessons: 0 }),
    subject('english', 'Tiếng Anh', { type: 'optional', type_label: 'Môn tự chọn' })],
};
const LESSONS = { subject: PROGRAMME.subjects[0], grade: 'grade2', number: 2, label: 'Lớp 2', organization: 'topic',
  source_note: 'Theo chủ đề của CT GDPT 2018, không theo mục lục bộ sách nào.', textbook: null,
  chapters: [{ key: 'toan2.nhan_chia', title: 'Phép nhân và phép chia', lessons: [
    { key: 'toan2.bang_nhan_2', title: 'Bảng nhân 2', description: 'Thuộc bảng nhân 2.', status: 'ready',
      progress: { status: 'in_progress', label: 'Đang luyện', games_passed: 1, games_total: 2, percent: 50 },
      games: [{ game: 'defense', title: 'Đường đua phép tính' }, { game: 'match', title: 'Ghép phép tính với kết quả' }], locked: false, requires_note: null },
    { key: 'toan2.bang_chia_2', title: 'Bảng chia 2', description: 'Chia cho 2.', status: 'ready', progress: null, games: [], locked: true,
      requires_note: 'Học bảng nhân 2 trước.' },
    { key: 'toan2.bang_nhan_5', title: 'Bảng nhân 5', description: 'Thuộc bảng nhân 5.', status: 'planned', progress: null, games: [], locked: false, requires_note: null },
  ] }] };
const progress = { stages: 0, completed: 0, best: null, passed: false, open_session: null, last: null };
const LESSON = { key: 'toan2.bang_nhan_2', title: 'Bảng nhân 2', description: 'Thuộc bảng nhân 2.', status: 'ready', grade: 2, grade_id: 'grade2',
  grade_label: 'Lớp 2', subject: { code: 'math', name: 'Toán' }, chapter: { key: 'toan2.nhan_chia', title: 'Phép nhân và phép chia' },
  objectives: ['Thuộc bảng nhân 2'], summary: ['2 × 3 nghĩa là 2 được lấy 3 lần.'], examples: [{ title: 'Đếm thêm 2', lines: ['2, 4, 6, 8'] }],
  review: { status: 'checked', label: 'Mirabi biên soạn và đã soát' }, source_note: 'Theo chủ đề.', content_version: 'abc123',
  completion: { min_first_try: 0.8, games: 'all' }, progress: { status: 'not_started', label: 'Chưa học', games_passed: 0, games_total: 2, percent: 0 },
  locked: false, requires: [], requires_note: null, practice_note: null, next: { key: 'toan2.bang_chia_2', title: 'Bảng chia 2', ready: true },
  games: [{ game: 'match', title: 'Ghép phép tính với kết quả', gameplay: 'Ghép cặp', style: null, turns: 3, short_stage: false, playable: true,
    review_count: 0, progress }] };

function renderLearning() {
  render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, age: 8, school_grade: 'grade2' } as any} defaultDuration={25} focus={null} onFreeStudy={jest.fn()} onRewards={jest.fn()} />
    </ConfirmProvider></ToastProvider>,
  );
}

describe('Học tập theo bài', () => {
  it('lists every subject of the grade, opens its lessons by chapter, then a lesson and plays its game', async () => {
    const server = mockServer({
      'GET /api/learning/programme': { status: 200, body: PROGRAMME },
      'GET /api/learning/catalog': { status: 200, body: { subjects: [], default_duration_minutes: 25, study_profile: null, programme: null } },
      'GET /api/learning/programme/subjects/math': { status: 200, body: LESSONS },
      'GET /api/learning/lesson-catalog/toan2.bang_nhan_2': { status: 200, body: LESSON },
      'POST /api/learning/lesson-catalog/toan2.bang_nhan_2/play': { status: 409, body: { detail: 'Not published', code: 'lesson_not_published' } },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
    });
    renderLearning();
    // A subject that depends on the region says why, and cannot be opened.
    expect(await screen.findByText('Nội dung do từng tỉnh biên soạn.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Nội dung giáo dục của địa phương\./ }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getAllByText('Môn tự chọn').length).toBe(2); // the section and the subject's type
    fireEvent.press(screen.getByRole('button', { name: /^Toán\. Bắt buộc/ }));

    expect(await screen.findByText('1. Phép nhân và phép chia')).toBeTruthy();
    expect(screen.getByText('🔒 Học bảng nhân 2 trước.')).toBeTruthy();
    // A planned lesson is listed, never playable.
    expect(screen.getByRole('button', { name: /^Bảng nhân 5\..*Đang biên soạn/ }).props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Tìm bài học'), 'chia');
    expect(screen.getByText('1 bài phù hợp')).toBeTruthy();
    expect(screen.queryByText('Bảng nhân 2')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Tìm bài học'), '');
    fireEvent.press(screen.getByRole('button', { name: /^Bảng nhân 2\./ }));

    expect(await screen.findByText('Bạn sẽ học gì?')).toBeTruthy();
    expect(screen.getByText('• Thuộc bảng nhân 2')).toBeTruthy();
    expect(screen.getByText('2 × 3 nghĩa là 2 được lấy 3 lần.')).toBeTruthy();
    expect(screen.queryByText('2, 4, 6, 8')).toBeNull(); // examples are folded
    fireEvent.press(screen.getByRole('button', { name: /Ví dụ/ }));
    expect(screen.getByText('2, 4, 6, 8')).toBeTruthy();
    expect(screen.getByText('Ghép cặp · 3 câu mỗi chặng')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
    // The first time, the game's guide comes first; nothing is created before "Bắt đầu".
    expect(await screen.findByText('Ghép các thẻ thành từng cặp.')).toBeTruthy();
    expect(server.callsTo('POST /api/learning/lesson-catalog/toan2.bang_nhan_2/play')).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
    fireEvent.press(screen.getByRole('button', { name: 'Tiếp' }));
    fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
    await waitFor(() => expect(server.callsTo('POST /api/learning/lesson-catalog/toan2.bang_nhan_2/play')).toHaveLength(1));
    expect(server.callsTo('POST /api/learning/lesson-catalog/toan2.bang_nhan_2/play')[0].body.game).toBe('match');
    // It could not start: back on the lesson, which says why.
    expect(await screen.findByText('Trò chơi này của bài đang được cập nhật. Bạn thử lại sau nhé.')).toBeTruthy();
    expect(await screen.findByText('Bạn sẽ học gì?')).toBeTruthy();
  });

  it('searches without accents', () => {
    expect(fold('Phân biệt s/x')).toBe('phan biet s/x');
    expect(fold('Đồng bằng')).toContain('dong');
  });
});

const turn = (kind: Turn['kind'], prompt: Turn['prompt']): Turn => ({ turn_id: 't1', position: 0, kind, skill_label: '', prompt, hints_shown: [],
  hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 });

describe('the lesson games', () => {
  it('Sắp xếp: cards fill the places in order; after a wrong answer the right ones stay locked', () => {
    const onSubmit = jest.fn();
    const t = turn('order_steps', { prompt: 'Vòng đời cây đậu', cards: [{ id: 'c1', text: 'Cây con' }, { id: 'c2', text: 'Hạt đậu' }, { id: 'c3', text: 'Ra hoa' }] });
    const view = render(<OrderSteps turn={t} disabled={false} onSubmit={onSubmit} />);
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ Cây con' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ Hạt đậu' }));
    expect(screen.getByRole('button', { name: 'Kiểm tra' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ Ra hoa' }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(onSubmit).toHaveBeenLastCalledWith(['c1', 'c2', 'c3']);
    view.rerender(<OrderSteps turn={t} disabled={false} onSubmit={onSubmit} kept={['c3']} feedback={{ text: 'Có 1/3 thẻ đúng vị trí.', tone: 'bad' }} />);
    expect(screen.getByRole('button', { name: 'Ra hoa, đúng vị trí' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thẻ Hạt đậu' })).toBeTruthy(); // back in the pool
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ Hạt đậu' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ Cây con' }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(onSubmit).toHaveBeenLastCalledWith(['c2', 'c1', 'c3']);
  });

  it('Ghép cặp: a left card then a right one makes a pair; the right pairs stay after a wrong answer', () => {
    const onSubmit = jest.fn();
    const t = turn('match_pairs', { prompt: 'Ghép phép tính', lefts: [{ id: 'a1', text: '2 × 3' }, { id: 'a2', text: '2 × 5' }],
      rights: [{ id: 'b1', text: '10' }, { id: 'b2', text: '6' }] });
    const view = render(<MatchPairs turn={t} disabled={false} onSubmit={onSubmit} />);
    fireEvent.press(screen.getByRole('button', { name: '2 × 3' }));
    fireEvent.press(screen.getByRole('button', { name: '10' }));
    fireEvent.press(screen.getByRole('button', { name: '2 × 5' }));
    fireEvent.press(screen.getByRole('button', { name: '6' }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(onSubmit).toHaveBeenLastCalledWith(['a1b1', 'a2b2']);
    view.rerender(<MatchPairs turn={t} disabled={false} onSubmit={onSubmit} kept={[]} feedback={{ text: 'Đúng 0/2 cặp.', tone: 'bad' }} />);
    expect(screen.getByRole('button', { name: 'Kiểm tra' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: '2 × 3' }));
    fireEvent.press(screen.getByRole('button', { name: '6' }));
    fireEvent.press(screen.getByRole('button', { name: '2 × 5' }));
    fireEvent.press(screen.getByRole('button', { name: '10' }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(onSubmit).toHaveBeenLastCalledWith(['a1b2', 'a2b1']);
  });

  it('Chọn đáp án: a wrong option is crossed out with its reason; the passage folds', () => {
    const onChoose = jest.fn();
    const t = turn('choice_explain', { style: 'reading', passage: 'Mai thích đọc sách.', question: 'Mai thích gì?',
      options: [{ id: 'o1', text: 'Đọc sách' }, { id: 'o2', text: 'Đá bóng' }] });
    const view = render(<ChoiceExplain turn={t} disabled={false} onChoose={onChoose} />);
    expect(screen.getByText('Mai thích đọc sách.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đá bóng' }));
    expect(onChoose).toHaveBeenLastCalledWith('o2');
    view.rerender(<ChoiceExplain turn={t} disabled={false} onChoose={onChoose} feedback={{ text: 'Đoạn văn nói Mai thích đọc sách.', tone: 'bad' }} />);
    expect(screen.getByText('Đoạn văn nói Mai thích đọc sách.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đá bóng, chưa đúng' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Thu gọn đoạn văn' }));
    expect(screen.queryByText('Mai thích đọc sách.')).toBeNull();
  });
});
