import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt, restartFromZero } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { TutorialScene, TutorialTarget } from '../../learning/tutorials';
import { appTheme as t } from '../../theme';
import { AnswerSlots } from './games/LetterInput';
import { Rock, WordTile } from './games/Playfield';
import { CodePath, SortCards, SpellDetective, WordBuild } from './games/CurriculumGames';
import { ChoiceExplain, MatchPairs, OrderSteps } from './games/LessonGames';
import type { Turn } from '../../learning/types';

const HEIGHT = 210;
const STEP_MS = 750;
const BASE_W = 70;
const MONSTER_W = 120;
/** The falling words' frame, as in the game (Playfield METEOR_W), and the pet at the bottom. */
const TARGET_W = 112;
const PET = 48;
const PET_BOTTOM = 12;

type Props = { scene: TutorialScene; petId: string; petLevel: number; reduceMotion: boolean };

/** What a scene shows, read out instead of the drawing. */
export function describeScene(scene: TutorialScene): string {
  switch (scene.kind) {
    case 'fall': return `${scene.targets.length} ${scene.variant === 'word' ? 'từ' : 'thiên thạch'} đang rơi, pet đứng dưới đất. `
      + `Ô chữ nằm dưới “${scene.targets[0].label}”, gần mặt đất nhất`;
    case 'type': return `Gõ “${scene.answer}” vào ô chữ dưới “${scene.target.label}”: pet tự bắn, đạn đuổi theo, trúng thì vỡ và hiện “${scene.result}”`;
    case 'monster': return `Quái vật mang phép tính ${scene.expression} tiến về căn cứ`;
    case 'numpad': return `Bấm ${scene.answer} cho ${scene.expression} rồi nhấn ${scene.submit}`;
    case 'gates': return `Câu “${scene.sentence}”, các cổng ${scene.options.join(', ')}${scene.demo ? `: chạm cổng ${scene.options[scene.right]}` : ''}`;
    case 'planks': return `Xếp ${scene.order.map((i) => scene.tokens[i]).join(' ')} cho câu “${scene.meaning}”`;
    case 'spans': return `Điền ${scene.answer} vào ${scene.equation} để đặt đoạn cầu`;
    case 'compare': return `So sánh ${scene.left} và ${scene.right}: chạm dấu ${scene.signs[scene.right_sign]}`;
    case 'rules': return scene.items.map((i) => i.text).join(' ');
    case 'word_build': return `Hình ${scene.picture}, các ${scene.unit === 'letter' ? 'chữ' : 'tiếng'} ${scene.shuffled.map((i) => scene.pieces[i]).join(', ')}`
      + (scene.demo ? `: chạm ${scene.pieces.join(', ')} rồi Kiểm tra` : '');
    case 'spell_fix': return `Câu “${scene.words.join(' ')}”` + (scene.demo ? `: chạm “${scene.words[scene.wrong]}”, chọn “${scene.options[scene.right]}”` : '');
    case 'sort': return `Thẻ ${scene.card.text}, các nhóm ${scene.groups.map((g) => g.label).join(', ')}`
      + (scene.demo ? `: kéo thẻ vào nhóm ${scene.groups.find((g) => g.id === scene.right)?.label}` : '');
    case 'order': return `${scene.prompt}: ` + (scene.demo ? `chạm ${scene.items.join(', ')} rồi Kiểm tra` : `các thẻ ${scene.shuffled.map((i) => scene.items[i]).join(', ')}`);
    case 'match': return `${scene.prompt}: ` + scene.pairs.map(([a, b]) => `${a} với ${b}`).join(', ');
    case 'choice': return `${scene.question} ` + (scene.demo ? `Chọn “${scene.options[scene.wrong]}”: chưa phù hợp, có lý do. Chọn “${scene.options[scene.right]}”: đúng.` : scene.options.join(', '));
    case 'code': return scene.mode === 'build' ? `Xếp các lệnh ${scene.program.length} lệnh vào thanh chương trình` : 'Nhấn Chạy: pet đi theo từng lệnh tới cờ đích';
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
  // The sky scenes place the words, the bullet and the pet from the frame's width.
  const [width, setWidth] = useState(0);
  const body = (() => {
    switch (scene.kind) {
      case 'fall': return <FallScene scene={scene} width={width} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'type': return <TypeScene scene={scene} width={width} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'monster': return <MonsterScene scene={scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'numpad': return <NumpadScene scene={scene} reduceMotion={reduceMotion} />;
      case 'gates': return <GatesScene scene={scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
      case 'planks': return <PlanksScene scene={scene} reduceMotion={reduceMotion} />;
      case 'spans': return <SpansScene scene={scene} reduceMotion={reduceMotion} />;
      case 'compare': return <CompareScene scene={scene} reduceMotion={reduceMotion} />;
      case 'rules': return <RulesScene scene={scene} />;
      case 'order': case 'match': case 'choice': return <LessonScene scene={scene} reduceMotion={reduceMotion} />;
      case 'word_build': case 'spell_fix': case 'sort': case 'code':
        return <CurriculumScene scene={scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />;
    }
  })();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Minh họa: ${describeScene(scene)}`} style={styles.frame}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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

/** A falling target as the game draws it: the word tile (Anh → Việt) or the rock with its meaning (Việt → Anh), and the
 * answer boxes in its frame, right under it. The aimed one is larger and shows what is typed. */
function Target({ variant, target, aimed, typed = '' }: { variant: 'word' | 'meteor'; target: TutorialTarget; aimed: boolean; typed?: string }) {
  return (
    <View style={styles.target}>
      {variant === 'word' ? <WordTile word={target.label} danger={false} big={aimed} /> : (
        <>
          <Rock danger={false} big={aimed} />
          <Text style={[styles.rockWord, aimed && styles.rockWordAimed]} numberOfLines={1}>{target.label}</Text>
        </>
      )}
      <View style={aimed ? styles.slotsAimed : styles.slotsCompact}>
        <AnswerSlots letters={target.letters} value={typed} width={TARGET_W - 8} compact={!aimed} />
      </View>
    </View>
  );
}

/** Several words falling at once in their lanes, each at its own height; the one closest to the ground is aimed. */
function FallScene({ scene, width, petId, petLevel, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'fall' }>; width: number } & Omit<Props, 'scene'>) {
  const fall = useLoop(4200, reduceMotion, 0.4);
  const drop = fall.interpolate({ inputRange: [0, 1], outputRange: [0, 28] });
  const lanes = [0.27, 0.73, 0.5];
  // A meteor's frame (rock, meaning, boxes) is taller than a word tile's: it starts higher, so it stays above the ground.
  const tops = scene.variant === 'word' ? [50, 22, -6] : [34, 0, -24];
  return (
    <Sky>
      {width > 0 ? scene.targets.slice(0, 3).map((target, i) => (
        <Animated.View key={target.label} style={[styles.faller, { left: Math.max(4, Math.min(width - TARGET_W - 4, width * lanes[i] - TARGET_W / 2)),
          top: tops[i], transform: [{ translateY: drop }] }]}>
          <Target variant={scene.variant} target={target} aimed={i === 0} />
        </Animated.View>
      )) : null}
      <View style={[styles.shooter, { left: width * 0.6 - PET / 2 }]}><PetArt pet={petId} size={PET} stage={petLevel} still={reduceMotion} /></View>
    </Sky>
  );
}

/**
 * Typing the answer in the boxes under the aimed word, as in the game: nothing to press. 0: empty boxes · 1…n: one more
 * letter · n+1: right, the boxes are empty again (ready for the next word) and the pet's bullet flies after the word,
 * which keeps falling · n+2, n+3: the bullet reaches it, it breaks, and its meaning shows where it was hit.
 */
function TypeScene({ scene, width, petId, petLevel, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'type' }>; width: number } & Omit<Props, 'scene'>) {
  const letters = scene.answer.replace(/\s+/g, '').length;
  const step = useStep(letters + 4, reduceMotion);
  const typed = step <= letters ? scene.answer.slice(0, step) : '';
  const firing = step === letters + 1;
  const hit = step >= letters + 2;
  const top = 8 + Math.min(step, letters + 2) * 5; // it keeps falling while the answer is typed and the bullet flies
  const bullet = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!firing) return;
    bullet.setValue(0);
    const run = Animated.timing(bullet, { toValue: 1, duration: STEP_MS * 0.9, easing: Easing.in(Easing.quad), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [firing, bullet]);
  const muzzle = HEIGHT - PET_BOTTOM - PET + 8;
  const hitY = top + (scene.variant === 'word' ? 38 : 43); // the middle of the tile, or of the rock
  return (
    <Sky>
      {width > 0 ? (
        <>
          {hit ? (
            <View style={[styles.burst, { top: Math.max(4, hitY - 24), left: width / 2 - 75 }]}>
              <Text style={styles.burstTitle}>{scene.result}</Text>
              {scene.sub ? <Text style={styles.burstSub}>{scene.sub}</Text> : null}
            </View>
          ) : (
            <View style={[styles.faller, { left: width / 2 - TARGET_W / 2, top }]}>
              <Target variant={scene.variant} target={scene.target} aimed typed={typed} />
            </View>
          )}
          {hit && step === letters + 2 ? [0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[styles.shard, { left: width / 2 + Math.cos(i * 1.05) * 46 - 3, top: hitY + Math.sin(i * 1.05) * 30 - 3 },
              i % 2 ? styles.shardAlt : null, scene.variant === 'meteor' && styles.shardRock]} />
          )) : null}
          {firing ? (
            <Animated.View style={[styles.bullet, { left: width / 2 - 3, top: 0, transform: [{ translateY: bullet.interpolate({ inputRange: [0, 1], outputRange: [muzzle, hitY + 6] }) }] }]} />
          ) : null}
        </>
      ) : null}
      <View style={[styles.shooter, { left: width / 2 - PET / 2 }]}><PetArt pet={petId} size={PET} stage={petLevel} still={reduceMotion} /></View>
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
        {filled ? <Text style={styles.good}>Chính xác!</Text> : null}
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

// --- Curriculum games: their real play area, playing the move -------------------------------------------------------

const demoTurn = (kind: Turn['kind'], prompt: Turn['prompt']): Turn => ({ turn_id: `guide-${kind}`, position: 0, kind, skill_label: '',
  prompt, hints_shown: [], hints_total: 0, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 });

function CurriculumScene({ scene, petId, petLevel, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'word_build' | 'spell_fix' | 'sort' | 'code' }> } & Omit<Props, 'scene'>) {
  const frames = scene.kind === 'word_build' ? scene.pieces.length + 2 : scene.kind === 'code' ? scene.program.length + 2 : 4;
  const animated = scene.kind === 'code' || ('demo' in scene && !!scene.demo);
  const step = useStep(frames, reduceMotion || !animated);
  let body: React.ReactNode = null;
  if (scene.kind === 'word_build') {
    const tiles = scene.shuffled.map((i, n) => ({ id: `t${n + 1}`, text: scene.pieces[i] }));
    const order = scene.pieces.map((_, i) => `t${scene.shuffled.indexOf(i) + 1}`);
    const placed = scene.demo ? order.slice(0, Math.min(step, order.length)) : [];
    body = <WordBuild turn={demoTurn('word_build', { picture: scene.picture, unit: scene.unit, tiles })} disabled onSubmit={() => {}}
      collected={scene.demo && step === frames - 1 ? 1 : 0} total={CURRICULUM_TOTAL} petId={petId} petLevel={petLevel}
      demo={{ placed, result: scene.demo && step === frames - 1 ? 'ok' : undefined }} />;
  } else if (scene.kind === 'spell_fix') {
    const tokens = scene.words.map((w, i) => ({ id: `w${i + 1}`, text: w }));
    const options = scene.options.map((o, i) => ({ id: `o${i + 1}`, text: o }));
    const wrong = `w${scene.wrong + 1}`;
    // 0: the sentence · 1: the misspelled word tapped · 2: the spellings · 3: the right one chosen
    const found = scene.demo && step >= 1 ? wrong : undefined;
    body = <SpellDetective turn={demoTurn('spell_fix', { step: found ? 'fix' : 'find', tokens, found, options: found ? options : undefined })}
      disabled onFind={() => {}} onFix={() => {}}
      feedback={scene.demo && step === 3 ? { text: `Chính xác! “${scene.options[scene.right]}” mới đúng chính tả.`, tone: 'good' } : null}
      demo={{ found, tapped: scene.demo && step === 1 ? wrong : undefined, chosen: scene.demo && step === 3 ? `o${scene.right + 1}` : undefined }} />;
  } else if (scene.kind === 'sort') {
    body = <SortCards turn={demoTurn('sort_card', { title: scene.title, groups: scene.groups, card: scene.card })} disabled onPlace={() => {}}
      demo={{ over: scene.demo && step >= 1 && step < 3 ? scene.right : undefined, placed: scene.demo && step === 3 ? scene.right : undefined }} />;
  } else {
    const { kind: _kind, program, mode, ...level } = scene;
    const shown = mode === 'build' ? program.slice(0, Math.min(step, program.length)) : program;
    body = <CodePath turn={demoTurn('code_path', { ...level, number: 1, max_blocks: program.length + 1, blocks: ['forward', 'left', 'right'] })}
      disabled onRun={() => {}} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion}
      demo={{ program: shown, step: mode === 'run' ? step : 0 }} />;
  }
  return <View style={[styles.scene, styles.light, styles.curriculum]} pointerEvents="none">{body}</View>;
}

const CURRICULUM_TOTAL = 10;

/** The lesson games: their real play area, the move played step by step. */
function LessonScene({ scene, reduceMotion }: { scene: Extract<TutorialScene, { kind: 'order' | 'match' | 'choice' }>; reduceMotion: boolean }) {
  const frames = scene.kind === 'order' ? scene.items.length + 2 : scene.kind === 'match' ? scene.pairs.length * 2 + 2 : 4;
  const step = useStep(frames, reduceMotion || !scene.demo);
  let body: React.ReactNode;
  if (scene.kind === 'order') {
    const cards = scene.shuffled.map((i, n) => ({ id: `c${n + 1}`, text: scene.items[i] }));
    const right = scene.items.map((_, i) => `c${scene.shuffled.indexOf(i) + 1}`);
    const placed = scene.demo ? right.slice(0, Math.min(step, right.length)) : [];
    body = <OrderSteps turn={demoTurn('order_steps', { prompt: scene.prompt, cards, first: scene.first, last: scene.last })} disabled onSubmit={() => {}}
      demo={{ placed, result: scene.demo && step === frames - 1 ? 'ok' : undefined }} />;
  } else if (scene.kind === 'match') {
    const lefts = scene.pairs.map(([a], i) => ({ id: `a${i + 1}`, text: a }));
    const rights = scene.rightOrder.map((i, n) => ({ id: `b${n + 1}`, text: scene.pairs[i][1] }));
    const pairs: Record<string, string> = {};
    let selected: string | undefined;
    if (scene.demo) {
      for (let i = 0; i < scene.pairs.length; i += 1) {
        const left = `a${i + 1}`;
        if (step >= i * 2 + 2) pairs[left] = `b${scene.rightOrder.indexOf(i) + 1}`;
        else if (step === i * 2 + 1) selected = left;
      }
    }
    body = <MatchPairs turn={demoTurn('match_pairs', { prompt: scene.prompt, lefts, rights })} disabled onSubmit={() => {}}
      demo={{ pairs, selected, result: scene.demo && step === frames - 1 ? 'ok' : undefined }} />;
  } else {
    const options = scene.options.map((text, i) => ({ id: `o${i + 1}`, text }));
    // 0: the question · 1: a wrong option tried, its reason · 2: … · 3: the right one
    const chosen = !scene.demo || step === 0 ? undefined : step < 3 ? `o${scene.wrong + 1}` : `o${scene.right + 1}`;
    body = <ChoiceExplain turn={demoTurn('choice_explain', { style: scene.style, question: scene.question, options })} disabled onChoose={() => {}}
      demo={{ chosen, result: chosen ? (step < 3 ? 'bad' : 'ok') : undefined }} />;
  }
  return <View style={[styles.scene, styles.light, styles.curriculum]} pointerEvents="none">{body}</View>;
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
  // The real play area: as tall as it needs.
  curriculum: { height: undefined, minHeight: HEIGHT },
  meadow: { backgroundColor: '#DDF3E4' },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  ground: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 18, backgroundColor: '#3E5F45' },
  faller: { position: 'absolute', width: TARGET_W },
  target: { alignItems: 'center' },
  rockWord: { marginTop: 4, fontSize: 13, lineHeight: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  rockWordAimed: { fontSize: 15, lineHeight: 19, color: '#FFE9B8' },
  slotsAimed: { marginTop: 6, alignItems: 'center' },
  slotsCompact: { marginTop: 3 },
  shooter: { position: 'absolute', bottom: PET_BOTTOM },
  bullet: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF4B0',
    shadowColor: '#FFD84D', shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  shard: { position: 'absolute', width: 6, height: 6, borderRadius: 2, backgroundColor: '#7FD3FF' },
  shardAlt: { backgroundColor: '#4C6FFF' },
  shardRock: { backgroundColor: '#F58A3A' },
  // The meaning where the word broke, as the game shows it (Playfield `burst`).
  burst: { position: 'absolute', width: 150, minHeight: 50, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 12, backgroundColor: 'rgba(12,22,52,0.55)' },
  burstTitle: { fontSize: 15, fontWeight: '800', color: '#FFE9B8', textAlign: 'center' },
  burstSub: { fontSize: 12, fontWeight: '600', color: '#C9D6F2', textAlign: 'center' },
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
