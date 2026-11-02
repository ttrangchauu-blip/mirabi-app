import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, ImageSourcePropType, View } from 'react-native';
import { petById, PetId } from '../pets';
import { ACTION_WINDOW, moveActivity, PetAction, PetActivity, petSprite, SPRITE_LAYOUT, SpriteLayout, stageIndex, WALK_CYCLE_MS } from '../petSprites';
import { restartFromZero } from '../world/motion';
import { useReduceMotion } from './useReduceMotion';

type Props = { pet?: string | null; size: number; stage?: number; /** No idle motion (e.g. small picker cards). */ still?: boolean; /** Add a visible alternating gait while the pet is exploring. */ walking?: boolean;
  /** Play the pet's study strip (reading its book) when it has one. */ studying?: boolean;
  /** In a game, the pet darting right (1) or left (-1): plays its move strip for that way when it has one, otherwise
   * it walks (and the caller mirrors the walk strip for left, see hasSprite). */ moving?: 1 | -1;
  /** With `moving`: an unhurried stroll rather than a dart, the same strip at half speed. */ strolling?: boolean;
  /** A still, blurred one-colour shape of the pet: a stage that is not unlocked yet. */ silhouette?: boolean;
  /** With `moving` or `walking`: how far through its strip the pet's steps are (1 = one full loop), set by the caller
   * from the distance it actually walked, so its feet stay planted at any speed. Without it the strip plays on its own
   * clock. */ phase?: Animated.Value;
  /** In a game: 0 → 1 through one attack (the caller's clock, shared with its shot, see useRig). While it runs the pet
   * shows its drawn attack strip at that point, if it has one; at rest, whatever it was doing. */ strike?: Animated.Value;
  /** With `strike`: 1 attacks to the right, as drawn, -1 mirrored. */ strikeFacing?: Animated.Value;
  /** In a game: 0 → 1 through one jump, in the same way: its drawn jump strip, if it has one. */ leap?: Animated.Value;
  /** In a game: 0 → 1 through one celebration, in the same way: its drawn celebrate strip, if it has one. */ cheer?: Animated.Value };

const SILHOUETTE_COLOR = '#93A9BA';
/** The idle strip's blinks and waves come at uneven moments: it rests on its first frame this long between rounds. */
const IDLE_REST = [300, 2600] as const;

/** Evolution artwork, Lv.0 (egg) to Lv.6 (king), cut from each element's character sheet. */
const STAGE_ART: Record<PetId, ImageSourcePropType[]> = {
  dolphin: [
    require('../../assets/pets/water/Lv0_Trung_Pet.png'),
    require('../../assets/pets/water/Lv1_So_Sinh.png'),
    require('../../assets/pets/water/Lv2_Phat_Trien.png'),
    require('../../assets/pets/water/Lv3_Nang_Cao.png'),
    require('../../assets/pets/water/Lv4_Truong_Thanh.png'),
    require('../../assets/pets/water/Lv5_Dai_Than.png'),
    require('../../assets/pets/water/Lv6_Vua_Nuoc.png'),
  ],
  fox: [
    require('../../assets/pets/fire/Lv0_Trung_Pet.png'),
    require('../../assets/pets/fire/Lv1_So_Sinh.png'),
    require('../../assets/pets/fire/Lv2_Phat_Trien.png'),
    require('../../assets/pets/fire/Lv3_Nang_Cao.png'),
    require('../../assets/pets/fire/Lv4_Truong_Thanh.png'),
    require('../../assets/pets/fire/Lv5_Dai_Than.png'),
    require('../../assets/pets/fire/Lv6_Vua_Lua.png'),
  ],
  turtle: [
    require('../../assets/pets/grass/Lv0_Trung_Pet.png'),
    require('../../assets/pets/grass/Lv1_So_Sinh.png'),
    require('../../assets/pets/grass/Lv2_Phat_Trien.png'),
    require('../../assets/pets/grass/Lv3_Nang_Cao.png'),
    require('../../assets/pets/grass/Lv4_Truong_Thanh.png'),
    require('../../assets/pets/grass/Lv5_Dai_Than.png'),
    require('../../assets/pets/grass/Lv6_Vua_Co.png'),
  ],
  penguin: [
    require('../../assets/pets/ice/Lv0_Trung_Pet.png'),
    require('../../assets/pets/ice/Lv1_So_Sinh.png'),
    require('../../assets/pets/ice/Lv2_Phat_Trien.png'),
    require('../../assets/pets/ice/Lv3_Nang_Cao.png'),
    require('../../assets/pets/ice/Lv4_Truong_Thanh.png'),
    require('../../assets/pets/ice/Lv5_Dai_Than.png'),
    require('../../assets/pets/ice/Lv6_Vua_Bang.png'),
  ],
  bunny: [
    require('../../assets/pets/electric/Lv0_Trung_Pet.png'),
    require('../../assets/pets/electric/Lv1_So_Sinh.png'),
    require('../../assets/pets/electric/Lv2_Phat_Trien.png'),
    require('../../assets/pets/electric/Lv3_Nang_Cao.png'),
    require('../../assets/pets/electric/Lv4_Truong_Thanh.png'),
    require('../../assets/pets/electric/Lv5_Dai_Than.png'),
    require('../../assets/pets/electric/Lv6_Vua_Dien.png'),
  ],
  cat: [
    require('../../assets/pets/mist/Lv0_Trung_Pet.png'),
    require('../../assets/pets/mist/Lv1_So_Sinh.png'),
    require('../../assets/pets/mist/Lv2_Phat_Trien.png'),
    require('../../assets/pets/mist/Lv3_Nang_Cao.png'),
    require('../../assets/pets/mist/Lv4_Truong_Thanh.png'),
    require('../../assets/pets/mist/Lv5_Dai_Than.png'),
    require('../../assets/pets/mist/Lv6_Vua_Suong.png'),
  ],
};

export const petStageArt = (petId: string | null | undefined, stage: number) => STAGE_ART[petById(petId).id][stageIndex(stage)];

export { restartFromZero };

/** A size in whole points. Scenes size the pet from their own width (89.5 points, say); on web a large image shrunk
 * into a box that is not a whole number of pixels is drawn without smoothing, so its edges come out jagged. */
const wholePixels = (size: number) => Math.max(1, Math.round(size));

/** Sheets that have finished loading once, so a remount (idle to walk and back, a new screen) does not flash the
 * still artwork again. */
const loadedSheets = new Set<ImageSourcePropType>();

/** Sheets already downloaded ahead of time (Asset.loadAsync): they show at once, so a quick move (a fraction of a
 * second) plays its own strip from the first time instead of the still artwork. */
export const markSheetsLoaded = (sources: ImageSourcePropType[]) => sources.forEach((s) => loadedSheets.add(s));

/** Plays a sprite sheet by sliding it behind a one-frame window, holding each frame (native driver, no re-renders).
 * `paused` holds the first frame. The sheets are large, so `placeholder` (the still artwork) shows until the sheet
 * has loaded, instead of an empty window. */
export function SpriteCycle({ source, size: rawSize, layout: { cols, rows, cycleMs }, paused, placeholder, once = false, onDone, phase, naturalRest, onLoaded }: {
  source: ImageSourcePropType; size: number; layout: SpriteLayout; paused: boolean;
  /** Nothing shows in its place when left out. */ placeholder?: ImageSourcePropType;
  /** The sheet has just loaded. */ onLoaded?: () => void;
  /** Drives the frame from outside (1 = one loop) instead of the strip's own clock. */ phase?: Animated.Value;
  /** Play through a single time, starting once the sheet has loaded, then hold the last frame and call `onDone`. */
  once?: boolean; onDone?: () => void;
  /** Between two runs of the strip it holds its first frame for a while in this range (ms), a different one each time. */
  naturalRest?: readonly [number, number];
}) {
  const size = wholePixels(rawSize);
  const frames = cols * rows;
  const progress = useRef(new Animated.Value(0)).current;
  // Worked out while rendering, not synced in an effect: on a switch to a sheet still loading (idle to walk, a new
  // stage) the first frame drawn would otherwise show that empty sheet instead of the still artwork.
  const [loadedSource, setLoadedSource] = useState<ImageSourcePropType | null>(null);
  const loaded = loadedSheets.has(source) || loadedSource === source;
  const onLoad = () => { loadedSheets.add(source); setLoadedSource(source); onLoaded?.(); };
  const done = useRef(onDone);
  done.current = onDone;
  const ready = once ? loaded : true;
  useEffect(() => {
    progress.setValue(0);
    if (paused || !ready || phase) return;
    if (naturalRest) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let play: Animated.CompositeAnimation | null = null;
      const round = () => {
        if (stopped) return;
        progress.setValue(0);
        play = Animated.timing(progress, { toValue: frames, duration: cycleMs, easing: Easing.linear, useNativeDriver: true });
        play.start(({ finished }) => {
          if (!finished || stopped) return;
          progress.setValue(0);
          timer = setTimeout(round, naturalRest[0] + Math.random() * (naturalRest[1] - naturalRest[0]));
        });
      };
      round();
      return () => { stopped = true; play?.stop(); if (timer) clearTimeout(timer); };
    }
    const run = once
      ? Animated.timing(progress, { toValue: frames, duration: cycleMs, easing: Easing.linear, useNativeDriver: true })
      : Animated.loop(restartFromZero(progress, frames, cycleMs));
    run.start(({ finished }) => { if (once && finished) done.current?.(); });
    return () => run.stop();
  }, [progress, frames, cycleMs, paused, once, ready, phase, naturalRest]);
  const inputRange: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < frames; i++) {
    inputRange.push(i, i + 0.999);
    const x = -(i % cols) * size, y = -Math.floor(i / cols) * size;
    xs.push(x, x); ys.push(y, y);
  }
  const driver = useMemo(() => (phase && !paused ? Animated.modulo(Animated.multiply(phase, frames), frames) : progress),
    [phase, paused, frames, progress]);
  const translateX = driver.interpolate({ inputRange, outputRange: xs, extrapolate: 'clamp' });
  const translateY = driver.interpolate({ inputRange, outputRange: ys, extrapolate: 'clamp' });
  // Pinned to the window's top-left corner: left to flex layout, a sheet taller than its window gets shifted.
  return <Animated.View style={{ width: size, height: size, overflow: 'hidden' }}>
    {!loaded && placeholder && <Image source={placeholder} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} resizeMode="contain" />}
    <Animated.Image source={source} onLoad={onLoad} style={{ position: 'absolute', left: 0, top: 0, width: size * cols, height: size * rows, opacity: loaded ? 1 : 0, transform: [{ translateX }, { translateY }] }} />
  </Animated.View>;
}

/** A one-off drawn action over what the pet is doing (`children`): 0 → 1 on `value` shows the action's strip at that point;
 * at rest, what it was doing. The strip is on stage from the start, unseen: phones show a picture that has been drawn once
 * at once, where one mounted as the action begins can leave the pet blank for its first frames. One of the two shows at a
 * time, so it can sit under the other (and until its sheet has loaded, the pet just stays as it is). An even margin keeps
 * it on whole points: the sheets are cut to the pixel. */
function ActionStrip({ action, sheet, size, value, facing, children }: { action: PetAction; sheet: ImageSourcePropType; size: number; value: Animated.Value;
  facing?: Animated.Value; children: React.ReactNode }) {
  const [loadedSheet, setLoadedSheet] = useState<ImageSourcePropType | null>(null);
  const ready = loadedSheets.has(sheet) || loadedSheet === sheet;
  const acting = useMemo(() => value.interpolate({ inputRange: [0, 0.001, 0.999, 1], outputRange: [0, 1, 1, 0] }), [value]);
  const notActing = useMemo(() => value.interpolate({ inputRange: [0, 0.001, 0.999, 1], outputRange: [1, 0, 0, 1] }), [value]);
  const inset = Math.round((size * (ACTION_WINDOW[action] - 1)) / 2);
  return <View style={{ width: size, height: size }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -inset, bottom: 0, opacity: ready ? acting : 0,
      transform: facing ? [{ scaleX: facing }] : [] }}>
      <SpriteCycle source={sheet} size={size + inset * 2} layout={SPRITE_LAYOUT[action]} paused={false} phase={value} onLoaded={() => setLoadedSheet(sheet)} />
    </Animated.View>
    <Animated.View style={{ width: size, height: size, opacity: ready ? notActing : 1 }}>{children}</Animated.View>
  </View>;
}

/** The illustrated pet at its evolution stage. It plays its drawn idle / walk / study sheet when it has one; otherwise
 * it gently floats and sways, or bobs while walking. Static (first frame) when "reduce motion" is on. */
export function PetArt({ pet: petId, size: rawSize, stage = 1, still: stillProp, walking: walkingProp = false, studying = false, moving,
  strolling = false, silhouette = false, phase, strike, strikeFacing, leap, cheer }: Props) {
  const size = wholePixels(rawSize);
  const reduceMotion = useReduceMotion();
  const still = stillProp || silhouette;
  // `still` wins over `moving`: a paused or finished game keeps the pet standing, not running on the spot.
  const move = moving && !still ? moveActivity(moving) : null;
  const drawnMove = !!move && !!petSprite(petId, stage, move);
  const walking = walkingProp || (!!move && !drawnMove);
  const activity: PetActivity | null = drawnMove ? move : walking ? 'walk' : studying ? 'study' : still ? null : 'idle';
  const sprite = activity ? petSprite(petId, stage, activity) : undefined;
  const animate = !still && !reduceMotion && !sprite;
  const walk = walking && !reduceMotion && !sprite;
  // An egg's sheets change little from frame to frame, so the egg also breathes, swelling up from where it sits.
  // (Walking and moving already have their own bounce.)
  const eggBreath = !!sprite && (activity === 'idle' || activity === 'study') && stageIndex(stage) === 0 && !still && !reduceMotion;
  const swing = useRef(new Animated.Value(0.5)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const gait = useRef(new Animated.Value(0)).current;
  const strikeSheet = strike && !reduceMotion ? petSprite(petId, stage, 'attack') : undefined;
  const leapSheet = leap && !reduceMotion ? petSprite(petId, stage, 'jump') : undefined;
  const cheerSheet = cheer && !reduceMotion ? petSprite(petId, stage, 'celebrate') : undefined;

  useEffect(() => {
    swing.setValue(0.5); breathe.setValue(0);
    if (!animate && !eggBreath) return;
    const ease = Easing.inOut(Easing.sin);
    const loops = [
      Animated.loop(Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1800, easing: ease, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1800, easing: ease, useNativeDriver: true }),
      ])),
    ];
    if (animate) loops.push(Animated.loop(Animated.sequence([
      Animated.timing(swing, { toValue: 1, duration: 1600, easing: ease, useNativeDriver: true }),
      Animated.timing(swing, { toValue: 0, duration: 1600, easing: ease, useNativeDriver: true }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [animate, eggBreath, swing, breathe]);

  useEffect(() => {
    if (!walk) { gait.stopAnimation(); gait.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(gait, { toValue: 1, duration: WALK_CYCLE_MS / 4, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(gait, { toValue: 0, duration: WALK_CYCLE_MS / 4, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [walk, gait]);

  const floatY = breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.035] });
  const tilt = swing.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  let body: React.ReactElement;
  if (sprite && activity) {
    const layout = SPRITE_LAYOUT[activity];
    // Walking in step (`phase`) only for the strips that move it; a new key when the driver changes, so a strip never
    // swaps a natively driven frame for one set from JS.
    const paced = activity === 'walk' || activity === 'moveRight' || activity === 'moveLeft' ? phase : undefined;
    const strip = <SpriteCycle key={paced ? 'paced' : 'clock'} source={sprite} size={size}
      layout={drawnMove && strolling ? { ...layout, cycleMs: layout.cycleMs * 2 } : layout}
      paused={reduceMotion} placeholder={petStageArt(petId, stage)} phase={paced} naturalRest={activity === 'idle' ? IDLE_REST : undefined} />;
    body = !eggBreath ? strip : <Animated.View style={{ transformOrigin: '50% 100%', transform: [
      { scaleX: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) },
      { scaleY: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
    ] }}>{strip}</Animated.View>;
  } else {
    body = (
      <Animated.View style={{ width: size, height: size, transform: [{ translateY: walk ? gait.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.01, 0] }) : floatY }, { rotate: tilt }] }}>
        <Image source={petStageArt(petId, stage)} style={{ width: size, height: size }} resizeMode="contain"
          tintColor={silhouette ? SILHOUETTE_COLOR : undefined} blurRadius={silhouette ? Math.max(1, size * 0.008) : undefined} />
      </Animated.View>
    );
  }
  if (cheerSheet) body = <ActionStrip action="celebrate" sheet={cheerSheet} size={size} value={cheer!}>{body}</ActionStrip>;
  if (leapSheet) body = <ActionStrip action="jump" sheet={leapSheet} size={size} value={leap!}>{body}</ActionStrip>;
  if (strikeSheet) body = <ActionStrip action="attack" sheet={strikeSheet} size={size} value={strike!} facing={strikeFacing}>{body}</ActionStrip>;
  return body;
}
