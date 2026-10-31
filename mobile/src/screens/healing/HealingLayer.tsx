import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { Ambience } from '../../life/types';
import { AMBIENCES } from './ambience';

/**
 * Góc thư giãn's light over the whole room: a faint colour grade that cross-fades when the scene changes. Everything
 * else (the windows' sky and weather, the lamps' glow) is drawn into the room itself by RoomAmbience, where the room's
 * own windows and lamps are. It never takes a touch; with "reduce motion" on it appears without fading.
 */
export const HealingLayer = memo(function HealingLayer({ ambience }: { ambience: Ambience }) {
  const reduce = useReduceMotion();
  const fade = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { fade.setValue(1); return; }
    fade.setValue(0);
    const anim = Animated.timing(fade, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [ambience, reduce, fade]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none" testID={`healing-layer-${ambience}`}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <LinearGradient colors={AMBIENCES[ambience].tint} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
});
