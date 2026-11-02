import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// One subscription for the whole app, however many things are listening: a scene has dozens of loops that all ask.
let current = false;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const set = (value: boolean) => {
      if (value === current) return;
      current = value;
      listeners.forEach((l) => l());
    };
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) set(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', set);
    stop = () => { active = false; sub.remove(); };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
      current = false; // nobody is listening: the next one asks again
    }
  };
}

/** True whenever the "reduce motion" setting is on. False until the OS answers, so an entrance that starts on mount
 * still plays once for someone with the setting on (it runs to its end; nothing is left hidden). Keeps animations
 * available if the native accessibility API is unavailable, rather than leaving the whole app frozen. */
export function useReduceMotion() {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
