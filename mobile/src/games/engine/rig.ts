import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, ViewStyle } from 'react-native';
import { drawnCelebrateMs, SPRITE_LAYOUT } from '../../petSprites';

// The sprite animation controller of the scene games: one character (the pet, a monster, a creature) and the actions it
// plays, made of transforms on its drawing (move, squash and stretch, turn, flash, fade). Each action is a short
// Animated sequence from rest back to rest; a new one stops the one playing. Idle is a slow breath that runs while the
// scene runs. Nothing re-renders while it plays.

/** `cheer` is a pet's drawn celebration on its own, for a right answer (nothing at all for a pet with none); `celebrate`, for
 * a challenge done, is a bigger one. */
export type Action = 'enter' | 'attack' | 'hit' | 'defeat' | 'jump' | 'celebrate' | 'cast' | 'cheer';
export type Rig = {
  style: Animated.WithAnimatedValue<ViewStyle>;
  /** 0 → 1 → 0 on a hit: a white (or red) flash over the drawing. */
  flash: Animated.Value;
  /** 0 → 1 through an attack drawn by its strip (`attackStrip`): for PetArt's `strike`. Back at rest, the pet is idle. */
  strike: Animated.Value;
  /** 0 → 1 through a jump drawn by its strip (`jumpStrip`), then 0: for PetArt's `leap`. */
  leap: Animated.Value;
  /** 0 → 1 through a celebration drawn by its strip (`celebrateStrip`), then 0: for PetArt's `cheer`. */
  cheer: Animated.Value;
  play: (action: Action, done?: () => void) => void;
  reset: () => void;
  /** Stops what is playing (its `done` is not called) and puts the character at rest, or gone (after a defeat). */
  stop: (gone?: boolean) => void;
};

/** `facing`: 1 looks right (the pet), -1 looks left (a monster): attacks lunge that way, hits push the other way.
 * `attackStrip`: the attack is drawn, lunge and all, so `attack` plays that strip and moves nothing itself. `jumpStrip`:
 * the same for `jump`, rise and fall included (and for the jumps of `celebrate`). `celebrateStrip`: `celebrate` is a jump,
 * then that strip, with no turning on top. */
export function useRig({ facing = 1, idle = true, running = true, reduceMotion = false, reach = 26, attackStrip = false, jumpStrip = false, celebrateStrip = false }: {
  facing?: 1 | -1; idle?: boolean; running?: boolean; reduceMotion?: boolean; reach?: number; attackStrip?: boolean; jumpStrip?: boolean; celebrateStrip?: boolean;
} = {}): Rig {
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const sx = useRef(new Animated.Value(1)).current;
  const sy = useRef(new Animated.Value(1)).current;
  const rot = useRef(new Animated.Value(0)).current;
  const alpha = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const strike = useRef(new Animated.Value(0)).current;
  const leap = useRef(new Animated.Value(0)).current;
  const cheer = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const current = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!idle || !running || reduceMotion) { breath.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(breath, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [idle, running, reduceMotion, breath]);
  useEffect(() => () => current.current?.stop(), []);

  return useMemo(() => {
    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
      Animated.timing(v, { toValue, duration, easing, useNativeDriver: false });
    const rest = () => { x.setValue(0); y.setValue(0); sx.setValue(1); sy.setValue(1); rot.setValue(0); alpha.setValue(1); flash.setValue(0); strike.setValue(0); leap.setValue(0); cheer.setValue(0); };
    const steps: Record<Action, () => Animated.CompositeAnimation> = {
      enter: () => { x.setValue(-facing * 120); alpha.setValue(0); return Animated.parallel([t(x, 0, 520, Easing.out(Easing.back(1.4))), t(alpha, 1, 300)]); },
      attack: () => attackStrip ? t(strike, 1, SPRITE_LAYOUT.attack.cycleMs, Easing.linear) : Animated.sequence([
        Animated.parallel([t(x, -facing * 8, 120), t(sx, 0.9, 120)]),
        Animated.parallel([t(x, facing * reach, 140, Easing.out(Easing.quad)), t(sx, 1.12, 140), t(rot, facing * 6, 140)]),
        Animated.parallel([t(x, 0, 260), t(sx, 1, 260), t(rot, 0, 260)]),
      ]),
      cast: () => Animated.sequence([
        Animated.parallel([t(y, -10, 180, Easing.out(Easing.quad)), t(sy, 1.08, 180)]),
        Animated.parallel([t(y, 0, 220, Easing.in(Easing.quad)), t(sy, 1, 220)]),
      ]),
      hit: () => { flash.setValue(1); return Animated.parallel([
        Animated.sequence([t(x, -facing * 14, 70), t(x, facing * 6, 90), t(x, -facing * 4, 80), t(x, 0, 90)]),
        Animated.sequence([t(sx, 0.9, 70), t(sx, 1, 220)]),
        t(flash, 0, 380),
      ]); },
      defeat: () => Animated.sequence([
        Animated.parallel([t(sy, 0.55, 220, Easing.in(Easing.quad)), t(sx, 1.3, 220)]),
        Animated.parallel([t(sy, 1.4, 260), t(sx, 0.4, 260), t(y, -30, 260), t(alpha, 0, 300), t(rot, facing * -25, 300)]),
      ]),
      jump: () => jumpStrip ? Animated.sequence([t(leap, 1, SPRITE_LAYOUT.jump.cycleMs, Easing.linear), t(leap, 0, 0)]) : Animated.sequence([
        Animated.parallel([t(sy, 0.85, 90), t(sx, 1.1, 90)]),
        Animated.parallel([t(y, -34, 220, Easing.out(Easing.quad)), t(sy, 1.1, 220), t(sx, 0.92, 220)]),
        Animated.parallel([t(y, 0, 220, Easing.in(Easing.quad)), t(sy, 1, 220), t(sx, 1, 220)]),
      ]),
      cheer: () => Animated.sequence([t(cheer, 1, SPRITE_LAYOUT.celebrate.cycleMs, Easing.linear), t(cheer, 0, 0)]),
      celebrate: () => celebrateStrip ? Animated.sequence([steps.jump(), steps.cheer()]) : Animated.sequence([steps.jump(), Animated.sequence([t(rot, 8, 120), t(rot, -8, 160), t(rot, 0, 120)]), steps.jump()]),
    };
    const play = (action: Action, done?: () => void) => {
      if (action === 'cheer' && !celebrateStrip) { done?.(); return; } // nothing to show: what is playing goes on
      current.current?.stop();
      if (reduceMotion) {
        rest();
        if (action === 'defeat') alpha.setValue(0);
        done?.();
        return;
      }
      if (action !== 'defeat') rest();
      const anim = steps[action]();
      current.current = anim;
      anim.start(({ finished }) => { if (finished) done?.(); });
    };
    const bob = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
    const style = {
      opacity: alpha,
      transform: [{ translateX: x }, { translateY: y }, { rotate: rot.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) },
        { scaleX: sx }, { scaleY: Animated.multiply(sy, bob) }],
    } as Animated.WithAnimatedValue<ViewStyle>;
    const stop = (gone = false) => { current.current?.stop(); current.current = null; rest(); if (gone) alpha.setValue(0); };
    return { style, flash, strike, leap, cheer, play, reset: rest, stop };
  }, [facing, reach, reduceMotion, attackStrip, jumpStrip, celebrateStrip]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** For a game with no rig of its own: while `on` turns true, the pet's drawn celebration plays once (for PetArt's `cheer`). */
export function usePetCheer(petId: string | null | undefined, stage: number, on: boolean, reduceMotion = false) {
  const cheer = useRef(new Animated.Value(0)).current;
  const ms = drawnCelebrateMs(petId, stage, reduceMotion);
  useEffect(() => {
    cheer.setValue(0);
    if (!on || !ms) return;
    const run = Animated.sequence([
      Animated.timing(cheer, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: false }),
      Animated.timing(cheer, { toValue: 0, duration: 0, useNativeDriver: false }),
    ]);
    run.start();
    return () => run.stop();
  }, [on, ms, cheer]);
  return cheer;
}
