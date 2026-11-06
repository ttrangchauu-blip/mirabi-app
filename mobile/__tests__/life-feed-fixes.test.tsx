import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HealingDock } from '../src/screens/healing/HealingDock';
import { FeedScreen } from '../src/screens/main/FeedScreen';
import { MemoryAlbumScreen } from '../src/screens/main/MemoryAlbumScreen';
import { MoneyGardenScreen } from '../src/screens/money/MoneyGardenScreen';
import { WorkQuestScreen } from '../src/screens/work/WorkQuestScreen';
import { monthOf } from '../src/life/worlds';
import { USER, mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

const TZ = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

// ---------------------------------------------------------------------------- Nhiệm vụ công việc
const DASHBOARD = `GET /api/work/dashboard?tz=${TZ}`;
const timer = { running: false, phase: 'focus', seconds: 1500, activeCycle: null, toggle: jest.fn(), reset: jest.fn() } as any;
const task = (over: Record<string, unknown> = {}) => ({
  id: 11, occurrence_id: '11:2026-11-01', title: 'Viết báo cáo', category: 'work', scheduled_date: '2026-11-01', repeat: 'none',
  project_id: 3, priority: 'high', due_at: '2026-11-01T02:00:00+00:00', estimated_minutes: 45, exp: 8, completed: false, steps: [], ...over,
});
const dashboard = (over: Record<string, unknown> = {}) => ({
  today: '2026-11-01', tasks_today: [task()], overdue: [], upcoming: [],
  projects: [{ id: 3, name: 'Ra mắt app', description: null, theme: 'beach', status: 'active', tasks_total: 2, tasks_done: 1, recurring_tasks: 0,
    completions: 1, progress: 0.5, build_stage: 2, ready_to_complete: false, completed_at: null, created_at: '2026-10-01T00:00:00+00:00' }],
  chests: [], summary: { today_total: 1, today_done: 0, focus_minutes_today: 25, exp_remaining_today: 52 },
  walk: { status: 'locked', goals_total: 4, goals_done: 3 }, pet_line: 'Cố lên nhé!', ...over,
});

describe('Nhiệm vụ công việc', () => {
  it('lays a task of today whose deadline has passed on the desk once', async () => {
    mockServer({ [DASHBOARD]: { status: 200, body: dashboard({ overdue: [{ ...task(), overdue: true }] }) } });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    await screen.findByText('Cố lên nhé!', {}, { timeout: 5000 });
    expect(screen.getAllByLabelText(/^Viết báo cáo, ưu tiên Cao/)).toHaveLength(1);
  });

  it('asks before archiving a project', async () => {
    const PATCH = 'PATCH /api/work/projects/3';
    const server = mockServer({ [DASHBOARD]: { status: 200, body: dashboard() }, [PATCH]: { status: 200, body: {} } });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText(/^Dự án Ra mắt app/, {}, { timeout: 5000 }));
    fireEvent.press(await screen.findByLabelText('Lưu trữ dự án'));
    fireEvent.press((await screen.findAllByText('Giữ lại')).pop()!);
    await waitFor(() => expect(screen.queryByText('Lưu trữ dự án?')).toBeNull());
    expect(server.callsTo(PATCH)).toHaveLength(0);

    fireEvent.press(await screen.findByLabelText('Lưu trữ dự án'));
    fireEvent.press(await screen.findByLabelText(/^Xác nhận lưu trữ/i));
    await waitFor(() => expect(server.callsTo(PATCH)[0]?.body).toEqual({ status: 'archived' }));
  });
});

// ---------------------------------------------------------------------------- Vườn tài chính
const goal = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Laptop', target_amount: 20000000, currency: 'VND', target_date: null, plant: 'sakura', status: 'active', saved_amount: 5000000, percent: 25,
  stage: 2, stage_name: 'Cây non', milestones: [25, 50, 75, 100].map((p) => ({ percent: p, reached: p <= 25 })), estimated_date: null, created_at: '', ...over,
});
const tx = (id: number, note: string, over: Record<string, unknown> = {}) => ({
  id, transaction_type: 'expense', amount: 1000, goal_id: null, category_id: null, category: null, occurred_at: '2026-11-01T02:00:00+00:00', note, ...over,
});
const HISTORY = 'GET /api/finance/transactions?goal_id=1&limit=20';
const garden = (routes: Record<string, any>) => mockServer({ 'GET /api/finance/goals': { status: 200, body: [goal()] }, [HISTORY]: { status: 200, body: { items: [], next_before: null } }, ...routes });
const summary = (over: Record<string, unknown> = {}) => ({ status: 200, body: { period: monthOf(), income: 0, expense: 0, net: 0, by_category: [], budgets: [], goals: [], saved_total: 0, target_total: 0, ...over } });
const SUMMARY = (period: string) => `GET /api/finance/summary?period=${period}&tz=${TZ}`;
const ENTRIES = (period: string) => `GET /api/finance/transactions?period=${period}&transaction_type=income,expense&limit=30&tz=${TZ}`;
const lastMonth = () => { const now = new Date(); return monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)); };

async function openBudget(routes: Record<string, any>) {
  const server = mockServer({
    'GET /api/finance/goals': { status: 200, body: [] },
    'GET /api/finance/categories': { status: 200, body: [] },
    [SUMMARY(monthOf())]: summary(),
    [ENTRIES(monthOf())]: { status: 200, body: { items: [], next_before: null } },
    ...routes,
  });
  wrap(<MoneyGardenScreen onBack={() => {}} />);
  fireEvent.press(await screen.findByText('Thu chi', {}, { timeout: 5000 }));
  await screen.findByTestId('budget-tab');
  return server;
}

describe('Vườn tài chính', () => {
  it('counts the month in the device zone and lists income and expenses without the savings', async () => {
    const server = await openBudget({ [ENTRIES(monthOf())]: { status: 200, body: { items: [tx(1, 'Cơm trưa')], next_before: null } } });
    expect(server.callsTo(SUMMARY(monthOf()))).toHaveLength(1);
    expect(await screen.findByText(/Cơm trưa/)).toBeTruthy();
  });

  it('only records income and expenses in the current month, and says so on another month', async () => {
    const server = await openBudget({ [SUMMARY(lastMonth())]: summary({ period: lastMonth() }), [ENTRIES(lastMonth())]: { status: 200, body: { items: [], next_before: null } } });
    fireEvent.press(screen.getByLabelText('Tháng trước'));
    expect(await screen.findByText(/Chỉ ghi được khoản thu chi của tháng hiện tại/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Ghi khoản chi'));
    expect(screen.queryByLabelText('Số tiền')).toBeNull();
    expect(server.callsTo('POST /api/finance/transactions')).toHaveLength(0);
    fireEvent.press(screen.getByLabelText('Tháng sau'));
    await waitFor(() => expect(screen.queryByText(/Chỉ ghi được khoản thu chi của tháng hiện tại/)).toBeNull());
    fireEvent.press(screen.getByLabelText('Ghi khoản chi'));
    expect(await screen.findByLabelText('Số tiền')).toBeTruthy();
  });

  it('shows both the income and the expense of a row without a category', async () => {
    await openBudget({ [SUMMARY(monthOf())]: summary({ by_category: [{ category_id: null, name: 'Chưa phân loại', icon: '❔', income: 3000, expense: 1000 }] }) });
    expect(await screen.findByText('+3.000 ₫')).toBeTruthy();
    expect(screen.getByText('−1.000 ₫')).toBeTruthy();
  });

  it('reads older entries of the month on request', async () => {
    const server = await openBudget({
      [ENTRIES(monthOf())]: { status: 200, body: { items: [tx(9, 'Mới')], next_before: 9 } },
      [`${ENTRIES(monthOf())}&before=9`]: { status: 200, body: { items: [tx(4, 'Cũ')], next_before: null } },
    });
    fireEvent.press(await screen.findByLabelText('Xem thêm giao dịch'));
    expect(await screen.findByText(/Cũ/)).toBeTruthy();
    expect(screen.getByText(/Mới/)).toBeTruthy();
    expect(server.callsTo(`${ENTRIES(monthOf())}&before=9`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByLabelText('Xem thêm giao dịch')).toBeNull());
  });

  it('reads the older savings of a goal on request', async () => {
    const deposit = (id: number, note: string) => tx(id, note, { transaction_type: 'deposit', goal_id: 1 });
    garden({
      [HISTORY]: { status: 200, body: { items: [deposit(9, 'Tháng này')], next_before: 9 } },
      [`${HISTORY}&before=9`]: { status: 200, body: { items: [deposit(4, 'Năm ngoái')], next_before: null } },
    });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Xem thêm lịch sử', {}, { timeout: 5000 }));
    expect(await screen.findByText(/Năm ngoái/)).toBeTruthy();
    expect(screen.getByText(/Tháng này/)).toBeTruthy();
  });

  it('says the history could not be read instead of showing it empty, and tries again', async () => {
    let down = true;
    garden({ [HISTORY]: () => (down ? { status: 500, body: { detail: 'x' } } : { status: 200, body: { items: [], next_before: null } }) });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    expect(await screen.findByText('Chưa tải được lịch sử.', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('Chưa có khoản nào.')).toBeNull();
    down = false;
    fireEvent.press(screen.getByLabelText('Tải lại lịch sử'));
    expect(await screen.findByText('Chưa có khoản nào.')).toBeTruthy();
  });

  it('keeps one reference for a retry of the same entry and a new one once the amount changes', async () => {
    let lost = true;
    const server = garden({ 'POST /api/finance/transactions': () => (lost ? networkDown() : { status: 201, body: { transaction: tx(1, ''), already_recorded: false, goal: goal() } }) });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Gửi tiết kiệm', {}, { timeout: 5000 }));
    fireEvent.changeText(await screen.findByLabelText('Số tiền'), '100000');
    const send = () => { const all = screen.getAllByLabelText('Gửi tiết kiệm'); fireEvent.press(all[all.length - 1]); };
    const sent = () => server.callsTo('POST /api/finance/transactions').map((c) => c.body);
    send();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByLabelText('Gửi tiết kiệm').pop()!.props.accessibilityState?.disabled).toBeFalsy());
    send();
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1].client_ref).toBe(sent()[0].client_ref);
    await waitFor(() => expect(screen.getAllByLabelText('Gửi tiết kiệm').pop()!.props.accessibilityState?.disabled).toBeFalsy());
    lost = false;
    fireEvent.changeText(screen.getByLabelText('Số tiền'), '900000');
    send();
    await waitFor(() => expect(sent()).toHaveLength(3));
    expect(sent()[2].amount).toBe(900000);
    expect(sent()[2].client_ref).not.toBe(sent()[0].client_ref);
  });
});

// ---------------------------------------------------------------------------- Góc thư giãn
describe('Góc thư giãn', () => {
  it('reads older journal pages on request', async () => {
    const page = (id: number, title: string) => ({ id, kind: 'free', title, content: 'Nội dung', mood: null, visibility: 'private', memory_id: null, created_at: '2026-11-01T02:00:00+00:00', updated_at: '' });
    const server = mockServer({
      [`GET /api/life/healing?tz=${TZ}`]: { status: 200, body: { today: '2026-11-01', ambience: { ambience_type: 'cozy_night', sound_enabled: false, volume: 0.4 }, mood_today: null, pet: null,
        relaxation: { today_seconds: 0, today_sessions: 0, week_seconds: 0, calm_days: 0 }, journal_count: 2 } },
      'GET /api/life/journal?limit=20': { status: 200, body: { items: [page(30, 'Trang mới')], next_before: 30 } },
      'GET /api/life/journal?limit=20&before=30': { status: 200, body: { items: [page(10, 'Trang cũ')], next_before: null } },
    });
    wrap(<HealingDock userId={1} ambience="cozy_night" onAmbience={() => {}} onPetResponse={() => {}} onPet={() => {}} onResting={() => {}} bottom={0} />);
    fireEvent.press(await screen.findByLabelText('Nhật ký', {}, { timeout: 5000 }));
    fireEvent.press(await screen.findByLabelText('Xem trang nhật ký cũ hơn'));
    expect(await screen.findByText('Trang cũ')).toBeTruthy();
    expect(screen.getByText('Trang mới')).toBeTruthy();
    expect(server.callsTo('GET /api/life/journal?limit=20&before=30')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByLabelText('Xem trang nhật ký cũ hơn')).toBeNull());
  });
});

// ---------------------------------------------------------------------------- Bảng tin
function Feed() {
  const [posts, setPosts] = useState<any[]>([]);
  return <FeedScreen user={USER as any} posts={posts} onPosts={setPosts} onBack={() => {}} />;
}

describe('Bảng tin', () => {
  it('reads the feed when it opens', async () => {
    const server = mockServer({ 'GET /api/community/posts': { status: 200, body: [{ id: 1, author: 'Linh', body: 'Hôm nay học xong chương 3!', likes: 2 }] } });
    wrap(<Feed />);
    expect(await screen.findByText('Hôm nay học xong chương 3!')).toBeTruthy();
    expect(server.callsTo('GET /api/community/posts')).toHaveLength(1);
  });

  it('says when there are no posts yet', async () => {
    mockServer({ 'GET /api/community/posts': { status: 200, body: [] } });
    wrap(<Feed />);
    expect(await screen.findByText('Chưa có bài viết nào')).toBeTruthy();
  });

  it('says when the feed could not be read, and tries again', async () => {
    let down = true;
    mockServer({ 'GET /api/community/posts': () => (down ? networkDown() : { status: 200, body: [{ id: 1, author: 'Linh', body: 'Đã tải lại', likes: 0 }] }) });
    wrap(<Feed />);
    const retry = await screen.findByLabelText('Thử lại');
    expect(screen.queryByText('Chưa có bài viết nào')).toBeNull();
    down = false;
    fireEvent.press(retry);
    expect(await screen.findByText('Đã tải lại')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- Album kỷ niệm
describe('Album kỷ niệm', () => {
  it('a memory saved while another filter is open shows only where it belongs', async () => {
    const saved = { id: 9, pet_id: 'fox', event_type: 'manual', title: 'Ngày chúng mình gặp nhau', message: null, event_text: '', event_at: '2026-11-01T02:00:00+00:00', created_at: '2026-11-01T02:00:00+00:00',
      favorite: false, status: 'ready', snapshot: { pet_name: 'Mây', pet_id: 'fox', level: 1, element: 'fire', accessory: null, background: 'home' }, thumbnail_svg: '<svg/>', featured: false,
      template_key: 'hatch', palette_key: 'sky', include_message: false, image_key: 'k', image_svg: '<svg/>' };
    const empty = { status: 200, body: { items: [], next_cursor: null } };
    const server = mockServer({
      'GET /api/memories?category=all&limit=20': empty,
      'GET /api/memories?category=study&limit=20': empty,
      'POST /api/memories/preview': { status: 200, body: { svg: '<svg/>', png: 'PNG', width: 1080, height: 1350, key: 'k' } },
      'POST /api/memories': { status: 201, body: saved },
    });
    wrap(<MemoryAlbumScreen user={{ ...USER, level: 1, pet_name: 'Mây' } as any} onBack={() => {}} />);
    fireEvent.press(await screen.findByText('Học tập'));
    await waitFor(() => expect(server.callsTo('GET /api/memories?category=study&limit=20')).toHaveLength(1));
    fireEvent.press((await screen.findAllByLabelText('Tạo kỷ niệm'))[0]);
    fireEvent.press(await screen.findByText('Lưu kỷ niệm'));
    await waitFor(() => expect(server.callsTo('POST /api/memories')).toHaveLength(1));
    await waitFor(() => expect(server.callsTo('GET /api/memories?category=study&limit=20')).toHaveLength(2));
    expect(screen.queryByText('Ngày chúng mình gặp nhau')).toBeNull();
  });
});
