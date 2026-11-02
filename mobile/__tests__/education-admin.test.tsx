import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { EducationAdminScreen } from '../src/screens/admin/EducationAdminScreen';
import { MoreTab } from '../src/screens/main/MoreTab';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

// Quản trị lớp học: administrators only; every change needs a reason and a verification, and is confirmed before saving.

// MoreTab's "Đăng xuất" needs the signed-in session; only its admin entry is under test here.
jest.mock('../src/auth/useConfirmLogout', () => ({ useConfirmLogout: () => jest.fn() }));

beforeEach(() => setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' }));

const LEARNER = { id: 7, email: 'minh@example.com', display_name: 'Minh', grade: 'grade2', grade_label: 'Lớp 2', academic_year: 2026,
  academic_year_label: '2026–2027', region: 'VN', status: 'studying', hold_next_promotion: false };
const DETAIL = { ...LEARNER, initial_grade: 'grade2', enrollment_date: '2026-10-31', awaiting_calendar: '2027–2028', can_promote: true,
  history: [{ id: 1, kind: 'enrollment', academic_year: 2026, academic_year_label: '2026–2027', from_grade: null, to_grade: 'grade2',
    skipped: false, reason: null, actor: null, at: '2026-10-31T03:00:00+00:00' }] };
const ALERT = { region: 'VN', academic_year: 2027, label: '2027–2028', level: 'overdue', expected_start: '2027-09-05', configured: false, waiting: 12 };

function renderAdmin() {
  render(<ToastProvider><ConfirmProvider><EducationAdminScreen onBack={jest.fn()} /></ConfirmProvider></ToastProvider>);
}

const routes = (extra = {}) => ({
  'GET /api/admin/education/alerts': { status: 200, body: [ALERT] },
  'GET /api/admin/education/regions': { status: 200, body: { items: [{ code: 'VN', name: 'Việt Nam', timezone: 'Asia/Ho_Chi_Minh' }] } },
  'GET /api/admin/education/users?q=minh': { status: 200, body: { items: [LEARNER] } },
  'GET /api/admin/education/users/7': { status: 200, body: DETAIL },
  'GET /api/admin/education/calendar?region=VN': { status: 200, body: { region: 'VN', years: [], changes: [], alerts: [ALERT] } },
  ...extra,
});

describe('Quản trị lớp học', () => {
  it('is offered in Cài đặt to administrators only', () => {
    const { rerender } = render(<MoreTab user={{ ...USER, role: 'user' } as any} onOpenProfile={jest.fn()} onOpenEducationAdmin={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Quản trị lớp học' })).toBeNull();
    const open = jest.fn();
    rerender(<MoreTab user={{ ...USER, role: 'admin' } as any} onOpenProfile={jest.fn()} onOpenEducationAdmin={open} />);
    fireEvent.press(screen.getByRole('button', { name: 'Quản trị lớp học' }));
    expect(open).toHaveBeenCalled();
  });

  it('warns about an unverified calendar, finds a learner and confirms a promotion with its reason', async () => {
    const server = mockServer(routes({
      'POST /api/admin/education/users/7/promote': { status: 200, body: {} },
    }));
    renderAdmin();
    expect(await screen.findByText(/Đã đến năm học 2027–2028 \(VN\) nhưng lịch chưa được xác minh · 12 học sinh/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Tìm học sinh'), 'minh');
    fireEvent.press(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Minh, minh@example.com' }));
    expect(await screen.findByText('Lớp: Lớp 2 · Năm học 2026–2027')).toBeTruthy();
    expect(screen.getByText('Đăng ký: Lớp 2 · 2026–2027')).toBeTruthy(); // the history
    fireEvent.press(screen.getByRole('button', { name: 'Xác nhận lên lớp' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Lý do cần ít nhất 5 ký tự.')).toBeTruthy(); // nothing sent without a reason
    fireEvent.changeText(screen.getByLabelText('Lý do'), 'Nhà trường xác nhận lên lớp');
    fireEvent.changeText(screen.getByLabelText('Xác minh'), 'TICKET-5');
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Xác nhận lên lớp?')).toBeTruthy(); // confirmed before saving
    expect(server.callsTo('POST /api/admin/education/users/7/promote')).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(server.callsTo('POST /api/admin/education/users/7/promote')).toHaveLength(1));
    expect(server.callsTo('POST /api/admin/education/users/7/promote')[0].body).toEqual({ reason: 'Nhà trường xác nhận lên lớp', verification: 'TICKET-5' });
  });

  it('corrects a grade only after confirmation, and cancelling sends nothing', async () => {
    const server = mockServer(routes({ 'POST /api/admin/education/users/7/grade': { status: 200, body: {} } }));
    renderAdmin();
    fireEvent.changeText(await screen.findByLabelText('Tìm học sinh'), 'minh');
    fireEvent.press(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Minh, minh@example.com' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Sửa lớp' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Lớp 3' }));
    fireEvent.changeText(screen.getByLabelText('Lý do'), 'Phụ huynh xác nhận đăng ký nhầm lớp');
    fireEvent.changeText(screen.getByLabelText('Xác minh'), 'TICKET-9');
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Sửa lớp?')).toBeTruthy();
    const cancels = screen.getAllByRole('button', { name: 'Huỷ' });
    fireEvent.press(cancels[cancels.length - 1]); // the dialog's, drawn last
    await waitFor(() => expect(screen.queryByText('Sửa lớp?')).toBeNull());
    expect(server.callsTo('POST /api/admin/education/users/7/grade')).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(server.callsTo('POST /api/admin/education/users/7/grade')[0]?.body).toEqual(
      { grade: 'grade3', reason: 'Phụ huynh xác nhận đăng ký nhầm lớp', verification: 'TICKET-9' }));
  });

  it('a verified school year needs its source and decision number; saved with the reason after confirmation', async () => {
    const server = mockServer(routes({ 'PUT /api/admin/education/calendar': { status: 200, body: {} } }));
    renderAdmin();
    fireEvent.press(await screen.findByText('Lịch năm học'));
    fireEvent.press(await screen.findByRole('button', { name: 'Thêm năm học' }));
    fireEvent.changeText(screen.getByLabelText('Năm bắt đầu'), '2027');
    fireEvent.changeText(screen.getByLabelText('Tựu trường'), '2027-08-30');
    fireEvent.press(screen.getByRole('switch', { name: 'Đã xác minh theo văn bản' }));
    fireEvent.changeText(screen.getByLabelText('Lý do thay đổi'), 'Bộ ban hành khung kế hoạch');
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đã xác minh cần có nguồn và số văn bản.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Nguồn quyết định'), 'Khung kế hoạch thời gian năm học 2027–2028');
    fireEvent.changeText(screen.getByLabelText('Số văn bản'), '1234/QĐ-BGDĐT');
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Học sinh sẽ tự lên lớp vào ngày 2027-08-30 (giờ Việt Nam).')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Lưu lịch' }));
    await waitFor(() => expect(server.callsTo('PUT /api/admin/education/calendar')).toHaveLength(1));
    expect(server.callsTo('PUT /api/admin/education/calendar')[0].body).toEqual({ region: 'VN', academic_year: 2027,
      school_start_date: '2027-08-30', opening_date: null, promotion_date: null, end_date: null,
      source: 'Khung kế hoạch thời gian năm học 2027–2028', decision_number: '1234/QĐ-BGDĐT', verified: true, reason: 'Bộ ban hành khung kế hoạch' });
  });

  it('a refused call (not an administrator) is shown, nothing changes', async () => {
    mockServer(routes({ 'GET /api/admin/education/users?q=minh': { status: 403, body: { detail: 'Administrator access is required', code: 'admin_required' } } }));
    renderAdmin();
    fireEvent.changeText(await screen.findByLabelText('Tìm học sinh'), 'minh');
    fireEvent.press(screen.getByRole('button', { name: 'Tìm' }));
    expect(await screen.findByText('Bạn không có quyền quản trị để thực hiện thao tác này.')).toBeTruthy();
  });
});
