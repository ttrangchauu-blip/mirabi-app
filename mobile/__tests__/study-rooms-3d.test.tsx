import React from 'react';
import { AccessibilityInfo, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FocusRoom, withStartingLook } from '../src/screens/main/FocusRoom';
import { FOCUS_DRAWING } from '../src/screens/main/FocusRoomArt';
import { FOCUS_FLOORS, FOCUS_ITEMS, FOCUS_WALLS } from '../src/screens/main/focusPlates';
import { PomodoroPanel } from '../src/screens/main/PomodoroPanel';
import { request } from '../src/screens/main/shared';
import type { FocusTimer } from '../src/screens/main/MainApp';
import { StudyRoomScene } from '../src/screens/together/StudyRoomScene';
import { RoomScene } from '../src/screens/room/RoomScene';
import { defaultLayout, poseFor, surfaceThumb } from '../src/room/art';
import ART from '../assets/room/room-art.json';
import type { FocusRoomData, Layout } from '../src/room/types';
import type { RoomMember } from '../src/studyTogether/types';
import { photoBand } from '../src/world/PhotoRoom';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';

jest.mock('../src/screens/main/shared', () => ({ request: jest.fn(), showError: jest.fn() }));
const mockPets: { pet?: string | null; studying?: boolean; still?: boolean; cheer?: unknown; stage?: number }[] = [];
const mockMounts = { count: 0 };
jest.mock('../src/components/PetArt', () => {
  const R = require('react');
  return { PetArt: (props: any) => { mockPets.push(props); R.useEffect(() => { mockMounts.count += 1; }, []); return null; }, restartFromZero: jest.fn(), petStageArt: () => 1 };
});
const mockXml: string[] = [];
jest.mock('react-native-svg', () => ({ __esModule: true, ...jest.requireActual('react-native-svg'), SvgXml: ({ xml }: { xml: string }) => { mockXml.push(xml); return null; } }));

jest.setTimeout(30000);

const data = (version = 1, layout: Layout = defaultLayout('focus')): FocusRoomData => ({
  room: { name: 'Phòng tập trung', layout, version, updated_at: '2030-01-01T00:00:00+00:00' },
  catalog: { groups: [], surfaces: [], items: [], max_items: 32 },
} as unknown as FocusRoomData);
const shell = (node: React.ReactElement) => <SafeAreaProvider><ConfirmProvider>{node}</ConfirmProvider></SafeAreaProvider>;
const lastPet = () => mockPets[mockPets.length - 1];

beforeEach(async () => {
  jest.clearAllMocks();
  mockPets.length = 0; mockXml.length = 0; mockMounts.count = 0;
  await AsyncStorage.clear();
  (request as jest.Mock).mockImplementation(async (path: string) => (path.includes('statistics') ? { today_seconds: 0, today_sessions: 0, current_streak: 1, days: [], hours: [] } : data()));
});
afterEach(() => { jest.restoreAllMocks(); });

describe('the focus room is pictures, in layers', () => {
  test('there is a picture for every wall and floor of the catalog and every thing of the starting layout', () => {
    for (const [id, surface] of Object.entries((ART as any).surfaces as Record<string, { kind: string }>)) {
      expect(surface.kind === 'wall' ? FOCUS_WALLS[id] : FOCUS_FLOORS[id]).toBeTruthy();
      expect(surfaceThumb(id)).toBeTruthy();
    }
    for (const p of defaultLayout('focus').items) {
      const plate = FOCUS_ITEMS[p.item];
      expect(plate).toBeTruthy();
      expect(plate.anchor).toEqual([p.x, p.y]); // drawn where the layout says, so nothing jumps
    }
  });

  test('the wall is drawn at the size of the room, not the size of its file', () => {
    // An image's own width wins over left and right, on a phone as on the web: the wall would show only its top left corner.
    render(shell(<>{FOCUS_DRAWING.room(defaultLayout('focus'))}</>));
    const wall = screen.getByTestId('focus-room-plates').findAllByType(Image)[0];
    expect(StyleSheet.flatten(wall.props.style)).toMatchObject({ width: '100%', height: '100%', left: '0%', top: '0%' });
  });

  test('a room nobody decorated opens in the rendered colours; a saved one is never touched', () => {
    const shown = withStartingLook(data(1)).room.layout;
    expect(shown).toMatchObject({ wall: 'wall_lilac', floor: 'floor_wood_honey' });
    expect(shown.items.find((p) => p.item === 'rug_oval')?.variant).toBe('lilac');
    expect(withStartingLook(data(2)).room.layout.wall).toBe('wall_mint');
    const other = { ...defaultLayout('focus'), wall: 'wall_sky' };
    expect(withStartingLook(data(1, other)).room.layout.wall).toBe('wall_sky');
  });

  test('another colour of a thing, or anything found later, keeps its catalog drawing in the room', () => {
    const layout = defaultLayout('focus');
    render(shell(<>{FOCUS_DRAWING.items(layout.items.filter((p) => p.item === 'mug'))}</>));
    expect(mockXml).toHaveLength(0); // the default mug is a picture
    const blue = layout.items.filter((p) => p.item === 'mug').map((p) => ({ ...p, variant: 'sky' }));
    render(shell(<>{FOCUS_DRAWING.items(blue)}</>));
    expect(mockXml).toHaveLength(1);
  });

  test('a moved thing is its picture moved: nothing of it stays behind', () => {
    const layout = defaultLayout('focus');
    const moved = { ...layout, items: layout.items.map((p) => (p.item === 'memo_board' ? { ...p, x: p.x + 64, flip: true } : p)) };
    render(shell(<>{FOCUS_DRAWING.items(moved.items.filter((p) => p.item === 'memo_board'))}</>));
    const style = JSON.stringify(screen.toJSON());
    expect(style).toContain('"left":"10%"'); // 64 of 640
    expect(style).toContain('"scaleX":-1');
  });
});

describe('the pet follows the session', () => {
  const room = (props: Partial<React.ComponentProps<typeof FocusRoom>>) => render(shell(<FocusRoom petId="fox" petName="Aqua" petLevel={3} resting={false} compact userId={1} {...props} />));

  test('idle, studying and on a break are three states, with the pet of the right element and level', async () => {
    const view = room({ idle: true });
    expect(screen.getByTestId('room-pet-state-idle')).toBeTruthy();
    expect(screen.getByLabelText('Phòng tập trung, Aqua đang ngồi cùng bạn')).toBeTruthy();
    expect(lastPet()).toMatchObject({ pet: 'fox', stage: 3, studying: false });
    view.rerender(shell(<FocusRoom petId="fox" petName="Aqua" petLevel={3} resting={false} compact userId={1} />));
    expect(await screen.findByTestId('room-pet-state-study')).toBeTruthy();
    expect(screen.getByLabelText('Phòng tập trung, Aqua đang học cùng bạn')).toBeTruthy();
    view.rerender(shell(<FocusRoom petId="fox" petName="Aqua" petLevel={3} resting compact userId={1} />));
    expect(await screen.findByTestId('room-pet-state-rest')).toBeTruthy();
    expect(lastPet()).toMatchObject({ studying: false, still: true }); // no study strip on a break
    await waitFor(() => expect(request).toHaveBeenCalled());
  });

  test('a finished session plays the celebration once and the pet goes back to what the session says', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const view = room({ resting: true, celebrate: 0 });
    await act(async () => { await Promise.resolve(); });
    expect(lastPet().cheer).toBeUndefined();
    view.rerender(shell(<FocusRoom petId="fox" petName="Aqua" petLevel={3} resting celebrate={1} compact userId={1} />));
    await waitFor(() => expect(lastPet().cheer).toBeTruthy());
    // Under jest the native animation ends at once: back to resting.
    expect(await screen.findByTestId('room-pet-state-rest')).toBeTruthy();
  });
});

describe('the panel', () => {
  const timer = (over: Partial<FocusTimer> = {}): FocusTimer => ({ phase: 'focus', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, completedCycles: 0, running: false,
    remainingSeconds: 1500, seconds: 1500, endsAt: null, sound: 'rain', volume: 0.35, soundOn: false, soundPlaying: false, previewing: false, focusMode: false, quiet: false, completionKey: null, activeCycle: null, pending: [],
    ready: true, completion: null, settingsVersion: 0, settingsError: false, syncMessage: '', retrySettings: jest.fn(), nextFocus: jest.fn(), configure: jest.fn(), toggle: jest.fn(), reset: jest.fn(), skip: jest.fn(), toggleSound: jest.fn(),
    selectSound: jest.fn(), toggleFocusMode: jest.fn(), dismissCompletion: jest.fn(), dailyGoalMinutes: 120, ...over } as unknown as FocusTimer);
  const panel = (t: FocusTimer) => <PomodoroPanel timer={t} userId={1} petId="fox" petName="Aqua" petLevel={1} />;

  test('photo mode takes nothing from the timer: it neither calls it nor stops it, and leaving it shows the same screen', async () => {
    const t = timer({ running: true, seconds: 1200, remainingSeconds: 1200, endsAt: Date.now() + 1200000, activeCycle: 'abc' });
    render(shell(panel(t)));
    expect(screen.getByLabelText('Còn lại 20:00')).toBeTruthy();
    fireEvent.press(screen.getByTestId('focus-photo-open'));
    const mode = await screen.findByTestId('focus-photo-mode');
    expect(within(mode).queryByLabelText('Còn lại 20:00')).toBeNull();
    expect(within(mode).getByRole('button', { name: 'Chụp ảnh và lưu vào thư viện' })).toBeTruthy();
    expect(within(mode).queryByRole('button', { name: 'Trang trí' })).toBeNull();
    for (const call of [t.toggle, t.reset, t.skip, t.nextFocus, t.configure]) expect(call).not.toHaveBeenCalled();
    fireEvent.press(within(mode).getByTestId('focus-photo-close'));
    await waitFor(() => expect(screen.queryByTestId('focus-photo-mode')).toBeNull());
    expect(screen.getByLabelText('Còn lại 20:00')).toBeTruthy();
    expect(t.toggle).not.toHaveBeenCalled();
  });

  test('a redraw every tick does not redraw the room', async () => {
    const t = timer({ running: true });
    const view = render(shell(panel(t)));
    await screen.findByTestId('focus-room');
    const before = mockPets.length;
    for (let s = 1499; s > 1495; s--) view.rerender(shell(panel({ ...t, seconds: s, remainingSeconds: s })));
    expect(mockPets.length).toBe(before);
  });
});

test('a tall phone sees the whole height of the room with its wall above and floor below', () => {
  const band = photoBand(390, 844);
  expect(band.width).toBeGreaterThanOrEqual(390);
  expect(band.height + band.bleed * 2).toBeGreaterThanOrEqual(844);
  const tablet = photoBand(1024, 768);
  expect(tablet.width).toBeGreaterThanOrEqual(1024);
  expect(tablet.height + tablet.bleed * 2).toBeGreaterThanOrEqual(768);
  const wide = photoBand(1280, 700);
  expect(wide.width).toBeGreaterThanOrEqual(1280);
  expect(wide.height).toBeGreaterThanOrEqual(700);
  const narrow = photoBand(360, 900);
  expect(narrow.height + narrow.bleed * 2).toBeGreaterThanOrEqual(900);
});

test('the focus room can be drawn the old way: the personal room is not touched by any of this', () => {
  const layout = defaultLayout('personal');
  render(shell(<RoomScene layout={layout} pet={{ id: 'fox', name: 'Aqua', level: 1 }} pose={poseFor('rug', layout)} away={false} description="Phòng" />));
  expect(screen.queryByTestId('focus-room-plates')).toBeNull();
  expect(mockXml.length).toBeGreaterThan(0);
});

describe('the room with friends', () => {
  const member = (id: number, name: string, extra: Partial<RoomMember> = {}): RoomMember => ({ id, user_id: id, display_name: name, avatar_theme: 'aqua', pet: 'cat', pet_name: null, pet_level: 2, public_code: null,
    role: 'member', presence: 'online', joined_at: '', in_session: true, focus_seconds: 0, cycles_completed: 0, ...extra });
  const scene = (props: Partial<React.ComponentProps<typeof StudyRoomScene>>) => <StudyRoomScene members={[member(1, 'Aqua'), member(2, 'Linh')]} state="focus" reactions={[]} meId={1} seats={4} {...props} />;

  test('each member is shown with what the server says they are doing', () => {
    const view = render(shell(scene({ members: [member(1, 'Aqua'), member(2, 'Linh', { presence: 'away' }), member(3, 'Mai', { in_session: false })] })));
    expect(screen.getByLabelText('Aqua (bạn): đang học')).toBeTruthy();
    expect(screen.getByLabelText('Linh: ngoại tuyến')).toBeTruthy();
    expect(screen.getByLabelText('Mai: đã vào phòng')).toBeTruthy();
    expect(screen.getByTestId('study-pet-1-study')).toBeTruthy();
    view.rerender(shell(scene({ state: 'break' })));
    expect(screen.getByLabelText('Linh: đang nghỉ')).toBeTruthy();
    view.rerender(shell(scene({ state: 'paused' })));
    expect(screen.getByLabelText('Linh: tạm dừng')).toBeTruthy();
    expect(lastPet()).toMatchObject({ studying: false, still: true });
  });

  test('nobody is made up, and a member without a pet shows their letter', () => {
    render(shell(scene({ members: [member(1, 'Aqua'), member(2, 'Linh', { pet: '' as unknown as string })] })));
    expect(screen.getAllByTestId(/^study-pet-/)).toHaveLength(2);
    expect(screen.getByTestId('study-room-no-pet')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy();
    expect(mockPets.every((p) => p.pet === 'cat')).toBe(true);
  });

  test('a photo has no letter of anyone\'s name, even of a member without a pet', async () => {
    render(shell(scene({ members: [member(1, 'Aqua'), member(2, 'Linh', { pet: '' as unknown as string })] })));
    fireEvent.press(screen.getByTestId('group-photo-open'));
    const inside = within(await screen.findByTestId('group-photo-mode'));
    expect(inside.getByTestId('study-room-no-pet')).toBeTruthy();
    expect(inside.queryByText('L')).toBeNull();
  });

  test('in a room of more than five each name fits its seat, and still says what the member is doing', () => {
    const everyone = Array.from({ length: 8 }, (_, i) => member(i + 1, `Bạn ${i + 1}`));
    render(shell(scene({ members: everyone, seats: 8 })));
    expect(screen.queryByText(/📖/)).toBeNull();
    expect(screen.getByLabelText('Bạn 2: đang học')).toBeTruthy();
    const label = StyleSheet.flatten(screen.getByLabelText('Bạn 2: đang học').props.style);
    expect(label.width).toBeLessThanOrEqual((74 / 640) * 340 + 0.01);
  });

  test('a room shows as many seats as it has, up to eight, with no two pets on one', () => {
    const everyone = Array.from({ length: 8 }, (_, i) => member(i + 1, `Bạn ${i + 1}`));
    const view = render(shell(scene({ members: everyone, seats: 8 })));
    const lefts = screen.getAllByTestId(/^study-pet-/).map((pet) => JSON.stringify(pet.props.style));
    expect(new Set(lefts).size).toBe(8);
    view.rerender(shell(scene({ members: [member(1, 'Aqua')], seats: 2 })));
    expect(screen.getAllByTestId(/^study-pet-/)).toHaveLength(1);
  });

  test('news from the server does not start a pet over', () => {
    const view = render(shell(scene({})));
    const mounted = mockMounts.count;
    view.rerender(shell(scene({ members: [member(1, 'Aqua', { focus_seconds: 60 }), member(2, 'Linh', { focus_seconds: 120 })] })));
    view.rerender(shell(scene({ reactions: [{ key: 1, userId: 2, reaction: 'clap' } as never] })));
    expect(mockMounts.count).toBe(mounted);
  });

  test('photo mode has the room and the pets, without names, messages or the goal', async () => {
    render(shell(scene({ goal: 'Bí mật của nhóm', messages: [{ key: 'm', userId: 2, text: 'Tin riêng' } as never] })));
    expect(screen.getByText('Tin riêng')).toBeTruthy();
    fireEvent.press(screen.getByTestId('group-photo-open'));
    const mode = await screen.findByTestId('group-photo-mode');
    const inside = within(mode);
    expect(inside.getAllByTestId(/^study-pet-/)).toHaveLength(2);
    for (const hidden of ['Linh', 'Tin riêng', 'Bí mật của nhóm']) expect(inside.queryByText(new RegExp(hidden))).toBeNull();
    expect(inside.queryByLabelText(/Linh/)).toBeNull();
    fireEvent.press(inside.getByTestId('group-photo-close'));
    await waitFor(() => expect(screen.queryByTestId('group-photo-mode')).toBeNull());
  });

  test('each new finished cycle, those in the session celebrate; those away do not', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const members = [member(1, 'Aqua', { pet: 'fox' }), member(2, 'Linh', { pet: 'penguin', presence: 'away' })];
    const view = render(shell(scene({ members, completed: 0 })));
    await act(async () => { await Promise.resolve(); });
    expect(mockPets.some((p) => p.cheer)).toBe(false);
    view.rerender(shell(scene({ members: [...members], state: 'break', completed: 1 })));
    await waitFor(() => expect(mockPets.some((p) => p.pet === 'fox' && p.cheer)).toBe(true));
    expect(mockPets.some((p) => p.pet === 'penguin' && p.cheer)).toBe(false);
  });
});
