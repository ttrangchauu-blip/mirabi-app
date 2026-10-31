import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, ViewStyle } from 'react-native';

// The sprite animation controller of the scene games: one character (the pet, a monster, a creature) and the actions it
// plays, made of transforms on its drawing (move, squash and stretch, turn, flash, fade). Each action is a short
// Animated sequence from rest back to rest; a new one stops the one playing. Idle is a slow breath that runs while the
// scene runs. Nothing re-renders while it plays.

export type Action = 'enter' | 'attack' | 'hit' | 'defeat' | 'jump' | 'celebrate' | 'cast';
export type Rig = {
  style: Animated.WithAnimatedValue<ViewStyle>;
  /** 0 → 1 → 0 on a hit: a white (or red) flash over the drawing. */
  flash: Animated.Value;
  play: (action: Action, done?: () => void) => void;
  reset: () => void;
  /** Stops what is playing (its `done` is not called) and puts the character at rest, or gone (after a defeat). */
  stop: (gone?: boolean) => void;
};

/** `facing`: 1 looks right (the pet), -1 looks left (a monster): attacks lunge that way, hits push the other way. */
export function useRig({ facing = 1, idle = true, running = true, reduceMotion = false, reach = 26 }: {
  facing?: 1 | -1; idle?: boolean; running?: boolean; reduceMotion?: boolean; reach?: number;
} = {}): Rig {
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const sx = useRef(new Animated.Value(1)).current;
  const sy = useRef(new Animated.Value(1)).current;
  const rot = useRef(new Animated.Value(0)).current;
  const alpha = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;
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
    const rest = () => { x.setValue(0); y.setValue(0); sx.setValue(1); sy.setValue(1); rot.setValue(0); alpha.setValue(1); flash.setValue(0); };
    const steps: Record<Action, () => Animated.CompositeAnimation> = {
      enter: () => { x.setValue(-facing * 120); alpha.setValue(0); return Animated.parallel([t(x, 0, 520, Easing.out(Easing.back(1.4))), t(alpha, 1, 300)]); },
      attack: () => Animated.sequence([
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
      jump: () => Animated.sequence([
        Animated.parallel([t(sy, 0.85, 90), t(sx, 1.1, 90)]),
        Animated.parallel([t(y, -34, 220, Easing.out(Easing.quad)), t(sy, 1.1, 220), t(sx, 0.92, 220)]),
        Animated.parallel([t(y, 0, 220, Easing.in(Easing.quad)), t(sy, 1, 220), t(sx, 1, 220)]),
      ]),
      celebrate: () => Animated.sequence([steps.jump(), Animated.sequence([t(rot, 8, 120), t(rot, -8, 160), t(rot, 0, 120)]), steps.jump()]),
    };
    const play = (action: Action, done?: () => void) => {
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
    return { style, flash, play, reset: rest, stop };
  }, [facing, reach, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
}
