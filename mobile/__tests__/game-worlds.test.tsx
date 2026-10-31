import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import type { LearningSession, Turn } from '../src/learning/types';
import {
  Asteroid, AsteroidVariant, Laser, Planet, PLANET_KINDS, Rocket, RocketGlass, Rubble, SpaceLayer, SpaceLayerKind, Thruster,
} from '../src/games/art/space';
import {
  Artifact, ARTIFACT_KINDS, DigMound, EraClouds, ERAS, EraScene, Owl, OwlMood, PortalSwirl, TimeGate,
} from '../src/games/art/timeTravel';
import { FogCloud, MAP_STOPS, MapBoard, MapFlag, routeAt, stopFractions } from '../src/games/art/treasureMap';
import { createSoundGate, Cue, GAP_MS, SfxProvider, useSfxPlayers, WINDOW_MS } from '../src/games/engine/sfx';
import { KingdomQuest } from '../src/games/quests/KingdomQuest';
import { LabQuest } from '../src/games/quests/LabQuest';
import { MapQuest, placesReached } from '../src/games/quests/MapQuest';
import type { QuestProps } from '../src/games/quests/QuestProps';
import { SpaceQuest } from '../src/games/quests/SpaceQuest';
import { TimeQuest } from '../src/games/quests/TimeQuest';
import { WorldQuest } from '../src/games/quests/WorldQuest';
import {
  artifactsFound, eraIndex, planetCount, planetsRescued, potionLevel, QUEST_KINDS, tripEras, worldOf,
} from '../src/games/quests/worlds';
import { GameScreen } from '../src/screens/learning/GameScreen';
import { QUEST_RIGHT_MAX_MS } from '../src/games/quests/worlds';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

// The worlds of the lesson games (Space Adventure, Time Traveler, Treasure Explorer, Magic Laboratory, Math Kingdom):
// their art, the rules of their progress, their sounds, and how each scene answers a right and a wrong answer.

const renders = (element: React.ReactElement) => expect(() => render(element).unmount()).not.toThrow();
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });

describe('the worlds\' art', () => {
  it('draws Space Adventure: the backdrop, the rocket, asteroids, shots and every planet asleep and rescued', () => {
    for (const layer of ['sky', 'far', 'near'] as SpaceLayerKind[]) renders(<SpaceLayer layer={layer} width={390} height={200} />);
    renders(<SpaceLayer layer="far" width={0} height={0} />);
    renders(<Rocket size={110} />);
    renders(<RocketGlass size={110} />);
    renders(<Thruster size={50} />);
    for (const v of [0, 1, 2] as AsteroidVariant[]) { renders(<Asteroid size={56} variant={v} />); renders(<Rubble size={16} variant={v} />); }
    renders(<Laser size={46} />);
    for (const kind of PLANET_KINDS) for (const rescued of [true, false]) renders(<Planet size={90} kind={kind} rescued={rescued} />);
  });

  it('draws Time Traveler: every era, the gate, every artifact, the mound and the owl in every mood', () => {
    for (const era of ERAS) renders(<EraScene era={era} width={390} height={200} />);
    renders(<EraScene era="stone" width={0} height={0} />);
    renders(<EraClouds width={390} height={200} />);
    for (const lit of [true, false]) renders(<TimeGate size={76} lit={lit} />);
    renders(<PortalSwirl size={50} />);
    expect(new Set(ARTIFACT_KINDS).size).toBe(ARTIFACT_KINDS.length);
    for (const kind of ARTIFACT_KINDS) renders(<Artifact size={44} kind={kind} />);
    for (const dug of [true, false]) renders(<DigMound size={64} dug={dug} />);
    for (const mood of ['idle', 'talk', 'cheer', 'worry'] as OwlMood[]) renders(<Owl size={48} mood={mood} />);
  });

  it('draws Treasure Explorer: the map, fog and flags', () => {
    renders(<MapBoard width={390} height={210} />);
    renders(<MapBoard width={0} height={0} />);
    renders(<FogCloud size={62} />);
    renders(<MapFlag size={30} />);
  });

  it('the trail goes through every place in order, from the start to the treasure, and the pet walks on it', () => {
    for (const aspect of [1.4, 1.9, 2.4]) {
      const f = stopFractions(aspect);
      expect(f[0]).toBe(0);
      expect(f[f.length - 1]).toBeCloseTo(1, 6);
      for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
      MAP_STOPS.forEach((s, i) => {
        const p = routeAt(f[i], aspect);
        expect(p.x).toBeCloseTo(s.u, 3);
        expect(p.y).toBeCloseTo(s.v, 3);
      });
      expect(routeAt(-1, aspect)).toEqual(routeAt(0, aspect));
      expect(routeAt(2, aspect)).toEqual(routeAt(1, aspect));
    }
    expect(placesReached(0, 1.9)).toBe(1); // the start
    expect(placesReached(1, 1.9)).toBe(MAP_STOPS.length);
  });
});

describe('the worlds\' rules', () => {
  it('the backend names the world; an older session goes by its subject; a subject without one has none', () => {
    const s = (code: string, world?: string | null) => ({ subject: { id: 1, code, name: code },
      catalog: world === undefined ? undefined : { world } as LearningSession['catalog'] });
    expect(worldOf(s('history_geography', 'map'))).toBe('map');
    expect(worldOf(s('history_geography'))).toBe('time');
    expect(worldOf(s('math'))).toBe('kingdom');
    expect(worldOf(s('english'))).toBe('space');
    expect(worldOf(s('physics'))).toBe('lab');
    expect(worldOf(s('music'))).toBeNull();
    expect(worldOf(s('math', null))).toBeNull(); // the backend says: no world for this lesson
    expect([...QUEST_KINDS].sort()).toEqual(['choice_explain', 'match_pairs', 'order_steps', 'sort_card']);
  });

  it('Space Adventure: one planet for a short stage, up to three; each rescued with its share of the answers', () => {
    expect([1, 3, 4, 8, 9, 15].map(planetCount)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(Array.from({ length: 11 }, (_, d) => planetsRescued(d, 10))).toEqual([0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
    expect(planetsRescued(12, 10)).toBe(3);
    expect(planetsRescued(0, 0)).toBe(0);
  });

  it('Time Traveler: an era per three questions from the oldest; finds come from the era they were dug in', () => {
    expect(tripEras(2)).toEqual(['stone']);
    expect(tripEras(6)).toEqual(['stone', 'bronze']);
    expect(tripEras(10)).toEqual(['stone', 'bronze', 'feudal', 'modern']);
    expect(Array.from({ length: 11 }, (_, d) => eraIndex(d, 10))).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(artifactsFound(6, 6)).toEqual(['axe', 'jar', 'axe', 'drum', 'jar', 'drum']);
    expect(artifactsFound(0, 6)).toEqual([]);
    expect(artifactsFound(9, 6)).toHaveLength(6);
  });

  it('Magic Laboratory: the potion fills with the answers', () => {
    expect([0, 5, 10, 12].map((d) => potionLevel(d, 10))).toEqual([0, 0.5, 1, 1]);
    expect(potionLevel(3, 0)).toBe(0);
  });
});

describe('the worlds\' sounds', () => {
  it('the same cue never restarts within its gap, and at most two start together', () => {
    const gate = createSoundGate();
    expect(gate('cast', 0)).toBe(true);
    expect(gate('cast', GAP_MS - 1)).toBe(false);
    expect(gate('hit', 10)).toBe(true);
    expect(gate('pickup', 20)).toBe(false); // a third within the window
    expect(gate('pickup', WINDOW_MS + 10)).toBe(true);
    expect(gate('cast', WINDOW_MS + 20)).toBe(true);
  });

  it('play: silent while "Âm thanh" is off; otherwise at the learner\'s volume', () => {
    const player = require('expo-audio').useAudioPlayer();
    let play: (cue: Cue) => void = () => {};
    const Probe = ({ on, volume }: { on: boolean; volume: 'low' | 'high' }) => { play = useSfxPlayers(on, volume); return null; };
    const view = render(<Probe on={false} volume="high" />);
    player.play.mockClear();
    play('cast');
    expect(player.play).not.toHaveBeenCalled();
    view.rerender(<Probe on volume="low" />);
    play('cast');
    expect(player.play).toHaveBeenCalledTimes(1);
    const low = player.volume;
    view.rerender(<Probe on volume="high" />);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    play('cast');
    expect(player.volume).toBeGreaterThan(low);
    jest.restoreAllMocks();
    view.unmount();
  });
});

describe('the worlds\' scenes', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  const base: QuestProps = { done: 0, total: 6, wrongKey: 0, petId: 'fox', petLevel: 1, reduceMotion: false, running: true };
  function scene(Quest: React.ComponentType<QuestProps>) {
    const cues: Cue[] = [];
    const view = render(<SfxProvider play={(c) => cues.push(c)}><Quest {...base} /></SfxProvider>);
    const set = (over: Partial<QuestProps>) => view.rerender(<SfxProvider play={(c) => cues.push(c)}><Quest {...base} {...over} /></SfxProvider>);
    return { view, set, cues };
  }

  it('Space Adventure: a right answer fires the laser and breaks the asteroid; a planet\'s share rescues it', () => {
    const { view, set, cues } = scene(SpaceQuest);
    expect(screen.getByLabelText('Tàu của pet bay tới Hành tinh Đại Dương; đã giải cứu 0 trên 2 hành tinh')).toBeTruthy();
    set({ done: 1 });
    ms(3000);
    expect(cues).toEqual(['shot', 'break']);
    set({ done: 2 }); ms(1200); set({ done: 3 }); ms(4000);
    expect(cues).toContain('unlock');
    expect(screen.getByLabelText('Tàu của pet bay tới Hành tinh Rừng Xanh; đã giải cứu 1 trên 2 hành tinh')).toBeTruthy();
    set({ done: 3, wrongKey: 1 });
    expect(cues[cues.length - 1]).toBe('wrong');
    set({ done: 6, wrongKey: 1 }); ms(5000);
    expect(screen.getByLabelText('Đã giải cứu cả 2 hành tinh!')).toBeTruthy();
    expect(cues).toContain('complete');
    view.unmount();
  });

  it('Time Traveler: each right answer digs up an artifact; an era\'s share opens the gate into the next', () => {
    const { view, set, cues } = scene(TimeQuest);
    expect(screen.getByLabelText('Thời nguyên thuỷ: pet đã tìm được 0 hiện vật')).toBeTruthy();
    set({ done: 1 }); ms(2000);
    expect(screen.getByLabelText('Bộ sưu tập: Rìu đá')).toBeTruthy();
    expect(cues).toEqual(['pickup']);
    set({ done: 2 }); ms(2000); set({ done: 3 }); ms(5000);
    expect(cues).toEqual(expect.arrayContaining(['unlock', 'whoosh']));
    expect(screen.getByLabelText('Thời đồ đồng: pet đã tìm được 3 hiện vật')).toBeTruthy();
    set({ done: 3, wrongKey: 1 });
    expect(cues[cues.length - 1]).toBe('wrong');
    set({ done: 6, wrongKey: 1 }); ms(5000);
    expect(screen.getByLabelText('Chuyến du hành hoàn thành: tìm được 6 hiện vật')).toBeTruthy();
    view.unmount();
  });

  it('Treasure Explorer: the pet walks the trail, the fog lifts from each place reached, the chest opens at the end', () => {
    const { view, set, cues } = scene(MapQuest);
    expect(screen.getByLabelText('Pet ở Bến xuất phát, đang đi tới Làng ven đồi')).toBeTruthy();
    set({ done: 2 }); ms(2000);
    expect(cues).toEqual(['pickup', 'unlock']);
    expect(screen.queryByLabelText(/Pet ở Bến xuất phát/)).toBeNull();
    set({ done: 2, wrongKey: 1 });
    expect(cues[cues.length - 1]).toBe('wrong');
    set({ done: 6, wrongKey: 1 }); ms(2000);
    expect(screen.getByLabelText('Pet đã tới đảo kho báu, rương mở ra')).toBeTruthy();
    expect(cues[cues.length - 1]).toBe('complete');
    view.unmount();
  });

  it('Magic Laboratory: each ingredient fills the potion; the last sets it bubbling and lights the bulb', () => {
    const { view, set, cues } = scene(LabQuest);
    expect(screen.getByLabelText('Bình tri thức đầy 0%')).toBeTruthy();
    set({ done: 3 }); ms(1500);
    expect(screen.getByLabelText('Bình tri thức đầy 50%')).toBeTruthy();
    expect(cues).toEqual(['cast', 'pickup']);
    set({ done: 3, wrongKey: 1 });
    expect(cues[cues.length - 1]).toBe('wrong');
    set({ done: 6, wrongKey: 1 }); ms(1500);
    expect(screen.getByLabelText('Bình tri thức đã pha xong, bóng đèn sáng')).toBeTruthy();
    expect(cues[cues.length - 1]).toBe('complete');
    view.unmount();
  });

  it('Math Kingdom: the lesson\'s answers are the pet\'s spells against the monsters, with no hearts or problem card', () => {
    const { view, set, cues } = scene(KingdomQuest);
    expect(screen.getByLabelText('Rừng phép thuật: pet đấu với Slime')).toBeTruthy();
    expect(screen.queryByLabelText(/Máu của pet/)).toBeNull();
    expect(screen.queryByLabelText(/Bài toán/)).toBeNull();
    set({ done: 1 }); ms(1500);
    expect(cues).toEqual(['cast', 'hit']);
    set({ done: 2 }); ms(4000);
    expect(cues).toContain('break');
    expect(screen.getByLabelText('Hang pha lê: pet đấu với Nấm phép thuật')).toBeTruthy(); // the next zone
    view.unmount();
  });

  it('held for "Câu tiếp theo": the answer plays at once, the next challenge comes only once released', () => {
    // Math Kingdom: the monster is defeated, the next one walks in (and the stage number moves) only then.
    let { view, set, cues } = scene(KingdomQuest);
    set({ done: 1 }); ms(1500);
    set({ done: 2, hold: true }); ms(6000);
    expect(cues).toContain('break');
    expect(screen.getByLabelText('Rừng phép thuật: pet đấu với Slime')).toBeTruthy();
    expect(screen.getByLabelText(/^Màn 1 trên/)).toBeTruthy();
    set({ done: 2, hold: false }); ms(3000);
    expect(screen.getByLabelText('Hang pha lê: pet đấu với Nấm phép thuật')).toBeTruthy();
    expect(screen.getByLabelText(/^Màn 2 trên/)).toBeTruthy();
    view.unmount();
    // Time Traveler: the artifact is dug up at once; the gate into the next era opens only then.
    ({ view, set, cues } = scene(TimeQuest));
    set({ done: 1 }); ms(2000); set({ done: 2 }); ms(2000);
    set({ done: 3, hold: true }); ms(6000);
    expect(screen.getByLabelText('Thời nguyên thuỷ: pet đã tìm được 3 hiện vật')).toBeTruthy();
    expect(cues).not.toContain('whoosh');
    set({ done: 3, hold: false }); ms(5000);
    expect(screen.getByLabelText('Thời đồ đồng: pet đã tìm được 3 hiện vật')).toBeTruthy();
    view.unmount();
    // Space Adventure: the planet is rescued at once; the next one comes into view only then.
    ({ view, set, cues } = scene(SpaceQuest));
    set({ done: 1 }); ms(3000); set({ done: 2 }); ms(3000);
    set({ done: 3, hold: true }); ms(6000);
    expect(cues).toContain('unlock');
    expect(screen.getByLabelText('Tàu của pet bay tới Hành tinh Đại Dương; đã giải cứu 1 trên 2 hành tinh')).toBeTruthy();
    set({ done: 3, hold: false }); ms(3000);
    expect(screen.getByLabelText('Tàu của pet bay tới Hành tinh Rừng Xanh; đã giải cứu 1 trên 2 hành tinh')).toBeTruthy();
    view.unmount();
  });

  it('with reduced motion every scene shows where the stage is at once', () => {
    for (const Quest of [SpaceQuest, TimeQuest, MapQuest, LabQuest] as React.ComponentType<QuestProps>[]) {
      const view = render(<Quest {...base} reduceMotion done={0} />);
      view.rerender(<Quest {...base} reduceMotion done={6} />);
      ms(100);
      view.unmount();
    }
    const view = render(<WorldQuest world="lab" kind="order_steps" {...base} reduceMotion done={6} />);
    expect(screen.getByLabelText('Bình tri thức đã pha xong, bóng đèn sáng')).toBeTruthy();
    view.unmount();
  });
});

describe('a lesson game in its world', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  });
  afterEach(() => { jest.useRealTimers(); });

  const ref = (id: number, code: string, name: string) => ({ id, code, name });
  const turn = (kind: Turn['kind'], prompt: Turn['prompt']): Turn => ({ turn_id: 'turn-c1', position: 0, kind, skill_label: 'x', prompt,
    hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0, on_screen_ms: 0 });
  const order = turn('order_steps', { prompt: 'Xếp các mốc theo thời gian', cards: [{ id: 'c1', text: 'Năm 938' }, { id: 'c2', text: 'Năm 1010' }] });
  const session = (code: string, world: LearningSession['catalog'] extends infer C ? C extends { world?: infer W } ? W : never : never,
    over: Partial<LearningSession> = {}): LearningSession => ({
    id: 7, status: 'active', kind: 'lesson', mode: 'practice', game_type: 'order' as any, variant: null, game: 'order' as any,
    subject: ref(6, code, code), topic: ref(9, 't', 't'), level: ref(1, 'g9', 'Lớp 9'), lesson: ref(5, 'l', 'l'),
    duration_seconds: 3600, active_ms: 0, remaining_ms: 3_600_000, time_up: false, timed: false, hearts: 0, hearts_max: 0, score: 0, combo: 0,
    max_combo: 0, required_count: 6, resolved_count: 0, pending_practice: 0, open_turns: [order], can_complete: false, end_reason: null,
    reward: null, version: 1, server_time: '2026-10-30T10:00:00Z',
    catalog: { lesson: 'lsdl9.x', title: 'Bài', grade: 9, game: 'order' as any, game_title: 'Dòng thời gian', short_stage: false, subject_name: null,
      other_games: [], next: null, world }, ...over });
  const prefs = { sound: false, volume: 'mid' as const, reduceMotion: true, setSound: jest.fn(), setVolume: jest.fn(), setReduceMotion: jest.fn() };

  async function play(s: LearningSession, routes: Record<string, unknown> = {}, motion = false) {
    mockServer({ 'POST /api/learning/sessions/7/resume': { status: 200, body: { result: null, session: s, replayed: false } }, ...routes } as never);
    render(<ToastProvider><ConfirmProvider>
      <GameScreen initial={s} petId="fox" petLevel={1} prefs={{ ...prefs, reduceMotion: !motion }} onEnded={jest.fn()} />
    </ConfirmProvider></ToastProvider>);
    for (let i = 0; i < 5; i++) await act(async () => { jest.advanceTimersByTime(1000); });
  }

  it('Lịch sử và Địa lí: the world the backend names (time or map) is drawn above the game, the game stays playable', async () => {
    await play(session('history_geography', 'time'));
    expect(await screen.findByLabelText('Thời nguyên thuỷ: pet đã tìm được 0 hiện vật')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Thẻ Năm 938' }));
    expect(screen.getByRole('button', { name: 'Gỡ Năm 938' })).toBeTruthy();
  });

  it('the map for an Địa lí lesson; nothing drawn for a subject without a world', async () => {
    await play(session('history_geography', 'map'));
    expect(await screen.findByLabelText('Pet ở Bến xuất phát, đang đi tới Làng ven đồi')).toBeTruthy();
    screen.unmount();
    await play(session('music', null));
    expect(await screen.findByRole('button', { name: 'Thẻ Năm 938' })).toBeTruthy();
    expect(screen.queryByLabelText(/Pet ở|hiện vật|hành tinh|Bình tri thức|pet đấu với/)).toBeNull();
  });

  it('a right answer: the world reacts first, then the explanation; the world stays after the last question', async () => {
    const choice = turn('choice_explain', { style: 'quiz', question: 'Năm 938 có sự kiện gì?', options: [{ id: 'a', text: 'Chiến thắng Bạch Đằng' },
      { id: 'b', text: 'Dời đô về Thăng Long' }] });
    const start = session('history_geography', 'time', { open_turns: [choice], required_count: 1 });
    const done = session('history_geography', 'time', { open_turns: [], required_count: 1, resolved_count: 1, can_complete: true });
    await play(start, {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: { turn_id: 'turn-c1', event: 'answer', correct: true, outcome: 'first_try',
        resolved: true, retry_allowed: false, error_type: null, score_delta: 0, hearts_delta: 0, combo: 1, hint: null, correct_answer: 'a',
        explanation: 'Ngô Quyền đánh tan quân Nam Hán trên sông Bạch Đằng.', practice_added: false, feedback: null }, session: done, replayed: false } },
    }, true);
    fireEvent.press(await screen.findByRole('button', { name: 'Chiến thắng Bạch Đằng' }));
    await act(async () => { jest.advanceTimersByTime(200); });
    // The find rises from the mound and the trip ends; the explanation waits, and the stage does not finish yet.
    expect(screen.getByLabelText(/^Chuyến du hành hoàn thành/)).toBeTruthy();
    expect(screen.queryByText('Ngô Quyền đánh tan quân Nam Hán trên sông Bạch Đằng.')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(QUEST_RIGHT_MAX_MS); });
    expect(screen.getByText('Ngô Quyền đánh tan quân Nam Hán trên sông Bạch Đằng.')).toBeTruthy();
    expect(screen.getByLabelText('Chuyến du hành hoàn thành: tìm được 1 hiện vật')).toBeTruthy(); // on the shelf
  });

  it('Toán lớp 1, Sắp xếp: until "Câu tiếp theo" only the question answered and its monster are on screen, never the next', async () => {
    const ascending = { ...turn('order_steps', { title: 'Xếp số theo thứ tự', prompt: 'Xếp các số theo thứ tự từ bé đến lớn.',
      cards: [{ id: 'c1', text: '6' }, { id: 'c2', text: '5' }, { id: 'c3', text: '8' }, { id: 'c4', text: '2' }], first: 'Bé nhất', last: 'Lớn nhất' }) };
    const descending = { ...turn('order_steps', { title: 'Xếp số theo thứ tự', prompt: 'Xếp các số theo thứ tự từ lớn đến bé.',
      cards: [{ id: 'c1', text: '3' }, { id: 'c2', text: '0' }, { id: 'c3', text: '7' }], first: 'Lớn nhất', last: 'Bé nhất' }), turn_id: 'turn-c2' };
    // The first monster has taken one hit already: this right answer defeats it.
    const math = (over: Partial<LearningSession>) => session('math', 'kingdom', { required_count: 6, resolved_count: 1, ...over });
    await play(math({ open_turns: [ascending] }), {
      'POST /api/learning/sessions/7/answer': { status: 200, body: { result: { turn_id: 'turn-c1', event: 'answer', correct: true,
        outcome: 'first_try', resolved: true, retry_allowed: false, error_type: null, score_delta: 0, hearts_delta: 0, combo: 0, hint: null,
        correct_answer: '2 → 5 → 6 → 8', explanation: '5 và 6 đứng liền nhau khi đếm: 5 trước, 6 sau.', practice_added: false, feedback: null },
        session: math({ open_turns: [descending], resolved_count: 2, version: 3 }), replayed: false } },
    }, true);
    for (const n of ['2', '5', '6', '8']) fireEvent.press(await screen.findByRole('button', { name: `Thẻ ${n}` }));
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra' }));
    await act(async () => { jest.advanceTimersByTime(0); });
    for (let i = 0; i < 10; i++) await act(async () => { jest.advanceTimersByTime(1000); });
    // The monster is down and the explanation is there; nothing of the next question or the next monster yet.
    expect(screen.getByText('Xếp các số theo thứ tự từ bé đến lớn.')).toBeTruthy();
    expect(screen.getByText('5 và 6 đứng liền nhau khi đếm: 5 trước, 6 sau.')).toBeTruthy();
    expect(screen.queryByText('Xếp các số theo thứ tự từ lớn đến bé.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Kiểm tra' })).toHaveLength(1);
    expect(screen.getByLabelText('Rừng phép thuật: pet đấu với Slime')).toBeTruthy();
    expect(screen.getByLabelText(/^Màn 1 trên/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    await act(async () => { jest.advanceTimersByTime(0); });
    // Now the next question, alone, and the next monster walks in.
    expect(screen.getByText('Xếp các số theo thứ tự từ lớn đến bé.')).toBeTruthy();
    expect(screen.queryByText('Xếp các số theo thứ tự từ bé đến lớn.')).toBeNull();
    expect(screen.queryByTestId('answer-feedback')).toBeNull();
    for (let i = 0; i < 4; i++) await act(async () => { jest.advanceTimersByTime(1000); });
    expect(screen.getByLabelText('Hang pha lê: pet đấu với Nấm phép thuật')).toBeTruthy();
    expect(screen.getByLabelText(/^Màn 2 trên/)).toBeTruthy();
  });
});
