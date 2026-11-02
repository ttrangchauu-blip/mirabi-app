import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// The scene manager's backdrop: layers at several depths (sky still, far slow, near fast), each a strip two widths long
// whose second half repeats the first, scrolled by transform and wrapped at one width (no seam, no re-render).
// `travel` moves the camera (the pet walking on: 1 = one step); `drift` keeps the far layers moving slowly while the
// scene runs. Both stop with reduced motion.

export type Layer = { key: string; speed: number; render: (width: number, height: number) => React.ReactNode };

export function Parallax({ width, height, layers, travel, step = 160, drift = 0, running = true, reduceMotion = false }: {
  width: number; height: number; layers: Layer[]; travel?: Animated.Value; step?: number; drift?: number; running?: boolean; reduceMotion?: boolean;
}) {
  const idle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!drift || !running || reduceMotion || !width) return;
    const loop = Animated.loop(Animated.timing(idle, { toValue: 1, duration: 60000 / drift, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [drift, running, reduceMotion, width, idle]);
  if (!width || !height) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {layers.map((layer) => {
        if (!layer.speed) return <View key={layer.key} style={StyleSheet.absoluteFill}>{layer.render(width, height)}</View>;
        const moved = Animated.add(
          travel ? Animated.multiply(travel, step * layer.speed) : new Animated.Value(0),
          idle.interpolate({ inputRange: [0, 1], outputRange: [0, width * layer.speed] }),
        );
        const x = Animated.multiply(Animated.modulo(moved, width), -1);
        return (
          <Animated.View key={layer.key} style={[styles.strip, { width: width * 2, height, transform: [{ translateX: x }] }]}>
            {layer.render(width, height)}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ strip: { position: 'absolute', left: 0, top: 0 } });
