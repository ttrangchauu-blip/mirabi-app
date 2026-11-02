import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, AppState, Platform } from 'react-native';
import { useReduceMotion } from '../components/useReduceMotion';
import { EASE, restartFromZero } from './motion';

/**
 * How much of the world may move right now.
 * - `full`: everything.
 * - `lite`: a weak device or a device falling behind: fewer drops, tufts and ripples, the same scene.
 * - `still`: the device's "reduce motion" or the account's "Giảm chuyển động": nothing loops; the scene stays at rest and
 *   only short answers to a tap still play.
 * Nothing loops while the app is in the background (no frames for nobody, and no battery spent on them).
 */
export type MotionLevel = 'full' | 'lite' | 'still';

let preference: 'auto' | 'reduced' = 'auto';
let fallingBehind = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setMotionPreference(next: 'auto' | 'reduced') {
  if (next === preference) return;
  preference = next;
  notify();
}
export const motionPreference = () => preference;
/** For tests. */
export function resetMotionBudget() { preference = 'auto'; fallingBehind = false; notify(); }

/** Android older than 10 (API 29) is the one thing known without measuring: those phones are slow at many layers. */
const knownWeak = () => Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 29;

export const levelFor = (reduce: boolean, pref: 'auto' | 'reduced', behind: boolean, weak: boolean): MotionLevel =>
  reduce || pref === 'reduced' ? 'still' : behind || weak ? 'lite' : 'full';

export function useMotionLevel(): MotionLevel {
  const reduce = useReduceMotion();
  const pref = useSyncExternalStore(subscribe, () => preference, () => preference);
  const behind = useSyncExternalStore(subscribe, () => fallingBehind, () => fallingBehind);
  return levelFor(reduce, pref, behind, knownWeak());
}

let appActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
let appStateSubscribers = 0;
let appStateSub: { remove: () => void } | null = null;
function subscribeApp(listener: () => void) {
  listeners.add(listener);
  if (appStateSubscribers++ === 0) {
    appStateSub = AppState.addEventListener('change', (state) => { appActive = state === 'active'; notify(); });
  }
  return () => {
    listeners.delete(listener);
    if (--appStateSubscribers === 0) { appStateSub?.remove(); appStateSub = null; }
  };
}
/** One subscription for the whole app, however many loops are listening. */
export const useAppActive = () => useSyncExternalStore(subscribeApp, () => appActive, () => appActive);

/** Whether loops may run here, and how many of a kind to draw (`lite`: about half). */
export function useWorldMotion() {
  const level = useMotionLevel();
  const active = useAppActive();
  return { level, animate: level !== 'still' && active, count: (full: number) => (level === 'lite' ? Math.max(1, Math.ceil(full / 2)) : full) };
}

// ------------------------------------------------------------------------------------------------ loops
const between = (low: number, high: number) => low + Math.random() * (high - low);

/**
 * A value swinging between -1 and 1 like a leaf or a curtain: each swing takes a slightly different time, and it may
 * pause at either end (`rest`, in ms), so two of them never fall into step and the scene has moments of quiet. Stopped
 * in the background and carried on from where it stood, so nothing jumps on return.
 */
export function useSwing({ ms, jitter = 0.25, rest, enabled = true }: { ms: number; jitter?: number; rest?: [number, number]; enabled?: boolean }) {
  const value = useRef(new Animated.Value(0)).current;
  const { animate } = useWorldMotion();
  const on = animate && enabled;
  const restLow = rest?.[0] ?? 0, restHigh = rest?.[1] ?? 0;
  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let run: Animated.CompositeAnimation | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let direction = Math.random() < 0.5 ? 1 : -1;
    const swing = () => {
      if (stopped) return;
      direction = -direction;
      run = Animated.timing(value, { toValue: direction, duration: ms * between(1 - jitter, 1 + jitter), easing: EASE.leaf, useNativeDriver: true });
      run.start(({ finished }) => {
        if (!finished || stopped) return;
        if (restHigh > 0 && direction < 0) timer = setTimeout(swing, between(restLow, restHigh));
        else swing();
      });
    };
    swing();
    return () => { stopped = true; run?.stop(); if (timer) clearTimeout(timer); };
  }, [on, ms, jitter, restLow, restHigh, value]);
  return value;
}

/**
 * A value running 0 to 1 again and again at one speed: scenery scrolling past, rain falling. It picks up where it
 * stopped after the background. The loop's last value must look the same as its first (whole periods), so there is no
 * jump at the seam.
 */
export function useTravel({ ms, enabled = true, delay = 0 }: { ms: number; enabled?: boolean; delay?: number }) {
  const value = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  const { animate } = useWorldMotion();
  const on = animate && enabled && ms > 0;
  useEffect(() => {
    if (!on) return;
    const finish = Animated.timing(value, { toValue: 1, duration: ms * (1 - at.current), delay, easing: (t) => t, useNativeDriver: true });
    const loop = Animated.loop(restartFromZero(value, 1, ms));
    let stopped = false;
    finish.start(({ finished }) => {
      if (!finished || stopped) return;
      value.setValue(0);
      at.current = 0;
      loop.start();
    });
    return () => {
      stopped = true;
      finish.stop();
      loop.stop();
      value.stopAnimation((where) => { at.current = where % 1; });
    };
  }, [on, ms, delay, value]);
  return value;
}

/** A value that eases towards `target` whenever it changes, for what the weather and the hour change (the wind). */
export function useEased(target: number, ms = 1500) {
  const value = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    const run = Animated.timing(value, { toValue: target, duration: ms, easing: EASE.light, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [target, ms, value]);
  return value;
}

// ------------------------------------------------------------------------------------------------ measuring
/** The time between frames of a stretch of animation, in numbers: what the app decides on, and what a test on a real
 * device reads. */
export function summarizeFrames(deltas: number[]) {
  // A gap this long is the app paused or scrolled away, not a slow frame.
  const frames = deltas.filter((d) => d > 0 && d < 250).sort((a, b) => a - b);
  if (!frames.length) return null;
  const median = frames[Math.floor(frames.length / 2)];
  const p95 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))];
  return { frames: frames.length, medianMs: median, p95Ms: p95, fps: Math.round(1000 / median) };
}

/** A median frame this slow (under about 36 FPS) for a whole sample means the device can't keep up with `full`. */
const BEHIND_MS = 28;
const SAMPLE_MS = 4000;
/** EXPO_PUBLIC_WORLD_PERF=1 writes each sample to the log, for measuring on a device. */
const LOG_FRAMES = __DEV__ && process.env.EXPO_PUBLIC_WORLD_PERF === '1';

/** Watches a scene's first seconds and steps it down to `lite` if the device falls behind. It measures the JS thread:
 * a good sign of a device struggling, though native-driven motion may still be smooth. It stays down for the session. */
export function useFrameWatch(name: string) {
  const { level, animate } = useWorldMotion();
  useEffect(() => {
    if (!animate || (level !== 'full' && !LOG_FRAMES)) return;
    let frame: number | null = null;
    let last = 0;
    const deltas: number[] = [];
    const started = Date.now();
    const tick = (now: number) => {
      if (last) deltas.push(now - last);
      last = now;
      if (Date.now() - started < SAMPLE_MS) { frame = requestAnimationFrame(tick); return; }
      frame = null;
      const stats = summarizeFrames(deltas);
      // eslint-disable-next-line no-console
      if (LOG_FRAMES) console.log(`[world] ${name}`, stats);
      if (stats && stats.frames > 10 && stats.medianMs > BEHIND_MS && !fallingBehind) { fallingBehind = true; notify(); }
    };
    frame = requestAnimationFrame(tick);
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [animate, level, name]);
}
