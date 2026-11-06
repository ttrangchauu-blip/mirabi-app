import React, { useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PetArt } from '../../components/PetArt';
import { drawnActions } from '../../petSprites';
import { Text } from '../../components/Typography';
import { Impact, Sparkle } from '../art/mathBattle';
import { Beaker, Bulb, HotPlate, LabBackdrop, Magnet, Microscope } from '../art/magicLab';
import { useRig } from '../engine/rig';
import { useSfx } from '../engine/sfx';
import { makeStyles } from '../../ui/theme';
import type { QuestProps } from './QuestProps';
import { NATIVE, potionLevel, useQuestEvents } from './worlds';

// Magic Laboratory (Khoa học, Vật lí, Hoá học, Sinh học lessons that are not hands-on experiments): the pet brews the
// potion of knowledge on the lab bench. Each right answer is an ingredient: the pet casts a glowing drop into the beaker,
// it splashes and the potion rises; the last one sets it bubbling and the bulb lights up. A wrong answer: a puff of grey
// smoke and the beaker rattles. Simulations only.

const H = 200;
const PET = 72;
const BEAKER = 96;
const PLATE = 70;
const DROP = 26;
const DROP_COLORS = ['#FF8FC8', '#7DF9FF', '#FFE27A', '#9BE38A', '#C7A6FF'];

export function LabQuest({ done, total, wrongKey, petId, petLevel, reduceMotion, running }: QuestProps) {
  const styles = useStyles();
  const play = useSfx();
  const [width, setWidth] = useState(0);
  const W = width || 340;
  const [level, setLevel] = useState(() => potionLevel(done, total));
  const [drop, setDrop] = useState(0); // the colour of the drop in flight
  const finished = done >= total && total > 0;
  const [brewed, setBrewed] = useState(finished);
  const pet = useRig({ facing: 1, running, reduceMotion, ...drawnActions(petId, petLevel) });
  const beaker = useRig({ facing: 1, idle: false, running, reduceMotion });
  const fly = useRef(new Animated.Value(0)).current;
  const splash = useRef(new Animated.Value(0)).current;
  const smoke = useRef(new Animated.Value(0)).current;
  const ms = (n: number) => (reduceMotion ? 0 : n);
  const timing = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
    Animated.timing(v, { toValue, duration: ms(duration), easing, useNativeDriver: NATIVE });

  useQuestEvents(done, wrongKey, (now, _before, end) => {
    const last = now >= total;
    setDrop(now % DROP_COLORS.length);
    pet.play('cast');
    play('cast');
    fly.setValue(0); splash.setValue(0);
    timing(fly, 1, 560, Easing.inOut(Easing.quad)).start(() => {
      fly.setValue(0);
      play(last ? 'complete' : 'pickup');
      setLevel(potionLevel(now, total));
      beaker.play('jump');
      timing(splash, 1, 700, Easing.out(Easing.cubic)).start(() => { splash.setValue(0); end(); });
      if (last) { setBrewed(true); pet.play('celebrate'); } else pet.play('cheer');
    });
  }, (end) => {
    play('wrong');
    beaker.play('hit');
    smoke.setValue(0);
    timing(smoke, 1, 900, Easing.out(Easing.quad)).start(() => { smoke.setValue(0); end(); });
  });

  // Everything stands on the counter (its top at 66% of the height).
  const floor = H * 0.69;
  const petAt = { x: W * 0.05, y: floor - PET * 0.96 };
  const plateAt = { x: W * 0.47 - PLATE / 2, y: floor - PLATE * 0.95 };
  const beakerAt = { x: W * 0.47 - BEAKER / 2, y: plateAt.y + PLATE * 0.58 - BEAKER * 0.94 };
  const mouth = { x: W * 0.47, y: beakerAt.y + BEAKER * 0.24 };
  const from = { x: petAt.x + PET * 0.8, y: petAt.y + PET * 0.3 };
  const arc = Math.min(from.y, mouth.y) - 46;
  const percent = Math.round(level * 100);
  return (
    <View style={[styles.scene, { height: H }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image"
      accessibilityLabel={brewed ? 'Bình tri thức đã pha xong, bóng đèn sáng' : `Bình tri thức đầy ${percent}%`}>
      {width ? <LabBackdrop width={W} height={H} /> : null}
      <View pointerEvents="none" style={[styles.abs, { left: W * 0.72, top: floor - 70 * 0.96 }]}><Microscope size={70} /></View>
      <View pointerEvents="none" style={[styles.abs, { left: W * 0.88, top: floor - 44 * 0.96 }]}><Bulb size={44} lit={brewed} /></View>
      <View pointerEvents="none" style={[styles.abs, { left: W * 0.27, top: floor - 34 * 0.96 }]}><Magnet size={34} /></View>
      <View pointerEvents="none" style={[styles.abs, { left: plateAt.x, top: plateAt.y }]}><HotPlate size={PLATE} on={brewed} /></View>
      <Animated.View pointerEvents="none" style={[styles.abs, { left: beakerAt.x, top: beakerAt.y }, beaker.style]}>
        <Beaker size={BEAKER} state={brewed ? 'boiling' : level > 0 ? 'water' : 'empty'} level={Math.max(level, brewed ? 1 : 0) * 0.92} />
      </Animated.View>
      {/* A drop of the ingredient flies in an arc into the beaker, then splashes. */}
      {!reduceMotion ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.abs, { left: from.x - DROP / 2, top: from.y - DROP / 2,
            opacity: fly.interpolate({ inputRange: [0, 0.05, 0.95, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [0, mouth.x - from.x] }) },
              { translateY: fly.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, arc - from.y, mouth.y - from.y] }) },
              { rotate: fly.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '300deg'] }) }] }]}>
            <Sparkle size={DROP} color={DROP_COLORS[drop]} />
          </Animated.View>
          {[0, 1, 2, 3, 4].map((i) => {
            const a = -Math.PI / 2 + (i - 2) * 0.5;
            return (
              <Animated.View key={i} style={[styles.abs, { left: mouth.x - 8, top: mouth.y - 8,
                opacity: splash.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
                transform: [{ translateX: splash.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * 34] }) },
                  { translateY: splash.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * 34] }) }] }]}>
                <Sparkle size={16} color={DROP_COLORS[(drop + i) % DROP_COLORS.length]} />
              </Animated.View>
            );
          })}
          <Animated.View style={[styles.abs, { left: mouth.x - 34, top: mouth.y - 60, opacity: smoke.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }),
            transform: [{ translateY: smoke.interpolate({ inputRange: [0, 1], outputRange: [10, -20] }) },
              { scale: smoke.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] }) }] }]}>
            <Impact size={68} color="#B9B4C8" />
          </Animated.View>
        </View>
      ) : null}
      <Animated.View pointerEvents="none" style={[styles.abs, { left: petAt.x, top: petAt.y }, pet.style]}>
        <PetArt pet={petId} size={PET} stage={petLevel} still={reduceMotion || !running} leap={pet.leap} cheer={pet.cheer} />
      </Animated.View>
      <View style={styles.chip} pointerEvents="none">
        <Text style={styles.chipText}>{brewed ? 'Pha chế thành công!' : 'Bình tri thức'}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${percent}%` }]} /></View>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  scene: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#FFF4E3', marginBottom: 10 },
  abs: { position: 'absolute' },
  chip: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10,
    paddingVertical: 4, backgroundColor: dark ? t.glass : 'rgba(255,255,255,0.92)' }, // the progress pill over the lab: chrome
  chipText: { fontSize: 12, fontWeight: '900', color: dark ? tones.lilac.ink : '#5B3F8C' },
  track: { width: 54, height: 8, borderRadius: 4, backgroundColor: dark ? tones.lilac.to : '#E6DDF5', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#8E6CF0' },
}));
