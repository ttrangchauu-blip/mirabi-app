import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PetArt } from '../../components/PetArt';
import { drawnActions, hasSprite } from '../../petSprites';
import { Text } from '../../components/Typography';
import { Sparkle } from '../art/mathBattle';
import { FogCloud, MAP_STOPS, MapBoard, MapFlag, routeAt, stopFractions } from '../art/treasureMap';
import { Chest } from '../art/wordForest';
import { useRig } from '../engine/rig';
import { useSfx } from '../engine/sfx';
import type { QuestProps } from './QuestProps';
import { NATIVE, useQuestEvents } from './worlds';

// Treasure Explorer (Địa lí lessons): an old map. The pet walks the dotted trail a step per right answer, from the
// village over the snowy mountains, across the river, through the old forest and down the coast to the treasure
// island; fog hides each place until the pet reaches it, then lifts and a flag goes up. The last answer reaches the X
// and the chest opens. A wrong answer: a little rain cloud over the pet, which stays where it is.

const H = 210;
const PET = 46;
const FOG = 62;
const SAMPLES = 48;

/** The places reached once the pet is at fraction f of the trail. */
export function placesReached(f: number, aspect: number): number {
  return stopFractions(aspect).filter((s) => s <= f + 1e-6).length;
}

export function MapQuest({ done, total, wrongKey, petId, petLevel, reduceMotion, running }: QuestProps) {
  const play = useSfx();
  const [width, setWidth] = useState(0);
  const W = width || 340;
  const aspect = W / H;
  const at = (n: number) => (total <= 0 ? 0 : Math.min(1, n / total));
  const [reached, setReached] = useState(() => placesReached(at(done), aspect));
  const [walking, setWalking] = useState(false);
  const finished = done >= total && total > 0;
  const pos = useRef(new Animated.Value(at(done))).current;
  const fog = useRef(MAP_STOPS.map(() => new Animated.Value(1))).current;
  const rain = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const pet = useRig({ facing: 1, running, reduceMotion, idle: false, ...drawnActions(petId, petLevel) });
  const ms = (n: number) => (reduceMotion ? 0 : n);

  // The trail as interpolation points, for this map's shape (the pet's x and y follow it exactly).
  const path = useMemo(() => {
    const f = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES);
    const p = f.map((k) => routeAt(k, aspect));
    return { f, x: p.map((q) => q.x * W - PET / 2), y: p.map((q) => q.y * H - PET + 4) };
  }, [aspect, W]);
  // Places reached before this screen opened (on this map's real shape) have no fog.
  useEffect(() => {
    const now = placesReached(at(done), aspect);
    setReached(now);
    fog.forEach((v, i) => v.setValue(i < now ? 0 : 1));
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  useQuestEvents(done, wrongKey, (now, _before, end) => {
    const f = at(now);
    const next = placesReached(f, aspect);
    play('pickup');
    if (hasSprite(petId, petLevel, 'jump') || hasSprite(petId, petLevel, 'celebrate')) pet.stop(); // it sets off: no drawn jump or celebrating on the move
    setWalking(!reduceMotion);
    Animated.timing(pos, { toValue: f, duration: ms(900), easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }).start(() => {
      setWalking(false);
      if (next <= reached) { pet.play('cheer'); end(); return; }
      {
        play(now >= total ? 'complete' : 'unlock');
        pet.play('celebrate');
        Animated.parallel(fog.slice(reached, next).map((v) => Animated.timing(v, { toValue: 0, duration: ms(700), useNativeDriver: NATIVE }))).start();
        setReached(next);
        shine.setValue(0);
        Animated.timing(shine, { toValue: 1, duration: ms(900), easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start(end);
      }
    });
  }, (end) => {
    play('wrong');
    pet.play('hit');
    rain.setValue(0);
    Animated.sequence([
      Animated.timing(rain, { toValue: 1, duration: ms(200), useNativeDriver: NATIVE }),
      Animated.delay(ms(700)),
      Animated.timing(rain, { toValue: 0, duration: ms(400), useNativeDriver: NATIVE }),
    ]).start(end);
  });

  const stops = MAP_STOPS.map((s) => ({ ...s, x: s.u * W, y: s.v * H }));
  const here = stops[Math.max(0, reached - 1)];
  const ahead = stops[Math.min(stops.length - 1, reached)];
  const island = stops[stops.length - 1];
  const petX = pos.interpolate({ inputRange: path.f, outputRange: path.x });
  const petY = pos.interpolate({ inputRange: path.f, outputRange: path.y });
  const label = finished ? 'Pet đã tới đảo kho báu, rương mở ra' : `Pet ở ${here.name}, đang đi tới ${ahead.name}`;
  return (
    <View style={[styles.scene, { height: H }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image"
      accessibilityLabel={label}>
      {width ? <MapBoard width={W} height={H} /> : null}
      {/* Flags on the places reached, fog over the others. */}
      {stops.map((s, i) => (i > 0 && i < reached && i < stops.length - 1 ? (
        <View key={`flag-${i}`} pointerEvents="none" style={[styles.abs, { left: s.x - 4, top: s.y - 34 }]}><MapFlag size={30} /></View>
      ) : null))}
      {stops.map((s, i) => (s.landmark ? (
        <Animated.View key={`fog-${i}`} pointerEvents="none" style={[styles.abs, { left: s.x - FOG / 2, top: s.y - FOG * 0.6, opacity: fog[i],
          transform: [{ scale: fog[i].interpolate({ inputRange: [0, 1], outputRange: [1.5, 1] }) }] }]}>
          <FogCloud size={FOG} />
        </Animated.View>
      ) : null))}
      {/* The treasure: the chest on the X, opened at the end. */}
      <View pointerEvents="none" style={[styles.abs, { left: island.x - 18, top: island.y - 36 }]}>
        {finished ? <Chest size={36} open /> : null}
      </View>
      <Animated.View pointerEvents="none" style={[styles.abs, { left: 0, top: 0, transform: [{ translateX: petX }, { translateY: petY }] }]}>
        <View style={styles.shadow} />
        <Animated.View style={pet.style}><PetArt pet={petId} size={PET} stage={petLevel} walking={walking} still={reduceMotion || !running} leap={pet.leap} cheer={pet.cheer} /></Animated.View>
        <Animated.View style={[styles.abs, { left: PET / 2 - 22, top: -26, opacity: rain }]}><FogCloud size={44} /></Animated.View>
        <Animated.View style={[styles.abs, { left: PET / 2 - 14, top: -10, opacity: shine.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
          transform: [{ translateY: shine.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }) }] }]}>
          <Sparkle size={28} color="#FFE27A" />
        </Animated.View>
      </Animated.View>
      <View style={styles.chip} pointerEvents="none">
        <Text style={styles.chipText}>{finished ? 'Đã tìm thấy kho báu!' : `${here.name} → ${ahead.name}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#F2DFB4', marginBottom: 10 },
  abs: { position: 'absolute' },
  shadow: { position: 'absolute', left: PET * 0.2, top: PET - 8, width: PET * 0.6, height: 8, borderRadius: 4, backgroundColor: 'rgba(60,40,20,0.22)' },
  chip: { position: 'absolute', bottom: 8, left: 8, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: 'rgba(255,248,230,0.92)',
    borderWidth: 1, borderColor: '#C9A06A' },
  chipText: { fontSize: 12, fontWeight: '900', color: '#7A4E2E' },
});
