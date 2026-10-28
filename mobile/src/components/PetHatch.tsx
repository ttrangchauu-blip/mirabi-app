import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { HATCH_LAYOUT, petHatchSprite } from '../petSprites';
import { PetArt, petStageArt, SpriteCycle } from './PetArt';
import { useReduceMotion } from './useReduceMotion';

type Props = { pet: string; stage: number; size: number;
  /** The shell has given way and the pet is stepping out. */ onCracked: () => void;
  /** The pet is fully out; the caller can go back to the plain pet. */ onDone: () => void };

/**
 * The egg hatching in place: it rocks while cracks spread over its shell (the pet's hatch sheet, or its still egg
 * when it has none), a soft flash, then the pet at `stage` pops out. "Reduce motion" skips straight to the pet.
 */
export function PetHatch({ pet, stage, size, onCracked, onDone }: Props) {
  const reduceMotion = useReduceMotion();
  const [cracking, setCracking] = useState(!reduceMotion);
  const wobble = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const sheet = petHatchSprite(pet);
  const callbacks = useRef({ onCracked, onDone });
  callbacks.current = { onCracked, onDone };

  useEffect(() => {
    if (!reduceMotion) return;
    callbacks.current.onCracked();
    callbacks.current.onDone();
  }, [reduceMotion]);

  // The egg rocks while it cracks.
  useEffect(() => {
    if (!cracking) return;
    const rock = (deg: number, ms: number) => Animated.timing(wobble, { toValue: deg, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([rock(-3, 160), rock(3, 320), rock(0, 160), Animated.delay(260)]));
    loop.start();
    return () => { loop.stop(); wobble.setValue(0); };
  }, [cracking, wobble]);

  // Without a hatch sheet the still egg rocks for as long as the sheet would have played.
  useEffect(() => {
    if (!cracking || sheet) return;
    const timer = setTimeout(hatch, HATCH_LAYOUT.cycleMs);
    return () => clearTimeout(timer);
  }, [cracking, sheet]);

  function hatch() {
    setCracking(false);
    callbacks.current.onCracked();
    Animated.parallel([
      Animated.timing(burst, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(reveal, { toValue: 1, speed: 9, bounciness: 9, useNativeDriver: true }),
    ]).start(() => callbacks.current.onDone());
  }

  if (reduceMotion) return <PetArt pet={pet} size={size} stage={stage} still />;
  const tilt = wobble.interpolate({ inputRange: [-3, 3], outputRange: ['-3deg', '3deg'] });
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    accessible accessibilityLabel={cracking ? 'Trứng đang nở' : 'Pet vừa nở'}>
    {cracking ? <Animated.View style={{ transformOrigin: '50% 100%', transform: [{ rotate: tilt }] }}>
      {sheet ? <SpriteCycle source={sheet} size={size} layout={HATCH_LAYOUT} paused={false} placeholder={petStageArt(pet, 0)} once onDone={hatch} />
        : <Image source={petStageArt(pet, 0)} style={{ width: size, height: size }} resizeMode="contain" />}
    </Animated.View> : <>
      {/* A soft flash where the egg was. */}
      <Animated.View pointerEvents="none" style={[styles.flash, { width: size, height: size, borderRadius: size / 2,
        opacity: burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.95, 0] }),
        transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.6] }) }],
      }]} />
      <Animated.View style={{ opacity: reveal.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
        transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
        <PetArt pet={pet} size={size} stage={stage} />
      </Animated.View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  flash: { position: 'absolute', backgroundColor: '#FFF8DC' },
});
