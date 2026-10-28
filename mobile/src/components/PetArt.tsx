import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ImageSourcePropType } from 'react-native';
import { petById, PetId } from '../pets';
import { PetActivity, petSprite, SPRITE_LAYOUT, SpriteLayout, stageIndex, WALK_CYCLE_MS } from '../petSprites';
import { useReduceMotion } from './useReduceMotion';

type Props = { pet?: string | null; size: number; stage?: number; /** No idle motion (e.g. small picker cards). */ still?: boolean; /** Add a visible alternating gait while the pet is exploring. */ walking?: boolean;
  /** Play the pet's study strip (reading its book) when it has one. */ studying?: boolean;
  /** A still, blurred one-colour shape of the pet: a stage that is not unlocked yet. */ silhouette?: boolean };

const SILHOUETTE_COLOR = '#93A9BA';

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

/** One linear run from 0 to `toValue`, then a snap back to 0, for use inside Animated.loop. The loop's own reset
 * does not rewind the value on web, so a bare timing would play once and then sit on its last value. */
export const restartFromZero = (value: Animated.Value, toValue: number, duration: number) => Animated.sequence([
  Animated.timing(value, { toValue, duration, easing: Easing.linear, useNativeDriver: true }),
  Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
]);

/** Sheets that have finished loading once, so a remount (idle to walk and back, a new screen) does not flash the
 * still artwork again. */
const loadedSheets = new Set<ImageSourcePropType>();

/** Plays a sprite sheet by sliding it behind a one-frame window, holding each frame (native driver, no re-renders).
 * `paused` holds the first frame. The sheets are large, so `placeholder` (the still artwork) shows until the sheet
 * has loaded, instead of an empty window. */
export function SpriteCycle({ source, size, layout: { cols, rows, cycleMs }, paused, placeholder, once = false, onDone }: {
  source: ImageSourcePropType; size: number; layout: SpriteLayout; paused: boolean; placeholder: ImageSourcePropType;
  /** Play through a single time, starting once the sheet has loaded, then hold the last frame and call `onDone`. */
  once?: boolean; onDone?: () => void;
}) {
  const frames = cols * rows;
  const progress = useRef(new Animated.Value(0)).current;
  const [loaded, setLoaded] = useState(() => loadedSheets.has(source));
  useEffect(() => setLoaded(loadedSheets.has(source)), [source]);
  const onLoad = () => { loadedSheets.add(source); setLoaded(true); };
  const done = useRef(onDone);
  done.current = onDone;
  const ready = once ? loaded : true;
  useEffect(() => {
    progress.setValue(0);
    if (paused || !ready) return;
    const run = once
      ? Animated.timing(progress, { toValue: frames, duration: cycleMs, easing: Easing.linear, useNativeDriver: true })
      : Animated.loop(restartFromZero(progress, frames, cycleMs));
    run.start(({ finished }) => { if (once && finished) done.current?.(); });
    return () => run.stop();
  }, [progress, frames, cycleMs, paused, once, ready]);
  const inputRange: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < frames; i++) {
    inputRange.push(i, i + 0.999);
    const x = -(i % cols) * size, y = -Math.floor(i / cols) * size;
    xs.push(x, x); ys.push(y, y);
  }
  const translateX = progress.interpolate({ inputRange, outputRange: xs, extrapolate: 'clamp' });
  const translateY = progress.interpolate({ inputRange, outputRange: ys, extrapolate: 'clamp' });
  // Pinned to the window's top-left corner: left to flex layout, a sheet taller than its window gets shifted.
  return <Animated.View style={{ width: size, height: size, overflow: 'hidden' }}>
    {!loaded && <Image source={placeholder} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} resizeMode="contain" />}
    <Animated.Image source={source} onLoad={onLoad} style={{ position: 'absolute', left: 0, top: 0, width: size * cols, height: size * rows, opacity: loaded ? 1 : 0, transform: [{ translateX }, { translateY }] }} />
  </Animated.View>;
}

/** The illustrated pet at its evolution stage. It plays its drawn idle / walk / study sheet when it has one; otherwise
 * it gently floats and sways, or bobs while walking. Static (first frame) when "reduce motion" is on. */
export function PetArt({ pet: petId, size, stage = 1, still: stillProp, walking = false, studying = false, silhouette = false }: Props) {
  const reduceMotion = useReduceMotion();
  const still = stillProp || silhouette;
  const activity: PetActivity | null = walking ? 'walk' : studying ? 'study' : still ? null : 'idle';
  const sprite = activity ? petSprite(petId, stage, activity) : undefined;
  const animate = !still && !reduceMotion && !sprite;
  const walk = walking && !reduceMotion && !sprite;
  // An egg's sheets change little from frame to frame, so the egg also breathes, swelling up from where it sits.
  // (Walking already has the scene's gait bounce.)
  const eggBreath = !!sprite && activity !== 'walk' && stageIndex(stage) === 0 && !still && !reduceMotion;
  const swing = useRef(new Animated.Value(0.5)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const gait = useRef(new Animated.Value(0)).current;

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
  if (sprite && activity) {
    const strip = <SpriteCycle source={sprite} size={size} layout={SPRITE_LAYOUT[activity]} paused={reduceMotion} placeholder={petStageArt(petId, stage)} />;
    if (!eggBreath) return strip;
    return <Animated.View style={{ transformOrigin: '50% 100%', transform: [
      { scaleX: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) },
      { scaleY: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
    ] }}>{strip}</Animated.View>;
  }
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY: walk ? gait.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.01, 0] }) : floatY }, { rotate: tilt }] }}>
      <Image source={petStageArt(petId, stage)} style={{ width: size, height: size }} resizeMode="contain"
        tintColor={silhouette ? SILHOUETTE_COLOR : undefined} blurRadius={silhouette ? Math.max(1, size * 0.008) : undefined} />
    </Animated.View>
  );
}
