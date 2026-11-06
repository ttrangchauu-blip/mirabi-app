import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Badge } from '../src/achievements/Badge';
import type { Achievement, AchievementsOverview, AchievementTier } from '../src/achievements/types';
import { useAchievementNotices, NOTICE_POLL_MS } from '../src/achievements/useAchievementNotices';
import { AchievementsScreen, dayOf } from '../src/screens/achievements/AchievementsScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

// The first render of a file is slow on a busy machine; later finds use the default.
const LOADED = { timeout: 8000 };
const wrap = (node: React.ReactNode) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);

const MATERIALS = ['bronze', 'silver', 'gold', 'diamond', 'legendary'] as const;
const NAMES = ['Đồng', 'Bạc', 'Vàng', 'Kim cương', 'Huyền thoại'];
const COINS = [10, 20, 40, 80, 150];

function tiers(thresholds: number[], titles: string[], reached: number, extra: Partial<AchievementTier>[] = []): AchievementTier[] {
  return thresholds.map((threshold, i) => ({
    rank: i + 1, threshold, title: titles[i], goal: `Hoàn thành ${threshold} nhiệm vụ`, name: NAMES[i], material: MATERIALS[i],
    reward_coins: COINS[i], unlocked: i < reached, unlock_id: i < reached ? 100 + i : null,
    unlocked_at: i < reached ? '2026-11-05T03:00:00+00:00' : null, claimed_at: null, claimable: i < reached, backfilled: false, new: false,
    ...(extra[i] ?? {}),
  }));
}

function achievement(over: Partial<Achievement> & Pick<Achievement, 'id' | 'tiers'>): Achievement {
  const reached = over.tiers.filter((t) => t.unlocked);
  const next = over.tiers.find((t) => !t.unlocked) ?? null;
  const current = reached[reached.length - 1];
  return {
    group: 'tasks', icon: 'checkbox', unit: 'nhiệm vụ', description: 'Nhiệm vụ đã hoàn thành.', milestone: false, coins: true, progress: 0,
    title: (current ?? over.tiers[0]).title, tier: current?.rank ?? 0, material: current?.material ?? null, tier_name: current?.name ?? null,
    next: next && { rank: next.rank, threshold: next.threshold, title: next.title, goal: next.goal, name: next.name, material: next.material, reward_coins: next.reward_coins },
    completed: !next, claimable: over.tiers.filter((t) => t.claimable).length, new: over.tiers.some((t) => t.new), ...over,
  };
}

const TASKS = achievement({ id: 'tasks_done', progress: 4, tiers: tiers([1, 10, 50, 200, 500],
  ['Nhiệm vụ đầu tiên', 'Người hành động', 'Chăm chỉ mỗi ngày', 'Kỷ luật thép', 'Bậc thầy kế hoạch'], 1, [{ new: true }]) });
const STAGES = achievement({ id: 'stages', group: 'games', icon: 'game-controller', unit: 'màn', progress: 0, tiers: tiers([1, 10, 50, 150, 500],
  ['Màn chơi đầu tiên', 'Chiến binh nhỏ', 'Tay chơi chăm chỉ', 'Cao thủ', 'Nhà vô địch'], 0) });
const HATCH = achievement({ id: 'pet_hatched', group: 'pet', icon: 'egg', unit: 'pet', milestone: true, progress: 1,
  tiers: [{ ...tiers([1], ['Chào đời'], 1)[0], rank: 3, name: 'Cột mốc', material: 'gold', reward_coins: 20, claimable: false, claimed_at: '2026-11-04T03:00:00+00:00', backfilled: true }] });

function overview(over: Partial<AchievementsOverview> = {}): AchievementsOverview {
  return {
    summary: { unlocked: 2, total: 11, percent: 18, claimable: 1, claimable_coins: 10 },
    groups: [{ id: 'games', name: 'Trò chơi học tập', icon: 'game-controller', total: 5, unlocked: 0 },
      { id: 'pet', name: 'Pet', icon: 'paw', total: 1, unlocked: 1 }, { id: 'tasks', name: 'Nhiệm vụ', icon: 'checkmark-done', total: 5, unlocked: 1 }],
    tiers: MATERIALS.map((material, i) => ({ rank: i + 1, name: NAMES[i], material })),
    achievements: [STAGES, HATCH, TASKS], near: ['tasks_done'],
    recent: [{ id: 100, achievement: 'tasks_done', tier: 1, title: 'Nhiệm vụ đầu tiên', name: 'Đồng', material: 'bronze', icon: 'checkbox', group: 'tasks',
      reward_coins: 10, unlocked_at: '2026-11-05T03:00:00+00:00', claimed_at: null, claimable: true, backfilled: false, new: true }],
    daily_tasks_counted: 10, coins: 100, ...over,
  };
}

describe('Thành tựu', () => {
  it('shows the totals, the newest badges, the closest ones and every group, all from the backend', async () => {
    const server = mockServer({ 'GET /api/achievements': { status: 200, body: overview() } });
    wrap(<AchievementsScreen onBack={() => {}} />);
    expect((await screen.findByTestId('achievements-unlocked', {}, LOADED))).toHaveTextContent('2 / 11');
    expect(screen.getByText('cấp huy hiệu · 18% hoàn thành')).toBeTruthy();
    expect(screen.getByText('Mới mở khóa')).toBeTruthy();
    expect(screen.getByText('Sắp đạt được')).toBeTruthy();
    for (const name of ['Trò chơi học tập', 'Pet', 'Nhiệm vụ']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    // The tiers reached were on screen as "Mới" once: they are acknowledged so no notice repeats them.
    await waitFor(() => expect(server.callsTo('POST /api/achievements/seen')).toHaveLength(1));
    expect(server.callsTo('POST /api/achievements/seen')[0].body).toEqual({ ids: [100] });
    // The app never sends a number of its own: reading is all it does besides claiming and acknowledging.
    expect(server.calls.filter((c) => c.method !== 'GET').every((c) => c.path === '/api/achievements/seen')).toBe(true);
  });

  it('filters by group and switches to the badge collection; there is no locked/unlocked switch', async () => {
    mockServer({ 'GET /api/achievements': { status: 200, body: overview() } });
    wrap(<AchievementsScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId('fold-all', {}, LOADED));  // every group unfolded
    await screen.findByTestId('achievement-stages');
    for (const name of ['Tất cả', 'Đã mở', 'Chưa mở']) expect(screen.queryByRole('tab', { name })).toBeNull();
    expect(screen.getByTestId('achievement-pet_hatched')).toBeTruthy();  // reached and not reached, side by side
    fireEvent.press(screen.getByRole('checkbox', { name: 'Pet 1/1' }));
    expect(screen.queryByTestId('achievement-stages')).toBeNull();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Tất cả' }));
    fireEvent.press(screen.getByRole('tab', { name: 'Huy hiệu' }));
    expect(screen.getByTestId('badge-stages')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Màn chơi đầu tiên, chưa mở khóa' })).toBeTruthy();
  });

  it('the detail shows progress, every tier and its reward, and a tier is claimed once', async () => {
    let claimed = false;
    const server = mockServer({
      'GET /api/achievements': () => ({ status: 200, body: claimed ? overview({ summary: { unlocked: 2, total: 11, percent: 18, claimable: 0, claimable_coins: 0 },
        achievements: [STAGES, HATCH, { ...TASKS, claimable: 0, tiers: TASKS.tiers.map((t) => (t.rank === 1 ? { ...t, claimable: false, claimed_at: '2026-11-06T03:00:00+00:00' } : t)) }] }) : overview() }),
      'POST /api/achievements/unlocks/100/claim': () => { claimed = true; return { status: 200, body: { paid: true, already_claimed: false, reward_coins: 10, coins: 110, unlock: {} } }; },
    });
    const onCoins = jest.fn();
    wrap(<AchievementsScreen onBack={() => {}} onCoins={onCoins} />);
    fireEvent.press((await screen.findAllByTestId('achievement-tasks_done', {}, LOADED))[0]);
    const sheet = await screen.findByTestId('achievement-detail');
    expect(within(sheet).getByText('Cấp hiện tại: Đồng')).toBeTruthy();
    expect(within(sheet).getByText('4 / 10 nhiệm vụ')).toBeTruthy();
    expect(within(sheet).getByText('Tiếp theo: Bạc · Hoàn thành 10 nhiệm vụ · +20 xu')).toBeTruthy();
    expect(within(sheet).getByText(`Đạt ngày ${dayOf('2026-11-05T03:00:00+00:00')}`)).toBeTruthy();
    expect(within(sheet).getByText('Phần thưởng: 150 xu')).toBeTruthy();
    fireEvent.press(within(sheet).getByTestId('claim-tasks_done-1'));
    await waitFor(() => expect(onCoins).toHaveBeenCalledWith(110));
    expect(await screen.findByText('+10 xu cho “Nhiệm vụ đầu tiên”')).toBeTruthy();
    expect(await within(screen.getByTestId('achievement-detail')).findByText('Đã nhận')).toBeTruthy();
    expect(screen.queryByTestId('claim-tasks_done-1')).toBeNull();
    expect(server.callsTo('POST /api/achievements/unlocks/100/claim')).toHaveLength(1);
  });

  it('groups start folded; a group and then an achievement unfold in place, with the tiers and their rewards', async () => {
    const server = mockServer({ 'GET /api/achievements': { status: 200, body: overview() },
      'POST /api/achievements/unlocks/100/claim': { status: 200, body: { paid: true, already_claimed: false, reward_coins: 10, coins: 110, unlock: {} } } });
    wrap(<AchievementsScreen onBack={() => {}} />);
    const header = await screen.findByTestId('group-tasks', {}, LOADED);
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.getByText('Chạm vào một nhóm để xem')).toBeTruthy();
    // Folded: only "Sắp đạt được" shows this achievement, as a row that opens the sheet.
    expect(screen.getAllByTestId('achievement-tasks_done')).toHaveLength(1);
    expect(within(header).getByText('1')).toBeTruthy();  // one reward waiting in the group
    fireEvent.press(header);
    expect(screen.getByTestId('group-tasks').props.accessibilityState).toEqual({ expanded: true });
    const rows = screen.getAllByTestId('achievement-tasks_done');
    expect(rows).toHaveLength(2);
    expect(screen.queryByTestId('achievement-tasks_done-tiers')).toBeNull();
    fireEvent.press(rows[1]);
    const tiers = screen.getByTestId('achievement-tasks_done-tiers');
    expect(within(tiers).getByText('Nhiệm vụ đã hoàn thành.')).toBeTruthy();
    expect(within(tiers).getAllByTestId(/^tier-tasks_done-/)).toHaveLength(5);
    expect(within(tiers).getByText('Phần thưởng: 150 xu')).toBeTruthy();
    expect(screen.queryByTestId('achievement-detail')).toBeNull();  // in place, not in a sheet
    fireEvent.press(within(tiers).getByTestId('claim-tasks_done-1'));
    await waitFor(() => expect(server.callsTo('POST /api/achievements/unlocks/100/claim')).toHaveLength(1));
    fireEvent.press(screen.getAllByTestId('achievement-tasks_done')[1]);
    expect(screen.queryByTestId('achievement-tasks_done-tiers')).toBeNull();
    expect(screen.getByText('1 nhóm đang mở')).toBeTruthy();
    fireEvent.press(screen.getByText('Thu gọn tất cả'));
    expect(screen.queryByTestId('achievement-tasks_done-tiers')).toBeNull();
    expect(screen.getAllByTestId('achievement-tasks_done')).toHaveLength(1);
    fireEvent.press(screen.getByText('Mở tất cả'));
    expect(screen.getByTestId('achievement-stages')).toBeTruthy();
    expect(screen.getByTestId('achievement-pet_hatched')).toBeTruthy();
  });

  it('a milestone shows as one gold step, with the date it was found in older history', async () => {
    mockServer({ 'GET /api/achievements': { status: 200, body: overview() } });
    wrap(<AchievementsScreen onBack={() => {}} />);
    fireEvent.press(await screen.findByTestId('group-pet', {}, LOADED));
    fireEvent.press(screen.getByTestId('achievement-pet_hatched'));
    fireEvent.press(within(screen.getByTestId('achievement-pet_hatched-tiers')).getByRole('button', { name: 'Xem huy hiệu lớn' }));
    const sheet = await screen.findByTestId('achievement-detail');
    expect(within(sheet).getByText('Cột mốc')).toBeTruthy();
    expect(within(sheet).getByText('Bạn đã đạt cấp cao nhất của thành tựu này.')).toBeTruthy();
    expect(within(sheet).getByText(/ghi nhận từ hành trình trước/)).toBeTruthy();
    expect(within(sheet).getByText('Đã nhận')).toBeTruthy();
  });

  it('claims every waiting tier at once', async () => {
    const server = mockServer({ 'GET /api/achievements': { status: 200, body: overview() },
      'POST /api/achievements/claim-all': { status: 200, body: { paid: 1, reward_coins: 10, coins: 110 } } });
    const onCoins = jest.fn();
    wrap(<AchievementsScreen onBack={() => {}} onCoins={onCoins} />);
    fireEvent.press(await screen.findByTestId('claim-all', {}, LOADED));
    await waitFor(() => expect(onCoins).toHaveBeenCalledWith(110));
    expect(await screen.findByText('+10 xu từ 1 thành tựu')).toBeTruthy();
    expect(server.callsTo('POST /api/achievements/claim-all')).toHaveLength(1);
  });

  it('offline: a retry, not an empty or invented screen', async () => {
    let up = false;
    mockServer({ 'GET /api/achievements': () => (up ? { status: 200, body: overview() } : new TypeError('Network request failed')) });
    wrap(<AchievementsScreen onBack={() => {}} />);
    expect(await screen.findByText('Chưa kết nối được', {}, LOADED)).toBeTruthy();
    expect(screen.queryByTestId('achievements-unlocked')).toBeNull();
    up = true;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('achievements-unlocked')).toBeTruthy();
  });

  it('draws every material, and a badge not reached yet is locked', () => {
    render(<>{MATERIALS.map((m) => <Badge key={m} icon="star" material={m} label={m} />)}<Badge icon="star" material={null} locked label="locked" /></>);
    for (const m of MATERIALS) expect(screen.getByLabelText(m)).toBeTruthy();
    expect(screen.getByLabelText('locked')).toBeTruthy();
  });
});

describe('unlock notices', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function Notices({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
    useAchievementNotices(enabled, onOpen);
    return null;
  }

  it('announces a new tier once, then acknowledges every unseen id', async () => {
    let unseen = true;
    const server = mockServer({
      'GET /api/achievements/unseen': () => ({ status: 200, body: unseen ? { count: 2, ids: [7, 8], unlocks: [overview().recent[0]] } : { count: 0, ids: [], unlocks: [] } }),
      'POST /api/achievements/seen': () => { unseen = false; return { status: 200, body: { seen: 2 } }; },
    });
    const onOpen = jest.fn();
    wrap(<Notices enabled onOpen={onOpen} />);
    await act(async () => { jest.advanceTimersByTime(4100); });
    expect(await screen.findByText('🏅 Bạn vừa mở khóa 2 thành tựu mới')).toBeTruthy();
    await waitFor(() => expect(server.callsTo('POST /api/achievements/seen')).toHaveLength(1));
    expect(server.callsTo('POST /api/achievements/seen')[0].body).toEqual({ ids: [7, 8] });
    fireEvent.press(screen.getByText('Xem'));
    expect(onOpen).toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(NOTICE_POLL_MS + 100); });
    expect(server.callsTo('GET /api/achievements/unseen').length).toBeGreaterThanOrEqual(2);
    expect(server.callsTo('POST /api/achievements/seen')).toHaveLength(1);  // nothing new: nothing acknowledged again
  });

  it('stays quiet while disabled (focus mode, or the achievements screen open), so nothing is acknowledged unseen', async () => {
    const server = mockServer({ 'GET /api/achievements/unseen': { status: 200, body: { count: 1, ids: [7], unlocks: [overview().recent[0]] } } });
    wrap(<Notices enabled={false} onOpen={() => {}} />);
    await act(async () => { jest.advanceTimersByTime(NOTICE_POLL_MS * 2); });
    expect(server.callsTo('GET /api/achievements/unseen')).toHaveLength(0);
    expect(server.callsTo('POST /api/achievements/seen')).toHaveLength(0);
  });
});
