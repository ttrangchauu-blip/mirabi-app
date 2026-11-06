import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, Linking } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { ExploreSpace } from '../src/screens/life/ExploreSpace';
import { loopAt, loopMs, pacing, RATE, ROADS, roadTrack, scaleAt, shownSlots, SWAY, valleyLayout, WIDE, WILD } from '../src/screens/life/exploreArt';
import { WALK_CYCLE_MS } from '../src/petSprites';
import { resetMotionBudget } from '../src/world/budget';
import { mockServer } from '../test/mockServer';

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/shot.png'), releaseCapture: jest.fn() }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })), saveToLibraryAsync: jest.fn(async () => undefined) }));

const USER = { id: 1, name: 'An', pet: 'cat', pet_name: 'Mây', level: 2, age: 20 };
const space = (status: string, over: object = {}) => ({ status, seconds_left: status === 'walking' ? 21430 : 0, walk_minutes: 480, server_now: new Date().toISOString(), started_at: null,
  return_at: status === 'walking' ? new Date(Date.now() + 21430e3).toISOString() : null, quests: [], collection: [], pending_reward: null, last_find: null, ...over });
const open = (props: Partial<React.ComponentProps<typeof ExploreSpace>> = {}) => render(<ToastProvider><ConfirmProvider>
  <ExploreSpace user={USER as any} top={60} bottom={0} version={0} onOpenGifts={() => {}} onOpenInventory={() => {}} onOpenQuests={() => {}} onOpenAdventure={() => {}} {...props} />
</ConfirmProvider></ToastProvider>);

beforeEach(() => { jest.clearAllMocks(); resetMotionBudget(); });

describe('the far camera', () => {
  /** What a phone leaves for the card and the tab bar: the same numbers the layout is promised. */
  const CARD_TOP = (height: number) => height - 84 - 10 - 190;
  it.each([[360, 640], [375, 667], [390, 844], [393, 852], [412, 915], [430, 932]])('%i x %i: the pet stands free, not too big or small, and keeps its feet in view', (width, height) => {
    const l = valleyLayout(width, height);
    // Its art fills about 95% of its box (measured on the walk strips): 12% to 18% of the scene's height.
    const drawn = l.pet * 0.95;
    expect(drawn / height).toBeGreaterThanOrEqual(0.12);
    expect(drawn / height).toBeLessThanOrEqual(0.18);
    for (const [, row] of ROADS.flat()) expect(l.top + row * l.tall).toBeLessThan(CARD_TOP(height));
    // The sky is at least a third of the screen on a phone, and the land reaches its bottom edge.
    expect(l.top + l.tall).toBeGreaterThanOrEqual(height);
    expect(l.wide).toBeGreaterThan(width);
    expect(l.wide / l.tall).toBeCloseTo(WIDE, 5);
  });
  it('the pet never grows with the screen, only with where it stands on the road', () => {
    expect(valleyLayout(430, 932).pet).toBeLessThanOrEqual(valleyLayout(390, 844).pet * 1.12);
    expect(valleyLayout(1024, 1366).pet).toBeLessThanOrEqual(124);
    const scales = ROADS.flat().map(([, , share]) => scaleAt(share));
    expect(Math.min(...scales)).toBeGreaterThan(0.8);
    expect(Math.max(...scales)).toBeLessThan(1.2);
  });
});

describe('photo mode', () => {
  it('hides everything but the scene, without touching the walk or remounting anything, and brings it all back', async () => {
    const server = mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    const onPhotoMode = jest.fn();
    open({ onPhotoMode });
    await screen.findByText('Mây đang khám phá');
    const sceneBefore = screen.getByTestId('explore-scene');
    const petBefore = screen.getByTestId('explore-pet');
    const readsBefore = server.calls.length;

    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    expect(onPhotoMode).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText('Mây đang khám phá')).toBeNull();
    expect(screen.queryByLabelText('Kho đồ')).toBeNull();
    expect(screen.queryByLabelText('Ẩn giao diện')).toBeNull();
    expect(screen.getByLabelText('Thoát chế độ chụp ảnh')).toBeTruthy();
    expect(screen.getByLabelText('Chụp ảnh và lưu vào thư viện')).toBeTruthy();
    expect(screen.getByTestId('explore-scene')).toBe(sceneBefore);
    expect(screen.getByTestId('explore-pet')).toBe(petBefore);

    fireEvent.press(screen.getByLabelText('Thoát chế độ chụp ảnh'));
    expect(onPhotoMode).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText('Mây đang khám phá')).toBeTruthy();
    expect(screen.getByTestId('explore-pet')).toBe(petBefore);
    expect(server.calls.length).toBe(readsBefore);
    expect(server.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('turning it on and off again and again leaves the time left as it was', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    open();
    await screen.findByText('Mây đang khám phá');
    const shown = () => screen.getByLabelText(/^Còn /).props.accessibilityLabel as string;
    const start = shown();
    for (let i = 0; i < 12; i++) {
      fireEvent.press(screen.getByTestId(i % 2 ? 'explore-photo-toggle' : 'explore-photo-open'));
      fireEvent.press(screen.getByTestId('explore-photo-close'));
    }
    // At most the seconds that really went by.
    expect(shown().slice(0, 8)).toBe(start.slice(0, 8));
  });

  it('keeps counting while hidden: the walk may end in photo mode, and the card says so on the way back', async () => {
    let body = space('walking', { return_at: new Date(Date.now() + 1200).toISOString(), seconds_left: 1 });
    mockServer({ 'GET /api/pet/space': () => ({ status: 200, body }) });
    const gifts = jest.fn(async () => {});
    open({ onOpenGifts: gifts });
    await screen.findByText('Mây đang khám phá');
    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    body = space('returned');
    await act(async () => { await new Promise((r) => setTimeout(r, 2300)); });
    // Nothing is handed over by itself, and the controls stay.
    expect(gifts).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Thoát chế độ chụp ảnh')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Thoát chế độ chụp ảnh'));
    expect(await screen.findByRole('button', { name: 'Xem quà' })).toBeTruthy();
  });

  it('Android\'s back leaves photo mode, not the place', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    const add = jest.spyOn(BackHandler, 'addEventListener');
    open();
    await screen.findByText('Mây đang khám phá');
    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    const handler = add.mock.calls[add.mock.calls.length - 1][1];
    let handled: boolean | null | undefined;
    act(() => { handled = handler(); });
    expect(handled).toBe(true);
    expect(await screen.findByText('Mây đang khám phá')).toBeTruthy();
  });

  it('the bars come back if the place is left while it is on', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    const onPhotoMode = jest.fn();
    const view = open({ onPhotoMode });
    await screen.findByText('Mây đang khám phá');
    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    view.unmount();
    expect(onPhotoMode).toHaveBeenLastCalledWith(false);
  });

  it('a picture is of the scene alone, and "saved" is only said once it is', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    let finish: () => void = () => {};
    (MediaLibrary.saveToLibraryAsync as jest.Mock).mockReturnValueOnce(new Promise<void>((r) => { finish = r; }));
    open();
    await screen.findByText('Mây đang khám phá');
    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    fireEvent.press(screen.getByLabelText('Chụp ảnh và lưu vào thư viện'));
    await waitFor(() => expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/shot.png'));
    // The view captured is the one with the pet in it and without the controls.
    const target = (captureRef as jest.Mock).mock.calls[0][0].current;
    expect(target).toBeTruthy();
    expect((captureRef as jest.Mock).mock.calls[0][1]).toMatchObject({ format: 'png', quality: 1 });
    expect(screen.queryByText('Đã lưu ảnh vào thư viện')).toBeNull();
    // A second press while saving does nothing.
    fireEvent.press(screen.getByLabelText('Chụp ảnh và lưu vào thư viện'));
    expect(captureRef).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(await screen.findByText('Đã lưu ảnh vào thư viện')).toBeTruthy();
    expect(releaseCapture).toHaveBeenCalledWith('file:///tmp/shot.png');
    // Still in photo mode, ready for the next.
    expect(screen.getByLabelText('Thoát chế độ chụp ảnh')).toBeTruthy();
  });

  it('permission refused: nothing is saved and it says why; once refused for good it offers Settings', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, canAskAgain: true });
    open();
    await screen.findByText('Mây đang khám phá');
    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    fireEvent.press(screen.getByLabelText('Chụp ảnh và lưu vào thư viện'));
    expect(await screen.findByText('Mirabi cần quyền lưu ảnh để giữ lại khung cảnh này.')).toBeTruthy();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(releaseCapture).toHaveBeenCalled();
    expect(screen.queryByText('Mở Cài đặt')).toBeNull();

    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, canAskAgain: false });
    fireEvent.press(screen.getByLabelText('Chụp ảnh và lưu vào thư viện'));
    fireEvent.press(await screen.findByText('Mở Cài đặt'));
    expect(settings).toHaveBeenCalled();
    expect(screen.getByLabelText('Thoát chế độ chụp ảnh')).toBeTruthy();
  });

  it('a picture that could not be taken says so, and the walk is untouched', async () => {
    const server = mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    (captureRef as jest.Mock).mockRejectedValueOnce(new Error('no surface'));
    open();
    await screen.findByText('Mây đang khám phá');
    fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
    fireEvent.press(screen.getByLabelText('Chụp ảnh và lưu vào thư viện'));
    expect(await screen.findByText('Chưa chụp được ảnh. Hãy thử lại nhé.')).toBeTruthy();
    expect(server.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});

describe('the card', () => {
  it('folds to the name and the time, and opens again with the same time', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    open();
    await screen.findByText('Mây đang khám phá');
    expect(screen.getByText('Quà vẫn là bí mật cho tới khi Mây về nhà.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Thu gọn thẻ'));
    expect(screen.queryByText('Quà vẫn là bí mật cho tới khi Mây về nhà.')).toBeNull();
    expect(screen.getByLabelText(/^Còn /)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Mở rộng thẻ'));
    expect(screen.getByText('Quà vẫn là bí mật cho tới khi Mây về nhà.')).toBeTruthy();
    expect(screen.getByLabelText('Kho đồ')).toBeTruthy();
  });
});

describe('the endless walk', () => {
  it('every stretch of road meets the next on the same row and with the same slope, so no join shows under its feet', () => {
    const first = ROADS[0][0][1];
    for (const road of ROADS) {
      expect(road[0][1]).toBeCloseTo(first, 3);
      expect(road[road.length - 1][1]).toBeCloseTo(first, 3);
      expect(Math.abs(road[1][1] - road[0][1])).toBeLessThan(0.002);
      expect(Math.abs(road[road.length - 1][1] - road[road.length - 2][1])).toBeLessThan(0.002);
    }
  });
  it('the road under the pet over a whole loop has no jump, and its two ends are one place', () => {
    const { at, rows, scales } = roadTrack(0.113);
    expect(at[0]).toBe(0);
    expect(at[at.length - 1]).toBe(1);
    expect(rows[0]).toBe(rows[rows.length - 1]);
    expect(scales[0]).toBe(scales[scales.length - 1]);
    for (let i = 1; i < at.length; i++) {
      expect(at[i]).toBeGreaterThan(at[i - 1]); // what a native interpolation needs
      expect(Math.abs(rows[i] - rows[i - 1])).toBeLessThan(0.008); // about 5 points on a phone, over the 38 points between two samples
    }
  });
  it.each([[360, 640], [390, 844], [430, 932]])('%i x %i: a whole number of steps per picture, so its feet never slide and the strip never skips', (width, height) => {
    const l = valleyLayout(width, height), pace = pacing(l.wide, l.pet);
    expect(Number.isInteger(pace.steps)).toBe(true);
    expect(pace.stride * pace.steps).toBeCloseTo(l.wide, 5);
    expect(Math.abs(pace.stride / (l.pet * 0.62) - 1)).toBeLessThan(0.05); // the pace its strip was drawn for
    // A strolling pace, however long the walk: the road keeps moving at one speed.
    expect(l.wide / pace.tileMs).toBeCloseTo(pace.stride / WALK_CYCLE_MS, 5);
  });
  it('where the walk has got to comes only from the time since it began, for all eight hours and after any reopening', () => {
    const ms = 83_000;
    expect(loopAt(0, ms)).toBe(0);
    expect(loopAt(ms * 0.25, ms)).toBeCloseTo(0.25, 6);
    expect(loopAt(ms * 347 + ms * 0.25, ms)).toBeCloseTo(0.25, 6);
    expect(loopAt(8 * 3_600_000, ms)).toBeGreaterThanOrEqual(0);
    expect(loopAt(8 * 3_600_000, ms)).toBeLessThan(1);
  });
  it('far layers go slower than near ones, and the same view does not come round again soon', () => {
    expect(RATE.far).toBeLessThan(RATE.mid);
    expect(RATE.mid).toBeLessThan(1);
    expect(RATE.front).toBeGreaterThan(1);
    expect(RATE.near).toBeGreaterThan(RATE.front);
    const tile = 27_600;
    const loops = [tile * WILD.lands.length, loopMs(tile, WILD.fronts.length, RATE.front), loopMs(tile, WILD.mids.length, RATE.mid), loopMs(tile, 1, RATE.far)];
    // No two layers share a length, so they drift against each other.
    expect(new Set(loops.map((x) => Math.round(x))).size).toBe(loops.length);
    expect(WILD.lands.length).toBeGreaterThanOrEqual(3);
  });
  it('only the pictures on the screen or about to be are mounted, and the first is there before the loop starts over', () => {
    const wide = 1500, width = 390, n = 3;
    expect(shownSlots(n, wide, width, 0, 100)).toEqual([0]);
    expect(shownSlots(n, wide, width, 0.3, 100)).toEqual([0, 1]);
    expect(shownSlots(n, wide, width, 0.5, 100)).toEqual([1]);
    const last = shownSlots(n, wide, width, 0.99, 100);
    expect(last).toContain(3);
    expect(last).toContain(0);
    for (let at = 0; at < 1; at += 0.013) expect(shownSlots(n, wide, width, at, 100).length).toBeLessThanOrEqual(3);
  });
  it('few trees: three that sway per hill picture, of different kinds of place', () => {
    for (const hill of SWAY) {
      expect(hill.length).toBeLessThanOrEqual(3);
      // Far apart: at least a screen between any two of them.
      const xs = hill.map((t) => t.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.2);
    }
  });

  describe('with motion on', () => {
    beforeEach(() => { jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false); });
    afterEach(() => jest.restoreAllMocks());
    const statesFor = async (ms: number) => {
      const seen = new Set<string>();
      const end = Date.now() + ms;
      while (Date.now() < end) { await act(async () => { await new Promise((r) => setTimeout(r, 150)); }); seen.add(screen.getByTestId(/^living-pet-/).props.testID); }
      return seen;
    };
    it('walks all the time: never idle, whatever the time goes by, and only ever reads the walk', async () => {
      const server = mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
      open();
      await screen.findByText('Mây đang khám phá');
      const states = await statesFor(2500);
      expect([...states]).toEqual(['living-pet-walk']);
      expect(server.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
    });
    it('keeps walking in photo mode, and after it', async () => {
      mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
      open();
      await screen.findByText('Mây đang khám phá');
      fireEvent.press(screen.getByLabelText('Ẩn giao diện'));
      expect(screen.getByTestId('living-pet-walk')).toBeTruthy();
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      fireEvent.press(screen.getByLabelText('Thoát chế độ chụp ảnh'));
      expect(screen.getByTestId('living-pet-walk')).toBeTruthy();
    });
  });
  it('stands idle when it is not out', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('rested') } });
    open();
    await screen.findByText(/Hôm nay Mây đã đi khám phá/);
    expect(screen.getByTestId('living-pet-idle')).toBeTruthy();
    expect(screen.queryByTestId('living-pet-walk')).toBeNull();
  });
});
