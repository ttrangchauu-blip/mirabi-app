import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { drawnCelebrateMs } from '../petSprites';
import { useWorldMotion } from './budget';
import { newActValues, PET_ACTS, playAct } from './motion';

/**
 * One celebration each time `trigger` goes up: the pet's drawn celebrate strip when it has one (pass `cheer` to PetArt), else a
 * hop of its body (`values`, for actTransform). Starts from 0, so a screen opened with `trigger` at 1 plays once. Nothing plays
 * with "reduce motion" on. `on` says it is playing, so what the pet was doing can wait and go on afterwards.
 */
export function useCelebration(trigger: number, pet: string | null | undefined, stage: number) {
  const cheer = useRef(new Animated.Value(0)).current;
  const values = useRef(newActValues()).current;
  const { animate } = useWorldMotion();
  const [on, setOn] = useState(false);
  const seen = useRef(0);
  useEffect(() => {
    if (trigger === seen.current) return;
    seen.current = trigger;
    if (!trigger || !animate) return;
    const ms = drawnCelebrateMs(pet, stage);
    cheer.setValue(0);
    setOn(true);
    const run = ms
      ? Animated.timing(cheer, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true })
      : playAct(PET_ACTS.celebrate, values);
    run.start(() => { cheer.setValue(0); setOn(false); });
    return () => run.stop();
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps
  return { cheer, values, on };
}
