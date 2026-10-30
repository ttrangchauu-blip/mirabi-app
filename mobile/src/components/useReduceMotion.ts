import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** True whenever the "reduce motion" setting is on. False until the OS answers, so an entrance that starts on mount
 * still plays once for someone with the setting on (it runs to its end; nothing is left hidden). */
export function useReduceMotion() {
  // Keep animations available while the platform preference is being queried. If the
  // native accessibility API is unavailable, don't leave the whole app frozen.
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduce(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { active = false; sub.remove(); };
  }, []);
  return reduce;
}
