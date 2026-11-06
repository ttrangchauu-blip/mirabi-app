import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import App from '../App';
import { lightAt } from '../src/components/daylight';
import { useReduceMotion } from '../src/components/useReduceMotion';
import { keyOf } from '../src/room/art';
import { PLAY_MS, useRoomPrefs } from '../src/room/prefs';
import type { Placement } from '../src/room/types';
import { walkSpeedAt, WALK_SPEED } from '../src/room/walk';
import { GardenScreen } from '../src/screens/garden/GardenScreen';
import { BED_FRAME_TOP, BED_TALL, YARD_HILLTOP, YARD_POND_END, YARD_TALL } from '../src/screens/garden/gardenArt';
import { GardenWorld, gardenPaths, gardenRoute, plotPlaces, yardLayout } from '../src/screens/garden/GardenWorld';
import { HealingDock } from '../src/screens/healing/HealingDock';
import { drapeLength, lampLit } from '../src/screens/healing/RoomAmbience';
import { ExploreSpace } from '../src/screens/life/ExploreSpace';
import { MoreTab } from '../src/screens/main/MoreTab';
import { InviteScreen, PrivacyScreen, SettingsScreen } from '../src/screens/main/SettingsScreens';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { blendMood, CALM, moodOf, roomLight, shade } from '../src/world/atmosphere';
import { levelFor, resetMotionBudget, setMotionPreference, summarizeFrames } from '../src/world/budget';
import { actDuration, PET_ACTS, poseAfterBeats } from '../src/world/motion';
import { ACT_OF_INTERACTION, artFor, nextPetState, type PetEvent, type PetState } from '../src/world/petMachine';
import { describeWeather, roughPlace, usableReading, WeatherProvider, type WeatherReading, weatherNote } from '../src/world/weather';
import { mockServer, tokens, USER } from '../test/mockServer';

jest.mock('../src/auth/useConfirmLogout', () => ({ useConfirmLogout: () => jest.fn() }));

const store = (require('expo-secure-store') as { __store: Map<string, string> }).__store;
const reading = (over: Partial<WeatherReading> = {}): WeatherReading => ({ condition: 'clear', temperature_c: 27, wind_kmh: 8, windy: false, cloud_cover: 10, is_day: true,
  fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1800e3).toISOString(), stale: false, source: 'Open-Meteo', ...over });
const wrap = (node: React.ReactNode) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
const allow = (lat = 21.0278, lon = 105.8342) => {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, canAskAgain: true });
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: lat, longitude: lon } });
};

beforeEach(async () => {
  store.clear();
  await AsyncStorage.clear();
  resetMotionBudget();
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false, canAskAgain: false });
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockClear();
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
});

describe('acts: every movement has its beats and ends where it began', () => {
  const acts = Object.entries(PET_ACTS);
  it.each(acts)('%s comes back to rest: its baseline, size and angle are as before', (_name, act) => {
    const poses = poseAfterBeats(act);
    expect(poses[poses.length - 1]).toEqual({ lift: 0, squash: 0, tilt: 0 });
    expect(act[act.length - 1].beat).toBe('settle');
  });
  it('the big movements prepare first, go, carry on and settle', () => {
    for (const name of ['hop', 'jump', 'pounce', 'celebrate', 'lean', 'nibble'] as const) {
      const beats = PET_ACTS[name].map((b) => b.beat);
      expect(beats[0]).toBe('anticipation');
      expect(beats).toContain('primary');
      expect(beats).toEqual(expect.arrayContaining(['settle']));
    }
    expect(poseAfterBeats(PET_ACTS.jump)[0].squash).toBeGreaterThan(0); // crouches before it leaves the ground
    expect(Math.max(...poseAfterBeats(PET_ACTS.jump).map((p) => p.lift))).toBeGreaterThan(0.25);
  });
  it('nothing the pet does with you outlasts the time taps are held back', () => {
    for (const name of Object.values(ACT_OF_INTERACTION)) expect(actDuration(PET_ACTS[name])).toBeLessThanOrEqual(PLAY_MS);
  });
  it('what bends the pet stays small enough to never look like another shape', () => {
    for (const act of Object.values(PET_ACTS)) for (const pose of poseAfterBeats(act)) {
      expect(Math.abs(pose.squash)).toBeLessThanOrEqual(1);
      expect(Math.abs(pose.tilt)).toBeLessThanOrEqual(10);
    }
  });
});

describe('the pet state machine', () => {
  const walkThrough = (from: PetState, events: PetEvent[]) => events.reduce(nextPetState, from);
  it('goes idle → walk → interact → idle', () => {
    expect(nextPetState('idle', 'WALK')).toBe('walk');
    expect(nextPetState('walk', 'INTERACT')).toBe('interact');
    expect(nextPetState('interact', 'DONE')).toBe('idle');
    expect(walkThrough('idle', ['WALK', 'ARRIVE', 'CELEBRATE', 'DONE'])).toBe('idle');
  });
  it('ignores what makes no sense now', () => {
    expect(nextPetState('away', 'WALK')).toBe('away');
    expect(nextPetState('idle', 'DONE')).toBe('idle');
    expect(nextPetState('celebrate', 'WALK')).toBe('celebrate');
    expect(nextPetState('study', 'INTERACT')).toBe('study');
  });
  it('can always get back to idle, from anywhere', () => {
    const states: PetState[] = ['idle', 'walk', 'interact', 'celebrate', 'study', 'rest', 'away'];
    for (const state of states) expect(walkThrough(state, ['ARRIVE', 'DONE', 'WAKE', 'RETURN'])).toBe('idle');
    for (const state of states) expect(nextPetState(state, 'LEAVE')).toBe('away');
  });
  it('only its own strips are played', () => {
    expect(artFor('walk')).toEqual({ walking: true, studying: false, still: false });
    expect(artFor('study')).toEqual({ walking: false, studying: true, still: false });
    expect(artFor('idle')).toEqual({ walking: false, studying: false, still: false });
  });
});

describe('how much may move', () => {
  it('reduce motion or the account setting: nothing loops; a weak or lagging device: fewer things', () => {
    expect(levelFor(true, 'auto', false, false)).toBe('still');
    expect(levelFor(false, 'reduced', false, false)).toBe('still');
    expect(levelFor(false, 'auto', true, false)).toBe('lite');
    expect(levelFor(false, 'auto', false, true)).toBe('lite');
    expect(levelFor(false, 'auto', false, false)).toBe('full');
  });
  it('reads frame times, leaving out the app being paused', () => {
    expect(summarizeFrames([])).toBeNull();
    expect(summarizeFrames([16, 17, 16, 17, 16, 5000])).toMatchObject({ frames: 5, medianMs: 16, fps: 63 });
    expect(summarizeFrames([33, 34, 33, 35, 90])!.p95Ms).toBe(90);
  });
  it('a scene of many loops holds one subscription to the OS setting, and gives it back', () => {
    const add = AccessibilityInfo.addEventListener as jest.Mock;
    const before = add.mock.calls.length;
    const Loop = () => { useReduceMotion(); return null; };
    const view = render(<>{Array.from({ length: 30 }, (_, i) => <Loop key={i} />)}</>);
    expect(add.mock.calls.length - before).toBe(1);
    const { remove } = add.mock.results[add.mock.results.length - 1].value;
    expect(remove).not.toHaveBeenCalled();
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('a walking pet picks up and slows down, at the same pace at any refresh rate', () => {
    expect(walkSpeedAt(0, 500)).toBeLessThan(WALK_SPEED * 0.5);
    expect(walkSpeedAt(1000, 500)).toBe(WALK_SPEED);
    expect(walkSpeedAt(1000, 5)).toBeLessThan(WALK_SPEED * 0.5);
    expect(walkSpeedAt(1000, 0)).toBeGreaterThan(0); // never stops short of arriving
    const distance = (hz: number) => { let d = 0; const dt = 1000 / hz; for (let t = 0; t < 2000; t += dt) d += walkSpeedAt(t, 1000) * dt / 1000; return d; };
    expect(Math.abs(distance(60) - distance(120)) / distance(120)).toBeLessThan(0.02);
  });
});

describe('the sky', () => {
  it('with no reading it is the hour alone: nothing pretends to be weather', () => {
    expect(moodOf(null)).toEqual(CALM);
    const noon = lightAt(12);
    expect(shade(noon, CALM)).toBe(noon);
    expect(CALM.rain).toBe(0);
  });
  it('rain darkens the sky, hides the stars and the fireflies, softens the shadows, and moves the leaves', () => {
    const rain = moodOf(reading({ condition: 'rain', cloud_cover: 100 }));
    expect(rain.rain).toBe(1);
    const noon = lightAt(12);
    const rainy = shade(noon, rain);
    const brightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(brightness(rainy.sky[0])).toBeLessThan(brightness(noon.sky[0]));
    expect(rainy.shadow).toBeLessThan(noon.shadow);
    const night = lightAt(23);
    expect(night.fireflies).toBeGreaterThan(0);
    expect(shade(night, rain).fireflies).toBe(0);
    expect(shade(night, rain).stars).toBeLessThan(night.stars);
    expect(rain.wind).toBeGreaterThan(CALM.wind);
    expect(moodOf(reading({ condition: 'clear', wind_kmh: 45 })).wind).toBeGreaterThan(1);
    expect(moodOf(reading({ condition: 'storm' })).rain).toBe(2);
    expect(moodOf(reading({ condition: 'fog' })).fog).toBe(1);
    expect(moodOf(reading({ condition: 'snow' })).snow).toBe(1);
  });
  it('morning, noon, evening and night go over smoothly: a few minutes never swap a background', () => {
    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    for (let h = 0; h < 24; h += 0.05) {
      const [a, b] = [lightAt(h), lightAt(h + 0.05)];
      for (const i of [0, 1, 2]) expect(Math.abs(channel(a.sky[0], i) - channel(b.sky[0], i))).toBeLessThan(14);
    }
  });
  it('a new reading blends over, not at once', () => {
    const mid = blendMood(CALM, moodOf(reading({ condition: 'rain' })), 0.5);
    expect(mid.gloom).toBeGreaterThan(0);
    expect(mid.gloom).toBeLessThan(0.65);
  });
  it('a room is lit by the hour: clear at noon, deep at night, greyer under cloud', () => {
    expect(roomLight(12, CALM).opacity).toBeLessThan(0.05);
    expect(roomLight(23, CALM).opacity).toBeGreaterThan(0.2);
    expect(roomLight(12, moodOf(reading({ condition: 'rain' }))).opacity).toBeGreaterThan(roomLight(12, CALM).opacity);
  });
});

describe('where the weather comes from', () => {
  it('a place is rounded before anything else happens to it', () => {
    expect(roughPlace(21.0278, 105.8342)).toEqual({ lat: 21, lon: 105.8 });
    expect(roughPlace(-33.8688, 151.2093)).toEqual({ lat: -33.9, lon: 151.2 });
  });
  it('a reading kept on the device is used only while it is recent, and says when it is old', () => {
    expect(usableReading(null)).toBeNull();
    expect(usableReading(reading())?.stale).toBe(false);
    const expired = reading({ fetched_at: new Date(Date.now() - 3600e3).toISOString(), expires_at: new Date(Date.now() - 1800e3).toISOString() });
    expect(usableReading(expired)?.stale).toBe(true);
    expect(usableReading(reading({ fetched_at: new Date(Date.now() - 7 * 3600e3).toISOString() }))).toBeNull();
    expect(usableReading(reading({ fetched_at: new Date(Date.now() + 3600e3).toISOString() }))).toBeNull();
  });
  it('says what it knows in words, and never claims more', () => {
    expect(describeWeather(reading({ condition: 'rain', windy: true }), false).label).toBe('Trời mưa, có gió, 27 độ');
    expect(describeWeather(reading(), true).icon).toBe('moon');
    expect(describeWeather(reading({ stale: true }), false).label).toMatch(/cập nhật lúc/);
    expect(weatherNote({ reading: null, status: 'no_permission' })).toMatch(/không hiển thị thời tiết/);
    expect(weatherNote({ reading: null, status: 'unavailable' })).toMatch(/theo giờ trong ngày/);
    expect(weatherNote({ reading: reading(), status: 'live' })).toMatch(/Open-Meteo/);
  });

  const Probe = () => { const { reading: r } = require('../src/world/weather').useWeather(); return r ? <>{r.condition}</> : null; };
  const inProvider = () => render(<WeatherProvider enabled><Probe /></WeatherProvider>);

  it('without permission nothing is asked of the backend, and asking stops after a final no', async () => {
    const server = mockServer({});
    inProvider();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(server.calls.filter((c) => c.path.startsWith('/api/world/weather'))).toHaveLength(0);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
  it('asks only with the rounded place, and keeps the answer for next time', async () => {
    allow();
    const server = mockServer({ 'GET /api/world/weather?lat=21&lon=105.8': { status: 200, body: { ...reading({ condition: 'rain' }), available: true } } });
    const view = inProvider();
    await waitFor(() => expect(server.callsTo('GET /api/world/weather?lat=21&lon=105.8')).toHaveLength(1));
    view.unmount();
    // Still good: it opens from the copy, with no second request and no location.
    (Location.getLastKnownPositionAsync as jest.Mock).mockClear();
    const again = mockServer({});
    inProvider();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(again.calls.filter((c) => c.path.startsWith('/api/world/weather'))).toHaveLength(0);
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });
  it('tells nothing when the backend has no reading', async () => {
    allow();
    const server = mockServer({ 'GET /api/world/weather?lat=21&lon=105.8': { status: 200, body: { available: false } } });
    render(<WeatherProvider enabled><Probe /></WeatherProvider>);
    await waitFor(() => expect(server.callsTo('GET /api/world/weather?lat=21&lon=105.8')).toHaveLength(1));
    await act(async () => {});
    expect(await AsyncStorage.getItem('mirabi.world.weather.v1')).toBeNull();
  });
});

describe('the settings follow the account', () => {
  let prefs: ReturnType<typeof useRoomPrefs>;
  const Host = () => { prefs = useRoomPrefs(1); return null; };
  const settings = (over = {}) => ({ sound: null, effects: null, motion: 'auto', lamps: {}, ...over });
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

  it('reads them from the server, and saves a change with the version it was based on', async () => {
    const server = mockServer({
      'GET /api/world/preferences': { status: 200, body: { version: 3, settings: settings({ sound: false, lamps: { lamp: true } }) } },
      'PUT /api/world/preferences': (req) => ({ status: 200, body: { version: req.body.version + 1, settings: req.body.settings } }),
    });
    render(<Host />);
    await flush();
    expect(prefs.sound).toBe(false);
    expect(prefs.lamps).toEqual({ lamp: true });
    act(() => prefs.setMotion('reduced'));
    expect(prefs.motion).toBe('reduced'); // at once
    await flush();
    expect(server.callsTo('PUT /api/world/preferences')[0].body).toMatchObject({ version: 3, settings: { motion: 'reduced', sound: false } });
    act(() => prefs.setSound(true));
    await flush();
    expect(server.callsTo('PUT /api/world/preferences')[1].body.version).toBe(4);
  });

  it('on a conflict it takes the newest settings and puts this change on top, once', async () => {
    let conflict = true;
    const server = mockServer({
      'GET /api/world/preferences': () => (conflict ? { status: 200, body: { version: 1, settings: settings() } } : { status: 200, body: { version: 5, settings: settings({ effects: false }) } }),
      'PUT /api/world/preferences': (req) => {
        if (req.body.version < 5) { conflict = false; return { status: 409, body: { detail: 'x', code: 'preferences_version_conflict' } }; }
        return { status: 200, body: { version: 6, settings: req.body.settings } };
      },
    });
    render(<Host />);
    await flush();
    act(() => prefs.setSound(false));
    await flush();
    await flush();
    const puts = server.callsTo('PUT /api/world/preferences');
    expect(puts).toHaveLength(2);
    expect(puts[1].body).toMatchObject({ version: 5, settings: { sound: false } });
  });

  it('without a connection the change stays here, and goes with the next open', async () => {
    const offline = mockServer({ 'GET /api/world/preferences': new TypeError('Network request failed'), 'PUT /api/world/preferences': new TypeError('Network request failed') });
    const view = render(<Host />);
    await flush();
    act(() => prefs.setSound(false));
    expect(prefs.sound).toBe(false);
    await flush();
    expect(offline.callsTo('PUT /api/world/preferences')).toHaveLength(1);
    view.unmount();
    const online = mockServer({ 'GET /api/world/preferences': { status: 200, body: { version: 2, settings: settings({ sound: true }) } },
      'PUT /api/world/preferences': (req) => ({ status: 200, body: { version: 3, settings: req.body.settings } }) });
    render(<Host />);
    await flush();
    expect(online.callsTo('PUT /api/world/preferences')[0].body).toMatchObject({ version: 2, settings: { sound: false } });
    expect(prefs.sound).toBe(false);
  });

  it('"Giảm chuyển động" in Tiện ích reaches the whole world', async () => {
    mockServer({ 'GET /api/world/preferences': { status: 200, body: { version: 1, settings: settings() } },
      'PUT /api/world/preferences': (req) => ({ status: 200, body: { version: 2, settings: req.body.settings } }) });
    wrap(<MoreTab user={{ ...USER, age: 20 } as any} onOpenProfile={() => {}} />);
    await flush();
    fireEvent(screen.getByRole('switch', { name: /Giảm chuyển động/ }), 'valueChange', true);
    await flush();
    expect(require('../src/world/budget').motionPreference()).toBe('reduced');
    setMotionPreference('auto');
  });
});

describe('the garden scene', () => {
  const daisy = (plot: number, over: object = {}) => ({ plot, empty: false, item_id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', planted_at: '2026-01-01T00:00:00+00:00',
    stage: 1, stage_label: 'Đang lớn', grown: false, next_stage_at: new Date(Date.now() + 3 * 3600e3).toISOString(), care: { water: { done: false, by: null, at: null }, tend: { done: false, by: null, at: null } }, ...over });
  const garden = (plots: object[], at = new Date().toISOString()) => ({ size: 6, plots: [...plots, ...Array.from({ length: 6 - plots.length }, (_, i) => ({ plot: plots.length + i, empty: true }))], seeds: [], care_kinds: [], care_day: '2026-11-01', server_now: at });

  it('every plot is in the scene, apart from the others, whatever the phone', () => {
    for (const [w, h] of [[320, 568], [360, 640], [390, 720], [430, 800], [768, 960]]) {
      const { places, content, picTop, tall } = yardLayout(9, w, h, 118, 92);
      for (const p of places) {
        expect(p.x - p.w / 2).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w / 2).toBeLessThanOrEqual(w);
        expect(p.feet).toBeLessThanOrEqual(content - 92);
        expect(p.feet - p.w * BED_FRAME_TOP).toBeGreaterThan(picTop + tall * YARD_POND_END); // on the grass, not in the pond
        expect(p.w).toBeGreaterThanOrEqual(44); // a finger fits
      }
      for (const [i, a] of places.entries()) for (const b of places.slice(i + 1)) {
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.feet - b.feet) >= 1;
        expect(apart).toBe(true);
      }
      expect(places[0].w).toBeLessThan(places[3].w); // the back rows are further away
      expect(places[3].w).toBeLessThan(places[6].w);
      expect(picTop + tall * YARD_HILLTOP).toBeGreaterThanOrEqual(118 + 40); // open sky under what floats at the top
    }
    expect(plotPlaces(9, 390, 720, 118, 92)).toEqual(plotPlaces(9, 390, 720, 118, 92));
  });

  it('a taller phone sees more sky', () => {
    const sky = (h: number) => { const { picTop, tall } = yardLayout(9, 390, h, 118, 160); return picTop + tall * YARD_HILLTOP - 118; };
    expect(sky(844)).toBeGreaterThan(100);
    expect(sky(844)).toBeGreaterThan(sky(700));
  });

  it('the pet walks along the lanes and round the beds, never through one', () => {
    for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932], [768, 960]]) {
      const yard = yardLayout(9, w, h, 118, 160);
      const paths = gardenPaths(yard, w);
      const beds = yard.places.map((p) => ({ left: p.x - p.w * 0.45, right: p.x + p.w * 0.45, top: p.feet - p.w * BED_FRAME_TOP, bottom: p.feet - p.w * 0.11 }));
      const spots = paths.lanes.flatMap((lane) => [{ x: lane.left + 30, y: lane.y }, { x: lane.right - 30, y: lane.y }]);
      for (const from of spots) for (const to of spots) {
        let here = from;
        const legs = gardenRoute(paths, from, to);
        if (from !== to) expect(legs[legs.length - 1]).toEqual(to);
        for (const leg of legs) {
          expect(leg.x === here.x || leg.y === here.y).toBe(true); // straight along a lane, a side or the gate
          for (const bed of beds) {
            const crossesX = Math.max(here.x, leg.x) > bed.left && Math.min(here.x, leg.x) < bed.right;
            const crossesY = Math.max(here.y, leg.y) > bed.top && Math.min(here.y, leg.y) < bed.bottom;
            expect(crossesX && crossesY).toBe(false);
          }
          here = leg;
        }
      }
    }
  });

  describe('the pet in its yard', () => {
    const empty = Array.from({ length: 9 }, (_, plot) => ({ plot, empty: true })) as any[];
    /** The states the pet goes through over a while. */
    async function statesOver(ms: number) {
      render(<GardenWorld plots={empty} busy={null} ready={() => false} labelFor={() => ''} onPress={() => {}} top={118} bottom={160} pet={{ id: 'fox', level: 2 }} />);
      await act(async () => {});
      const seen = new Set<string>();
      for (let t = 0; t < ms; t += 100) {
        await act(async () => { jest.advanceTimersByTime(100); });
        seen.add(screen.getByTestId(/^living-pet-/).props.testID);
      }
      return seen;
    }
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });

    it('strolls about on its own', async () => {
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
      expect(await statesOver(6000)).toContain('living-pet-walk');
    });

    it('stays where it is with reduce motion', async () => {
      expect(await statesOver(6000)).not.toContain('living-pet-walk');
    });
  });

  it('keeps the yard at its own shape and only scrolls where the phone is too short', () => {
    expect(yardLayout(9, 390, 720, 118, 92).content).toBe(720);
    expect(yardLayout(9, 320, 568, 118, 92).content).toBe(568);
    expect(yardLayout(9, 320, 400, 118, 92).content).toBeGreaterThan(400);
    const { zoom, tall } = yardLayout(9, 390, 720, 118, 92);
    expect(tall / (390 * zoom)).toBeCloseTo(YARD_TALL);
  });

  it('shows what the server says: wet soil only once watered, no plant where none was planted', async () => {
    mockServer({ 'GET /api/garden': { status: 200, body: garden([daisy(0, { care: { water: { done: true, by: null, at: null }, tend: { done: false, by: null, at: null } } })]) } });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    expect(await screen.findByTestId('garden-soil-wet')).toBeTruthy();
    expect(screen.getByTestId('garden-world')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Ô đất trống/)).toHaveLength(5);
    expect(screen.queryByText('Ô trống', { includeHiddenElements: true })).toBeNull(); // its (+) says it
    expect(screen.getByText('Đang lớn', { includeHiddenElements: true })).toBeTruthy();
  });

  it('a finger lands on one plot only, anywhere on it, whatever the phone', () => {
    for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932], [768, 960]]) {
      const areas = yardLayout(9, w, h, 98, 88).places.map((p) => ({ left: p.x - p.pitch / 2, right: p.x + p.pitch / 2, top: p.feet - p.h, bottom: p.feet, w: p.w, h: p.h, pitch: p.pitch }));
      for (const area of areas) {
        expect(area.pitch).toBeGreaterThanOrEqual(44);
        expect(area.h).toBeGreaterThanOrEqual(44);
        expect(area.pitch).toBeGreaterThanOrEqual(area.w); // the whole plot, up to its corners
        expect(area.h).toBeGreaterThanOrEqual(area.w * BED_TALL - 0.01);
      }
      for (const [i, a] of areas.entries()) for (const b of areas.slice(i + 1)) {
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.01 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.01;
        expect(overlap).toBe(false);
      }
    }
  });

  it('a plot takes its place from the screen alone, planted or not', async () => {
    const spot = () => screen.getByTestId('garden-plot-0-area').props.style;
    const SEED = { id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', rarity_label: 'Thường', group: 'seed', available: 2 };
    mockServer({
      'GET /api/garden': { status: 200, body: { ...garden([]), seeds: [SEED] } },
      'POST /api/garden/plots/0/plant': { status: 200, body: { planted: true, replayed: false, garden: { ...garden([daisy(0)]), seeds: [SEED] } } },
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />);
    const plot = await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc');
    const before = spot();
    fireEvent.press(plot);
    expect(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn/)).toBeTruthy();
    expect(spot()).toEqual(before);
  });

  it('an answer that left the server before the one on screen can\'t bring the older garden back', async () => {
    let resolveLate: (value: { status: number; body: unknown }) => void = () => {};
    const late = new Promise<{ status: number; body: unknown }>((r) => { resolveLate = r; });
    const newer = new Date().toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();
    let reads = 0;
    mockServer({
      'GET /api/garden': () => (++reads === 1 ? { status: 200, body: garden([daisy(0)], older) } : late),
      'POST /api/garden/plots/0/care': { status: 200, body: { cared: true, replayed: false, reason: null, garden: garden([daisy(0, { care: { water: { done: true, by: null, at: null }, tend: { done: false, by: null, at: null } } })], newer) } },
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn.*chạm để xem chi tiết$/));
    fireEvent.press(await screen.findByLabelText('Tưới nước'));
    expect(await screen.findByTestId('garden-soil-wet')).toBeTruthy();
    resolveLate({ status: 200, body: garden([daisy(0)], older) });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId('garden-soil-wet')).toBeTruthy();
  });

  describe('with motion on', () => {
    beforeEach(() => { jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false); });
    afterEach(() => { jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });

    it('water falls only after the server said yes', async () => {
      let answer: (value: { status: number; body: unknown }) => void = () => {};
      mockServer({
        'GET /api/garden': { status: 200, body: garden([daisy(0)]) },
        'POST /api/garden/plots/0/care': () => new Promise((r) => { answer = r; }),
      });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn.*chạm để xem chi tiết$/));
      fireEvent.press(await screen.findByLabelText('Tưới nước'));
      await act(async () => {});
      expect(screen.queryByTestId('garden-water-fx')).toBeNull();
      await act(async () => { answer({ status: 200, body: { cared: true, replayed: false, reason: null, garden: garden([daisy(0, { care: { water: { done: true, by: null, at: null }, tend: { done: false, by: null, at: null } } })]) } }); });
      expect(await screen.findByTestId('garden-water-fx')).toBeTruthy();
      expect(screen.getByTestId('garden-soil-wet')).toBeTruthy();
    });

    it('seeds are sown only after the server said yes, and not when it answers from a retry', async () => {
      const SEED = { id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', rarity_label: 'Thường', group: 'seed', available: 2 };
      let answer: (value: { status: number; body: unknown }) => void = () => {};
      mockServer({
        'GET /api/garden': { status: 200, body: { ...garden([]), seeds: [SEED] } },
        'POST /api/garden/plots/0/plant': () => new Promise((r) => { answer = r; }),
      });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />);
      fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc'));
      await act(async () => {});
      expect(screen.queryByTestId('garden-seed-fx')).toBeNull();
      await act(async () => { answer({ status: 200, body: { planted: false, replayed: true, garden: { ...garden([daisy(0)]), seeds: [SEED] } } }); });
      expect(screen.queryByTestId('garden-seed-fx')).toBeNull();
      fireEvent.press(await screen.findByLabelText('Ô đất trống 2, chạm để trồng Hạt hoa cúc'));
      expect(await screen.findByLabelText('Ô đất trống 2, chạm để trồng Hạt hoa cúc')).toBeTruthy();
    });

    it('plays the sowing on the plot planted', async () => {
      const SEED = { id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', rarity_label: 'Thường', group: 'seed', available: 2 };
      mockServer({
        'GET /api/garden': { status: 200, body: { ...garden([]), seeds: [SEED] } },
        'POST /api/garden/plots/0/plant': { status: 200, body: { planted: true, replayed: false, garden: { ...garden([daisy(0)]), seeds: [SEED] } } },
      });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />);
      fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc'));
      expect(await screen.findByTestId('garden-seed-fx')).toBeTruthy();
    });
  });
});

describe('the exploration', () => {
  const space = (status: string, over: object = {}) => ({ status, seconds_left: status === 'walking' ? 3600 : 0, walk_minutes: 480, server_now: new Date().toISOString(), started_at: null,
    return_at: status === 'walking' ? new Date(Date.now() + 3600e3).toISOString() : null, quests: [], collection: [], pending_reward: null, last_find: null, ...over });
  const open = (props: Partial<React.ComponentProps<typeof ExploreSpace>> = {}) => wrap(<ExploreSpace user={{ ...USER, age: 20, level: 2 } as any} top={0} bottom={0} version={0} onOpenGifts={() => {}}
    onOpenInventory={() => {}} onOpenQuests={() => {}} onOpenAdventure={() => {}} {...props} />);

  it('only reads the walk: never starts, ends or collects anything', async () => {
    const server = mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    open();
    expect(await screen.findByText('Aqua đang khám phá')).toBeTruthy();
    expect(screen.getByLabelText(/^Còn 0(0:59:5\d|1:00:00)/)).toBeTruthy();
    expect(server.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('says what is happening at each point of the walk, and hands the gift to the app\'s own popup', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('locked') } });
    const quests = jest.fn();
    let view = open({ onOpenQuests: quests });
    fireEvent.press(await screen.findByRole('button', { name: 'Xem mục tiêu hôm nay' }));
    expect(quests).toHaveBeenCalled();
    view.unmount();

    mockServer({ 'GET /api/pet/space': { status: 200, body: space('returned') } });
    const gifts = jest.fn(async () => {});
    view = open({ onOpenGifts: gifts });
    fireEvent.press(await screen.findByRole('button', { name: 'Xem quà' }));
    await waitFor(() => expect(gifts).toHaveBeenCalled());
    expect(await screen.findByTestId('explore-gift')).toBeTruthy();
    view.unmount();

    mockServer({ 'GET /api/pet/space': { status: 200, body: space('rested', { last_find: { name: 'Hạt hoa cúc', emoji: '🌼' } }) } });
    view = open();
    expect(await screen.findByText(/tìm được Hạt hoa cúc/)).toBeTruthy();
    view.unmount();

    mockServer({ 'GET /api/pet/space': { status: 200, body: space('waiting_hatch') } });
    open();
    expect(await screen.findByText('Trứng sắp nở rồi')).toBeTruthy();
  });

  it('Phiêu lưu cuộc sống is there for those aged 16 and over only', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    const view = open();
    expect(await screen.findByTestId('open-adventure')).toBeTruthy();
    view.unmount();
    open({ user: { ...USER, age: 15, level: 2 } as any });
    await screen.findByText('Aqua đang khám phá');
    expect(screen.queryByTestId('open-adventure')).toBeNull();
  });

  it('a failed read offers another try', async () => {
    let up = false;
    mockServer({ 'GET /api/pet/space': () => (up ? { status: 200, body: space('walking') } : new TypeError('Network request failed')) });
    open();
    const retry = await screen.findByRole('button', { name: /thử lại/ });
    up = true;
    fireEvent.press(retry);
    expect(await screen.findByText('Aqua đang khám phá')).toBeTruthy();
  });

  it('the weather changes the sky, never what the pet is doing', async () => {
    allow();
    const weather: { body: object } = { body: { ...reading({ condition: 'clear' }), available: true } };
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('rested') }, 'GET /api/world/weather?lat=21&lon=105.8': () => ({ status: 200, body: weather.body }) });
    const tree = (key: number) => <ToastProvider><ConfirmProvider><WeatherProvider key={key} enabled><ExploreSpace user={{ ...USER, level: 2 } as any} top={0} bottom={0} version={0} onOpenGifts={() => {}}
      onOpenInventory={() => {}} onOpenQuests={() => {}} /></WeatherProvider></ConfirmProvider></ToastProvider>;
    render(tree(1));
    expect(await screen.findByTestId('weather-chip')).toBeTruthy();
    expect(screen.getByTestId('living-pet-idle')).toBeTruthy();
    expect(screen.queryByTestId('weather-rain')).toBeNull();
    expect(screen.getByLabelText(/Trời quang/)).toBeTruthy();
  });

  it('no permission: no weather shown at all', async () => {
    mockServer({ 'GET /api/pet/space': { status: 200, body: space('walking') } });
    open();
    await screen.findByText('Aqua đang khám phá');
    expect(screen.queryByTestId('weather-chip')).toBeNull();
    expect(screen.queryByTestId('weather-rain')).toBeNull();
  });
});

describe('the room as a living place', () => {
  it('curtains stop at what stands in front of them, and go on behind nothing', () => {
    const window: Placement = { item: 'window', variant: 'default', x: 200, y: 200, flip: false, rotate: 0 } as Placement;
    expect(drapeLength(window, 1, [window])).toBe(84);
    const tall = { item: 'desk', variant: 'default', x: 200 + 76, y: 340, flip: false, rotate: 0 } as Placement;
    const length = drapeLength(window, 1, [window, tall])!;
    expect(length === null || length < 84).toBe(true);
    expect(drapeLength(window, -1, [window, tall])).toBe(84); // the other side is free
  });
  it('a lamp follows the hour until the user switches it, then stays as they left it', () => {
    const lamp = { item: 'night_lamp', uid: 'a1', variant: 'default', x: 0, y: 0, flip: false, rotate: 0 } as Placement;
    expect(lampLit(lamp, 'morning', CALM, null)).toBe(false);
    expect(lampLit(lamp, 'starry', CALM, null)).toBe(true);
    expect(lampLit(lamp, 'morning', moodOf(reading({ condition: 'rain' })), null)).toBe(true); // a dark, rainy day
    expect(lampLit(lamp, 'starry', CALM, null, { [keyOf(lamp)]: false })).toBe(false);
    expect(lampLit(lamp, 'morning', CALM, null, { [keyOf(lamp)]: true })).toBe(true);
  });
});

describe('the navigation', () => {
  const WORLD = { 'GET /api/auth/me': { status: 200, body: { ...USER, age: 20 } }, 'GET /api/pet/space': { status: 200, body: { status: 'rested', seconds_left: 0, collection: [], quests: [] } },
    'GET /api/friends': { status: 200, body: { items: [] } }, 'GET /api/garden': { status: 200, body: { size: 6, plots: [], seeds: [], server_now: new Date().toISOString() } } };
  const start = async () => {
    store.set('refmi.session.v1', JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
    render(<App />);
    await screen.findByText(`Chào bạn, ${USER.display_name}!`, {}, { timeout: 5000 });
  };

  it('four tabs that are always there, and four places inside Cuộc sống', async () => {
    mockServer(WORLD);
    await start();
    expect(screen.getAllByRole('tab').map((x) => x.props.accessibilityLabel)).toEqual(['Trang chủ', 'Học tập', 'Cuộc sống', 'Tiện ích']);
    fireEvent.press(screen.getByRole('tab', { name: 'Cuộc sống' }));
    expect(await screen.findByTestId('space-switcher')).toBeTruthy();
    const tabs = () => screen.getAllByRole('tab').map((x) => x.props.accessibilityLabel);
    expect(tabs()).toEqual(['Nhà của pet', 'Vườn nhà', 'Khám phá', 'Bạn bè', 'Trang chủ', 'Học tập', 'Cuộc sống', 'Tiện ích']);
    for (const [place, marker] of [['Vườn nhà', 'garden-screen'], ['Khám phá', 'explore-space'], ['Bạn bè', 'friends-space'], ['Nhà của pet', 'life-hub']] as const) {
      fireEvent.press(screen.getByRole('tab', { name: place }));
      expect(await screen.findByTestId(marker)).toBeTruthy();
      expect(screen.getByRole('tab', { name: place }).props.accessibilityState).toEqual({ selected: true });
      expect(screen.getByRole('tab', { name: 'Tiện ích' })).toBeTruthy(); // the menu never goes
    }
  });

  it('a place left stays chosen, and only one place is alive at a time', async () => {
    mockServer(WORLD);
    await start();
    fireEvent.press(screen.getByRole('tab', { name: 'Cuộc sống' }));
    fireEvent.press(await screen.findByRole('tab', { name: 'Vườn nhà' }));
    await screen.findByTestId('garden-screen');
    expect(screen.queryByTestId('explore-space')).toBeNull();
    expect(screen.queryByTestId('personal-room')).toBeNull();
    fireEvent.press(screen.getByRole('tab', { name: 'Tiện ích' }));
    expect(await screen.findByText('Kỷ niệm và thành tựu')).toBeTruthy();
    expect(screen.queryByTestId('garden-screen')).toBeNull();
    fireEvent.press(screen.getByRole('tab', { name: 'Cuộc sống' }));
    expect(await screen.findByTestId('garden-screen')).toBeTruthy();
  });

  it('Tiện ích is three groups, each row a real screen; no button leads nowhere and no place is offered twice', () => {
    const openers = { onOpenFocus: jest.fn(), onOpenNotebook: jest.fn(), onOpenTeamQuests: jest.fn(), onOpenAlbum: jest.fn(), onOpenAchievements: jest.fn(), onOpenStreak: jest.fn(),
      onOpenStatistics: jest.fn(), onOpenArchive: jest.fn(), onOpenInvite: jest.fn(), onOpenSettings: jest.fn() };
    wrap(<MoreTab user={{ ...USER, age: 20 } as any} onOpenProfile={() => {}} onOpenStudyProfile={() => {}} {...openers} />);
    for (const group of ['Học tập và tập trung', 'Kỷ niệm và thành tựu', 'Cá nhân hóa']) expect(screen.getByText(group)).toBeTruthy();
    for (const id of ['focus', 'notebook', 'team-quests', 'album', 'achievements', 'streak', 'statistics', 'archive', 'invite', 'settings']) fireEvent.press(screen.getByTestId(`open-${id}`));
    for (const opener of Object.values(openers)) expect(opener).toHaveBeenCalledTimes(1);
    for (const gone of ['Bảng xếp hạng', 'Phòng của tôi', 'Vườn nhà', 'Bảng tin', 'Góc thư giãn', 'Thị trấn Mirabi']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('what does not exist yet says so and is no button; the journal follows the age rule', () => {
    const journal = jest.fn();
    const view = wrap(<MoreTab user={{ ...USER, age: 15, coins: 1200, gems: 30 } as any} onOpenProfile={() => {}} life={{ work: jest.fn(), career: jest.fn(), money: jest.fn() }} onOpenJournal={journal} />);
    expect(screen.getByLabelText('Cửa hàng: Bạn đang có 1.200 xu, 30 pha lê. Sắp có')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cửa hàng/ })).toBeNull();
    expect(screen.queryByTestId('open-journal')).toBeNull();
    view.unmount();
    wrap(<MoreTab user={{ ...USER, age: 20 } as any} onOpenProfile={() => {}} life={{ work: jest.fn(), career: jest.fn(), money: jest.fn() }} onOpenJournal={journal} />);
    fireEvent.press(screen.getByTestId('open-journal'));
    expect(journal).toHaveBeenCalledTimes(1);
  });

  it('Cài đặt: each row opens its screen, and language and dark mode are plain facts', () => {
    const openers = { onOpenProfile: jest.fn(), onChangePassword: jest.fn(), onOpenNotifications: jest.fn(), onOpenPrivacy: jest.fn(), onOpenHelp: jest.fn() };
    wrap(<SettingsScreen user={USER as any} onBack={() => {}} {...openers} />);
    for (const id of ['profile', 'password', 'notifications', 'privacy', 'help']) fireEvent.press(screen.getByTestId(`open-${id}`));
    for (const opener of Object.values(openers)) expect(opener).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Ngôn ngữ: Tiếng Việt/)).toBeTruthy();
    expect(screen.getByLabelText(/^Chế độ tối: .*Sắp có$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ngôn ngữ|Chế độ tối/ })).toBeNull();
  });

  const SOCIAL = { id: 1, display_name: 'Lan', public_code: 'ABCD2345', presence_visibility: 'friends', share_study_stats: true, discoverable: true, allow_room_visits: true, allow_study_invites: true };
  const BLOCKED = { id: 9, display_name: 'Minh', avatar_theme: null, pet: 'cat', pet_name: null, pet_level: 1 };

  it('Nhật ký phản tư opens the journal, once: leaving Góc thư giãn and coming back does not reopen it', async () => {
    mockServer({ 'GET /api/life/journal?limit=20': { status: 200, body: { items: [], next_before: null } } });
    const started = jest.fn();
    const dock = (startJournal: boolean) => <HealingDock userId={1} ambience="cozy_night" onAmbience={() => {}} onPetResponse={() => {}} onPet={() => {}} onResting={() => {}} bottom={0} startJournal={startJournal} onJournalStarted={started} />;
    const view = wrap(dock(true));
    expect(await screen.findByText(/Chỉ mình bạn đọc được nhật ký này/)).toBeTruthy();
    expect(started).toHaveBeenCalledTimes(1);
    view.unmount();
    wrap(dock(false));
    await waitFor(() => expect(screen.queryByText(/Chỉ mình bạn đọc được nhật ký này/)).toBeNull());
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('Quyền riêng tư: switches save to the server, and a block can be taken back', async () => {
    const server = mockServer({ 'GET /api/social/me': { status: 200, body: SOCIAL }, 'GET /api/blocks': { status: 200, body: { items: [BLOCKED] } },
      'PATCH /api/social/me': { status: 200, body: { ...SOCIAL, discoverable: false } }, 'DELETE /api/users/9/block': { status: 204, body: null } });
    wrap(<PrivacyScreen onBack={() => {}} />);
    fireEvent(await screen.findByRole('switch', { name: 'Cho phép tìm theo tên' }), 'valueChange', false);
    await waitFor(() => expect(server.calls.some((c) => c.method === 'PATCH' && c.path === '/api/social/me' && c.body?.discoverable === false)).toBe(true));
    expect(screen.getByText('Người đã chặn (1)')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bỏ chặn' }));
    expect(await screen.findByText('Người đã chặn (0)')).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'DELETE' && c.path === '/api/users/9/block')).toBe(true);
    expect(screen.getByText('Bạn chưa chặn ai')).toBeTruthy();
  });

  it('Quyền riêng tư: a server that fails shows a way to retry, never empty settings', async () => {
    mockServer({ 'GET /api/social/me': { status: 500, body: { detail: 'x' } }, 'GET /api/blocks': { status: 200, body: { items: [] } } });
    wrap(<PrivacyScreen onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Cho phép tìm theo tên' })).toBeNull();
  });

  it('Mời bạn bè shows the real code and promises no reward', async () => {
    mockServer({ 'GET /api/social/me': { status: 200, body: SOCIAL } });
    wrap(<InviteScreen onBack={() => {}} />);
    expect(await screen.findByText('ABCD 2345')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chia sẻ mã' })).toBeTruthy();
    expect(screen.queryByText(/pha lê/)).toBeNull();
  });

  it('Thành tựu opens the achievements, whose keepsake link opens Kho đồ on Kỷ vật; Đổi mật khẩu fills the screen with the account email locked', async () => {
    mockServer({ ...WORLD, 'GET /api/inventory': { status: 200, body: { tabs: [], rarities: [], uses: [], items: [], server_now: new Date().toISOString() } },
      'GET /api/achievements': { status: 200, body: { summary: { unlocked: 0, total: 0, percent: 0, claimable: 0, claimable_coins: 0 }, groups: [],
        tiers: [], achievements: [], near: [], recent: [], daily_tasks_counted: 10, coins: 100 } } });
    await start();
    fireEvent.press(screen.getByRole('tab', { name: 'Tiện ích' }));
    fireEvent.press(await screen.findByTestId('open-achievements'));
    expect(await screen.findByText('Ghi nhận hành trình thật của bạn')).toBeTruthy();
    fireEvent.press(await screen.findByTestId('open-keepsakes'));
    expect((await screen.findByRole('tab', { name: 'Kỷ vật, 0 món' })).props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByRole('tab', { name: 'Tiện ích' }));
    fireEvent.press(await screen.findByTestId('open-settings'));
    fireEvent.press(await screen.findByTestId('open-password'));
    expect(await screen.findByText('Đổi mật khẩu')).toBeTruthy();
    expect(screen.getByTestId('forgot-email').props.value).toBe(USER.email);
    expect(screen.getByTestId('forgot-email').props.editable).toBe(false);
    expect(screen.queryByRole('tab', { name: 'Tiện ích' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Cài đặt và trợ giúp')).toBeTruthy();
  });

  it('seeing the tour again from Trợ giúp goes back when done, without touching onboarding', async () => {
    const server = mockServer(WORLD);
    await start();
    fireEvent.press(screen.getByRole('tab', { name: 'Tiện ích' }));
    fireEvent.press(await screen.findByTestId('open-settings'));
    fireEvent.press(await screen.findByTestId('open-help'));
    fireEvent.press(await screen.findByTestId('replay-tour'));
    fireEvent.press(await screen.findByRole('button', { name: 'Bỏ qua hướng dẫn' }));
    expect(await screen.findByText('Câu hỏi thường gặp')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/onboarding/complete')).toBe(false);
  });

  it('Thị trấn Mirabi is in Bạn bè for those aged 16 and over, not for others', async () => {
    mockServer({ ...WORLD, 'GET /api/auth/me': { status: 200, body: { ...USER, age: 15 } } });
    await start();
    fireEvent.press(screen.getByRole('tab', { name: 'Cuộc sống' }));
    fireEvent.press(await screen.findByRole('tab', { name: 'Bạn bè' }));
    await screen.findByTestId('friends-space');
    expect(screen.queryByTestId('open-town')).toBeNull();
    expect(screen.getByRole('button', { name: 'Bảng tin: Lan tỏa điều tích cực' })).toBeTruthy();
  });
});
