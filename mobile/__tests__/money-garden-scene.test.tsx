import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MoneyGardenScreen } from '../src/screens/money/MoneyGardenScreen';
import { gardenLayout, landFor, petSpot } from '../src/screens/money/GardenScene';
import { mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

const MILESTONES = (percent: number) => [25, 50, 75, 100].map((p) => ({ percent: p, reached: percent >= p }));
const goal = (over: Record<string, any> = {}) => {
  const percent = over.percent ?? 25;
  return { id: 1, name: 'Laptop', target_amount: 20000000, currency: 'VND', target_date: null, plant: 'sakura', status: 'active', saved_amount: 5000000, percent, stage: 2, stage_name: 'Cây non',
    milestones: MILESTONES(percent), estimated_date: null, created_at: '2026-01-01T00:00:00Z', ...over };
};
const HISTORY = (id = 1) => `GET /api/finance/transactions?goal_id=${id}&limit=20`;
const EMPTY = { status: 200, body: { items: [], next_before: null } };
const garden = (goals: any[], routes: Record<string, any> = {}) => mockServer({ 'GET /api/finance/goals': { status: 200, body: goals }, ...Object.fromEntries(goals.map((g) => [HISTORY(g.id), EMPTY])), ...routes });
const open = () => wrap(<MoneyGardenScreen onBack={() => {}} />);

describe('Vườn tài chính: what the garden shows', () => {
  it('writes the real sum of the goals on the wooden board, never a figure of its own', async () => {
    garden([goal(), goal({ id: 2, name: 'Du lịch', saved_amount: 1234567, percent: 12, stage: 1, stage_name: 'Mầm cây' })]);
    open();
    expect(await screen.findByLabelText('Tổng tiết kiệm 6.234.567 ₫', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('has an empty garden with a plot to sow, and a board that says zero', async () => {
    const server = garden([]);
    open();
    expect(await screen.findByLabelText('Tổng tiết kiệm 0 ₫', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Gieo mục tiêu mới')).toBeTruthy();
    expect(screen.queryByTestId('goal-panel')).toBeNull();
    expect(server.calls.filter((c: any) => c.method !== 'GET')).toEqual([]);
  });

  it.each([
    [0, 0, 0, 'Hạt giống', 20000000],
    [5000000, 25, 2, 'Cây non', 15000000],
    [10000000, 50, 3, 'Cây phát triển', 10000000],
    [15000000, 75, 4, 'Cây trưởng thành', 5000000],
    [20000000, 100, 5, 'Cây nở hoa', 0],
  ])('draws the server\'s stage for %s saved', async (saved, percent, stage, stageName, missing) => {
    garden([goal({ saved_amount: saved, percent, stage, stage_name: stageName })]);
    open();
    expect(await screen.findByTestId(`plant-sakura-${stage}`, { includeHiddenElements: true }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText(`Laptop: ${stageName}, ${percent}%`)).toBeTruthy();
    const card = within(screen.getByTestId('goal-panel'));
    expect(card.getAllByText(`${String(missing).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`).length).toBeGreaterThan(0);
  });

  it('keeps the real amount beyond the target, with progress held at 100% and nothing missing', async () => {
    garden([goal({ target_amount: 550000, saved_amount: 11110000, percent: 100, stage: 5, stage_name: 'Cây nở hoa' })]);
    open();
    expect(await screen.findByLabelText('Đã tiết kiệm 11.110.000 ₫ trên 550.000 ₫', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Laptop: Cây nở hoa, 100%')).toBeTruthy();
    expect(screen.getByLabelText('Tổng tiết kiệm 11.110.000 ₫')).toBeTruthy();
    expect(within(screen.getByTestId('goal-panel')).getByText('0 ₫')).toBeTruthy();
  });

  it('shows the picked goal\'s numbers on the card when another plant is picked', async () => {
    garden([goal(), goal({ id: 2, name: 'Du lịch', target_amount: 8000000, saved_amount: 2000000, plant: 'maple' })]);
    open();
    expect(await screen.findByLabelText('Đã tiết kiệm 5.000.000 ₫ trên 20.000.000 ₫', {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Du lịch: Cây non, 25%'));
    expect(await screen.findByLabelText('Đã tiết kiệm 2.000.000 ₫ trên 8.000.000 ₫')).toBeTruthy();
    expect(screen.getByLabelText('Du lịch: Cây non, 25%').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Laptop: Cây non, 25%').props.accessibilityState.selected).toBe(false);
  });

  it('has a plant for each of many goals: the limit is the server\'s, not the picture\'s', async () => {
    const many = Array.from({ length: 12 }, (_, i) => goal({ id: i + 1, name: `Mục tiêu ${i + 1}` }));
    garden(many);
    open();
    expect(await screen.findByLabelText('Mục tiêu 12: Cây non, 25%', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText('Gieo mục tiêu mới')).toBeTruthy();
  });

  it('explains itself on request, without moving anything', async () => {
    const server = garden([goal()]);
    open();
    fireEvent.press(await screen.findByLabelText('Trợ giúp', {}, { timeout: 5000 }));
    expect(await screen.findByText('Vườn tài chính hoạt động thế nào?')).toBeTruthy();
    expect(server.calls.filter((c: any) => c.method !== 'GET')).toEqual([]);
  });
});

describe('Vườn tài chính: money', () => {
  const save = async (amount: string) => {
    fireEvent.press(await screen.findByLabelText('Gửi tiết kiệm', {}, { timeout: 5000 }));
    fireEvent.changeText(await screen.findByLabelText('Số tiền'), amount);
    const send = screen.getAllByLabelText('Gửi tiết kiệm');
    fireEvent.press(send[send.length - 1]);
  };

  it('celebrates a new milestone only after the server has saved it', async () => {
    let answer: (v: any) => void = () => {};
    const server = garden([goal()], { 'POST /api/finance/transactions': () => new Promise((resolve) => { answer = resolve; }) });
    open();
    await save('5000000');
    await waitFor(() => expect(server.callsTo('POST /api/finance/transactions')).toHaveLength(1));
    // Not yet saved: the old numbers, and nothing plays.
    expect(screen.getByLabelText('Laptop: Cây non, 25%')).toBeTruthy();
    expect(screen.queryByTestId('triumph', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('Đã đạt mốc 50%!')).toBeNull();
    answer({ status: 201, body: { transaction: { id: 9 }, already_recorded: false, goal: goal({ saved_amount: 10000000, percent: 50, stage: 3, stage_name: 'Cây phát triển' }) } });
    expect(await screen.findByLabelText('Laptop: Cây phát triển, 50%')).toBeTruthy();
    expect(await screen.findByText('Đã đạt mốc 50%!')).toBeTruthy();
    expect(screen.getByLabelText('Tổng tiết kiệm 10.000.000 ₫')).toBeTruthy();
  });

  it('changes nothing and plays nothing when saving fails', async () => {
    const server = garden([goal()], { 'POST /api/finance/transactions': () => networkDown() });
    open();
    await save('5000000');
    await waitFor(() => expect(server.callsTo('POST /api/finance/transactions').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByLabelText('Gửi tiết kiệm').pop()!.props.accessibilityState?.disabled).toBeFalsy());
    expect(screen.getByLabelText('Laptop: Cây non, 25%')).toBeTruthy();
    expect(screen.getByLabelText('Tổng tiết kiệm 5.000.000 ₫')).toBeTruthy();
    expect(screen.queryByTestId('triumph', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('watering-can', { includeHiddenElements: true })).toBeNull();
  });

  it('sends one request with one reference when the button is pressed twice', async () => {
    let answer: (v: any) => void = () => {};
    const server = garden([goal()], { 'POST /api/finance/transactions': () => new Promise((resolve) => { answer = resolve; }) });
    open();
    await save('1000000');
    const again = screen.getAllByLabelText('Gửi tiết kiệm');
    fireEvent.press(again[again.length - 1]);
    await waitFor(() => expect(server.callsTo('POST /api/finance/transactions').length).toBeGreaterThan(0));
    const refs = new Set(server.callsTo('POST /api/finance/transactions').map((c: any) => c.body.client_ref));
    expect(refs.size).toBe(1);
    answer({ status: 201, body: { transaction: { id: 9 }, already_recorded: false, goal: goal({ saved_amount: 6000000, percent: 30 }) } });
    expect(await screen.findByLabelText('Tổng tiết kiệm 6.000.000 ₫')).toBeTruthy();
  });

  it('edits a goal by sending only what changed, and leaves what was saved alone', async () => {
    const server = garden([goal()], { 'PATCH /api/finance/goals/1': (req: any) => ({ status: 200, body: goal({ target_amount: req.body.target_amount, percent: 50, stage: 3, stage_name: 'Cây phát triển' }) }) });
    open();
    fireEvent.press(await screen.findByLabelText('Chỉnh sửa mục tiêu', {}, { timeout: 5000 }));
    fireEvent.changeText(await screen.findByLabelText('Số tiền mục tiêu'), '10000000');
    fireEvent.press(screen.getByLabelText('Lưu thay đổi'));
    await waitFor(() => expect(server.callsTo('PATCH /api/finance/goals/1')).toHaveLength(1));
    expect(server.callsTo('PATCH /api/finance/goals/1')[0].body).toEqual({ target_amount: 10000000 });
    expect(await screen.findByLabelText('Đã tiết kiệm 5.000.000 ₫ trên 10.000.000 ₫')).toBeTruthy();
    expect(server.callsTo('POST /api/finance/transactions')).toHaveLength(0);
    // A target lowered that far is not a milestone reached by saving.
    expect(screen.queryByTestId('triumph', { includeHiddenElements: true })).toBeNull();
  });

  it('won\'t accept a target of zero, and sends nothing when nothing changed', async () => {
    const server = garden([goal()]);
    open();
    fireEvent.press(await screen.findByLabelText('Chỉnh sửa mục tiêu', {}, { timeout: 5000 }));
    fireEvent.changeText(await screen.findByLabelText('Số tiền mục tiêu'), '0');
    expect(screen.getByLabelText('Lưu thay đổi').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Số tiền mục tiêu'), '20000000');
    fireEvent.press(screen.getByLabelText('Lưu thay đổi'));
    await waitFor(() => expect(screen.queryByLabelText('Lưu thay đổi')).toBeNull());
    expect(server.calls.filter((c: any) => c.method !== 'GET')).toEqual([]);
  });

  it('puts away a goal from the menu, only once it is confirmed', async () => {
    const server = garden([goal()], { 'PATCH /api/finance/goals/1': { status: 200, body: goal({ status: 'archived' }) } });
    open();
    fireEvent.press(await screen.findByLabelText('Thao tác khác', {}, { timeout: 5000 }));
    fireEvent.press(await screen.findByLabelText('Cất mục tiêu'));
    fireEvent.press((await screen.findAllByText('Giữ lại')).pop()!);
    await waitFor(() => expect(screen.queryAllByText('Giữ lại')).toHaveLength(0));
    expect(server.callsTo('PATCH /api/finance/goals/1')).toHaveLength(0);
    fireEvent.press(screen.getByLabelText('Thao tác khác'));
    fireEvent.press(await screen.findByLabelText('Cất mục tiêu'));
    fireEvent.press((await screen.findAllByText('Cất đi')).pop()!);
    await waitFor(() => expect(server.callsTo('PATCH /api/finance/goals/1')).toHaveLength(1));
    expect(server.callsTo('PATCH /api/finance/goals/1')[0].body).toEqual({ status: 'archived' });
  });
});

describe('Vườn tài chính: the card and the pet', () => {
  it('folds the card to leave the garden more room, and unfolds it', async () => {
    garden([goal()]);
    open();
    fireEvent.press(await screen.findByLabelText('Thu gọn thẻ', {}, { timeout: 5000 }));
    expect(screen.queryByLabelText('Đã tiết kiệm 5.000.000 ₫ trên 20.000.000 ₫')).toBeNull();
    // What identifies the goal stays.
    expect(within(screen.getByTestId('goal-panel')).getByText('Laptop')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Mở rộng thẻ'));
    expect(screen.getByLabelText('Đã tiết kiệm 5.000.000 ₫ trên 20.000.000 ₫')).toBeTruthy();
    expect(landFor(824, true)).toBeGreaterThan(landFor(824, false));
    // The garden and the folded card fill the page, so there is nothing to scroll to below the card.
    expect(landFor(824, true, 700)).toBe(700 - 118 - 123);
    expect(landFor(568, true, 460)).toBe(landFor(568, false));
  });

  it('shows the user\'s own pet and no other', async () => {
    garden([goal()]);
    const first = wrap(<MoneyGardenScreen onBack={() => {}} pet={{ id: 'fox', level: 3 }} />);
    expect(await screen.findByTestId('living-pet-idle', { includeHiddenElements: true }, { timeout: 5000 })).toBeTruthy();
    first.unmount();
    garden([goal()]);
    wrap(<MoneyGardenScreen onBack={() => {}} pet={null} />);
    await screen.findByTestId('goal-panel', {}, { timeout: 5000 });
    expect(screen.queryByTestId('living-pet-idle', { includeHiddenElements: true })).toBeNull();
  });
});

describe('Vườn tài chính: the layout', () => {
  // How far a plant's crown reaches to each side of its foot, in the world's units: the widest species in full bloom.
  const CROWN = 1.2;
  it.each([[320, 568], [360, 740], [384, 824], [430, 932], [600, 1000]])('keeps two blooming crowns apart on a screen of %i by %i, folded or not', (width, height) => {
    for (const folded of [false, true]) {
      const l = gardenLayout(width, landFor(height, folded));
      expect(l.world * CROWN + l.world * CROWN * 0.62).toBeLessThanOrEqual(l.slot);
      // The picked plant stands in the very middle of the screen.
      expect(l.centerOf(0)).toBeCloseTo(width / 2);
      // The valley always reaches past the right edge, and the lawn starts above the plants.
      expect(l.valeWide).toBeGreaterThanOrEqual(width);
      expect(l.feet).toBeLessThan(l.scene);
      // The tag under the plant ends above the card, which lies 18 over the garden.
      expect(l.feet + l.world * 0.34 + 52).toBeLessThanOrEqual(l.scene - 18);
    }
  });

  it('stands the pet on the side of the smaller neighbour, and never at a plant\'s foot', () => {
    const l = gardenLayout(384, landFor(824, false));
    const goals = [goal({ id: 1, stage: 5 }), goal({ id: 2, stage: 5 }), goal({ id: 3, stage: 1 })] as any[];
    expect(petSpot(goals, 1, l).x).toBeGreaterThan(l.centerOf(1));
    expect(petSpot([goals[2], goals[0], goals[1]] as any[], 1, l).x).toBeLessThan(l.centerOf(1));
    for (const i of [0, 1, 2]) expect(Math.abs(petSpot(goals, i, l).x - l.centerOf(i))).toBeGreaterThan(l.world);
    expect(petSpot(goals, 0, l).y).toBeLessThan(l.feet);
  });
});
