import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildShelves, filterShelves } from '../src/screens/learning/KnowledgeLibrary';
import { NotebookScreen } from '../src/screens/learning/ArchiveScreens';
import { layoutMap, finished } from '../src/screens/career/JourneyMap';
import { MoneyGardenScreen } from '../src/screens/money/MoneyGardenScreen';
import { CareerJourneyScreen } from '../src/screens/career/CareerJourneyScreen';
import { targetAt } from '../src/screens/work/WorkDesk';
import { WorkQuestScreen } from '../src/screens/work/WorkQuestScreen';
import { TeamQuestDetailScreen, TeamQuestsScreen } from '../src/screens/together/TeamQuestsScreen';
import { NavContext, RefreshContext } from '../src/screens/together/navigation';
import { FriendsSpace } from '../src/screens/life/FriendsSpace';
import { STREET_ART, STREET_DOORS, STREET_GATES } from '../src/screens/life/streetArt';
import { Triumph } from '../src/world/diorama';
import { PlantArt } from '../src/screens/money/GardenArt';
import { USER, mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
beforeEach(async () => { await AsyncStorage.clear(); });

// ---------------------------------------------------------------------------- Sổ tay kiến thức
const entry = (key: string, subject: string, over: Record<string, unknown> = {}) => ({
  key, title: `Bài ${key}`, description: null, grade: 11, subject, subject_name: subject === 'math' ? 'Toán' : 'Văn', chapter: 'Chương 1',
  objectives: ['Biết đạo hàm'], summary: ['Đạo hàm là tốc độ thay đổi'], examples: [{ title: 'Ví dụ', lines: ['(x²)′ = 2x'] }], content_version: '1', ...over,
});
const note = (id: number, subject: string, lessonKey: string | null, over: Record<string, unknown> = {}) => ({
  id, academic_year: 2026, academic_year_label: '2026–2027', grade: 'grade11', grade_label: 'Lớp 11', subject, subject_name: subject === 'math' ? 'Toán' : 'Văn',
  lesson_key: lessonKey, lesson_title: lessonKey ? `Bài ${lessonKey}` : null, title: `Ghi chú ${id}`, body: 'Nội dung', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
});

describe('Sổ tay kiến thức: the library', () => {
  it('puts each lesson and each loose note on the shelf of its subject, a lesson\'s notes inside its own book', () => {
    const shelves = buildShelves([entry('a', 'math'), entry('b', 'lit')] as any, [note(1, 'math', 'a'), note(2, 'math', null), note(3, 'lit', 'gone')] as any);
    expect(shelves.map((s) => s.name)).toEqual(['Toán', 'Văn']);
    const math = shelves[0].books;
    expect(math.map((b) => b.id)).toEqual(['lesson:a', 'notes:math']);
    expect(math[0].pages.map((p) => p.heading)).toEqual(['Bạn đã học gì?', 'Kiến thức tóm tắt', 'Ví dụ', 'Ghi chú 1']);
    expect(math[1].pages.map((p) => p.heading)).toEqual(['Ghi chú 2']);
    // A note on a lesson not on the shelf this year is not lost.
    expect(shelves[1].books.find((b) => b.id === 'notes:lit')?.pages[0].heading).toBe('Ghi chú 3');
  });

  it('searches without accents, by subject and by bookmark, and never loses a shelf for good', () => {
    const shelves = buildShelves([entry('a', 'math'), entry('b', 'lit', { summary: ['Dòng sông quê hương'] })] as any, []);
    const titles = (f: any) => filterShelves(shelves, f).flatMap((s) => s.books.map((b) => b.id));
    expect(titles({ query: 'dong song', subject: null, marked: null })).toEqual(['lesson:b']);
    expect(titles({ query: '', subject: 'math', marked: null })).toEqual(['lesson:a']);
    expect(titles({ query: '', subject: null, marked: new Set(['lesson:b']) })).toEqual(['lesson:b']);
    expect(titles({ query: 'không có', subject: null, marked: null })).toEqual([]);
    expect(titles({ query: '', subject: null, marked: null })).toEqual(['lesson:a', 'lesson:b']);
  });

  it('opens a book, turns its pages, keeps a bookmark on this device and sends nothing to the server for it', async () => {
    const server = mockServer({
      'GET /api/education/notebook': { status: 200, body: { academic_year: 2026, academic_year_label: '2026–2027', grade_label: 'Lớp 11', entries: [entry('a', 'math')] } },
      'GET /api/education/notes?academic_year=2026': { status: 200, body: { items: [note(1, 'math', 'a')], total: 1 } },
    });
    const onOpen = jest.fn();
    wrap(<NotebookScreen onBack={() => {}} onOpenLesson={onOpen} subjects={[{ code: 'math', name: 'Toán' }]} userId={5} pet={null} />);
    fireEvent.press(await screen.findByLabelText('Mở sách Bài a', {}, { timeout: 5000 }));
    expect(screen.getByLabelText('Trang 1 trên 4')).toBeTruthy();
    expect(screen.getByLabelText('Trang trước').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText('Trang sau'));
    expect(await screen.findByLabelText('Trang 2 trên 4')).toBeTruthy();
    expect(screen.getByText('Đạo hàm là tốc độ thay đổi')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Đánh dấu sách'));
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('mirabi.library.bookmarks:5')) ?? '[]')).toEqual(['lesson:a']));
    expect(server.calls.filter((c: any) => c.method !== 'GET')).toEqual([]);
    fireEvent.press(screen.getAllByLabelText('Đóng sách')[0]);
    await waitFor(() => expect(screen.queryByTestId('book-reader')).toBeNull());
    expect(screen.getByLabelText('Mở sách Bài a, đã đánh dấu')).toBeTruthy();
  });

  it('says so when the library is empty, and offers a retry when it can\'t load', async () => {
    mockServer({
      'GET /api/education/notebook': { status: 200, body: { academic_year: 2026, academic_year_label: '2026–2027', grade_label: 'Lớp 11', entries: [] } },
      'GET /api/education/notes?academic_year=2026': { status: 200, body: { items: [], total: 0 } },
    });
    const first = wrap(<NotebookScreen onBack={() => {}} onOpenLesson={() => {}} subjects={[]} userId={5} />);
    expect(await screen.findByText('Học một bài để kiến thức của bài xuất hiện trong sổ tay nhé.', {}, { timeout: 5000 })).toBeTruthy();
    first.unmount();
    mockServer({ 'GET /api/education/notebook': networkDown() });
    wrap(<NotebookScreen onBack={() => {}} onOpenLesson={() => {}} subjects={[]} userId={5} />);
    expect(await screen.findByLabelText('Thử lại', {}, { timeout: 5000 })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- Vườn tài chính
const goal = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'Laptop', target_amount: 20000000, currency: 'VND', target_date: null, plant: 'sakura', status: 'active', saved_amount: 5000000, percent: 25, stage: 2,
  stage_name: 'Cây non', milestones: [{ percent: 25, reached: true }], estimated_date: null, created_at: '2026-01-01T00:00:00Z', ...over,
});

describe('Vườn tài chính: the garden', () => {
  it('shows target, saved and what is still missing', async () => {
    mockServer({ 'GET /api/finance/goals': { status: 200, body: [goal()] }, 'GET /api/finance/transactions?goal_id=1&limit=20': { status: 200, body: { items: [], next_before: null } } });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    expect(await screen.findByText('Còn thiếu', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('15.000.000 ₫')).toBeTruthy();
    expect(screen.getAllByText('20.000.000 ₫').length).toBeGreaterThan(0);
  });

  it('never moves money for a tap on a plant or on the watering can', async () => {
    const server = mockServer({ 'GET /api/finance/goals': { status: 200, body: [goal()] }, 'GET /api/finance/transactions?goal_id=1&limit=20': { status: 200, body: { items: [], next_before: null } } });
    wrap(<MoneyGardenScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Laptop: Cây non, 25%', {}, { timeout: 5000 }));
    fireEvent.press(screen.getByLabelText('Tưới cây cho vui'));
    expect(await screen.findByText(/Cây chỉ lớn khi bạn ghi một khoản tiết kiệm/)).toBeTruthy();
    expect(server.calls.filter((c: any) => c.method !== 'GET')).toEqual([]);
    expect(screen.getByLabelText('Đã tiết kiệm 5.000.000 ₫ trên 20.000.000 ₫')).toBeTruthy();
  });

  it.each(['sakura', 'oak', 'sunflower', 'bamboo', 'maple', 'lotus'])('draws every stage of %s', (plant) => {
    for (let stage = 0; stage <= 5; stage++) expect(() => render(<PlantArt plant={plant as any} stage={stage} size={100} />)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------- Hành trình sự nghiệp
const skill = (id: number, status: string) => ({ id, code: `s${id}`, group: 'A', name: `Kỹ năng ${id}`, description: '', goal: '', level: 1, prerequisites: [], activities: [],
  has_assessment: false, assessment: [], unlocked: status !== 'locked', status, progress_percent: 0 });

describe('Hành trình sự nghiệp: the map', () => {
  const groups = [{ name: 'A', skills: [skill(1, 'practiced'), skill(2, 'available'), skill(3, 'locked')] }, { name: 'B', skills: [skill(4, 'locked')] }] as any;
  it('places every milestone once, the same way every time, inside the screen', () => {
    const one = layoutMap(groups, 360);
    expect(one).toEqual(layoutMap(groups, 360));
    expect(one.nodes.map((n) => n.skill.id)).toEqual([1, 2, 3, 4]);
    one.nodes.forEach((n) => { expect(n.x).toBeGreaterThan(40); expect(n.x).toBeLessThan(320); });
    expect(one.regions.map((r) => r.name)).toEqual(['A', 'B']);
    // Regions follow each other with no gap.
    expect(one.regions[1].top).toBe(one.regions[0].top + one.regions[0].height);
  });
  it('colours the road only as far as is really done, plus the milestone now open', () => {
    const map = layoutMap(groups, 360);
    const curves = (d: string) => (d.match(/C/g) ?? []).length;
    expect(curves(map.road)).toBe(3);
    expect(curves(map.done)).toBe(1);
    const none = layoutMap([{ name: 'A', skills: [skill(1, 'locked'), skill(2, 'locked')] }] as any, 360);
    expect(none.done).toBe('');
    expect(finished('assessed' as any)).toBe(true);
    expect(finished('in_progress' as any)).toBe(false);
  });
  it('looks back over what is done, and what is not done is not listed', async () => {
    const detail = { id: 1, code: 'qa', name: 'QA', description: '', icon: '🔍', skills_total: 3, skills_done: 1, selected: true, active: true, current_goal: null, groups, milestones: [{ code: 'm', title: 'Huy hiệu A', earned: false }], new_badges: [] };
    mockServer({ 'GET /api/careers': { status: 200, body: [detail] }, 'GET /api/careers/qa': { status: 200, body: detail } });
    wrap(<CareerJourneyScreen user={USER as any} onBack={() => {}} />);
    expect(await screen.findByLabelText('Kỹ năng 2, Sẵn sàng học', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Huy hiệu Huy hiệu A')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Nhìn lại hành trình'));
    expect(await screen.findByLabelText('Xem lại Kỹ năng 1, Đã thực hành')).toBeTruthy();
    expect(screen.queryByLabelText(/^Xem lại Kỹ năng 2/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------- Nhiệm vụ công việc
const TZ = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const DASHBOARD = `GET /api/work/dashboard?tz=${TZ}`;
const task = (over: Record<string, unknown> = {}) => ({ id: 11, occurrence_id: '11:2026-11-01', title: 'Viết báo cáo', category: 'work', scheduled_date: '2026-11-01', repeat: 'none', project_id: null, priority: 'high',
  due_at: null, estimated_minutes: 45, exp: 8, steps: [], completed: false, ...over });
const dashboard = (over: Record<string, unknown> = {}) => ({ today: '2026-11-01', tasks_today: [task()], overdue: [], upcoming: [], projects: [], chests: [], pet_line: 'Cố lên!',
  summary: { focus_minutes_today: 0, exp_remaining_today: 50 }, walk: { status: 'locked', goals_done: 0, goals_total: 0 }, ...over });
const timer = { running: false, phase: 'focus', seconds: 1500, activeCycle: null, toggle: jest.fn(), reset: jest.fn() } as any;

describe('Nhiệm vụ công việc: the desk', () => {
  it('finds the drop target under a finger, a little past its edge, and nothing elsewhere', () => {
    const zones = { done: { x: 300, y: 600, width: 80, height: 58 }, urgent: { x: 200, y: 600, width: 80, height: 58 } };
    expect(targetAt(zones, 340, 630)).toBe('done');
    expect(targetAt(zones, 295, 630)).toBe('done');
    expect(targetAt(zones, 240, 630)).toBe('urgent');
    expect(targetAt(zones, 340, 300)).toBeNull();
    expect(targetAt({}, 340, 630)).toBeNull();
  });
  it('rewrites a note with the same call as the app\'s tasks, title and estimate, and keeps its deadline unless changed', async () => {
    const patched: any[] = [];
    mockServer({
      [DASHBOARD]: { status: 200, body: dashboard() },
      'PATCH /api/tasks/11?occurrence_date=2026-11-01': (req: any) => { patched.push(req.body); return { status: 200, body: task({ title: req.body.title }) }; },
    });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Viết báo cáo, ưu tiên Cao', {}, { timeout: 5000 }));
    fireEvent.press(await screen.findByLabelText('Sửa nhiệm vụ'));
    fireEvent.changeText(await screen.findByLabelText('Tên nhiệm vụ'), 'Viết báo cáo quý');
    fireEvent.press(screen.getByLabelText('Lưu thay đổi'));
    await waitFor(() => expect(patched).toEqual([{ title: 'Viết báo cáo quý', estimated_minutes: 45 }]));
  });
  it('shows priority in words on every note, and a late note as late', async () => {
    mockServer({ [DASHBOARD]: { status: 200, body: dashboard({ overdue: [task({ id: 12, occurrence_id: '12:2026-10-30', title: 'Việc trễ', priority: 'urgent', overdue: true })] }) } });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    expect(await screen.findByLabelText('Việc trễ, ưu tiên Khẩn, quá hạn', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('Quá hạn')).toBeTruthy();
    expect(screen.getByText('Khẩn')).toBeTruthy();
    expect(screen.getByText('Cao')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- Cùng bạn tiến bộ
const person = (id: number, name: string, contribution: number | null = 10) => ({ id, user_id: id, display_name: name, avatar_theme: 'aqua', pet: 'fox', pet_name: null, pet_level: 1, public_code: null, contribution, rewarded: false });
const quest = (over: Record<string, unknown> = {}) => ({ id: 1, room_id: 1, room_name: 'Nhóm ôn thi', template_key: 'focus_minutes', title: 'Tập trung 300 phút', description: 'Mô tả', unit: 'minutes', target: 300, progress: 120,
  status: 'active', reward_exp: 15, starts_at: '2026-11-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z', completed_at: null, joined: true, my_contribution: 10, my_reward_exp: 0, members: [person(2, 'Trang'), person(3, 'Minh'), person(4, 'Linh', null)], ...over });
const friend = (id: number, name: string, presence: string) => ({ ...person(id, name), presence, room: null, can_visit: true, accepts_study_invites: true });

function hall(node: React.ReactElement) {
  const nav = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), reset: jest.fn() } as any;
  const view = render(<ToastProvider><ConfirmProvider><NavContext.Provider value={nav}><RefreshContext.Provider value={jest.fn()}>{node}</RefreshContext.Provider></NavContext.Provider></ConfirmProvider></ToastProvider>);
  return { nav, view };
}

describe('Cùng bạn tiến bộ: the common room', () => {
  it('gives a presence dot only to friends who share it, and makes up none for anybody else', async () => {
    mockServer({ 'GET /api/team-quests': { status: 200, body: { items: [quest()] } }, 'GET /api/friends': { status: 200, body: { items: [friend(3, 'Minh', 'online')] } } });
    const { nav } = hall(<TeamQuestsScreen />);
    expect(await screen.findByLabelText('Minh, trực tuyến', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Trang')).toBeTruthy();
    expect(screen.getByLabelText('Linh')).toBeTruthy();
    expect(screen.getByTestId('presence-3-online')).toBeTruthy();
    expect(screen.queryByTestId('presence-2-online')).toBeNull();
    expect(screen.queryByTestId('presence-4-online')).toBeNull();
    fireEvent.press(screen.getByLabelText('Tập trung 300 phút, 120 trên 300 phút, Đang diễn ra'));
    expect(nav.push).toHaveBeenCalledWith({ name: 'quest', questId: 1 });
  });
  it('keeps a member\'s hidden contribution hidden, and shows real numbers for the others', async () => {
    mockServer({ 'GET /api/team-quests/1': { status: 200, body: quest() }, 'GET /api/friends': { status: 200, body: { items: [] } } });
    hall(<TeamQuestDetailScreen questId={1} />);
    expect(await screen.findByLabelText('Linh, Ẩn', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Trang, 10 phút')).toBeTruthy();
    expect(screen.getByText('120/300 phút')).toBeTruthy();
    expect(screen.getByText(/Bạn đã góp 10 phút/)).toBeTruthy();
  });
  it('has an honest empty room, a way to the study rooms, and a retry when it can\'t load', async () => {
    mockServer({ 'GET /api/team-quests': { status: 200, body: { items: [] } }, 'GET /api/friends': { status: 200, body: { items: [] } } });
    const { nav, view } = hall(<TeamQuestsScreen />);
    expect(await screen.findByText('Chưa có nhiệm vụ nhóm', {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Mở phòng học'));
    expect(nav.push).toHaveBeenCalledWith({ name: 'home' });
    view.unmount();
    mockServer({ 'GET /api/team-quests': networkDown(), 'GET /api/friends': networkDown() });
    hall(<TeamQuestsScreen />);
    expect(await screen.findByLabelText('Thử lại', {}, { timeout: 5000 })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- what they share
describe('The diorama kit', () => {
  it('plays an achievement only for a new number, and still shows it with reduced motion', async () => {
    const view = render(<Triumph play={0} />);
    expect(screen.queryByTestId('triumph', { includeHiddenElements: true })).toBeNull();
    await act(async () => { view.rerender(<Triumph play={1} />); });
    expect(screen.getByTestId('triumph', { includeHiddenElements: true })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------- Bạn bè: the street
describe('Bạn bè: the street of houses', () => {
  const friend = (id: number, name: string, canVisit = true) => ({ id, display_name: name, avatar_theme: 'aqua', pet: 'fire', pet_name: 'Lửa', pet_level: 1, public_code: null, presence: 'offline', room: null, can_visit: canVisit, accepts_study_invites: true });
  const street = (over: Partial<React.ComponentProps<typeof FriendsSpace>> = {}) => wrap(
    <FriendsSpace top={0} initialTab="friends" onVisit={jest.fn()} onVisitGarden={jest.fn()} onOpenStudyRoom={jest.fn()} onRequestsChanged={jest.fn()} onOpenFeed={jest.fn()} {...over} />,
  );

  it('goes straight in from a house, and a friend who has visits off stays shut, with a lock to say so', async () => {
    mockServer({ 'GET /api/friends': { status: 200, body: { items: [friend(7, 'Minh'), friend(8, 'Lan', false)] } } });
    const onVisit = jest.fn();
    street({ onVisit });
    const open = await screen.findByTestId('friend-house-7');
    expect(screen.queryByTestId('friend-house-closed-7')).toBeNull();
    fireEvent.press(open);
    expect(onVisit).toHaveBeenCalledWith(7);
    onVisit.mockClear();
    expect(screen.getByTestId('friend-house-closed-8')).toBeTruthy();
    fireEvent.press(screen.getByTestId('friend-house-8'));
    expect(onVisit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nhà của Lan, đang tắt ghé thăm')).toBeTruthy();
  });

  it('has a picture and a place inside the street for each of the six plots, by day and at night', () => {
    expect(STREET_DOORS).toHaveLength(6);
    expect(STREET_GATES).toHaveLength(6);
    for (const light of ['day', 'night'] as const) {
      expect(STREET_ART[light].houses).toHaveLength(6);
      expect(STREET_ART[light].boxes).toHaveLength(6);
      for (const [left, top, width, height] of STREET_ART[light].boxes) {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left + width).toBeLessThanOrEqual(1.001);
        expect(top + height).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('shows at most six houses, and says so when the street is empty', async () => {
    mockServer({ 'GET /api/friends': { status: 200, body: { items: Array.from({ length: 8 }, (_, i) => friend(i + 1, `Bạn ${i + 1}`)) } } });
    const crowded = street();
    await screen.findByTestId('friend-house-6');
    expect(screen.queryByTestId('friend-house-7')).toBeNull();
    crowded.unmount();
    mockServer({ 'GET /api/friends': { status: 200, body: { items: [] } } });
    street();
    expect(await screen.findByText(/Con phố còn vắng/)).toBeTruthy();
  });
});
