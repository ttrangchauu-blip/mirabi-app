import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../components/Typography';
import { radius, type as typeScale } from '../../ui/design';
import { makeStyles } from '../../ui/theme';
import { useMotionLevel } from '../../world/budget';
import { DURATION, EASE } from '../../world/motion';
import { SpaceIcon } from './SpaceIcon';
import { type LifeSpace, SPACES, SWITCHER_HEIGHT, SWITCHER_TOP } from './spaces';

/** The four places, always in the same spot at the top. The light behind the chosen one slides over: moving between
 * places is one continuous movement, never a page changing. `badges`: a count on a place (friend requests). */
export function SpaceSwitcher({ space, onChange, badges }: { space: LifeSpace; onChange: (next: LifeSpace) => void; badges?: Partial<Record<LifeSpace, number>> }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const still = useMotionLevel() === 'still';
  const [width, setWidth] = useState(0);
  const index = SPACES.findIndex((x) => x.id === space);
  const slide = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    if (still) { slide.setValue(index); return; }
    const run = Animated.timing(slide, { toValue: index, duration: DURATION.base, easing: EASE.ui, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [index, slide, still]);
  const cell = width / SPACES.length;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  return (
    <View style={[s.bar, { top: insets.top + SWITCHER_TOP, marginLeft: insets.left + 12, marginRight: insets.right + 12 }]} accessibilityRole="tablist" accessibilityLabel="Cuộc sống Mirabi"
      onLayout={onLayout} testID="space-switcher">
      {width ? <Animated.View pointerEvents="none" style={[s.light, { width: cell - 6, transform: [{ translateX: slide.interpolate({ inputRange: [0, SPACES.length - 1], outputRange: [3, 3 + cell * (SPACES.length - 1)] }) }] }]} /> : null}
      {SPACES.map((x) => {
        const on = x.id === space;
        const count = badges?.[x.id] ?? 0;
        return (
          <Pressable key={x.id} onPress={() => onChange(x.id)} style={s.cell} accessibilityRole="tab" accessibilityLabel={x.title} accessibilityState={{ selected: on }}
            accessibilityValue={count > 0 ? { text: `${count} đang chờ` } : undefined} testID={`space-${x.id}`}>
            <View>
              <SpaceIcon space={x.id} size={22} active={on} />
              {count > 0 ? <View style={s.badge} testID={`space-badge-${x.id}`}><Text style={s.badgeText}>{Math.min(99, count)}</Text></View> : null}
            </View>
            <Text style={[s.label, on && s.labelOn]} numberOfLines={1}>{x.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Cuộc sống Mirabi: one place at a time, filling the whole tab, and the switcher over it. A new place comes in with a
 * short settle (under the scene-change limit), so there is no flash of an empty screen. A place that isn't shown isn't
 * mounted: it holds no timers, loops or textures. Back from another place returns to the pet's home.
 */
export function LifeHub({ space, onSpace, badges, immersive = false, children }: {
  space: LifeSpace; onSpace: (next: LifeSpace) => void; badges?: Partial<Record<LifeSpace, number>>;
  /** Decorating needs the whole screen for its own header. */ immersive?: boolean; children: React.ReactNode;
}) {
  const s = useStyles();
  const still = useMotionLevel() === 'still';
  const enter = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (still) { enter.setValue(1); return; }
    enter.setValue(0);
    const run = Animated.timing(enter, { toValue: 1, duration: DURATION.scene, easing: EASE.ui, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [space, enter, still]);
  useEffect(() => {
    if (space === 'home' || immersive) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onSpace('home'); return true; });
    return () => sub.remove();
  }, [space, immersive, onSpace]);
  return (
    <View style={s.fill} testID="life-hub">
      <Animated.View style={[s.fill, { opacity: enter.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.2, 1, 1] }),
        transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [1.018, 1] }) }] }]}>
        {children}
      </Animated.View>
      {immersive ? null : <SpaceSwitcher space={space} onChange={onSpace} badges={badges} />}
    </View>
  );
}

const useStyles = makeStyles(({ t, glass, elevation }) => StyleSheet.create({
  fill: { flex: 1 },
  bar: { position: 'absolute', left: 0, right: 0, height: SWITCHER_HEIGHT, flexDirection: 'row', borderRadius: radius.lg, ...glass, ...elevation.floating },
  light: { position: 'absolute', top: 3, bottom: 3, borderRadius: radius.md, backgroundColor: t.tint },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 1 },
  label: { ...typeScale.micro, color: t.muted, fontWeight: '700' },
  labelOn: { color: t.ink, fontWeight: '900' },
  badge: { position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: t.danger, borderWidth: 1.5, borderColor: t.card, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: t.onPrimary, fontSize: 9, lineHeight: 11, fontWeight: '900' },
}));
