import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FocusRoom } from '../src/screens/main/FocusRoom';
import { request } from '../src/screens/main/shared';
import { defaultLayout, itemArt, supportOf } from '../src/room/art';

jest.mock('../src/screens/main/shared', () => ({ request: jest.fn(), showError: jest.fn() }));
jest.mock('../src/components/PetArt', () => ({ PetArt: () => null }));
// The drawings themselves are tested in room-art/room-rules; parsing them here would only slow the screen down.
jest.mock('react-native-svg', () => ({ ...jest.requireActual('react-native-svg'), SvgXml: () => null }));

const GROUPS = [{ id: 'surface', label: 'Tường và sàn' }, { id: 'table', label: 'Bàn' }, { id: 'study', label: 'Đồ học tập' }];
const ITEMS = [['wall_mint', 'wall', 'surface', 'Tường sọc bạc hà'], ['wall_sky', 'wall', 'surface', 'Tường xanh biển'],
  ['floor_wood_light', 'floor', 'surface', 'Sàn gỗ sáng'], ['desk', 'item', 'table', 'Bàn học'], ['laptop', 'item', 'study', 'Laptop'],
  ['book_stack', 'item', 'study', 'Chồng sách']]
  .map(([id, kind, group, name]) => ({ id, kind, group, name, source: 'starter', owned: true }));
const data = (version = 1, layout = defaultLayout('focus')) => ({
  room: { name: 'Phòng tập trung', layout, version, updated_at: '2030-01-01T00:00:00+00:00' },
  catalog: { groups: GROUPS, surfaces: [{ id: 'wall', label: 'Giấy dán tường' }, { id: 'floor', label: 'Sàn nhà' }], items: ITEMS, max_items: 32 },
});

// Whole-screen renders are slow when every test file runs in parallel; give them room.
jest.setTimeout(30000);

const show = () => render(<SafeAreaProvider><FocusRoom petId="fox" petName="Aqua" petLevel={1} resting={false} compact userId={1} /></SafeAreaProvider>);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('the focus room shows the saved room and decorates it: add, undo, save', async () => {
  let saved = data();
  (request as jest.Mock).mockImplementation(async (path: string, options?: { method?: string; body?: any }) => {
    if (options?.method === 'PUT') {
      saved = data(2, { wall: options.body.wall_id, floor: options.body.floor_id, items: options.body.items });
      return { room: saved.room };
    }
    return saved;
  });
  show();
  const decorate = await screen.findByRole('button', { name: 'Trang trí' });
  await waitFor(() => expect(decorate.props.accessibilityState).toMatchObject({ disabled: false }));
  expect(screen.getByLabelText('Phòng tập trung, Aqua đang học cùng bạn')).toBeTruthy();
  fireEvent.press(decorate);
  expect(await screen.findByTestId('focus-room-editor')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hoàn tác' }).props.accessibilityState).toMatchObject({ disabled: true });

  fireEvent.press(screen.getByRole('tab', { name: 'Đồ học tập' }));
  fireEvent.press(screen.getByRole('button', { name: 'Laptop, trên bàn, kệ, Trong kho' }));
  expect(screen.getByRole('button', { name: 'Laptop, trên bàn, kệ, đang dùng' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
  expect(screen.getByRole('button', { name: 'Laptop, trên bàn, kệ, Trong kho' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Laptop, trên bàn, kệ, Trong kho' }));
  fireEvent.press(screen.getByRole('tab', { name: 'Tường và sàn' }));
  fireEvent.press(screen.getByRole('radio', { name: /Tường xanh biển/ }));

  fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByTestId('focus-room-editor')).toBeNull(), { timeout: 15000 });
  const put = (request as jest.Mock).mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(put[0]).toBe('/api/focus-room');
  expect(put[1].body).toMatchObject({ version: 1, wall_id: 'wall_sky' });
  const laptop = put[1].body.items.find((p: any) => p.item === 'laptop');
  expect(itemArt('laptop')!.mount).toBe('top');
  expect(supportOf(laptop, put[1].body.items)).not.toBeNull(); // placed on a desk or shelf by itself
});

test('"Hủy" with changes asks first, inside the decorating screen', async () => {
  (request as jest.Mock).mockResolvedValue(data());
  show();
  const decorate = await screen.findByRole('button', { name: 'Trang trí' });
  await waitFor(() => expect(decorate.props.accessibilityState).toMatchObject({ disabled: false }));
  fireEvent.press(decorate);
  fireEvent.press(await screen.findByRole('tab', { name: 'Tường và sàn' }));
  fireEvent.press(screen.getByRole('radio', { name: /Tường xanh biển/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Hủy' }));
  expect(screen.getByText('Bỏ các thay đổi?')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
  await waitFor(() => expect(screen.queryByTestId('focus-room-editor')).toBeNull(), { timeout: 15000 });
  expect((request as jest.Mock).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
});

test('offline, the last saved focus room shows and decorating waits for a connection', async () => {
  (request as jest.Mock).mockResolvedValueOnce(data(3));
  const first = show();
  await waitFor(async () => expect(await AsyncStorage.getItem('mirabi.focusRoom.v1:1')).not.toBeNull());
  first.unmount();
  (request as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
  show();
  const decorate = await screen.findByRole('button', { name: 'Trang trí' });
  await waitFor(() => expect(decorate.props.accessibilityState).toMatchObject({ disabled: true }));
  expect(screen.getByTestId('focus-room')).toBeTruthy();
});
