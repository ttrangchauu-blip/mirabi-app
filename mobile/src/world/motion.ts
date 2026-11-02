import { Animated, Easing, type EasingFunction } from 'react-native';

/**
 * How things move in the living world (docs/LIVING_WORLD.md). A movement is an `Act`: named beats, from anticipation to
 * settle, so nothing just slides or fades. Everything is timed in milliseconds of real time (never by counting frames),
 * so a 120 Hz phone and a 60 Hz one play the same movement, and runs on the native driver (transform and opacity only).
 */

/** Scene changes and small feedback: 200–500 ms, by how much of the screen moves. */
export const DURATION = { tap: 120, quick: 200, base: 280, scene: 360, slow: 500 } as const;

/** Each kind of thing has its own feel: cloth drifts, water eases out, a landing overshoots, light never hurries. */
export const EASE = {
  pet: Easing.inOut(Easing.quad),
  rise: Easing.out(Easing.quad),
  fall: Easing.in(Easing.quad),
  land: Easing.out(Easing.back(1.6)),
  cloth: Easing.inOut(Easing.sin),
  leaf: Easing.inOut(Easing.sin),
  water: Easing.out(Easing.sin),
  light: Easing.inOut(Easing.cubic),
  ui: Easing.out(Easing.cubic),
} as const satisfies Record<string, EasingFunction>;

export type BeatName = 'anticipation' | 'primary' | 'secondary' | 'followThrough' | 'settle';

/** One beat of an act. `lift` is a share of the pet's height above its baseline; `squash` is positive for wide and short
 * (crouching, landing) and negative for tall and narrow (stretching in the air); `tilt` is in degrees. */
export type Beat = { beat: BeatName; ms: number; lift?: number; squash?: number; tilt?: number; ease?: EasingFunction };
export type Act = readonly Beat[];

const REST = { lift: 0, squash: 0, tilt: 0 };

export const PET_ACTS = {
  /** A happy little hop: "Trò chuyện", a confirmed tap. */
  hop: [
    { beat: 'anticipation', ms: 90, squash: 0.45, ease: EASE.pet },
    { beat: 'primary', ms: 150, lift: 0.14, squash: -0.4, ease: EASE.rise },
    { beat: 'followThrough', ms: 130, lift: 0, squash: -0.1, ease: EASE.fall },
    { beat: 'secondary', ms: 80, squash: 0.45, ease: EASE.pet },
    { beat: 'settle', ms: 170, ease: EASE.land },
  ],
  /** A real jump: crouch, launch, hang, fall, land, recover. */
  jump: [
    { beat: 'anticipation', ms: 140, squash: 0.85, ease: EASE.pet },
    { beat: 'primary', ms: 190, lift: 0.3, squash: -0.6, ease: EASE.rise },
    { beat: 'secondary', ms: 70, lift: 0.32, squash: -0.1 },
    { beat: 'followThrough', ms: 170, lift: 0, squash: -0.35, ease: EASE.fall },
    { beat: 'secondary', ms: 90, squash: 0.8, ease: EASE.pet },
    { beat: 'settle', ms: 200, ease: EASE.land },
  ],
  /** "Vuốt ve": leans into the hand, twice, the second time softer. */
  lean: [
    { beat: 'anticipation', ms: 100, squash: -0.12, tilt: 1, ease: EASE.pet },
    { beat: 'primary', ms: 220, squash: 0.55, tilt: -3, ease: EASE.pet },
    { beat: 'followThrough', ms: 200, squash: -0.1, tilt: 1.5, ease: EASE.pet },
    { beat: 'secondary', ms: 200, squash: 0.35, tilt: -2, ease: EASE.pet },
    { beat: 'settle', ms: 200, ease: EASE.pet },
  ],
  /** "Cho ăn": waits for the treat (it takes 480 ms to arrive), then nibbles. */
  nibble: [
    { beat: 'anticipation', ms: 440, squash: -0.15, lift: 0.01, ease: EASE.pet },
    { beat: 'primary', ms: 100, squash: 0.5, ease: EASE.fall },
    { beat: 'secondary', ms: 100, squash: 0, lift: 0.03, ease: EASE.rise },
    { beat: 'primary', ms: 100, squash: 0.45, lift: 0, ease: EASE.fall },
    { beat: 'settle', ms: 180, ease: EASE.land },
  ],
  /** "Chơi cùng": crouches and leaps after the ball, then a smaller bounce. */
  pounce: [
    { beat: 'anticipation', ms: 120, squash: 0.8, tilt: 2, ease: EASE.pet },
    { beat: 'primary', ms: 200, lift: 0.26, squash: -0.5, tilt: -4, ease: EASE.rise },
    { beat: 'followThrough', ms: 180, lift: 0, squash: -0.2, tilt: 0, ease: EASE.fall },
    { beat: 'secondary', ms: 80, squash: 0.6, ease: EASE.pet },
    { beat: 'primary', ms: 140, lift: 0.1, squash: -0.25, ease: EASE.rise },
    { beat: 'followThrough', ms: 130, lift: 0, ease: EASE.fall },
    { beat: 'settle', ms: 150, ease: EASE.land },
  ],
  /** Its whole body says it: two jumps turning side to side (back from a walk, a gift). */
  celebrate: [
    { beat: 'anticipation', ms: 140, squash: 0.85, ease: EASE.pet },
    { beat: 'primary', ms: 180, lift: 0.3, squash: -0.6, tilt: -6, ease: EASE.rise },
    { beat: 'followThrough', ms: 170, lift: 0, squash: -0.25, tilt: -2, ease: EASE.fall },
    { beat: 'secondary', ms: 90, squash: 0.75, tilt: 0, ease: EASE.pet },
    { beat: 'primary', ms: 170, lift: 0.22, squash: -0.5, tilt: 6, ease: EASE.rise },
    { beat: 'followThrough', ms: 160, lift: 0, squash: -0.2, tilt: 2, ease: EASE.fall },
    { beat: 'secondary', ms: 80, squash: 0.6, tilt: 0, ease: EASE.pet },
    { beat: 'settle', ms: 190, ease: EASE.land },
  ],
  /** Weight shifting before the first step. */
  stepOff: [
    { beat: 'anticipation', ms: 90, squash: 0.3, ease: EASE.pet },
    { beat: 'settle', ms: 110, ease: EASE.pet },
  ],
  /** Coming to a stop: the body carries on a little, then rests. */
  stop: [
    { beat: 'followThrough', ms: 110, squash: 0.28, tilt: 1, ease: EASE.fall },
    { beat: 'settle', ms: 170, ease: EASE.land },
  ],
} as const satisfies Record<string, Act>;

export type ActName = keyof typeof PET_ACTS;

/** One linear run from 0 to `toValue`, then a snap back to 0, for use inside Animated.loop. The loop's own reset
 * does not rewind the value on web, so a bare timing would play once and then sit on its last value. */
export const restartFromZero = (value: Animated.Value, toValue: number, duration: number) => Animated.sequence([
  Animated.timing(value, { toValue, duration, easing: Easing.linear, useNativeDriver: true }),
  Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
]);

export const actDuration = (act: Act) => act.reduce((sum, b) => sum + b.ms, 0);

export type ActValues = { lift: Animated.Value; squash: Animated.Value; tilt: Animated.Value };
export const newActValues = (): ActValues => ({ lift: new Animated.Value(0), squash: new Animated.Value(0), tilt: new Animated.Value(0) });

/** Where each value stands after each beat: a value a beat doesn't name goes back to rest only if that beat is the last. */
export function poseAfterBeats(act: Act) {
  const pose = { ...REST };
  return act.map((b, i) => {
    const last = i === act.length - 1;
    pose.lift = b.lift ?? (last ? 0 : pose.lift);
    pose.squash = b.squash ?? (last || b.beat === 'primary' ? 0 : pose.squash);
    pose.tilt = b.tilt ?? (last ? 0 : pose.tilt);
    return { ...pose };
  });
}

/** Plays an act from wherever the values are, and leaves them at rest. */
export function playAct(act: Act, values: ActValues) {
  const poses = poseAfterBeats(act);
  return Animated.sequence(act.map((b, i) => Animated.parallel((['lift', 'squash', 'tilt'] as const).map((key) =>
    Animated.timing(values[key], { toValue: poses[i][key], duration: b.ms, easing: b.ease ?? EASE.pet, useNativeDriver: true })))));
}

/** The transform of a pet playing acts. Scales grow from the feet (put `transformOrigin: '50% 100%'` on the view), so
 * its baseline and its size at rest never change, whichever act was playing. */
export function actTransform(values: ActValues, size: number) {
  return [
    { translateY: values.lift.interpolate({ inputRange: [0, 1], outputRange: [0, -size] }) },
    { rotate: values.tilt.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
    { scaleX: values.squash.interpolate({ inputRange: [-1, 1], outputRange: [0.93, 1.07] }) },
    { scaleY: values.squash.interpolate({ inputRange: [-1, 1], outputRange: [1.09, 0.91] }) },
  ];
}
