import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { LearningScreen } from '../src/screens/learning/LearningScreen';
import { StudyProfileScreen } from '../src/screens/main/StudyProfileScreen';
import { AGE_MAX, AGE_MIN, GRADES, gradeChoices, gradeFitsAge, suggestGrade, validateAge, validateGrade } from '../src/studyProfile';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

const ref = (id: number, code: string, name: string) => ({ id, code, name });
const PROGRAMME3 = { curriculum: 'Chương trình giáo dục phổ thông 2018', grade: 'grade3', level: null, outside_school: false, label: 'Lớp 3',
  note: null, levels: [], subjects: [
    { code: 'vietnamese', name: 'Tiếng Việt', games: [{ id: 'spelling_detective', grades: 'Lớp 2–5' }] },
    { code: 'math', name: 'Toán', games: [{ id: 'defense', grades: 'Lớp 1–12 · người học tự do' }] },
    { code: 'science', name: 'Tự nhiên và Xã hội', games: [{ id: 'sorting', grades: 'Lớp 1–5' }] }] };
const catalog = (studyProfile: { grade?: string } | null = null) => ({
  default_duration_minutes: 25, study_profile: studyProfile, programme: studyProfile ? PROGRAMME3 : null,
  subjects: [
    { ...ref(1, 'english', 'Tiếng Anh'), levels: [], topics: [], lessons: [] },
    { ...ref(2, 'math', 'Toán'),
      levels: [{ ...ref(2, 'grade2', 'Lớp 2'), description: null }, { ...ref(3, 'grade3', 'Lớp 3'), description: null }],
      topics: [{ ...ref(4, 'arithmetic', 'Cộng, trừ, nhân, chia'), skill_type: 'arithmetic', description: null, review_count: 0 },
        { ...ref(5, 'compare', 'So sánh số'), skill_type: 'compare', description: null, review_count: 0 }],
      lessons: [
        { id: 8, code: 'math.arithmetic.grade2', title: '', topic_id: 4, level_id: 2, game_type: 'defense', turns: 12, variants: [], version: 1 },
        { id: 9, code: 'math.arithmetic.grade3', title: '', topic_id: 4, level_id: 3, game_type: 'defense', turns: 12, variants: [], version: 1 },
        { id: 10, code: 'math.compare.grade3', title: '', topic_id: 5, level_id: 3, game_type: 'defense', turns: 12, variants: [], version: 1 }] },
  ],
});
const GRADE3 = { grade: 'grade3', grade_label: 'Lớp 3', subjects: ['english', 'math'], games: ['word_shooter', 'gate', 'defense', 'math_bridge'],
  math_level: 'grade3', topics: { english: ['school'], math: ['arithmetic', 'missing_number'] } };

beforeEach(() => setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' }));

function renderLearning(user: object, onUserUpdated = jest.fn()) {
  render(
    <ToastProvider><ConfirmProvider>
      <LearningScreen user={{ ...USER, ...user } as any} defaultDuration={25} focus={null} onFreeStudy={jest.fn()} onRewards={jest.fn()}
        onUserUpdated={onUserUpdated} />
    </ConfirmProvider></ToastProvider>,
  );
  return onUserUpdated;
}

function chooseAge(age: number) {
  fireEvent.press(screen.getByRole('button', { name: 'Độ tuổi' }));
  fireEvent.press(screen.getByRole('radio', { name: `${age} tuổi` }));
}

describe('age and grade rules', () => {
  it('mirror backend/app/study_profile.py', () => {
    const backend = fs.readFileSync(path.join(__dirname, '../../backend/app/study_profile.py'), 'utf8');
    expect(backend).toContain(`AGE_MIN, AGE_MAX = ${AGE_MIN}, ${AGE_MAX}`);
    const literal = backend.match(/GradeId = Literal\[([^\]]+)\]/)![1];
    expect([...literal.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1])).toEqual(GRADES.map((g) => g.id));
  });

  it('suggest a grade from the age and offer only plausible ones', () => {
    expect([4, 5, 6, 10, 17, 18, 22, 23, 100].map(suggestGrade))
      .toEqual(['preschool', 'preschool', 'grade1', 'grade5', 'grade12', 'university', 'university', 'adult', 'adult']);
    for (let age = AGE_MIN; age <= AGE_MAX; age++) expect(gradeFitsAge(suggestGrade(age), age)).toBe(true);
    expect(gradeChoices(6).map((g) => g.id)).toEqual(['preschool', 'grade1', 'grade2']);
    expect(gradeChoices(30).map((g) => g.id)).toEqual(['university', 'adult']);
    expect(validateAge(null)).toBe('Vui lòng chọn độ tuổi.');
    expect(validateAge(3)).toBeTruthy();
    expect(validateAge(10.5)).toBeTruthy();
    expect(validateGrade(10, null)).toBe('Vui lòng chọn lớp học.');
    expect(validateGrade(10, 'grade12')).toBeTruthy();
    expect(validateGrade(10, 'grade5')).toBeUndefined();
  });
});

describe('Học tập', () => {
  it('asks an account without age and grade, saves them, then shows what the grade offers', async () => {
    let profile: { grade?: string } | null = null;
    const server = mockServer({
      'GET /api/learning/catalog': () => ({ status: 200, body: catalog(profile) }),
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } },
      'PUT /api/profile/study': (req) => { profile = GRADE3; return { status: 200, body: { ...USER, ...req.body } }; },
    });
    const onUserUpdated = renderLearning({ age: null, school_grade: null });
    expect(await screen.findByText('Cho Mirabi biết thêm về bạn')).toBeTruthy();
    expect(screen.getByText('Chọn môn học')).toBeTruthy(); // the subjects stay usable below

    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Vui lòng chọn độ tuổi.')).toBeTruthy();
    expect(server.callsTo('PUT /api/profile/study')).toHaveLength(0);

    chooseAge(8);
    expect(screen.getByRole('radio', { name: 'Lớp 3, gợi ý theo tuổi' }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ age: 8, school_grade: 'grade3' })));
    expect(server.callsTo('PUT /api/profile/study')[0].body).toEqual({ age: 8, school_grade: 'grade3' });
    expect(await screen.findByText('Lớp 3')).toBeTruthy();
    expect(screen.queryByText('Cho Mirabi biết thêm về bạn')).toBeNull();
    expect(screen.getByRole('button', { name: /^Tự nhiên và Xã hội\./ })).toBeTruthy(); // named as in grade 3
    expect(screen.queryByRole('button', { name: /^Tiếng Anh\./ })).toBeNull(); // no game for it in this programme
  });

  it('"Để sau" hides the question for this visit without saving anything', async () => {
    const server = mockServer({ 'GET /api/learning/catalog': { status: 200, body: catalog() } });
    renderLearning({});
    fireEvent.press(await screen.findByRole('button', { name: 'Để sau' }));
    expect(screen.queryByText('Cho Mirabi biết thêm về bạn')).toBeNull();
    expect(screen.getByText('Chọn môn học')).toBeTruthy();
    expect(server.callsTo('PUT /api/profile/study')).toHaveLength(0);
  });

  it('the grade decides the Math grade; its suggested topics are marked, the others still offered', async () => {
    mockServer({ 'GET /api/learning/catalog': { status: 200, body: catalog(GRADE3) },
      'GET /api/learning/sessions/current': { status: 200, body: { session: null } } });
    renderLearning({ age: 8, school_grade: 'grade3' });
    expect(await screen.findByText('Lớp 3')).toBeTruthy();
    expect(screen.queryByText('Cho Mirabi biết thêm về bạn')).toBeNull(); // nothing to ask

    fireEvent.press(screen.getByRole('button', { name: /^Toán\./ }));
    fireEvent.press(await screen.findByRole('button', { name: /^Bảo vệ căn cứ\./ }));
    // Only grade 3 (the grade being studied), not grade 2; another grade is chosen on the subject screen.
    expect(screen.getByRole('checkbox', { name: 'Lớp 3' }).props.accessibilityState.checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Lớp 2' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Cộng, trừ, nhân, chia (gợi ý)' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'So sánh số' })).toBeTruthy();
  });

  it('the confirmed grade is changed from the subject screen', async () => {
    const server = mockServer({
      'GET /api/learning/catalog': { status: 200, body: catalog(GRADE3) },
      'PUT /api/profile/study': (req) => ({ status: 200, body: { ...USER, ...req.body } }),
    });
    const onUserUpdated = renderLearning({ age: 8, school_grade: 'grade3' });
    fireEvent.press(await screen.findByRole('button', { name: 'Sửa độ tuổi và lớp chính' }));
    expect(screen.getByRole('button', { name: 'Độ tuổi' }).props.accessibilityValue).toEqual({ text: '8 tuổi' });
    fireEvent.press(screen.getByRole('radio', { name: 'Lớp 2' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(onUserUpdated).toHaveBeenCalled());
    expect(server.callsTo('PUT /api/profile/study')[0].body).toEqual({ age: 8, school_grade: 'grade2' });
    expect(await screen.findByText('Chọn môn học')).toBeTruthy();
  });
});

describe('Cài đặt', () => {
  it('edits the saved age and grade; a changed age suggests its grade again', async () => {
    const server = mockServer({ 'PUT /api/profile/study': (req) => ({ status: 200, body: { ...USER, ...req.body } }) });
    const onBack = jest.fn();
    const onUserUpdated = jest.fn();
    render(<ToastProvider><StudyProfileScreen user={{ ...USER, age: 16, school_grade: 'grade10' } as any} onBack={onBack} onUserUpdated={onUserUpdated} /></ToastProvider>);
    expect(screen.getByRole('radio', { name: 'Lớp 10' }).props.accessibilityState.checked).toBe(true);
    chooseAge(19);
    expect(screen.getByRole('radio', { name: 'Sinh viên, gợi ý theo tuổi' }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole('radio', { name: 'Người đi làm/Học tự do' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(server.callsTo('PUT /api/profile/study')[0].body).toEqual({ age: 19, school_grade: 'adult' });
    expect(onUserUpdated).toHaveBeenCalledWith(expect.objectContaining({ age: 19, school_grade: 'adult' }));
  });

  it('keeps the form and says why when the server refuses', async () => {
    mockServer({ 'PUT /api/profile/study': { status: 422, body: { detail: 'Invalid', code: 'validation_error' } } });
    const onBack = jest.fn();
    render(<ToastProvider><StudyProfileScreen user={{ ...USER, age: 16, school_grade: 'grade10' } as any} onBack={onBack} onUserUpdated={jest.fn()} /></ToastProvider>);
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' }).props.accessibilityState.busy).toBe(false));
    expect(onBack).not.toHaveBeenCalled();
  });
});
