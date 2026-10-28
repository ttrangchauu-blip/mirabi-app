import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { petById, PetMotion } from '../pets';
import { authTheme } from '../theme';
import { PetArt } from './PetArt';
import { useReduceMotion } from './useReduceMotion';

type Props = {
  /** Pet id from src/pets.ts; unknown ids fall back to Aqua. */
  pet?: string | null;
  size?: number;
  /** Evolution artwork stage, from 0 (egg) to 6 (water king). */
  stage?: number;
  /** Tapping makes the pet jump for joy. */
  interactive?: boolean;
  /**
   * Optional bitmap artwork to show instead of the pet's evolution art from assets/pets/<element>/
   * (see PetArt): add e.g. assets/aqua.png and pass `source={require('../../assets/aqua.png')}`.
   */
  source?: ImageSourcePropType;
};

// One loop cycle per motion: `up` ms to reach t=1, the same back to 0, then `rest` ms still.
const TIMING: Record<PetMotion, { up: number; rest: number }> = {
  float: { up: 1600, rest: 0 }, sway: { up: 1300, rest: 0 }, hop: { up: 320, rest: 700 },
  waddle: { up: 420, rest: 0 }, swim: { up: 1500, rest: 0 }, stroll: { up: 2200, rest: 0 },
};

function motionStyle(motion: PetMotion, t: Animated.Value, size: number) {
  const px = (n: number) => n * size / 140; // offsets are tuned for the default 140px pet
  const range = (from: number | string, to: number | string) => t.interpolate({ inputRange: [0, 1], outputRange: [from, to] as any });
  switch (motion) {
    case 'float': return [{ translateY: range(0, px(-8)) }, { rotate: range('-3deg', '3deg') }];
    case 'sway': return [{ translateY: range(0, px(-3)) }, { rotate: range('-9deg', '9deg') }];
    case 'hop': return [
      { translateY: range(0, px(-18)) },
      { scaleX: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1.1, 0.96, 1] }) },
      { scaleY: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.88, 1.05, 1] }) },
    ];
    case 'waddle': return [{ translateX: range(px(-4), px(4)) }, { rotate: range('-10deg', '10deg') }];
    case 'swim': return [
      { translateX: range(px(-10), px(10)) },
      { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, px(-7), 0] }) },
      { rotate: range('-7deg', '7deg') },
    ];
    case 'stroll': return [{ translateX: range(px(-7), px(7)) }, { rotate: range('-2deg', '2deg') }];
  }
}

/** A pet companion inside a crystal halo tinted by its element. Each pet has its own idle motion; static when "reduce motion" is on. */
export function PetCompanion({ pet: petId, size = 140, stage = 1, interactive = false, source }: Props) {
  const pet = petById(petId);
  const reduceMotion = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  const joy = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(1)).current;
  const firstPet = useRef(pet.id);

  useEffect(() => {
    if (reduceMotion) { t.setValue(0); return; }
    const { up, rest } = TIMING[pet.motion];
    const hop = pet.motion === 'hop';
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: up, easing: hop ? Easing.out(Easing.quad) : Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: up, easing: hop ? Easing.in(Easing.quad) : Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(rest),
    ]));
    t.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pet.motion, t]);

  // Pop in when the pet changes (e.g. while picking one at sign-up), but not on first render.
  useEffect(() => {
    if (pet.id === firstPet.current) return;
    firstPet.current = pet.id;
    if (reduceMotion) return;
    entrance.setValue(0.6);
    Animated.spring(entrance, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
  }, [pet.id, reduceMotion, entrance]);

  function cheer() {
    if (reduceMotion) return;
    joy.stopAnimation();
    joy.setValue(0);
    Animated.sequence([
      Animated.timing(joy, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(joy, { toValue: 0, friction: 3, tension: 140, useNativeDriver: true }),
    ]).start();
  }

  const inner = size * 0.74;
  const artSize = size * 0.9;
  const jump = { translateY: joy.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.18] }) };
  const grow = { scale: Animated.multiply(entrance, joy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })) };
  const label = `${pet.name}, ${pet.species} hệ ${pet.element.label}, đồng hành của bạn`;
  const body = (
    <>
      <LinearGradient colors={pet.element.halo} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.halo, { width: size, height: size, borderRadius: size / 2 }]}>
        <View style={[styles.core, { width: inner, height: inner, borderRadius: inner / 2 }]} />
        <Animated.View style={[styles.art, { transform: [jump, grow, ...motionStyle(pet.motion, t, size)] }]}>
          {source
            ? <Image source={source} style={{ width: artSize, height: artSize }} resizeMode="contain" />
            : <PetArt pet={pet.id} size={artSize} stage={stage} />}
        </Animated.View>
        <Animated.Text style={[styles.heart, { fontSize: size * 0.15, opacity: joy, transform: [{ translateY: joy.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.12] }) }] }]}>
          💙
        </Animated.Text>
      </LinearGradient>
      <Animated.View style={[styles.shadow, { width: size * 0.5, transform: [{ scaleX: t.interpolate({ inputRange: [0, 1], outputRange: [1, pet.motion === 'hop' ? 0.7 : 0.9] }) }] }]} />
    </>
  );

  if (!interactive) {
    return <View style={[styles.wrap, { width: size, height: size + 14 }]} accessible accessibilityRole="image" accessibilityLabel={label}>{body}</View>;
  }
  return (
    <Pressable onPress={cheer} style={[styles.wrap, { width: size, height: size + 14 }]} accessibilityRole="imagebutton"
      accessibilityLabel={label} accessibilityHint={`Chạm để chơi cùng ${pet.name}`}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'center' },
  halo: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: authTheme.shadow, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  core: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.55)' },
  art: { position: 'absolute' },
  heart: { position: 'absolute', left: '10%', top: '8%' },
  shadow: { height: 8, borderRadius: 8, backgroundColor: 'rgba(31,110,158,0.16)', marginTop: 6 },
});
