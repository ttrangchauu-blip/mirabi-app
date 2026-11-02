import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AdventureMapScreen } from '../src/screens/adventure/AdventureMapScreen';
import { MoneyGardenScreen } from '../src/screens/money/MoneyGardenScreen';
import { TownScreen } from '../src/screens/town/TownScreen';
import { CareerJourneyScreen } from '../src/screens/career/CareerJourneyScreen';
import { formatVnd, localDay, parseVnd } from '../src/life/worlds';
import { lifeEligible } from '../src/life/access';
import { USER, mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
const ADULT = { ...USER, age: 28 } as any;
beforeEach(async () => { await AsyncStorage.clear(); });

describe('rules shared with the backend', () => {
  it('opens Cuộc sống Mirabi from 16, never without an age', () => {
    expect([lifeEligible({ age: 15 }), lifeEligible({ age: 16 }), lifeEligible({ age: null }), lifeEligible(null)]).toEqual([false, true, false, false]);
  });
  it('formats and reads whole đồng', () => {
    expect(formatVnd(20000000)).toBe('20.000.000 ₫');
    expect(parseVnd('20.000.000 đ')).toBe(20000000);
    expect([parseVnd(''), parseVnd('0'), parseVnd('abc'), parseVnd('1234567890123')]).toEqual([null, null, null, null]);
  });
});

// ---------------------------------------------------------------------------- Phiêu lưu cuộc sống
const region = (code: string, over: Record<string, unknown> = {}) => ({
  code, name: { green_valley: 'Thung lũng Xanh', cozy_village: 'Làng Ấm Áp', knowledge_forest: 'Rừng Tri Thức', dream_lake: 'Hồ Mộng Mơ',
    adventure_mountain: 'Núi Phiêu Lưu' }[code], theme: 'Sức khỏe', emoji: '🌿', description: 'Mô tả', progress: 0, unlocked: code === 'green_valley',
  unlock_hint: code === 'green_valley' ? null : 'Hoàn thành 3 hoạt động ở vùng trước', next_milestone: 3,
  milestones: [{ code: `${code}:3`, required: 3, rewards: [], status: 'locked' }],
  activities: [{ code: 'walk_20', name: 'Đi bộ 20 phút', emoji: '🚶' }], tasks_today: [], ...over,
});
const map = (over: Record<string, unknown> = {}, valley: Record<string, unknown> = {}) => ({
  day: localDay(), pet_region: 'green_valley', total_progress: 0, daily_count_limit: 3,
  regions: [region('green_valley', valley), ...['cozy_village', 'knowledge_forest', 'dream_lake', 'adventure_mountain'].map((c) => region(c))], ...over,
});

describe('Phiêu lưu cuộc sống', () => {
  it('draws the five regions, locks the later ones and takes on an activity as a task of today', async () => {
    let started = false;
    const task = { id: 7, occurrence_id: `7:${localDay()}`, title: 'Đi bộ 20 phút', scheduled_date: localDay(), completed: false, adventure_activity: 'walk_20' };
    const server = mockServer({
      [`GET /api/adventure/map?day=${localDay()}`]: () => ({ status: 200, body: map({}, started ? { tasks_today: [task] } : {}) }),
      'POST /api/adventure/activities/walk_20/start': () => { started = true; return { status: 201, body: { ...task, region: 'green_valley' } }; },
      'POST /api/tasks/7/complete': { status: 200, body: { awarded_exp: 5, already_completed: false } },
    });
    const onRewards = jest.fn();
    wrap(<AdventureMapScreen user={ADULT} onBack={() => {}} onRewards={onRewards} />);
    expect(await screen.findByLabelText(/^Thung lũng Xanh: 0 hoạt động$/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText(/^Núi Phiêu Lưu: chưa mở/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Nhận hoạt động Đi bộ 20 phút'));
    await waitFor(() => expect(server.callsTo('POST /api/adventure/activities/walk_20/start')[0]?.body).toEqual({ scheduled_date: localDay() }));
    fireEvent.press(await screen.findByLabelText('Đã làm xong Đi bộ 20 phút'));
    await waitFor(() => expect(server.callsTo('POST /api/tasks/7/complete')[0]?.body).toEqual({ occurrence_date: localDay() }));
    await waitFor(() => expect(onRewards).toHaveBeenCalled());
  });

  it('shows the region locked with what opens it, and retries after an error', async () => {
    let down = true;
    mockServer({ [`GET /api/adventure/map?day=${localDay()}`]: () => (down ? networkDown() : { status: 200, body: map() }) });
    wrap(<AdventureMapScreen user={ADULT} onBack={() => {}} />);
    const retry = await screen.findByLabelText('Thử lại');
    down = false;
    fireEvent.press(retry);
    fireEvent.press(await screen.findByLabelText(/^Làng Ấm Áp: chưa mở/));
    expect(screen.getByText('Hoàn thành 3 hoạt động ở vùng trước')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- Vườn tài chính
const goal = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Laptop', target_amount: 20000000, currency: 'VND', target_date: null, plant: 'sakura', status: 'active', saved_amount: 5000000, percent: 25,
  stage: 2, stage_name: 'Cây non', milestones: [25, 50, 75, 100].map((p) => ({ percent: p, reached: p <= 25 })), estimated_date: null, created_at: '', ...over,
});

describe('Vườn tài chính', () => {
  it('shows each goal as a tree and records a deposit once, growing the tree', async () => {
    let saved = 0;
    const server = mockServer({
      'GET /api/finance/goals': { status: 200, body: [goal()] },
      'GET /api/finance/transactions?goal_id=1&limit=20': { status: 200, body: { items: [], next_before: null } },
      'POST /api/finance/transactions': (req) => { saved += 1; return { status: 201, body: { transaction: { id: 9, ...req.body }, already_recorded: false,
        goal: goal({ saved_amount: 10000000, percent: 50, stage: 3, stage_name: 'Cây phát triển' }) } }; },
    });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    expect(await screen.findByLabelText('Laptop: Cây non, 25%', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Đã tiết kiệm 5.000.000 ₫ trên 20.000.000 ₫')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Gửi tiết kiệm'));
    fireEvent.changeText(await screen.findByLabelText('Số tiền'), '5000000');
    const send = screen.getAllByLabelText('Gửi tiết kiệm');
    fireEvent.press(send[send.length - 1]);
    await waitFor(() => expect(saved).toBe(1));
    const body = server.callsTo('POST /api/finance/transactions')[0].body;
    expect(body).toMatchObject({ transaction_type: 'deposit', amount: 5000000, goal_id: 1 });
    expect(body.client_ref).toMatch(/^[A-Za-z0-9_.:-]{8,64}$/);
    expect(await screen.findByLabelText('Laptop: Cây phát triển, 50%')).toBeTruthy();
  });

  it('refuses to withdraw more than the goal holds before asking the server', async () => {
    const server = mockServer({
      'GET /api/finance/goals': { status: 200, body: [goal()] },
      'GET /api/finance/transactions?goal_id=1&limit=20': { status: 200, body: { items: [], next_before: null } },
    });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Rút tiền', {}, { timeout: 5000 }));
    fireEvent.changeText(await screen.findByLabelText('Số tiền'), '6000000');
    expect(screen.getByText('Không thể rút nhiều hơn số tiền đang có.')).toBeTruthy();
    expect(server.callsTo('POST /api/finance/transactions')).toHaveLength(0);
  });

  it('invites the first goal when the garden is empty', async () => {
    mockServer({ 'GET /api/finance/goals': { status: 200, body: [] } });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    expect(await screen.findByText('Khu vườn đang chờ hạt giống đầu tiên', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/không kết nối ngân hàng và không đưa ra lời khuyên đầu tư/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- Thị trấn Mirabi
const town = (over: Record<string, unknown> = {}) => ({
  me: { id: 1, display_name: 'Aqua', pet: 'fox', pet_name: 'Aqua', pet_level: 1, coins: 500 },
  friends: [{ id: 7, display_name: 'May', avatar_theme: 'aqua', pet: 'cat', pet_name: 'Mochi', pet_level: 2, presence: 'online', can_visit: true }],
  projects: [{ id: 3, code: 'square_fountain', name: 'Đài phun nước Quảng trường', description: '', target: 50000, current: 1000, percent: 2, stage: 0,
    status: 'active', my_contribution: 0, contributors: 1 }],
  events: [], achievements: [], contribution_left_today: 1000, gifts_left_today: 10, ...over,
});

describe('Thị trấn Mirabi', () => {
  it('has a house for each friend that opens their room, and builds with coins', async () => {
    const server = mockServer({
      'GET /api/town/map': { status: 200, body: town() },
      'POST /api/town/projects/3/contribute': (req) => ({ status: 200, body: { project: { ...town().projects[0], current: 1000 + req.body.amount, my_contribution: req.body.amount },
        coins: 500 - req.body.amount, already_recorded: false, contribution_left_today: 1000 - req.body.amount } }),
    });
    const onVisitRoom = jest.fn();
    wrap(<TownScreen user={ADULT} onBack={() => {}} onVisitRoom={onVisitRoom} onVisitGarden={() => {}} onOpenFriends={() => {}} />);
    fireEvent.press(await screen.findByTestId('house-7', {}, { timeout: 5000 }));
    fireEvent.press(await screen.findByLabelText('Ghé thăm phòng'));
    expect(onVisitRoom).toHaveBeenCalledWith(7);
    fireEvent.press(screen.getByLabelText('Đài phun nước Quảng trường: 2%'));
    fireEvent.press(await screen.findByLabelText('Góp 100 xu'));
    await waitFor(() => expect(server.callsTo('POST /api/town/projects/3/contribute')[0]?.body.amount).toBe(100));
    expect(await screen.findByLabelText('400 xu')).toBeTruthy();
  });

  it('asks to make friends when the street is empty', async () => {
    mockServer({ 'GET /api/town/map': { status: 200, body: town({ friends: [] }) } });
    const onOpenFriends = jest.fn();
    wrap(<TownScreen user={ADULT} onBack={() => {}} onVisitRoom={() => {}} onVisitGarden={() => {}} onOpenFriends={onOpenFriends} />);
    fireEvent.press(await screen.findByLabelText('Kết bạn', {}, { timeout: 5000 }));
    expect(onOpenFriends).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------- Hành trình sự nghiệp
const qa = (status: Record<string, string> = {}) => ({
  id: 1, code: 'qa_tester', name: 'Kiểm thử phần mềm (QA/QC)', description: '', icon: '🔍', skills_total: 2, skills_done: status.tcd === 'practiced' ? 1 : 0,
  selected: true, active: true, current_goal: null, new_badges: [], milestones: [{ code: 'path:all', title: 'Chinh phục QA', earned: false }],
  groups: [{ name: 'Kiểm thử thủ công', skills: [
    { id: 11, code: 'tcd', group: 'Kiểm thử thủ công', name: 'Thiết kế test case', description: 'Viết test case', goal: '', level: 1, prerequisites: [],
      activities: ['Đọc user story'], has_assessment: true, assessment: [{ q: 'Câu hỏi?', options: ['A', 'B'] }], unlocked: true,
      status: status.tcd ?? 'available', progress_percent: status.tcd === 'practiced' ? 100 : 0 },
    { id: 12, code: 'exec', group: 'Kiểm thử thủ công', name: 'Thực thi kiểm thử', description: '', goal: '', level: 1, prerequisites: ['tcd'], activities: [],
      has_assessment: false, assessment: [], unlocked: status.tcd === 'practiced', status: status.tcd === 'practiced' ? 'available' : 'locked', progress_percent: 0 },
  ] }],
});

describe('Hành trình sự nghiệp', () => {
  it('lets the user choose a career from the server list', async () => {
    const server = mockServer({
      'GET /api/careers': { status: 200, body: [{ ...qa(), active: false, selected: false }] },
      'POST /api/careers/profile': { status: 200, body: qa() },
    });
    wrap(<CareerJourneyScreen user={ADULT} onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId('career-qa_tester', {}, { timeout: 5000 }));
    fireEvent.press(screen.getByLabelText('Bắt đầu hành trình'));
    await waitFor(() => expect(server.callsTo('POST /api/careers/profile')[0]?.body).toEqual({ career_code: 'qa_tester', current_goal: null }));
    expect(await screen.findByLabelText('Thiết kế test case, Sẵn sàng học')).toBeTruthy();
    expect(screen.getByLabelText('Thực thi kiểm thử, Chưa mở')).toBeTruthy();
  });

  it('marks a practice done, opens the next skill and never calls it verified', async () => {
    const server = mockServer({
      'GET /api/careers': { status: 200, body: [qa()] },
      'GET /api/careers/qa_tester': { status: 200, body: qa() },
      'PATCH /api/careers/skills/11/progress': { status: 200, body: { ...qa({ tcd: 'practiced' }), awarded_exp: 5 } },
    });
    const onRewards = jest.fn();
    wrap(<CareerJourneyScreen user={ADULT} onBack={() => {}} onRewards={onRewards} />);
    fireEvent.press(await screen.findByLabelText('Thiết kế test case, Sẵn sàng học', {}, { timeout: 5000 }));
    expect(screen.getByText(/chưa có cơ chế xác minh chính thức/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Tôi đã thực hành kỹ năng này'));
    await waitFor(() => expect(server.callsTo('PATCH /api/careers/skills/11/progress')[0]?.body).toEqual({ practiced: true }));
    expect(await screen.findByLabelText('Thực thi kiểm thử, Sẵn sàng học')).toBeTruthy();
    expect(onRewards).toHaveBeenCalled();
  });
});
