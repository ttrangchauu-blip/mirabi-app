import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../components/PetArt';
import { drawnActions } from '../petSprites';
import { Text } from '../components/Typography';
import type { Turn } from '../learning/types';
import { makeStyles, useTheme } from '../ui/theme';
import { Battery, Beaker, Bulb, ColdBox, HotPlate, LabBackdrop, Magnet, Material, MaterialKind, Pot, Screen, Switch, Torch, WateringCan } from './art/magicLab';
import { FieldLines, Puff, WaterDrop, ZapSpark } from './art/effects';
import { Sparkle } from './art/mathBattle';
import { useReactions } from './engine/feedback';
import { Draggable, DropArea, DropZone } from './engine/drag';
import { useRig } from './engine/rig';
import { useSfx } from './engine/sfx';

// Magic Lab (Khoa học, the lesson game "lab"): a cosy lab where the pet assists. Every experiment is set up by hand:
// the parts lie on the bench, the learner drags them onto the apparatus (or taps one: it goes to the first free place),
// then runs it (the switch, the torch, the heater, watching the seed grow). The backend checks the setup; what happens
// is then shown by the objects themselves: the bulb lights and current flows, a shadow falls on the screen, the ice
// melts, the plant grows stage by stage. A wrong part: the experiment does not work, the reason is given, the right parts
// stay in place. Simulations only: nothing here is a procedure to try for real. Both are reactions of the feedback loop
// (engine/feedback.ts): the explanation waits for them, and "Bỏ qua" (or "Tiếp theo") jumps to their end.

type Part = { id: string; name: string; art: string };
type Slot = { id: string; label: string };
type Note = { text: string; tone: 'good' | 'bad'; kept?: string[] | null; final?: boolean } | null;
type Props = {
  turn: Turn | null; disabled: boolean; feedback?: Note; onSubmit: (answer: string[]) => void;
  /** The experiment just done right: it runs and stays working until "Tiếp theo" (the game screen's). */
  solved?: { turnId: string } | null;
  petId: string; petLevel: number; reduceMotion: boolean;
  /** The guide: what is placed, and whether it runs (nothing can be touched). */
  demo?: { placed: Record<string, string>; run: boolean };
};

const STAGE_H = 236;
const RUN_LABEL: Record<string, string> = { circuit: 'Bật công tắc', shadow: 'Bật đèn pin', water: 'Bắt đầu', plant: 'Gieo hạt và quan sát',
  magnet: 'Đưa nam châm lại gần' };
const SCENE_NAME: Record<string, string> = { circuit: 'Mạch điện', shadow: 'Ánh sáng và bóng', water: 'Nước chuyển thể', plant: 'Hạt nảy mầm',
  magnet: 'Nam châm' };

/** Puts a part on a place: on `slot`, or the first free one. A part already placed elsewhere moves; the one it replaces
 * goes back to the bench. */
export function placePart(placed: Record<string, string>, slots: string[], part: string, slot?: string): Record<string, string> {
  const next = Object.fromEntries(Object.entries(placed).filter(([, p]) => p !== part));
  const target = slot ?? slots.find((s) => !next[s]);
  if (!target || !slots.includes(target)) return placed;
  next[target] = part;
  return next;
}

/** The answer sent: a part on every place, as "slot:part". */
export const labAnswer = (placed: Record<string, string>, slots: string[]) => slots.map((s) => `${s}:${placed[s]}`);

export function PartArt({ art, size, lit }: { art: string; size: number; lit?: boolean }) {
  if (art === 'battery') return <Battery size={size} />;
  if (art === 'bulb') return <Bulb size={size} lit={!!lit} />;
  if (art === 'hot') return <HotPlate size={size} on={!!lit} />;
  if (art === 'cold') return <ColdBox size={size} open={!!lit} />;
  if (art.startsWith('stage:')) return <Pot size={size} stage={Number(art.split(':')[1]) as 1} />;
  return <Material kind={art as MaterialKind} size={size} />;
}

export function MagicLab({ turn, disabled, feedback, onSubmit, solved, petId, petLevel, reduceMotion, demo }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  // The experiment on the bench: the open one, or the one just done (it shows working until "Tiếp theo").
  const sound = useSfx();
  const done = useRef<{ turn: Turn; placed: Record<string, string> } | null>(null);
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [wrong, setWrong] = useState<string[]>([]);
  const lastSent = useRef<{ turn: Turn; placed: Record<string, string> } | null>(null);
  const showing = solved && lastSent.current?.turn.turn_id === solved.turnId ? lastSent.current : null;
  if (showing) done.current = showing;
  const bench = showing?.turn ?? turn;
  const shownPlaced = demo?.placed ?? (showing ? showing.placed : placed);
  const prompt = bench?.prompt;
  const scene = (prompt as { scene?: string } | undefined)?.scene ?? 'circuit';
  const slots: Slot[] = (prompt as { slots?: Slot[] } | undefined)?.slots ?? [];
  const parts: Part[] = (prompt as { parts?: Part[] } | undefined)?.parts ?? [];
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);
  const locked = disabled || !!showing || !!demo;
  const full = slotIds.length > 0 && slotIds.every((s) => shownPlaced[s]);
  const [width, setWidth] = useState(0);

  const pet = useRig({ facing: 1, running: !locked || !!showing, reduceMotion, ...drawnActions(petId, petLevel) });
  const run = useRef(new Animated.Value(0)).current; // 0 → 1: the experiment working
  const fizzle = useRef(new Animated.Value(0)).current; // a wrong setup: a spark, then nothing
  const react = useReactions();
  // Going away: late animation callbacks (stopped as the views detach) must not touch state.
  const live = useRef(true);
  useLayoutEffect(() => () => { live.current = false; }, []);

  useEffect(() => { if (demo) run.setValue(demo.run ? 1 : 0); }, [demo?.run]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new experiment: an empty bench.
  const turnId = turn?.turn_id;
  useEffect(() => { if (!showing && !demo) { setPlaced({}); setWrong([]); run.setValue(0); } }, [turnId, !!showing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Done right: it runs (the reaction: until it is over the stage waits), the pet watches and cheers.
  useEffect(() => {
    if (!showing) return;
    run.setValue(0);
    pet.play('celebrate');
    sound('unlock');
    const toEnd = () => { run.stopAnimation(); run.setValue(1); };
    const end = react.begin('lab:run', { maxMs: 5000, finish: toEnd });
    const anim = Animated.timing(run, { toValue: 1, duration: reduceMotion ? 1 : scene === 'plant' ? 2600 : scene === 'magnet' ? 1800 : 1400,
      easing: Easing.inOut(Easing.quad), useNativeDriver: false });
    anim.start(() => { end(); if (live.current) sound('complete'); });
    return () => { anim.stop(); end(); };
  }, [showing?.turn.turn_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A wrong setup: it does not work, the wrong parts flash and go back to the bench, the right ones stay.
  const lastNote = useRef(feedback);
  useEffect(() => {
    if (feedback === lastNote.current) return;
    lastNote.current = feedback;
    if (!feedback || feedback.tone !== 'bad') return;
    const kept = new Set(feedback.kept ?? []);
    const bad = slotIds.filter((s) => !kept.has(s));
    setWrong(bad);
    pet.play('hit');
    sound('wrong');
    fizzle.setValue(1);
    // The question goes on (an older server): the wrong parts go back to the bench once it has fizzled, the right ones
    // stay. Otherwise the setup stays on the bench, under the right answer.
    const back = () => {
      if (!live.current || feedback.final) return;
      setPlaced((p) => Object.fromEntries(Object.entries(p).filter(([s]) => kept.has(s))));
      setWrong([]);
    };
    const end = react.begin('lab:fizzle', { maxMs: 1500, finish: () => { fizzle.stopAnimation(); fizzle.setValue(0); back(); } });
    const anim = Animated.timing(fizzle, { toValue: 0, duration: reduceMotion ? 1 : 900, useNativeDriver: false });
    anim.start(() => { back(); end(); });
    return () => { anim.stop(); end(); };
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bench || !prompt) return null;
  const place = (part: string, slot?: string) => {
    if (locked) return false;
    if (slot && !slotIds.includes(slot)) return false;
    setWrong([]);
    setPlaced((p) => placePart(p, slotIds, part, slot));
    sound('pickup');
    return true;
  };
  const unplace = (slot: string) => { if (!locked) setPlaced(({ [slot]: _, ...rest }) => rest); };
  const start = () => {
    if (!full || locked || !turn) return;
    lastSent.current = { turn, placed };
    pet.play('cast');
    onSubmit(labAnswer(placed, slotIds));
  };
  const onBench = parts.filter((p) => !Object.values(shownPlaced).includes(p.id));
  const partOf = (id?: string) => parts.find((p) => p.id === id);
  const W = width || 320;
  const sceneProps = { W, slots, placed: shownPlaced, partOf, wrong, run, fizzle, onUnplace: unplace, locked, prompt, reduceMotion, parts, ran: !!showing };

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.assistant}>
        <Animated.View style={[styles.petBox, pet.style]}><PetArt pet={petId} size={58} stage={petLevel} still={reduceMotion} leap={pet.leap} cheer={pet.cheer} /></Animated.View>
        <View style={styles.bubble} accessibilityRole="text">
          <View style={styles.sceneHead}>
            <Ionicons name="flask" size={13} color={styles.sceneName.color} />
            <Text style={styles.sceneName}>{SCENE_NAME[scene] ?? 'Thí nghiệm'}</Text>
          </View>
          <Text style={styles.goal}>{prompt.aim}</Text>
        </View>
      </View>
      <DropArea style={styles.area}>
        <View style={[styles.stage, { height: STAGE_H }]} accessibilityLabel={`Bàn thí nghiệm: ${SCENE_NAME[scene] ?? ''}`}>
          {width ? <View style={StyleSheet.absoluteFill} pointerEvents="none"><LabBackdrop width={W} height={STAGE_H} /></View> : null}
          {scene === 'circuit' ? <CircuitScene {...sceneProps} /> : null}
          {scene === 'shadow' ? <ShadowScene {...sceneProps} /> : null}
          {scene === 'water' ? <WaterScene {...sceneProps} /> : null}
          {scene === 'plant' ? <PlantScene {...sceneProps} /> : null}
          {scene === 'magnet' ? <MagnetScene {...sceneProps} /> : null}
        </View>
        {!showing ? (
          <View style={styles.tray} accessibilityLabel="Dụng cụ trên bàn">
            {onBench.map((p) => (
              <Draggable key={p.id} disabled={locked} onDrop={(zone) => place(p.id, zone)}>
                <Pressable onPress={() => place(p.id)} disabled={locked} accessibilityRole="button" accessibilityLabel={`Đặt ${p.name}`}
                  accessibilityHint="Kéo vào chỗ trên dụng cụ, hoặc chạm để đặt vào chỗ trống đầu tiên" style={({ pressed }) => [styles.part, pressed && styles.pressed]}>
                  <PartArt art={p.art} size={48} />
                  <Text style={styles.partName} numberOfLines={2}>{p.name}</Text>
                </Pressable>
              </Draggable>
            ))}
            {!onBench.length ? <Text style={styles.trayEmpty}>Đã đặt hết dụng cụ</Text> : null}
          </View>
        ) : null}
      </DropArea>
      {showing ? null : (
        <>
          {feedback?.text && feedback.tone === 'bad' ? (
            <View style={styles.note} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Ionicons name="information-circle" size={18} color={t.danger} />
              <Text style={styles.noteText}>{feedback.text}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={() => setPlaced({})} disabled={locked || !Object.keys(placed).length} accessibilityRole="button" accessibilityLabel="Cất dụng cụ"
              style={[styles.secondary, (locked || !Object.keys(placed).length) && styles.dimmed]}><Text style={styles.secondaryText}>Cất dụng cụ</Text></Pressable>
            <Pressable onPress={start} disabled={locked || !full} accessibilityRole="button" accessibilityLabel={RUN_LABEL[scene] ?? 'Bắt đầu'}
              accessibilityState={{ disabled: locked || !full }} style={[styles.primary, styles.flex, (locked || !full) && styles.dimmed]}>
              <Text style={styles.primaryText}>▶ {RUN_LABEL[scene] ?? 'Bắt đầu'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

type SceneProps = {
  W: number; slots: Slot[]; placed: Record<string, string>; partOf: (id?: string) => Part | undefined; wrong: string[];
  run: Animated.Value; fizzle: Animated.Value; onUnplace: (slot: string) => void; locked: boolean; prompt: Turn['prompt']; reduceMotion: boolean;
  /** Every part of the experiment (the magnet shows the ones left on the bench staying put). */
  parts: Part[];
  /** The experiment was done right and is being shown. */
  ran: boolean;
};

/** A place on the apparatus: empty (dashed, with its name), or holding a part (tap to take it back). A part put there
 * snaps in with a little pop (`spark`: and a spark where it connects). */
function Place({ slot, at, size, part, wrong, locked, onUnplace, lit, children, spark = false, reduceMotion = false }: {
  slot: Slot; at: { x: number; y: number }; size: number; part?: Part; wrong: boolean; locked: boolean; onUnplace: (s: string) => void;
  lit?: boolean; children?: React.ReactNode; spark?: boolean; reduceMotion?: boolean;
}) {
  const styles = useStyles();
  const pop = useRef(new Animated.Value(0)).current;
  const partId = part?.id;
  const seen = useRef(partId);
  useEffect(() => {
    if (partId === seen.current) return;
    seen.current = partId;
    if (!partId || reduceMotion) return;
    pop.setValue(1);
    Animated.timing(pop, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [partId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <DropZone id={slot.id} accessibilityLabel={`${slot.label}: ${part ? part.name : 'trống'}`}
      style={(over) => [styles.place, { left: at.x - size / 2, top: at.y - size / 2, width: size, height: size }, !part && styles.placeEmpty,
        over && styles.placeOver, wrong && styles.placeWrong]}>
      {part ? (
        <Pressable onPress={() => onUnplace(slot.id)} disabled={locked} accessibilityRole="button" accessibilityLabel={`Lấy ${part.name} ra`} style={styles.placeFill}>
          <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }] }}>
            {children ?? <PartArt art={part.art} size={size - 8} lit={lit} />}
          </Animated.View>
        </Pressable>
      ) : <Text style={styles.placeLabel}>{slot.label}</Text>}
      {spark && part && !reduceMotion ? (
        <Animated.View pointerEvents="none" style={[styles.snapSpark, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) }] }]}>
          <ZapSpark size={26} />
        </Animated.View>
      ) : null}
    </DropZone>
  );
}

/** What a wrong setup does: a grey puff over `at` (and, in a circuit, a dead spark). */
function Fizzle({ at, value, dead = false }: { at: { x: number; y: number }; value: Animated.Value; dead?: boolean }) {
  const styles = useStyles();
  return (
    <Animated.View pointerEvents="none" style={[styles.fizzle, { left: at.x - 26, top: at.y - 26, opacity: value,
      transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1.25, 0.8] }) }] }]}
      accessibilityLabel="Thí nghiệm chưa thành công">
      <Puff size={52} />
      {dead ? <View style={styles.fizzleSpark}><ZapSpark size={26} dead /></View> : null}
    </Animated.View>
  );
}

// --- Mạch điện ------------------------------------------------------------------------------------------------------

function CircuitScene({ W, slots, placed, partOf, wrong, run, fizzle, onUnplace, locked, reduceMotion }: SceneProps) {
  const styles = useStyles();
  const box = { l: W * 0.16, t: 46, r: W * 0.84, b: STAGE_H - 46 };
  const at: Record<string, { x: number; y: number }> = {
    power: { x: box.l, y: (box.t + box.b) / 2 }, lamp: { x: (box.l + box.r) / 2, y: box.t },
    link: { x: box.r, y: (box.t + box.b) / 2 }, link2: { x: box.l + (box.r - box.l) * 0.3, y: box.b },
  };
  const sw = { x: box.l + (box.r - box.l) * 0.7, y: box.b };
  const has = new Set(slots.map((s) => s.id));
  const lit = run.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });
  // The current: dots going round the loop once the circuit is closed.
  const loop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const id = run.addListener(({ value }) => {
      if (value < 1) return;
      Animated.loop(Animated.timing(loop, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: false })).start();
    });
    return () => { run.removeListener(id); loop.stopAnimation(); };
  }, [run, loop]);
  const w = box.r - box.l;
  const h = box.b - box.t;
  const perimeter = 2 * (w + h);
  const corners = [0, w / perimeter, (w + h) / perimeter, (2 * w + h) / perimeter, 1];
  const dots = Array.from({ length: 8 }, (_, i) => {
    const p = Animated.modulo(Animated.add(loop, i / 8), 1);
    return { x: p.interpolate({ inputRange: corners, outputRange: [box.l, box.r, box.r, box.l, box.l] }),
      y: p.interpolate({ inputRange: corners, outputRange: [box.t, box.t, box.b, box.b, box.t] }) };
  });
  const on = run.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] });
  return (
    <>
      <View pointerEvents="none" style={[styles.wire, { left: box.l, top: box.t, width: w, height: h }]} />
      {/* The bulb's light grows as the current reaches it. */}
      <Animated.View pointerEvents="none" style={[styles.halo, { left: at.lamp.x - 60, top: at.lamp.y - 66, opacity: lit,
        transform: [{ scale: run.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 0.9, 1.1] }) }] }]} />
      <Animated.View pointerEvents="none" style={[styles.wireLit, { left: box.l, top: box.t, width: w, height: h, opacity: lit }]} />
      {dots.map((d, i) => (
        <Animated.View key={i} pointerEvents="none" style={[styles.electron, { opacity: lit, transform: [{ translateX: d.x }, { translateY: d.y }] }]} />
      ))}
      {!has.has('power') ? <View pointerEvents="none" style={[styles.fixed, { left: at.power.x - 34, top: at.power.y - 34 }]}><Battery size={68} /></View> : null}
      {!has.has('lamp') ? (
        <View pointerEvents="none" style={[styles.fixed, { left: at.lamp.x - 34, top: at.lamp.y - 50 }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: lit }]}><Bulb size={68} lit /></Animated.View>
          <Animated.View style={{ opacity: lit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Bulb size={68} lit={false} /></Animated.View>
        </View>
      ) : null}
      {slots.map((s) => (
        <Place key={s.id} slot={s} at={at[s.id]} size={72} part={partOf(placed[s.id])} wrong={wrong.includes(s.id)} locked={locked} onUnplace={onUnplace}
          spark reduceMotion={reduceMotion}>
          {s.id === 'lamp' && placed[s.id] ? (
            <View>
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: lit }]}><Bulb size={64} lit /></Animated.View>
              <Animated.View style={{ opacity: lit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Bulb size={64} lit={false} /></Animated.View>
            </View>
          ) : undefined}
        </Place>
      ))}
      <View pointerEvents="none" style={[styles.fixed, { left: sw.x - 30, top: sw.y - 44 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: on }]}><Switch size={60} on /></Animated.View>
        <Animated.View style={{ opacity: on.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Switch size={60} on={false} /></Animated.View>
      </View>
      {wrong.map((s) => <Fizzle key={s} at={{ x: at[s].x, y: at[s].y - 40 }} value={fizzle} dead />)}
    </>
  );
}

// --- Ánh sáng và bóng -----------------------------------------------------------------------------------------------

function ShadowScene({ W, slots, placed, partOf, wrong, run, fizzle, onUnplace, locked, prompt, reduceMotion }: SceneProps) {
  const styles = useStyles();
  const y = STAGE_H * 0.5;
  const torch = { x: W * 0.13, y };
  const screen = { x: W * 0.86, y };
  const mid = { x: W * 0.5, y };
  const beam = run.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] });
  const target = (prompt as { to?: string }).to ?? 'dark';
  const after = target === 'clear' ? 1 : target === 'faint' ? 0.45 : 0.06;
  const shadow = target === 'dark' ? 'rgba(20,24,40,0.85)' : target === 'faint' ? 'rgba(40,48,70,0.35)' : 'transparent';
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.beam, { left: torch.x + 26, top: y - 30, width: mid.x - torch.x - 26, height: 60, opacity: beam }]} />
      <Animated.View pointerEvents="none" style={[styles.beam, { left: mid.x, top: y - 42, width: screen.x - mid.x - 16, height: 84,
        opacity: Animated.multiply(beam, after) }]} />
      <View pointerEvents="none" style={[styles.fixed, { left: screen.x - 40, top: y - 62 }]}><Screen size={96} /></View>
      <Animated.View pointerEvents="none" style={[styles.shadowSpot, { left: screen.x - 22, top: y - 30, backgroundColor: shadow, opacity: beam }]} />
      <View pointerEvents="none" style={[styles.fixed, { left: torch.x - 34, top: y - 34 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: beam }]}><Torch size={68} on /></Animated.View>
        <Animated.View style={{ opacity: beam.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Torch size={68} on={false} /></Animated.View>
      </View>
      {slots.map((s) => (
        <Place key={s.id} slot={s} at={mid} size={78} part={partOf(placed[s.id])} wrong={wrong.includes(s.id)} locked={locked} onUnplace={onUnplace}
          reduceMotion={reduceMotion} />
      ))}
      {wrong.length ? <Fizzle at={{ x: screen.x, y: y - 64 }} value={fizzle} /> : null}
    </>
  );
}

// --- Nước chuyển thể -------------------------------------------------------------------------------------------------

const BEAKER: Record<string, { state: 'ice' | 'water' | 'boiling' | 'steam'; level: number }> = {
  ice: { state: 'ice', level: 0.5 }, water: { state: 'water', level: 0.55 }, steam: { state: 'steam', level: 0.25 },
};

function WaterScene({ W, slots, placed, partOf, wrong, run, fizzle, locked, onUnplace, prompt, reduceMotion }: SceneProps) {
  const styles = useStyles();
  const from = (prompt as { from?: string }).from ?? 'water';
  const to = (prompt as { to?: string }).to ?? 'ice';
  const tool = partOf(placed[slots[0]?.id]);
  const before = BEAKER[from];
  const afterState = from === 'water' && to === 'steam' ? { state: 'boiling' as const, level: 0.45 } : BEAKER[to];
  const fade = run.interpolate({ inputRange: [0, 0.35, 0.75, 1], outputRange: [0, 0, 1, 1] });
  const steam = run.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const bubbles = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const id = run.addListener(({ value }) => {
      if (value < 1) return;
      Animated.loop(Animated.timing(bubbles, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: false })).start();
    });
    return () => { run.removeListener(id); bubbles.stopAnimation(); };
  }, [run, bubbles]);
  // The beaker stands on the tool's place (the hot plate or the freezer once one is put there).
  const place = { x: W * 0.5, y: STAGE_H * 0.8 - 14 };
  return (
    <>
      <Text style={[styles.stateTag, { left: 12 }]}>{STATE_NAME[from]} → {STATE_NAME[to]}</Text>
      {slots.map((s) => (
        <Place key={s.id} slot={s} at={{ x: place.x, y: STAGE_H * 0.8 }} size={92} part={tool} wrong={wrong.includes(s.id)} locked={locked} onUnplace={onUnplace}
          lit={!!tool && !locked} reduceMotion={reduceMotion}>
          {tool ? <Animated.View style={{ opacity: 1 }}><PartArt art={tool.art} size={84} lit /></Animated.View> : undefined}
        </Place>
      ))}
      <View pointerEvents="none" style={[styles.fixed, { left: place.x - 44, top: place.y - 84 }]}>
        <Animated.View style={{ opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Beaker size={88} state={before.state} level={before.level} /></Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}><Beaker size={88} state={afterState.state} level={afterState.level} /></Animated.View>
        {to === 'steam' || from === 'steam' ? [0, 1, 2].map((i) => (
          <Animated.View key={i} style={[styles.vapour, { left: 26 + i * 14, opacity: to === 'steam' ? steam : Animated.subtract(1, steam),
            transform: [{ translateY: bubbles.interpolate({ inputRange: [0, 1], outputRange: [0, -26 - i * 6] }) }] }]} />
        )) : null}
        {to === 'water' && from === 'steam' ? [0, 1].map((i) => ( // the steam condenses: drops run down the cold glass
          <Animated.View key={i} style={[styles.drop, { left: 24 + i * 26, opacity: steam,
            transform: [{ translateY: steam.interpolate({ inputRange: [0, 1], outputRange: [-6, 10 + i * 6] }) }] }]}>
            <WaterDrop size={16} />
          </Animated.View>
        )) : null}
      </View>
      {wrong.length ? <Fizzle at={{ x: place.x + 52, y: place.y - 96 }} value={fizzle} /> : null}
    </>
  );
}
const STATE_NAME: Record<string, string> = { ice: 'Thể rắn (đá)', water: 'Thể lỏng (nước)', steam: 'Thể khí (hơi nước)' };

// --- Hạt nảy mầm -----------------------------------------------------------------------------------------------------

function PlantScene({ W, slots, placed, partOf, wrong, run, fizzle, onUnplace, locked, reduceMotion }: SceneProps) {
  const styles = useStyles();
  const stages = slots.map((s) => Number(partOf(placed[s.id])?.art.split(':')[1] ?? 0));
  const last = Math.max(1, slots.length);
  // Growing: the seed is sown and watered (the drops fall, the soil darkens), then the big pot shows each stage placed,
  // in turn, until it flowers.
  const [grown, setGrown] = useState(0);
  const [wet, setWet] = useState(false);
  useEffect(() => {
    const id = run.addListener(({ value }) => {
      setWet(value >= 0.12);
      setGrown(value <= 0.2 ? 0 : Math.min(last, Math.ceil(((value - 0.2) / 0.8) * last)));
    });
    return () => run.removeListener(id);
  }, [run, last]);
  const shownStage = grown ? stages[grown - 1] || 0 : 0;
  const size = Math.min(70, (W * 0.62 - 16) / last - 6);
  const pour = run.interpolate({ inputRange: [0, 0.04, 0.18, 0.22, 1], outputRange: [0, 1, 1, 0, 0] });
  const bloom = run.interpolate({ inputRange: [0, 0.92, 1], outputRange: [0, 0, 1] });
  return (
    <>
      <View pointerEvents="none" style={[styles.fixed, { left: 10, top: STAGE_H - 160 }]}
        accessibilityLabel={`Chậu cây, giai đoạn ${shownStage}${wet ? ', đất đã được tưới ẩm' : ''}`}>
        <Pot size={130} stage={shownStage as 0} wet={wet} />
        <Animated.View style={[styles.can, { opacity: pour, transform: [{ rotate: '-24deg' }] }]}><WateringCan size={60} /></Animated.View>
        {!reduceMotion ? [0, 1, 2].map((i) => { // the water falls from the can's rose into the pot
          const start = 0.05 + i * 0.03;
          const fall = run.interpolate({ inputRange: [0, start, start + 0.08, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
          return (
            <Animated.View key={i} style={[styles.dropFall, { left: 66 + i * 9, opacity: fall.interpolate({ inputRange: [0, 0.05, 0.9, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, 38] }) }] }]}>
              <WaterDrop size={12} />
            </Animated.View>
          );
        }) : null}
        {stages[last - 1] === 5 && !reduceMotion ? (
          <Animated.View style={[styles.bloom, { opacity: bloom, transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
            <Sparkle size={34} color="#FFB4D2" />
          </Animated.View>
        ) : null}
      </View>
      <View style={[styles.timeline, { left: W * 0.36, width: W * 0.62 }]}>
        {slots.map((s, i) => (
          <View key={s.id} style={styles.step}>
            <View style={{ width: size, height: size }}>
              <Place slot={s} at={{ x: size / 2, y: size / 2 }} size={size} part={partOf(placed[s.id])} wrong={wrong.includes(s.id)} locked={locked} onUnplace={onUnplace}
                reduceMotion={reduceMotion} />
            </View>
            <Text style={[styles.stepNo, grown > i && styles.stepDone]}>{i + 1}</Text>
          </View>
        ))}
      </View>
      {wrong.length ? <Fizzle at={{ x: W * 0.67, y: 40 }} value={fizzle} /> : null}
    </>
  );
}

// --- Nam châm --------------------------------------------------------------------------------------------------------

const MAGNET = 78;

/** The objects put in the magnet's reach lie on the bench; the magnet comes down over them. Done right, the magnetic
 * ones fly up and stick under its poles while what was left on the bench stays put; a wrong one: the magnet comes
 * close, nothing moves, it goes back. */
function MagnetScene({ W, slots, placed, partOf, wrong, run, fizzle, onUnplace, locked, reduceMotion, parts, ran }: SceneProps) {
  const styles = useStyles();
  const bench = STAGE_H * 0.74;
  const placeX = (i: number) => (slots.length === 1 ? W * 0.5 : W * (0.38 + i * 0.24));
  const mx = W * 0.5;
  const down = run.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 34, 34], extrapolate: 'clamp' });
  const near = fizzle.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 26, 0] });
  const magnetTop = 6;
  const tips = [mx - MAGNET * 0.23, mx + MAGNET * 0.23];
  const tipY = magnetTop + 34 + MAGNET * 0.95;
  const pull = run.interpolate({ inputRange: [0, 0.4, 0.7, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
  const field = run.interpolate({ inputRange: [0, 0.3, 0.45, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
  const left = ran ? parts.filter((p) => !Object.values(placed).includes(p.id)) : [];
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.fixed, { left: mx - MAGNET / 2, top: magnetTop, transform: [{ translateY: Animated.add(down, near) }] }]}
        accessibilityLabel={ran ? 'Nam châm đã hạ xuống' : 'Nam châm'}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: field, top: MAGNET * 0.45 }]}><FieldLines size={MAGNET} /></Animated.View>
        <Magnet size={MAGNET} />
      </Animated.View>
      {slots.map((s, i) => {
        const part = partOf(placed[s.id]);
        const at = { x: placeX(i), y: bench };
        const tip = tips[Math.min(i, 1)] ?? mx;
        const stuck = ran && part;
        return (
          <Place key={s.id} slot={s} at={at} size={72} part={part} wrong={wrong.includes(s.id)} locked={locked} onUnplace={onUnplace} reduceMotion={reduceMotion}>
            {part ? (
              <Animated.View accessibilityLabel={stuck ? `${part.name} bị nam châm hút` : undefined}
                style={stuck ? { transform: [
                  { translateX: pull.interpolate({ inputRange: [0, 1], outputRange: [0, (slots.length === 1 ? mx : tip) - at.x] }) },
                  { translateY: pull.interpolate({ inputRange: [0, 1], outputRange: [0, tipY + 10 - at.y] }) },
                  { rotate: pull.interpolate({ inputRange: [0, 1], outputRange: ['0deg', i % 2 ? '-25deg' : '25deg'] }) },
                  { scale: pull.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] }) }] } : undefined}>
                <PartArt art={part.art} size={64} />
              </Animated.View>
            ) : undefined}
          </Place>
        );
      })}
      {left.map((p, i) => ( // left on the bench: not attracted, they stay where they are
        <View key={p.id} pointerEvents="none" style={[styles.fixed, styles.benchPart, { left: W - 52 - i * 46, top: bench - 6 }]}
          accessibilityLabel={`${p.name} đứng yên`}>
          <PartArt art={p.art} size={40} />
        </View>
      ))}
      {wrong.map((s) => {
        const i = slots.findIndex((x) => x.id === s);
        return <Fizzle key={s} at={{ x: placeX(i), y: bench - 54 }} value={fizzle} />;
      })}
    </>
  );
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 4 },
  flex: { flex: 1 },
  assistant: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  petBox: { width: 64, alignItems: 'center' },
  bubble: { flex: 1, backgroundColor: t.card, borderRadius: 16, borderBottomLeftRadius: 4, padding: 10, borderWidth: 1.5,
    borderColor: dark ? t.border : '#D9E2F0' },
  sceneHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sceneName: { fontSize: 12, fontWeight: '900', color: tones.lilac.ink },
  goal: { fontSize: 15, fontWeight: '800', color: t.ink, lineHeight: 20 },
  area: { gap: 10 },
  stage: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#FDF3E1' },
  fixed: { position: 'absolute' },
  wire: { position: 'absolute', borderWidth: 4, borderColor: '#C9873C', borderRadius: 10 },
  wireLit: { position: 'absolute', borderWidth: 4, borderColor: '#FFC94A', borderRadius: 10,
    shadowColor: '#FFD86B', shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  electron: { position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF7C2', borderWidth: 1.5, borderColor: '#F2A93B' },
  place: { position: 'absolute', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  placeEmpty: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#9AA8BC', backgroundColor: 'rgba(255,255,255,0.75)' },
  placeOver: { borderColor: '#136FA8', backgroundColor: 'rgba(214,236,255,0.95)', transform: [{ scale: 1.08 }] },
  placeWrong: { borderWidth: 2, borderStyle: 'solid', borderColor: '#B4234F', backgroundColor: 'rgba(255,214,220,0.9)' },
  placeFill: { alignItems: 'center', justifyContent: 'center' },
  placeLabel: { fontSize: 11, fontWeight: '900', color: '#6B7A90', textAlign: 'center', paddingHorizontal: 2 },
  fizzle: { position: 'absolute', width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  fizzleSpark: { position: 'absolute', right: -6, top: -6 },
  snapSpark: { position: 'absolute', right: -10, top: -12 },
  halo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,225,110,0.42)' },
  drop: { position: 'absolute', top: 18 },
  dropFall: { position: 'absolute', top: 20 },
  bloom: { position: 'absolute', left: 48, top: 0 },
  benchPart: { opacity: 0.95 },
  beam: { position: 'absolute', backgroundColor: 'rgba(255,236,150,0.55)', borderRadius: 30 },
  shadowSpot: { position: 'absolute', width: 40, height: 60, borderRadius: 10 },
  stateTag: { position: 'absolute', top: 8, fontSize: 12, fontWeight: '900', color: dark ? t.info : '#1559A8',
    backgroundColor: dark ? t.glass : 'rgba(255,255,255,0.9)', paddingHorizontal: 8,
    paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  vapour: { position: 'absolute', top: 6, width: 10, height: 18, borderRadius: 6, backgroundColor: 'rgba(230,240,255,0.9)' },
  can: { position: 'absolute', right: -40, top: -10 },
  timeline: { position: 'absolute', top: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', padding: 8, borderRadius: 16,
    backgroundColor: dark ? t.glass : 'rgba(255,255,255,0.9)', borderWidth: 1.5, borderColor: dark ? t.glassBorder : '#E3D3B8' },
  step: { alignItems: 'center', gap: 2 },
  stepNo: { fontSize: 12, fontWeight: '900', color: dark ? t.muted : '#6B7A90' },
  stepDone: { color: t.success },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', padding: 8, borderRadius: 18,
    backgroundColor: dark ? tones.sun.from : '#EFE3CF', minHeight: 96 },
  trayEmpty: { alignSelf: 'center', color: dark ? t.muted : '#8A7A62', fontWeight: '800' },
  part: { width: 84, minHeight: 86, borderRadius: 14, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center', padding: 4, borderWidth: 1.5,
    borderColor: dark ? t.border : '#E3D3B8' },
  partName: { fontSize: 11, fontWeight: '800', color: t.ink, textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: 10, backgroundColor: t.dangerBg },
  noteText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20, color: t.danger },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { minHeight: 46, borderRadius: 14, backgroundColor: '#5141A8', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryText: { color: t.onPrimary, fontWeight: '900', fontSize: 15 },
  secondary: { minHeight: 46, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryText: { color: t.accent, fontWeight: '900', fontSize: 14 },
  dimmed: { opacity: 0.45 },
}));
