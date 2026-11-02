import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { NotesPanel } from '../src/screens/learning/NotesScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

// Sổ tay kiến thức → Ghi chú của tôi: write, search, edit and delete, per school year.

beforeEach(() => setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' }));

const NOTE = { id: 3, academic_year: 2026, academic_year_label: '2026–2027', grade: 'grade2', grade_label: 'Lớp 2', subject: 'math',
  subject_name: 'Toán', lesson_key: 'toan2.bang_nhan_2', lesson_title: 'Bảng nhân 2', title: 'Mẹo bảng nhân', body: '2 × 5 = 10',
  created_at: '2026-10-31T03:00:00+00:00', updated_at: '2026-10-31T03:00:00+00:00' };
const SUBJECTS = [{ code: 'math', name: 'Toán' }, { code: 'vietnamese', name: 'Tiếng Việt' }];
const LESSONS = [{ key: 'toan2.bang_nhan_2', title: 'Bảng nhân 2', subject: 'math' }];

function renderNotes(draft: { subject: string; lessonKey?: string } | null = null) {
  render(<ToastProvider><ConfirmProvider>
    <NotesPanel subjects={SUBJECTS} lessons={LESSONS} academicYear={2026} draft={draft} />
  </ConfirmProvider></ToastProvider>);
}

it('lists this year\'s notes, searches, and shows the subject, lesson and school year of each', async () => {
  const server = mockServer({
    'GET /api/education/notes?academic_year=2026': { status: 200, body: { items: [NOTE], total: 1 } },
    'GET /api/education/notes?q=nhan&academic_year=2026': { status: 200, body: { items: [], total: 0 } },
    'GET /api/education/notes': { status: 200, body: { items: [NOTE, { ...NOTE, id: 1, academic_year: 2025, academic_year_label: '2025–2026',
      grade_label: 'Lớp 1', title: 'Năm trước' }], total: 2 } },
  });
  renderNotes();
  expect(await screen.findByText('Mẹo bảng nhân')).toBeTruthy();
  expect(screen.getByText('Toán · Bảng nhân 2 · Lớp 2 · 2026–2027')).toBeTruthy();
  fireEvent.press(screen.getByRole('radio', { name: 'Tất cả năm học' }));
  expect(await screen.findByText('Năm trước')).toBeTruthy(); // older years' notes are kept
  fireEvent.press(screen.getByRole('radio', { name: 'Năm học này' }));
  fireEvent.changeText(screen.getByLabelText('Tìm ghi chú'), 'nhan');
  expect(await screen.findByText('Không tìm thấy ghi chú nào.')).toBeTruthy();
  expect(server.callsTo('GET /api/education/notes?q=nhan&academic_year=2026')).toHaveLength(1);
});

it('writes a note for a lesson (opened from the lesson), checks it has text first', async () => {
  const server = mockServer({
    'GET /api/education/notes?academic_year=2026': { status: 200, body: { items: [], total: 0 } },
    'POST /api/education/notes': (req) => ({ status: 201, body: { ...NOTE, ...req.body } }),
  });
  renderNotes({ subject: 'math', lessonKey: 'toan2.bang_nhan_2' });
  expect(screen.getByRole('radio', { name: 'Bảng nhân 2' }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByText('Hãy viết nội dung ghi chú.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Nội dung ghi chú'), '  2 × 5 = 10  ');
  fireEvent.changeText(screen.getByLabelText('Tiêu đề ghi chú'), 'Mẹo');
  fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(server.callsTo('POST /api/education/notes')).toHaveLength(1));
  expect(server.callsTo('POST /api/education/notes')[0].body).toEqual({ title: 'Mẹo', body: '2 × 5 = 10', subject: 'math', lesson_key: 'toan2.bang_nhan_2' });
});

it('edits and deletes a note (deleting asks first)', async () => {
  const server = mockServer({
    'GET /api/education/notes?academic_year=2026': { status: 200, body: { items: [NOTE], total: 1 } },
    'PUT /api/education/notes/3': (req) => ({ status: 200, body: { ...NOTE, ...req.body } }),
    'DELETE /api/education/notes/3': { status: 204 },
  });
  renderNotes();
  fireEvent.press(await screen.findByRole('button', { name: 'Sửa ghi chú Mẹo bảng nhân' }));
  fireEvent.changeText(screen.getByLabelText('Nội dung ghi chú'), '2 × 5 = 5 × 2 = 10');
  fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(server.callsTo('PUT /api/education/notes/3')).toHaveLength(1));
  expect(server.callsTo('PUT /api/education/notes/3')[0].body).toMatchObject({ body: '2 × 5 = 5 × 2 = 10', subject: 'math' });
  fireEvent.press(await screen.findByRole('button', { name: 'Xoá ghi chú Mẹo bảng nhân' }));
  expect(await screen.findByText('Xoá ghi chú?')).toBeTruthy();
  expect(server.callsTo('DELETE /api/education/notes/3')).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Xoá' }));
  await waitFor(() => expect(server.callsTo('DELETE /api/education/notes/3')).toHaveLength(1));
});
