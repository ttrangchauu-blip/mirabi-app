import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { setSession } from '../src/api/client';
import { dragTo, moveItem } from '../src/room/rules';
import type { Layout, Pose } from '../src/room/types';
import { RoomScene } from '../src/screens/room/RoomScene';
import { VisitRoom } from '../src/screens/room/VisitRoom';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, networkDown, USER } from '../test/mockServer';

const at = (item: string, variant: string, x: number, y: number) => ({ item, variant, x, y, flip: false, rotate: 0 });
const LAYOUT: Layout = { wall: 'wall_cream', floor: 'floor_wood_light', items: [
  at('window', 'morning', 180, 268), at('rug_oval', 'sage', 180, 516), at('desk', 'oak', 96, 462), at('plant_flowers', 'pink', 180, 544)] };
const K = 320 / 420; // tests have no layout pass: the canvas is drawn across the scene's 320-point fallback width
const PET = { id: 'fox', name: 'Lửa', level: 2 };

/** Where the pet's feet are on the canvas, read back from its frame on screen. */
function feet() {
  const style = StyleSheet.flatten(screen.getByTestId('room-pet').props.style);
  const size = style.width / K;
  return { x: Math.round(style.left / K + size / 2), feet: Math.round(style.top / K + size) };
}
function tap(x: number, y: number, moveBy = 0) {
  const floor = screen.getByTestId('room-floor');
  const touch = (dx: number) => ({ nativeEvent: { locationX: x * K + dx, locationY: y * K, pageX: x * K + dx, pageY: y * K, touches: [{}] } });
  fireEvent(floor, 'responderGrant', touch(0));
  if (moveBy) fireEvent(floor, 'responderMove', touch(moveBy));
  fireEvent(floor, 'responderRelease', touch(moveBy));
}
async function walk(ms: number) {
  for (let t = 0; t < ms; t += 16) await act(async () => { jest.advanceTimersByTime(16); });
}
function scene(props: Partial<React.ComponentProps<typeof RoomScene>> = {}) {
  const base = { layout: LAYOUT, pet: PET, pose: 'rug' as Pose, away: false, description: 'Phòng', walkable: true, onPetPress: jest.fn() };
  return render(<RoomScene {...base} {...props} />);
}

describe('tap the floor to walk the pet', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('walks to the tapped point at a steady pace, with its walk strip, then stands again', async () => {
    scene();
    expect(feet()).toEqual({ x: 180, feet: 516 }); // on its rug
    tap(280, 564);
    expect(screen.getByTestId('room-walk-target')).toBeTruthy();
    await walk(300);
    const midway = feet();
    expect(midway.x).toBeGreaterThan(180); // moving, not jumped there
    expect(midway.x).toBeLessThan(280);
    const art = screen.UNSAFE_getByProps({ walking: true }); // the walk strip while it goes
    expect(art).toBeTruthy();
    await walk(1500); // 111 units at 120 a second
    expect(feet()).toEqual({ x: 280, feet: 564 });
    expect(screen.UNSAFE_queryByProps({ walking: true })).toBeNull(); // idle when it arrives
  });

  test('a new tap while walking turns it from where it is, never from where it started', async () => {
    scene();
    tap(280, 564);
    await walk(400);
    const turned = feet();
    tap(100, 574);
    await act(async () => { jest.advanceTimersByTime(16); });
    const after = feet();
    expect(Math.hypot(after.x - turned.x, after.feet - turned.feet)).toBeLessThan(6);
    await walk(3000);
    expect(feet()).toEqual({ x: 100, feet: 574 });
  });

  test('walking left mirrors the walk strip that faces right', async () => {
    scene();
    tap(90, 564);
    await walk(200);
    const mirrored = screen.UNSAFE_getAllByType(require('react-native').Animated.View)
      .some((v: any) => (StyleSheet.flatten(v.props.style)?.transform ?? []).some((t: any) => t.scaleX === -1));
    expect(mirrored).toBe(true);
  });

  test('taps on furniture, on the wall or a drag never move it', async () => {
    scene();
    tap(96, 444); // the desk
    tap(180, 294); // the window, on the wall
    tap(270, 600, 30); // a drag across the floor (the page scrolling)
    expect(screen.queryByTestId('room-walk-target')).toBeNull();
    await walk(500);
    expect(feet()).toEqual({ x: 180, feet: 516 });
  });

  test('behind a plant the plant covers it; in front it does not', async () => {
    scene();
    tap(224, 484); // the floor behind the flowers (they stand at y 544), beside their drawing
    await walk(2500);
    expect(feet()).toEqual({ x: 224, feet: 484 });
    expect(screen.getByTestId('room-front')).toBeTruthy();
    tap(180, 574); // in front of them again, around the pot
    await walk(4000);
    expect(screen.queryByTestId('room-front')).toBeNull();
  });

  test('not while decorating, studying, resting, out walking or for a visitor', () => {
    const editor = { selected: null, onSelect: jest.fn(), place: jest.fn(() => null), preview: jest.fn(() => null), onMove: jest.fn() };
    const cases: Partial<React.ComponentProps<typeof RoomScene>>[] = [{ editor }, { pose: 'study' }, { pose: 'rest' }, { away: true }, { walkable: false }];
    for (const props of cases) {
      const { unmount } = scene(props);
      expect(screen.queryByTestId('room-floor')).toBeNull();
      unmount();
    }
  });

  test('a tap on the pet is play, not a walk', () => {
    const onPetPress = jest.fn();
    scene({ onPetPress });
    fireEvent.press(screen.getByTestId('room-pet'));
    expect(onPetPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('room-walk-target')).toBeNull();
  });
});

describe('dragging furniture while decorating', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  /** A one-finger touch on the edit layer, from a canvas point, moved by these points one after another. */
  function finger(from: { x: number; y: number }) {
    const layer = screen.getByTestId('room-edit-layer');
    const sx = from.x * K, sy = from.y * K;
    let prev = { x: sx, y: sy }, time = 1;
    const event = (x: number, y: number) => {
      time += 16;
      const touch = { touchActive: true, startPageX: sx, startPageY: sy, startTimeStamp: 1, currentPageX: x, currentPageY: y,
        currentTimeStamp: time, previousPageX: prev.x, previousPageY: prev.y, previousTimeStamp: time - 16 };
      prev = { x, y };
      return { nativeEvent: { locationX: x, locationY: y, pageX: x, pageY: y, touches: [{}], changedTouches: [{}], timestamp: time },
        touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: time, touchBank: [touch] } };
    };
    act(() => { layer.props.onResponderGrant(event(sx, sy)); });
    return {
      move: (dx: number, dy: number) => act(() => { layer.props.onResponderMove(event(sx + dx, sy + dy)); }),
      lift: () => act(() => { layer.props.onResponderRelease(event(prev.x, prev.y)); }),
    };
  }
  function decorating() {
    const editor = { selected: null as string | null, onSelect: jest.fn(), onMove: jest.fn(),
      place: jest.fn((item: string, x: number, y: number) => dragTo(LAYOUT, item, x, y, 'personal')),
      preview: jest.fn((item: string, x: number, y: number) => moveItem(LAYOUT, item, x, y, 'personal')) };
    scene({ editor });
    return editor;
  }
  const roomXml = () => screen.UNSAFE_getAllByType(SvgXml)[0].props.xml as string;

  test('the item keeps the grab point under the finger, follows it on its own layer, and is dropped once', () => {
    const editor = decorating();
    expect(roomXml()).toContain('translate(96 462)'); // the desk, in the room drawing
    const touch = finger({ x: 60, y: 400 }); // on the desk, 36 left of and 62 above its anchor
    expect(editor.onSelect).toHaveBeenCalledWith('desk');
    touch.move(2, 1); // a shake of the finger is not a drag yet
    expect(screen.queryByTestId('room-lifted')).toBeNull();
    touch.move(40, 16);
    touch.move(60, 20);
    // Lifted off the room, which is drawn once without it; the drawing moved with the finger is the desk.
    expect(screen.getByTestId('room-lifted')).toBeTruthy();
    expect(roomXml()).not.toContain('translate(96 462)');
    expect(screen.UNSAFE_getAllByType(SvgXml).some((svg) => svg.props.xml.includes('translate(96 462)'))).toBe(true);
    expect(editor.place).toHaveBeenCalledTimes(2);
    expect(editor.preview).not.toHaveBeenCalled(); // the rules are checked a few times a second, not every frame
    act(() => { jest.advanceTimersByTime(120); });
    expect(editor.preview).toHaveBeenCalledTimes(1);
    expect(editor.onMove).not.toHaveBeenCalled(); // nothing is stored while it moves
    touch.lift();
    // Its anchor moved as far as the finger did (in canvas units), wherever the finger was on it.
    const [item, x, y] = editor.onMove.mock.calls[0];
    expect(item).toBe('desk');
    expect(x).toBeCloseTo(96 + 60 / K);
    expect(y).toBeCloseTo(462 + 20 / K);
    expect(editor.onMove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('room-lifted')).toBeNull();
  });

  test('decorating keeps the camera of the room: the same scale and place, with its header and panel drawn over it', () => {
    const view = render(<RoomScene layout={LAYOUT} pet={PET} pose="rug" away={false} description="Phòng" safeTop={130} safeBottom={26} />);
    const canvas = () => StyleSheet.flatten(screen.getByTestId('room-canvas').props.style);
    const before = canvas();
    const editor = { selected: null, onSelect: jest.fn(), onMove: jest.fn(), place: jest.fn(() => null), preview: jest.fn(() => null) };
    view.rerender(<RoomScene layout={LAYOUT} pet={PET} pose="rug" away={false} description="Phòng" safeTop={130} safeBottom={26}
      editor={editor} chrome={{ top: 56, bottom: 300 }} />);
    expect(canvas()).toEqual(before);
    // The front edge of the floor is the bottom of what is shown above the bar, in both.
    expect(before.top + before.height).toBeCloseTo(676 - 26, 6);
  });

  test('a drag on an empty spot slides the room to reach what is under the panel, and moves no item', () => {
    const slid = { selected: null as string | null, onSelect: jest.fn(), onMove: jest.fn(), place: jest.fn(() => null), preview: jest.fn(() => null) };
    render(<RoomScene layout={LAYOUT} pet={PET} pose="rug" away={false} description="Phòng" safeTop={130} safeBottom={26}
      editor={slid} chrome={{ top: 56, bottom: 300 }} />);
    const shift = () => (StyleSheet.flatten(screen.getByTestId('room-camera').props.style).transform as any[])[0].translateY;
    expect(shift()).toBe(0); // decorating starts where the room was
    const layer = screen.getByTestId('room-edit-layer');
    const ev = (y: number, t: number) => ({ nativeEvent: { locationX: 400 * K, locationY: 200 * K, pageX: 400 * K, pageY: y, touches: [{}], changedTouches: [{}], timestamp: t },
      touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: t, touchBank: [{ touchActive: true, startPageX: 400 * K,
        startPageY: 300, startTimeStamp: 1, currentPageX: 400 * K, currentPageY: y, currentTimeStamp: t, previousPageX: 400 * K, previousPageY: 300, previousTimeStamp: 1 }] } });
    act(() => { layer.props.onResponderGrant(ev(300, 1)); });
    expect(slid.onSelect).toHaveBeenLastCalledWith(null); // an empty spot of the wall
    act(() => { layer.props.onResponderMove(ev(150, 20)); });
    act(() => { layer.props.onResponderRelease(ev(150, 30)); });
    expect(shift()).toBeLessThan(0); // the room slid up, under the header, to show the floor under the panel
    expect(shift()).toBeGreaterThanOrEqual(-300);
    expect(slid.onMove).not.toHaveBeenCalled();
  });

  test('a tap selects without moving anything, and a tap on the floor clears the selection', () => {
    const editor = decorating();
    finger({ x: 60, y: 400 }).lift();
    expect(editor.onSelect).toHaveBeenLastCalledWith('desk');
    finger({ x: 330, y: 700 }).lift();
    expect(editor.onSelect).toHaveBeenLastCalledWith(null);
    expect(editor.onMove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('room-lifted')).toBeNull();
  });

  test('what stands on a desk is lifted with it', () => {
    const onDesk: Layout = { ...LAYOUT, items: [...LAYOUT.items, at('mug', 'cream', 120, 376)] };
    const editor = { selected: null, onSelect: jest.fn(), onMove: jest.fn(), place: jest.fn((item: string, x: number, y: number) => dragTo(onDesk, item, x, y, 'personal')),
      preview: jest.fn(() => null) };
    scene({ layout: onDesk, editor });
    const touch = finger({ x: 60, y: 400 });
    touch.move(30, 0);
    const lifted = screen.UNSAFE_getAllByType(SvgXml).map((svg) => svg.props.xml as string).find((xml) => xml.includes('translate(96 462)'))!;
    expect(lifted).toContain('translate(120 376)'); // the mug goes along
    expect(roomXml()).not.toContain('translate(120 376)');
    touch.lift();
  });
});

describe('playing with a friend\'s pet on a visit', () => {
  const visited = (over: Record<string, any> = {}) => ({
    owner: { id: 2, display_name: 'Mây', avatar_theme: 'aqua', pet: 'cat', pet_name: 'Bông', pet_level: 2 }, room: { name: 'Phòng của Bông', layout: LAYOUT },
    pet: { id: 'cat', name: 'Bông', level: 2 }, activity: 'idle', walk: { away: false }, guest_pet: { id: 'fox', name: 'Lửa', level: 1 },
    can_invite_study: true, available_at: { hello: null, cheer: null, study_invite: null },
    pet_gift: { exp: 2, daily_cap: 10, available: true, reason: null }, ...over,
  });
  const played = (over: Record<string, any> = {}) => ({ status: 200, body: { granted: 2, reason: 'granted', pet_name: 'Bông', pet_level: 2, replayed: false, ...over } });
  function visit() {
    return render(<ToastProvider><VisitRoom userId={2} me={{ ...USER, pet: 'fox', pet_name: 'Lửa' } as any} onBack={jest.fn()} /></ToastProvider>);
  }
  // "Chào pet" plays for a moment (PLAY_MS) and taps meanwhile are ignored: `later()` moves the clock past it.
  let clockOffset = 0;
  const realNow = Date.now.bind(Date);
  const later = () => { clockOffset += 2000; };
  beforeEach(() => {
    setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
  });
  afterEach(() => { (Date.now as jest.Mock).mockRestore(); });
  /** A tap on their pet, then "Chào pet" in its menu. */
  async function greet() {
    fireEvent.press(await screen.findByTestId('room-pet'));
    fireEvent.press(within(screen.getByTestId('room-pet-menu')).getByRole('button', { name: 'Chào pet' }));
  }

  test('"Chào pet" makes it hop with hearts; the first gives it EXP once and says so, later ones just play', async () => {
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() }, 'POST /api/personal-room/visit/2/pet-play': played() });
    visit();
    await greet();
    expect(screen.queryByTestId('room-pet-menu')).toBeNull();
    expect(screen.getByText('Chào bạn! Cảm ơn đã ghé chơi nha!')).toBeTruthy();
    expect(screen.getByTestId('room-hearts')).toBeTruthy();
    expect(await screen.findByLabelText('+2 EXP cho Bông')).toBeTruthy();
    // While it plays, more taps open nothing and ask for nothing.
    fireEvent.press(screen.getByTestId('room-pet'));
    expect(screen.queryByTestId('room-pet-menu')).toBeNull();
    later();
    await greet();
    later();
    await greet();
    expect(screen.getByText('Ồ, có khách! Vui quá đi!')).toBeTruthy(); // it keeps playing
    expect(server.callsTo('POST /api/personal-room/visit/2/pet-play')).toHaveLength(1);
    expect(screen.queryByTestId('room-floor')).toBeNull(); // a visitor never moves the host's pet
    expect(screen.queryByTestId('room-edit-layer')).toBeNull(); // nor anything in the room
  });

  test('the menu sits by the pet, inside the room', async () => {
    mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() } });
    visit();
    fireEvent.press(await screen.findByTestId('room-pet'));
    const menu = StyleSheet.flatten(screen.getByTestId('room-pet-menu').props.style);
    const pet = StyleSheet.flatten(screen.getByTestId('room-pet').props.style);
    expect(menu.left).toBeGreaterThanOrEqual(8);
    expect(menu.left + menu.width).toBeLessThanOrEqual(320 - 8);
    expect(menu.top + menu.height <= pet.top || menu.top >= pet.top + pet.height).toBe(true); // never over the pet
    fireEvent.press(screen.getByTestId('room-pet-menu-backdrop'));
    expect(screen.queryByTestId('room-pet-menu')).toBeNull();
  });

  test('when today\'s EXP is given, a short note once, then only play', async () => {
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited({ pet_gift: { exp: 2, daily_cap: 10, available: false, reason: 'pet_full' } }) } });
    visit();
    await greet();
    expect(await screen.findByLabelText('Bông đã nhận đủ EXP từ bạn bè hôm nay. Vẫn chơi cùng được nhé!')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng thông báo' }));
    later();
    await greet();
    await act(async () => {});
    expect(screen.queryByLabelText(/đã nhận đủ EXP/)).toBeNull(); // not again on every tap
    expect(server.callsTo('POST /api/personal-room/visit/2/pet-play')).toHaveLength(0);
  });

  test('the backend says no (already given from another device): the note once, never "+2 EXP"', async () => {
    mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() },
      'POST /api/personal-room/visit/2/pet-play': played({ granted: 0, reason: 'already_given' }) });
    visit();
    await greet();
    expect(await screen.findByLabelText('Hôm nay bạn đã tặng EXP cho Bông rồi. Vẫn chơi cùng được nhé!')).toBeTruthy();
    expect(screen.queryByLabelText(/\+2 EXP/)).toBeNull();
  });

  test('a lost connection asks again on the next tap with the same request id', async () => {
    let tries = 0;
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() },
      'POST /api/personal-room/visit/2/pet-play': () => (++tries === 1 ? networkDown() : played()) });
    visit();
    await greet();
    await waitFor(() => expect(tries).toBe(1));
    later();
    await greet();
    expect(await screen.findByLabelText('+2 EXP cho Bông')).toBeTruthy();
    const [a, b] = server.callsTo('POST /api/personal-room/visit/2/pet-play');
    expect(a.body.client_request_id).toBe(b.body.client_request_id);
  });

  test('a pet out walking is not there to play with', async () => {
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited({ walk: { away: true },
      pet_gift: { exp: 2, daily_cap: 10, available: false, reason: 'pet_away' } }) } });
    visit();
    fireEvent.press(await screen.findByTestId('room-away-marker')); // where the pet would be: a greeting can be left
    expect(screen.getByRole('button', { name: 'Để lại lời chào' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chào pet' })).toBeNull();
    expect(screen.queryByTestId('room-pet')).toBeNull();
    expect(server.callsTo('POST /api/personal-room/visit/2/pet-play')).toHaveLength(0);
  });
});
