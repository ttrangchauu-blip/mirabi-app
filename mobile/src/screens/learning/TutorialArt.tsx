import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { PetArt, restartFromZero } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { TutorialScene } from '../../learning/tutorials';
import { appTheme as t } from '../../theme';

const HEIGHT = 210;
const STEP_MS = 750;
const BASE_W = 70;
const MONSTER_W = 120;

type Props = { scene: TutorialScene; petId: string; petLevel: number; reduceMotion: boolean };

/** What a scene shows, read out instead of the drawing. */
export function describeScene(scene: TutorialScene): string {
  switch (scene.kind) {
    case 'fall': return scene.variant === 'word' ? `Từ “${scene.label}” rơi xuống` : `Thiên thạch “${scene.label}” rơi xuống`;
    case 'type': return `Gõ “${scene.answer}” rồi nhấn Bắn: hiện “${scene.result}”`;
    case 'monster': return `Quái vật mang phép tính ${scene.expression} tiến về căn cứ`;
    case 'numpad': return `Bấm ${scene.answer} cho ${scene.expression} rồi nhấn ${scene.submit}`;
    case 'gates': return `Câu “${scene.sentence}”, các cổng ${scene.options.join(', ')}${scene.demo ? `: chạm cổng ${scene.options[scene.right]}` : ''}`;
    case 'planks': return `Xếp ${scene.order.map((i) => scene.tokens[i]).join(' ')} cho câu “${scene.meaning}”`;
    case 'spans': return `Điền ${scene.answer} vào ${scene.equation} để đặt đoạn cầu`;
    case 'compare': return `So sánh ${scene.left} và ${scene.right}: chạm dấu ${scene.signs[scene.right_sign]}`;
    case 'rules': return scene.items.map((i) => i.text).join(' ');
  }
}

/** Steps 0 … count−1 in a loop, one every STEP_MS. Reduced motion holds the last step (the finished move). */
function useStep(count: number, reduceMotion: boolean) {
  const [step, setStep] = useState(reduceMotion ? count - 1 : 0);
  useEffect(() => {
    if (reduceMotion) { setStep(count - 1); return; }
    setStep(0);
    const timer = setInterval(() => setStep((s) => (s + 1) % count), STEP_MS);
    return () => clearInterval(timer);
  }, [count, reduceMotion]);
  return step;
}

/** 0 → 1 over `ms`, again and again (still at `still` with reduced motion). */
function useLoop(ms: number, reduceMotion: boolean, still = 0.5) {
  const value = useRef(new Animated.Value(reduceMotion ? still : 0)).current;
  useEffect(() => {
    if (reduceMotion) { value.setValue(still); return; }
    const loop = Animated.loop(restartFromZero(value, 1, ms));
    loop.start();
    return () => loop.stop();
  }, [value, ms, reduceMotion, still]);
  return value;
}

/** A small working copy of the game, drawn like the real one, that shows the move the page explains. */
export function TutorialArt({ scene, petId, petLevel, reduceMotion }: Props) {
  const body = (() => {
    switch (scene.kind) {
      case 'fall': return <FallScene scene={scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'type': return <TypeScene scene={scene} reduceMotion={reduceMotion} />;
      case 'monster': return <MonsterScene scene={scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'numpad': return <NumpadScene scene={scene} reduceMotion={reduceMotion} />;
      case 'gates': return <GatesScene scene={scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'planks': return <PlanksScene scene={scene} reduceMotion={reduceMotion} />;
      case 'spans': return <SpansScene scene={scene} reduceMotion={reduceMotion} />;
      case 'compare': return <CompareScene scene={scene} reduceMotion={reduceMotion} />;
      case 'rules': return <RulesScene scene={scene} />;
    }
  })();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Minh họa: ${describeScene(scene)}`} style={styles.frame}>
      {body}
    </View>
  );
}

// --- Vocabulary: the night sky ------------------------------------------------------------------------------------------

function Sky({ children }: { children: React.ReactNode }) {
  return (
    <View style={[styles.scene, styles.sky]}>
      {[[10, 14], [26, 48], [44, 10], [62, 30], [80, 16], [90, 54], [18, 76], [70, 70]].map(([x, y], i) => (
        <View key={i} style={[styles.star, { left: `${x}%`, top: `${y}%`, opacity: i % 3 ? 0.45 : 0.85 }]} />
      ))}
      <View style={styles.ground} />
      {children}
    </View>
  );
}

function Target({ variant, label, hit }: { variant: 'word' | 'meteor'; label: string; hit?: boolean }) {
  if (hit) return <Text style={styles.boom}>💥</Text>;
  if (variant === 'word') {
    return (
      <LinearGradient colors={['#7FD3FF', '#4C6FFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <Text style={styles.tileText}>{label}</Text>
      </LinearGradient>
    );
  }
  return (
    <View style={styles.center}>
      <LinearGradient colors={['#FFE29A', '#F58A3A', '#8E3B1F']} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.85, y: 1 }} style={styles.rock} />
      <Text style={styles.rockWord}>{label}</Text>
    </View>
  );
}

function FallScene({ scene, petId, petLevel, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'fall' }> } & Omit<Props, 'scene'>) {
  const fall = useLoop(3200, reduceMotion);
  const top = fall.interpolate({ inputRange: [0, 1], outputRange: [6, HEIGHT - 100] });
  return (
    <Sky>
      <View style={styles.petCorner}><PetArt pet={petId} size={56} stage={petLevel} still={reduceMotion} /></View>
      <Animated.View style={[styles.faller, { transform: [{ translateY: top }] }]}>
        <Target variant={scene.variant} label={scene.label} />
      </Animated.View>
    </Sky>
  );
}

function TypeScene({ scene, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'type' }>; reduceMotion: boolean }) {
  const letters = scene.answer.length;
  // 0: empty boxes · 1…n: one more letter · n+1: "Bắn" pressed · n+2: hit, the result shows.
  const step = useStep(letters + 3, reduceMotion);
  const typed = scene.answer.slice(0, Math.min(step, letters));
  const firing = step >= letters + 1;
  const hit = step === letters + 2;
  return (
    <Sky>
      <View style={styles.typeTarget}>
        <Target variant={scene.variant} label={scene.label} hit={hit} />
        {hit ? <Text style={styles.result}>{scene.result}</Text> : null}
      </View>
      <View style={styles.typeRow}>
        <View style={styles.boxes}>
          {Array.from({ length: letters }, (_, i) => (
            <View key={i} style={[styles.box, typed[i] ? styles.boxFilled : null]}><Text style={styles.boxLetter}>{typed[i] ?? ''}</Text></View>
          ))}
        </View>
        <View style={[styles.fire, typed.length === letters && styles.fireLit, firing && !hit && styles.fireDown]}>
          <Ionicons name="flame" size={16} color="#FFFFFF" />
          <Text style={styles.fireText}>Bắn</Text>
        </View>
        {firing && !hit ? <Text style={styles.pointerFire}>👆</Text> : null}
      </View>
    </Sky>
  );
}

// --- Math: the meadow and the bridge -----------------------------------------------------------------------------------

function MonsterScene({ scene, petId, petLevel, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'monster' }> } & Omit<Props, 'scene'>) {
  const walk = useLoop(3600, reduceMotion);
  const [width, setWidth] = useState(0);
  // From the right edge to just before the base, where it stops and waits (Học tập).
  const way = Math.max(0, width - BASE_W - MONSTER_W - 24);
  const x = walk.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, -way, -way] });
  return (
    <View style={[styles.scene, styles.meadow]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.base}><Text style={styles.baseIcon}>🏰</Text></View>
      <View style={styles.petBase}><PetArt pet={petId} size={52} stage={petLevel} still={reduceMotion} /></View>
      <Animated.View style={[styles.monster, { transform: [{ translateX: x }] }]}>
        <Text style={styles.monsterIcon}>👾</Text>
        <Text style={styles.monsterText}>{scene.expression}</Text>
      </Animated.View>
    </View>
  );
}

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function NumpadScene({ scene, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'numpad' }>; reduceMotion: boolean }) {
  const digits = scene.answer.length;
  const step = useStep(digits + 3, reduceMotion);
  const typed = scene.answer.slice(0, Math.min(step, digits));
  const pressing = step >= 1 && step <= digits ? scene.answer[step - 1] : null;
  const submitting = step === digits + 1;
  const done = step === digits + 2;
  return (
    <View style={[styles.scene, styles.light]}>
      <View style={styles.padHead}>
        <View style={styles.monsterSmall}><Text style={styles.monsterIconSmall}>{done ? '💥' : '👾'}</Text><Text style={styles.monsterText}>{scene.expression} = ?</Text></View>
        {done ? <Text style={styles.good}>Chính xác!</Text> : null}
      </View>
      <View style={styles.display}><Text style={styles.displayText}>{typed || ' '}</Text></View>
      <View style={styles.pad}>
        {PAD_KEYS.map((k) => (
          <View key={k} style={[styles.key, pressing === k && styles.keyOn]}><Text style={[styles.keyText, pressing === k && styles.onText]}>{k}</Text></View>
        ))}
      </View>
      <View style={[styles.submit, submitting && styles.submitOn]}><Text style={styles.submitText}>{scene.submit}</Text></View>
    </View>
  );
}

function SpansScene({ scene, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'spans' }>; reduceMotion: boolean }) {
  const SPANS = 5;
  // One more span per step; the answer is shown in the gap while a span is being laid.
  const step = useStep(SPANS + 1, reduceMotion);
  const filled = step > 0;
  return (
    <View style={[styles.scene, styles.light]}>
      <View style={styles.spans}>
        {Array.from({ length: SPANS }, (_, i) => <View key={i} style={[styles.span, i < step && styles.spanBuilt]} />)}
      </View>
      <Text style={styles.equation}>{filled ? scene.equation.replace('▢', scene.answer) : scene.equation}</Text>
      {filled ? <Text style={[styles.good, styles.centerText]}>+1 đoạn cầu</Text> : <Text style={[styles.mutedText, styles.centerText]}>Tìm số còn thiếu</Text>}
      <View style={[styles.submit, filled && styles.submitOn]}><Text style={styles.submitText}>Đặt đoạn cầu</Text></View>
    </View>
  );
}

function CompareScene({ scene, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'compare' }>; reduceMotion: boolean }) {
  // 0: the question · 1: the right sign is tapped · 2: it fills the gap.
  const step = useStep(3, reduceMotion);
  const sign = scene.signs[scene.right_sign];
  return (
    <View style={[styles.scene, styles.light]}>
      <Text style={styles.equation}>{scene.left}  {step === 2 ? sign : '▢'}  {scene.right}</Text>
      {step === 2 ? <Text style={[styles.good, styles.centerText]}>Chính xác!</Text> : <Text style={[styles.mutedText, styles.centerText]}>Chọn dấu đúng</Text>}
      <View style={styles.signs}>
        {scene.signs.map((s, i) => (
          <View key={s} style={[styles.sign, i === scene.right_sign && step >= 1 && styles.signOn]}>
            <Text style={[styles.signText, i === scene.right_sign && step >= 1 && styles.onText]}>{s}</Text>
            {i === scene.right_sign && step === 1 ? <Text style={styles.pointer}>👆</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// --- Grammar: gates and planks ----------------------------------------------------------------------------------------

function GatesScene({ scene, petId, petLevel, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'gates' }> } & Omit<Props, 'scene'>) {
  const step = useStep(3, reduceMotion || !scene.demo);
  const chosen = scene.demo && step >= 1;
  const filled = scene.demo && step === 2;
  const answer = scene.options[scene.right];
  return (
    <View style={[styles.scene, styles.light]}>
      <Text style={styles.sentence}>{filled ? scene.sentence.replace('___', answer) : scene.sentence}</Text>
      <View style={styles.gates}>
        {scene.options.map((o, i) => (
          <View key={o} style={[styles.gate, chosen && i === scene.right && styles.gateOn]}>
            <Text style={styles.gateArch}>⛩️</Text>
            <Text style={styles.gateText}>{o}</Text>
            {chosen && !filled && i === scene.right ? <Text style={styles.pointer}>👆</Text> : null}
          </View>
        ))}
      </View>
      <View style={styles.petRow}>
        <PetArt pet={petId} size={44} stage={petLevel} still={reduceMotion} />
        {filled ? <Text style={styles.good}>Chính xác! Pet qua cổng.</Text> : null}
      </View>
    </View>
  );
}

function PlanksScene({ scene, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'planks' }>; reduceMotion: boolean }) {
  const n = scene.order.length;
  // 0: nothing placed · 1…n: the next piece in order · n+1: "Kiểm tra", the sentence is right.
  const step = useStep(n + 2, reduceMotion || !scene.demo);
  const placedCount = scene.demo ? Math.min(step, n) : 0;
  const placed = scene.order.slice(0, placedCount);
  const checked = scene.demo && step === n + 1;
  return (
    <View style={[styles.scene, styles.light]}>
      <Text style={styles.meaning}>{scene.meaning}</Text>
      <View style={styles.bridge}>
        {placed.length === 0 ? <Text style={styles.mutedText}>Chạm các mảnh để xếp câu</Text> : placed.map((i) => (
          <View key={i} style={styles.plank}><Text style={styles.plankText}>{scene.tokens[i]}</Text></View>
        ))}
        {placed.length === n ? <Text style={styles.endMark}>.</Text> : null}
      </View>
      <View style={styles.tokens}>
        {scene.tokens.map((tk, i) => placed.includes(i) ? null : (
          <View key={i} style={[styles.token, scene.demo && scene.order[placedCount] === i && styles.tokenNext]}>
            <Text style={styles.tokenText}>{tk}</Text>
          </View>
        ))}
      </View>
      <View style={styles.checkRow}>
        <View style={[styles.submit, styles.flex, placed.length === n && styles.submitOn]}><Text style={styles.submitText}>Kiểm tra</Text></View>
        {checked ? <Text style={styles.good}>Chính xác!</Text> : null}
      </View>
    </View>
  );
}

// --- How the stage ends -----------------------------------------------------------------------------------------------

const TONE = { good: { color: t.success, bg: t.successBg }, bad: { color: t.danger, bg: t.dangerBg }, info: { color: t.accent, bg: t.tint } };

function RulesScene({ scene }: { scene: Extract<TutorialScene, { kind: 'rules' }> }) {
  return (
    <View style={styles.rules}>
      {scene.items.map((item) => (
        <View key={item.text} style={styles.rule}>
          <View style={[styles.ruleIcon, { backgroundColor: TONE[item.tone].bg }]}><Ionicons name={item.icon} size={20} color={TONE[item.tone].color} /></View>
          <Text style={styles.ruleText}>{item.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', minHeight: HEIGHT },
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  scene: { height: HEIGHT, borderRadius: 20, overflow: 'hidden', padding: 12 },
  sky: { backgroundColor: '#142349' },
  light: { backgroundColor: '#F2FAFF', gap: 8, justifyContent: 'center' },
  meadow: { backgroundColor: '#DDF3E4' },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  ground: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 18, backgroundColor: '#3E5F45' },
  petCorner: { position: 'absolute', left: 10, bottom: 12 },
  faller: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  tile: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, shadowColor: '#7FB8FF', shadowOpacity: 0.9, shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  tileText: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  rock: { width: 46, height: 46, borderRadius: 23, shadowColor: '#FF8A3D', shadowOpacity: 0.9, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  rockWord: { marginTop: 6, fontSize: 18, fontWeight: '900', color: '#FFE9B8', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  boom: { fontSize: 40 },
  typeTarget: { alignItems: 'center', marginTop: 4, minHeight: 92 },
  result: { fontSize: 20, fontWeight: '900', color: '#FFE9B8', marginTop: 2 },
  typeRow: { position: 'absolute', left: 0, right: 0, bottom: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  boxes: { flexDirection: 'row', gap: 5 },
  box: { width: 28, height: 36, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center' },
  boxFilled: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  boxLetter: { fontSize: 20, fontWeight: '900', color: '#142349' },
  fire: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: 14, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  fireLit: { backgroundColor: '#FF7A3D', borderColor: '#FF7A3D' },
  fireDown: { transform: [{ scale: 0.92 }] },
  fireText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  pointerFire: { position: 'absolute', right: '18%', bottom: -24, fontSize: 24 },
  base: { position: 'absolute', left: 0, top: 0, bottom: 0, width: BASE_W, backgroundColor: '#C7E5CF', alignItems: 'center', paddingTop: 10 },
  baseIcon: { fontSize: 30 },
  petBase: { position: 'absolute', left: 10, bottom: 10 },
  monster: { position: 'absolute', right: 12, top: 70, width: MONSTER_W, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16, borderWidth: 2, borderColor: '#F2A93B', paddingHorizontal: 10, paddingVertical: 8 },
  monsterIcon: { fontSize: 24 },
  monsterText: { fontSize: 18, fontWeight: '900', color: t.ink },
  padHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monsterSmall: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 2,
    borderColor: '#F2A93B', paddingHorizontal: 10, paddingVertical: 4 },
  monsterIconSmall: { fontSize: 20 },
  display: { height: 34, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: t.border, justifyContent: 'center', paddingHorizontal: 10 },
  displayText: { fontSize: 20, fontWeight: '900', color: t.ink, textAlign: 'right' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  key: { width: '32%', height: 22, borderRadius: 7, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  keyOn: { backgroundColor: t.accent },
  keyText: { fontSize: 14, fontWeight: '800', color: t.ink },
  onText: { color: '#FFFFFF' },
  submit: { height: 34, borderRadius: 10, backgroundColor: t.accent, opacity: 0.45, alignItems: 'center', justifyContent: 'center' },
  submitOn: { opacity: 1 },
  submitText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  good: { color: t.success, fontWeight: '900', fontSize: 15 },
  mutedText: { color: t.muted, fontSize: 13 },
  spans: { flexDirection: 'row', gap: 4 },
  span: { flex: 1, height: 16, borderRadius: 5, backgroundColor: '#D4E3EC' },
  spanBuilt: { backgroundColor: '#C98B4E' },
  equation: { fontSize: 30, fontWeight: '900', color: t.ink, textAlign: 'center' },
  signs: { flexDirection: 'row', gap: 10 },
  sign: { flex: 1, height: 54, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  signOn: { backgroundColor: t.accent, borderColor: t.accent },
  signText: { fontSize: 26, fontWeight: '900', color: t.accent },
  pointer: { position: 'absolute', bottom: -18, right: 4, fontSize: 22 },
  sentence: { fontSize: 22, fontWeight: '900', color: t.ink, textAlign: 'center' },
  gates: { flexDirection: 'row', gap: 8 },
  gate: { flex: 1, height: 74, borderRadius: 16, backgroundColor: '#FFF4E0', borderWidth: 2, borderColor: '#F2C46D', alignItems: 'center', justifyContent: 'center' },
  gateOn: { borderColor: t.success, backgroundColor: t.successBg },
  gateArch: { fontSize: 20 },
  gateText: { fontSize: 17, fontWeight: '900', color: t.ink },
  petRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  meaning: { fontSize: 18, fontWeight: '900', color: t.ink, textAlign: 'center' },
  bridge: { minHeight: 48, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: '#A9C9DD', padding: 6, flexDirection: 'row',
    flexWrap: 'wrap', gap: 6, alignItems: 'center', backgroundColor: '#FFFFFF' },
  plank: { backgroundColor: '#C98B4E', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  plankText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  endMark: { fontSize: 18, fontWeight: '900', color: t.ink },
  tokens: { flexDirection: 'row', gap: 8, minHeight: 36 },
  token: { backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 6 },
  tokenNext: { borderColor: t.accent, borderWidth: 2 },
  tokenText: { fontSize: 15, fontWeight: '800', color: t.ink },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rules: { gap: 10, paddingVertical: 4 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ruleIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  ruleText: { flex: 1, fontSize: 15, color: t.ink, lineHeight: 21, fontWeight: '700' },
});
