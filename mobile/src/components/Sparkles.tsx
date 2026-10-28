import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { authTheme } from '../theme';
import { useReduceMotion } from './useReduceMotion';

// Positions are percentages so the field adapts to any screen size.
const SPARKS = [
  { top: '8%', left: '12%', size: 14, delay: 0 }, { top: '14%', left: '82%', size: 18, delay: 600 },
  { top: '32%', left: '6%', size: 10, delay: 1200 }, { top: '42%', left: '90%', size: 12, delay: 300 },
  { top: '64%', left: '10%', size: 16, delay: 900 }, { top: '72%', left: '86%', size: 10, delay: 1500 },
  { top: '88%', left: '24%', size: 12, delay: 450 }, { top: '92%', left: '70%', size: 15, delay: 1100 },
] as const;

function Spark({ top, left, size, delay, color, animate }: (typeof SPARKS)[number] & { color: string; animate: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, delay, t]);
  const opacity = animate ? t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.95] }) : 0.6;
  const translateY = animate ? t.interpolate({ inputRange: [0, 1], outputRange: [4, -6] }) : 0;
  return <Animated.Text style={[styles.spark, { top, left, fontSize: size, color, opacity, transform: [{ translateY }] }]}>✦</Animated.Text>;
}

/** Decorative particle field. Hidden from screen readers; static when the OS "reduce motion" setting is on. */
export function Sparkles() {
  const animate = !useReduceMotion();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {SPARKS.map((s, i) => <Spark key={i} {...s} color={authTheme.sparkle[i % authTheme.sparkle.length]} animate={animate} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  spark: { position: 'absolute', textShadowColor: 'rgba(31,110,158,0.35)', textShadowRadius: 6 },
});
