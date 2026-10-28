import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { setSession } from '../src/api/client';
import type { Layout, Pose } from '../src/room/types';
import { RoomScene } from '../src/screens/room/RoomScene';
import { VisitRoom } from '../src/screens/room/VisitRoom';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, networkDown, USER } from '../test/mockServer';

const at = (item: string, variant: string, x: number, y: number) => ({ item, variant, x, y, flip: false, rotate: 0 });
const LAYOUT: Layout = { wall: 'wall_cream', floor: 'floor_wood_light', items: [
  at('window', 'morning', 200, 124), at('rug_oval', 'sage', 200, 372), at('desk', 'oak', 96, 318), at('plant_flowers', 'pink', 200, 400)] };
const K = 320 / 400; // tests have no layout pass: the scene is drawn at its 320-point fallback width
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
    expect(feet()).toEqual({ x: 200, feet: 372 }); // on its rug
    tap(320, 420);
    expect(screen.getByTestId('room-walk-target')).toBeTruthy();
    await walk(300);
    const midway = feet();
    expect(midway.x).toBeGreaterThan(200); // moving, not jumped there
    expect(midway.x).toBeLessThan(320);
    const art = screen.UNSAFE_getByProps({ walking: true }); // the walk strip while it goes
    expect(art).toBeTruthy();
    await walk(1500); // 130 units at 120 a second
    expect(feet()).toEqual({ x: 320, feet: 420 });
    expect(screen.UNSAFE_queryByProps({ walking: true })).toBeNull(); // idle when it arrives
  });

  test('a new tap while walking turns it from where it is, never from where it started', async () => {
    scene();
    tap(320, 420);
    await walk(400);
    const turned = feet();
    tap(100, 430);
    await act(async () => { jest.advanceTimersByTime(16); });
    const after = feet();
    expect(Math.hypot(after.x - turned.x, after.feet - turned.feet)).toBeLessThan(6);
    await walk(3000);
    expect(feet()).toEqual({ x: 100, feet: 430 });
  });

  test('walking left mirrors the walk strip that faces right', async () => {
    scene();
    tap(90, 420);
    await walk(200);
    const mirrored = screen.UNSAFE_getAllByType(require('react-native').Animated.View)
      .some((v: any) => (StyleSheet.flatten(v.props.style)?.transform ?? []).some((t: any) => t.scaleX === -1));
    expect(mirrored).toBe(true);
  });

  test('taps on furniture, on the wall or a drag never move it', async () => {
    scene();
    tap(96, 300); // the desk
    tap(200, 150); // the window, on the wall
    tap(330, 420, 30); // a drag across the floor (the page scrolling)
    expect(screen.queryByTestId('room-walk-target')).toBeNull();
    await walk(500);
    expect(feet()).toEqual({ x: 200, feet: 372 });
  });

  test('behind a plant the plant covers it; in front it does not', async () => {
    scene();
    tap(244, 340); // the floor behind the flowers (they stand at y 400), beside their drawing
    await walk(2500);
    expect(feet()).toEqual({ x: 244, feet: 340 });
    expect(screen.getByTestId('room-front')).toBeTruthy();
    tap(200, 430); // in front of them again, around the pot
    await walk(4000);
    expect(screen.queryByTestId('room-front')).toBeNull();
  });

  test('not while decorating, studying, resting, out walking or for a visitor', () => {
    const editor = { selected: null, onSelect: jest.fn(), onMove: jest.fn() };
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
  beforeEach(() => { setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' }); });

  test('a tap makes it hop with hearts; the first gives it EXP once and says so, later taps just play', async () => {
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() }, 'POST /api/personal-room/visit/2/pet-play': played() });
    visit();
    fireEvent.press(await screen.findByTestId('room-pet'));
    expect(screen.getByText('Hi hi, nhột quá!')).toBeTruthy();
    expect(screen.getByTestId('room-hearts')).toBeTruthy();
    expect(await screen.findByLabelText('+2 EXP cho Bông')).toBeTruthy();
    fireEvent.press(screen.getByTestId('room-pet'));
    fireEvent.press(screen.getByTestId('room-pet'));
    expect(screen.getByText('Thích bạn ghê!')).toBeTruthy(); // it keeps playing
    expect(server.callsTo('POST /api/personal-room/visit/2/pet-play')).toHaveLength(1);
    expect(screen.queryByTestId('room-floor')).toBeNull(); // a visitor never moves the host's pet
  });

  test('when today\'s EXP is given, a short note once, then only play', async () => {
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited({ pet_gift: { exp: 2, daily_cap: 10, available: false, reason: 'pet_full' } }) } });
    visit();
    fireEvent.press(await screen.findByTestId('room-pet'));
    expect(await screen.findByLabelText('Bông đã nhận đủ EXP từ bạn bè hôm nay. Vẫn chơi cùng được nhé!')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng thông báo' }));
    fireEvent.press(screen.getByTestId('room-pet'));
    await act(async () => {});
    expect(screen.queryByLabelText(/đã nhận đủ EXP/)).toBeNull(); // not again on every tap
    expect(server.callsTo('POST /api/personal-room/visit/2/pet-play')).toHaveLength(0);
  });

  test('the backend says no (already given from another device): the note once, never "+2 EXP"', async () => {
    mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() },
      'POST /api/personal-room/visit/2/pet-play': played({ granted: 0, reason: 'already_given' }) });
    visit();
    fireEvent.press(await screen.findByTestId('room-pet'));
    expect(await screen.findByLabelText('Hôm nay bạn đã tặng EXP cho Bông rồi. Vẫn chơi cùng được nhé!')).toBeTruthy();
    expect(screen.queryByLabelText(/\+2 EXP/)).toBeNull();
  });

  test('a lost connection asks again on the next tap with the same request id', async () => {
    let tries = 0;
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited() },
      'POST /api/personal-room/visit/2/pet-play': () => (++tries === 1 ? networkDown() : played()) });
    visit();
    fireEvent.press(await screen.findByTestId('room-pet'));
    await waitFor(() => expect(tries).toBe(1));
    fireEvent.press(screen.getByTestId('room-pet'));
    expect(await screen.findByLabelText('+2 EXP cho Bông')).toBeTruthy();
    const [a, b] = server.callsTo('POST /api/personal-room/visit/2/pet-play');
    expect(a.body.client_request_id).toBe(b.body.client_request_id);
  });

  test('a pet out walking is not there to play with', async () => {
    const server = mockServer({ 'GET /api/personal-room/visit/2': { status: 200, body: visited({ walk: { away: true },
      pet_gift: { exp: 2, daily_cap: 10, available: false, reason: 'pet_away' } }) } });
    visit();
    expect(await screen.findByRole('button', { name: 'Để lại lời chào' })).toBeTruthy();
    expect(screen.queryByTestId('room-pet')).toBeNull();
    expect(server.callsTo('POST /api/personal-room/visit/2/pet-play')).toHaveLength(0);
  });
});
