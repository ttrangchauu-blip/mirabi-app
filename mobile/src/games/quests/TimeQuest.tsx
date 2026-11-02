import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PetArt } from '../../components/PetArt';
import { drawnActions } from '../../petSprites';
import { Text } from '../../components/Typography';
import { Artifact, ARTIFACT_NAME, DigMound, ERA_NAME, EraClouds, EraScene, Owl, OwlMood, PortalSwirl, TimeGate } from '../art/timeTravel';
import { Layer, Parallax } from '../engine/Parallax';
import { useRig } from '../engine/rig';
import { useSfx } from '../engine/sfx';
import type { QuestProps } from './QuestProps';
import { artifactsFound, eraIndex, NATIVE, tripEras, useQuestEvents } from './worlds';

// Time Traveler (Lịch sử lessons): the pet travels through the eras with Cú Thời Gian, the owl guide. Each right
// answer digs up an artifact of the era (the mound sparkles, the pet hops, the find rises and flies to the collection
// shelf, the owl cheers); when the era's share of the stage is done the stone time gate lights, its swirl opens and the
// pet steps through into the next era. A wrong answer: the owl frets and the mound stays shut.

const H = 200;
const PET = 64;
const GATE = 76; // the gate's ring and pedestal: GATE wide, 1.2 × GATE tall
const MOUND = 64;
const OWL = 48;
const FIND = 44;
const SHELF = 22;

export function TimeQuest({ done, total, wrongKey, petId, petLevel, reduceMotion, running, hold = false }: QuestProps) {
  const play = useSfx();
  const [width, setWidth] = useState(0);
  const W = width || 340;
  const eras = tripEras(total);
  const [era, setEra] = useState(() => eraIndex(done, total));
  const [found, setFound] = useState(() => artifactsFound(done, total));
  const [digging, setDigging] = useState<number | null>(null); // the find rising from the mound, by index
  const [owl, setOwl] = useState<OwlMood>('talk');
  const [walking, setWalking] = useState(false);
  const [opening, setOpening] = useState(false); // the gate lit for the way into the next era
  const finished = done >= total && total > 0;
  const pet = useRig({ facing: 1, running, reduceMotion, ...drawnActions(petId, petLevel) });
  const guide = useRig({ facing: -1, running, reduceMotion });
  const mound = useRig({ facing: 1, idle: false, running, reduceMotion });
  const spin = useRef(new Animated.Value(0)).current;
  const gate = useRef(new Animated.Value(finished ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const walk = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const ms = (n: number) => (reduceMotion ? 0 : n);
  const timing = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
    Animated.timing(v, { toValue, duration: ms(duration), easing, useNativeDriver: NATIVE });
  const owlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owlSays = (mood: OwlMood, back = 1200) => {
    setOwl(mood);
    if (owlTimer.current) clearTimeout(owlTimer.current);
    owlTimer.current = setTimeout(() => setOwl('idle'), reduceMotion ? 0 : back);
  };
  useEffect(() => () => { if (owlTimer.current) clearTimeout(owlTimer.current); }, []);

  // The gate's swirl turns while it is open.
  useEffect(() => {
    if (!running || reduceMotion) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: NATIVE }));
    loop.start();
    return () => { loop.stop(); spin.setValue(0); };
  }, [running, reduceMotion, spin]);
  useEffect(() => owlSays('talk', 1600), []); // eslint-disable-line react-hooks/exhaustive-deps

  useQuestEvents(done, wrongKey, (now, _before, end, advance) => {
    const nextEra = eraIndex(now, total);
    const all = artifactsFound(now, total);
    const last = now >= total;
    pet.play('jump', () => { if (!last) pet.play('cheer'); });
    mound.play('jump');
    setDigging(all.length - 1);
    rise.setValue(0);
    play('pickup');
    owlSays('cheer');
    guide.play('jump');
    Animated.sequence([timing(rise, 1, 520, Easing.out(Easing.back(1.4))), Animated.delay(ms(380)), timing(rise, 2, 520, Easing.in(Easing.quad))]).start(() => {
      setFound(all);
      setDigging(null);
      rise.setValue(0);
      if (last) { play('complete'); timing(gate, 1, 500).start(end); pet.play('celebrate'); return; }
      if (nextEra === era) { end(); return; }
      // Through the gate into the next era: once "Câu tiếp theo" is pressed, when the answered question waits for it.
      advance((end) => {
        play('unlock');
        setOpening(true);
        setWalking(!reduceMotion);
        Animated.sequence([
          timing(gate, 1, 450),
          timing(walk, 1, 900, Easing.in(Easing.quad)),
        ]).start(() => {
          play('whoosh');
          timing(flash, 1, 180).start(() => {
            setEra(nextEra);
            walk.setValue(0); gate.setValue(0);
            setWalking(false);
            setOpening(false);
            pet.play('enter');
            owlSays('talk', 1600);
            timing(flash, 0, 420).start(end);
          });
        });
      });
    });
  }, (end) => {
    play('wrong');
    owlSays('worry');
    mound.play('hit', end);
  }, hold);

  const ground = H * 0.8;
  const petAt = { x: W * 0.04, y: ground - PET + 6 };
  const owlAt = { x: W * 0.22, y: ground - OWL + 4 };
  const moundAt = { x: W * 0.44 - MOUND / 2, y: ground - MOUND * 0.5 + 6 };
  const gateAt = { x: W * 0.74, y: ground - GATE * 1.2 + 8 };
  const shelfEnd = { x: W - 12 - SHELF / 2, y: 8 + SHELF / 2 }; // the newest find sits at the shelf's right end
  const rising = digging !== null ? artifactsFound(digging + 1, total)[digging] : null;
  const riseFrom = { x: moundAt.x + MOUND / 2 - FIND / 2, y: moundAt.y - FIND * 0.4 };
  const gateMid = gateAt.x + GATE / 2 - PET / 2 - petAt.x;
  const scenes: Layer[] = [
    { key: `era-${eras[era]}`, speed: 0, render: (w, h) => <EraScene era={eras[era]} width={w} height={h} /> },
    { key: 'clouds', speed: 0.4, render: (w, h) => <EraClouds width={w} height={h} /> },
  ];
  const label = finished ? `Chuyến du hành hoàn thành: tìm được ${found.length} hiện vật`
    : `${ERA_NAME[eras[era]]}: pet đã tìm được ${found.length} hiện vật`;
  return (
    <View style={[styles.scene, { height: H }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image"
      accessibilityLabel={label}>
      {width ? <Parallax width={W} height={H} layers={scenes} drift={0.8} running={running} reduceMotion={reduceMotion} /> : null}
      {/* The time gate: its swirl shows through the ring once it opens. */}
      <View pointerEvents="none" style={[styles.abs, { left: gateAt.x, top: gateAt.y, width: GATE, height: GATE * 1.2 }]}>
        <Animated.View style={[styles.abs, { left: GATE * 0.17, top: GATE * 0.17, opacity: gate,
          transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
          <PortalSwirl size={GATE * 0.66} />
        </Animated.View>
        <TimeGate size={GATE} lit={finished || opening} />
      </View>
      <View pointerEvents="none" style={[styles.abs, { left: moundAt.x, top: moundAt.y }]}>
        <Animated.View style={mound.style}><DigMound size={MOUND} dug={digging !== null} /></Animated.View>
      </View>
      {/* The find: up out of the mound, a moment in the light, then off to the shelf. */}
      {rising ? (
        <Animated.View pointerEvents="none" style={[styles.abs, { left: riseFrom.x, top: riseFrom.y,
          opacity: rise.interpolate({ inputRange: [0, 0.2, 1.8, 2], outputRange: [0, 1, 1, 0.2] }),
          transform: [
            { translateX: rise.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, shelfEnd.x - riseFrom.x - FIND / 2] }) },
            { translateY: rise.interpolate({ inputRange: [0, 1, 2], outputRange: [10, -34, shelfEnd.y - riseFrom.y - FIND / 2] }) },
            { scale: rise.interpolate({ inputRange: [0, 1, 2], outputRange: [0.4, 1.15, 0.45] }) }] }]}>
          <Artifact size={FIND} kind={rising} />
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[styles.abs, { left: owlAt.x, top: owlAt.y }, guide.style]}>
        <Owl size={OWL} mood={owl} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.abs, { left: petAt.x, top: petAt.y, opacity: walk.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
        transform: [{ translateX: walk.interpolate({ inputRange: [0, 1], outputRange: [0, gateMid] }) },
          { scale: walk.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.9, 0.4] }) }] }]}>
        <Animated.View style={pet.style}><PetArt pet={petId} size={PET} stage={petLevel} walking={walking} still={reduceMotion || !running} leap={pet.leap} cheer={pet.cheer} /></Animated.View>
      </Animated.View>
      {/* The era's name and the shelf of finds. */}
      <View style={styles.era} pointerEvents="none">
        <Text style={styles.eraText}>{ERA_NAME[eras[era]]} · {Math.min(era + 1, eras.length)}/{eras.length}</Text>
      </View>
      <View style={styles.shelf} pointerEvents="none" accessibilityLabel={`Bộ sưu tập: ${found.map((k) => ARTIFACT_NAME[k]).join(', ') || 'chưa có hiện vật'}`}>
        {found.slice(-8).map((k, i) => <View key={i} style={styles.slot}><Artifact size={SHELF} kind={k} /></View>)}
      </View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#FFE9C7', marginBottom: 10 },
  abs: { position: 'absolute' },
  era: { position: 'absolute', top: 8, left: 8, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: 'rgba(255,255,255,0.9)' },
  eraText: { fontSize: 12, fontWeight: '900', color: '#7A4E2E' },
  shelf: { position: 'absolute', top: 6, right: 8, flexDirection: 'row', gap: 2, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 2,
    backgroundColor: 'rgba(122,78,46,0.55)', minWidth: SHELF + 8, minHeight: SHELF + 4 },
  slot: { width: SHELF, height: SHELF },
  flash: { backgroundColor: '#FFFFFF' },
});
