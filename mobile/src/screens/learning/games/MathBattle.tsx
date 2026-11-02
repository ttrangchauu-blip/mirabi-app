import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PetArt } from '../../../components/PetArt';
import { Text } from '../../../components/Typography';
import type { Turn } from '../../../learning/types';
import { petById } from '../../../pets';
import { attackWindupMs, drawnActions } from '../../../petSprites';
import { appTheme as t } from '../../../theme';
import { ArenaLayer, CrystalShield, Impact, MagicBolt, MONSTER_ART, MonsterId, MonsterMood, Sparkle, Zone } from '../../../games/art/mathBattle';
import { Layer, Parallax } from '../../../games/engine/Parallax';
import { useRig } from '../../../games/engine/rig';
import { useSfx } from '../../../games/engine/sfx';
import { useReactions } from '../../../games/engine/feedback';
import { useAdvance } from '../../../games/quests/worlds';
import { MagicCircle, Slash } from '../../../games/art/effects';

// Math Battle (Toán, the `defense` game): a turn-based duel in a fantasy world. The pet stands on the left, a monster on
// the right; the problem to solve is under them and the number pad's "Tấn công" answers it. A right answer: the pet
// casts, a magic bolt flies, the monster flashes and loses one hit point; at zero it is defeated and the next one walks
// in. Monsters come in a row through the magic forest, the crystal cave and the monster castle; the last questions are
// the Crystal King in the boss arena, whose crystal shield (phase 2) and rage (phase 3) change the fight. A wrong
// answer: the monster strikes back and the pet loses a heart (the backend's), with a short hint, and the fight goes
// on. Three right in a row power the pet's element skill. The backend decides every answer and heart: this only shows
// them, with transforms (no re-render while anything moves).

type Props = {
  problem: Turn | null;
  required: number;
  resolved: number;
  hearts: number;
  heartsMax: number;
  /** A right answer (a new object each time). */
  flash: { turnId: string; kind: 'hit' | 'miss' } | null;
  /** Bumped after a wrong answer. */
  wrongKey: number;
  petId: string;
  petLevel: number;
  reduceMotion: boolean;
  running: boolean;
  /** Math Kingdom above a Toán lesson's own game: only the arena and the monster's bar (no hearts, no problem card). */
  bare?: boolean;
  /** After a wrong answer: the short hint the pet says (from the kind of mistake). */
  tip?: string | null;
  /** The answered question waits for "Câu tiếp theo": a foe is defeated at once, the next one walks in only then. */
  hold?: boolean;
};

export const HITS = 2;
export const SKILL_COMBO = 3;
const ORDER: MonsterId[] = ['slime', 'mushroom', 'golem', 'shadow', 'drake'];
const ZONES: Zone[] = ['forest', 'cave', 'castle'];
export const ZONE_NAME: Record<Zone, string> = { forest: 'Rừng phép thuật', cave: 'Hang pha lê', castle: 'Lâu đài quái vật', boss: 'Đấu trường trùm' };

export type Foe = { index: number; count: number; id: MonsterId; zone: Zone; hp: number; max: number; boss: boolean; phase: 1 | 2 | 3 };

/** Who is being fought after `resolved` right answers of `required`: monsters of HITS hit points each in a row through
 * the zones, then the boss holding the last questions (its phases: shield at two thirds, rage on its last point). */
export function battleFoe(required: number, resolved: number): Foe {
  const bossMax = required >= 6 ? Math.min(4, Math.max(2, Math.floor(required / 3))) : 0;
  const normal = required - bossMax;
  const monsters = Math.max(1, Math.ceil(normal / HITS));
  const count = monsters + (bossMax ? 1 : 0);
  if (bossMax && resolved >= normal) {
    const hp = Math.max(1, required - resolved);
    const phase = hp === 1 ? 3 : hp === bossMax ? 1 : 2;
    return { index: count - 1, count, id: 'boss', zone: 'boss', hp, max: bossMax, boss: true, phase };
  }
  const index = Math.min(monsters - 1, Math.floor(resolved / HITS));
  const max = Math.min(HITS, normal - index * HITS) || HITS;
  const hp = Math.max(1, max - (resolved - index * HITS));
  const zone = ZONES[Math.min(ZONES.length - 1, Math.floor((index * ZONES.length) / monsters))];
  return { index, count, id: ORDER[index % ORDER.length], zone, hp, max, boss: false, phase: 1 };
}

/** The element skill a run of right answers powers: 1 at three in a row, 2 at six, 3 from nine. */
export const skillLevel = (combo: number): 0 | 1 | 2 | 3 => (combo < SKILL_COMBO ? 0 : Math.min(3, Math.floor(combo / SKILL_COMBO)) as 1 | 2 | 3);

const SKILL_NAME: Record<string, string> = {
  water: 'Sóng thần', fire: 'Cầu lửa', grass: 'Lá thần', ice: 'Mưa băng', electric: 'Sấm sét', mist: 'Sương mù ảo',
};
const ARENA_H = 230;
const BARE_H = 200;
const PET = 84;
const FOE = 112;
const BOSS = 140;

const layersOf = (zone: Zone): Layer[] => [
  { key: `${zone}-sky`, speed: 0, render: (w, h) => <ArenaLayer zone={zone} layer="sky" width={w} height={h} /> },
  { key: `${zone}-far`, speed: 0.2, render: (w, h) => <ArenaLayer zone={zone} layer="far" width={w} height={h} /> },
  { key: `${zone}-mid`, speed: 0.5, render: (w, h) => <ArenaLayer zone={zone} layer="mid" width={w} height={h} /> },
  { key: `${zone}-near`, speed: 1, render: (w, h) => <ArenaLayer zone={zone} layer="near" width={w} height={h} /> },
];

/** The pet's short hint after a wrong answer, by the kind of mistake the backend recognised. */
export const MATH_TIP: Record<string, string> = {
  order_of_operations: 'Nhân, chia trước; cộng, trừ sau nhé!', wrong_operation: 'Xem lại dấu phép tính nhé!',
  carry_error: 'Nhớ sang hàng bên trái nhé!', borrow_error: 'Nhớ mượn ở hàng bên trái nhé!', sign_error: 'Xem lại dấu âm, dương nhé!',
  off_by_one: 'Gần đúng rồi, đếm lại một chút!', times_table_slip: 'Đọc lại bảng nhân nhé!',
};

export const MathBattle = memo(function MathBattle({ problem, required, resolved, hearts, heartsMax, flash, wrongKey, petId, petLevel,
  reduceMotion, running, bare = false, tip = null, hold = false }: Props) {
  const sound = useSfx();
  const element = petById(petId).element;
  const [width, setWidth] = useState(0);
  const W = width || 340;
  const now = battleFoe(required, resolved);
  // The foe on stage lags behind the score while it is being defeated; then the next one walks in.
  const [foe, setFoe] = useState<Foe>(now);
  const [mood, setMood] = useState<MonsterMood>('idle');
  const [combo, setCombo] = useState(0);
  const [burst, setBurst] = useState<{ key: number; skill: 0 | 1 | 2 | 3; text: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(`${ZONE_NAME[now.zone]} · ${MONSTER_ART[now.id].name}`);
  const windup = attackWindupMs(petId, petLevel, reduceMotion);
  const pet = useRig({ facing: 1, running, reduceMotion, reach: 30, ...drawnActions(petId, petLevel) });
  const monster = useRig({ facing: -1, running, reduceMotion, reach: 34 });
  const react = useReactions();
  const advanceFor = useAdvance(hold);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const bolt = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const charge = useRef(new Animated.Value(0)).current; // the magic circle gathering around the pet before the spell
  const claw = useRef(new Animated.Value(0)).current; // the monster's counter-attack flying to the pet
  const drain = useRef(new Animated.Value(0)).current; // the heart just lost, emptying
  const [lostAt, setLostAt] = useState<number | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleA = useRef(new Animated.Value(0)).current;
  const bannerA = useRef(new Animated.Value(0)).current;
  const travel = useRef(new Animated.Value(0)).current;
  const ms = (n: number) => (reduceMotion ? 1 : n);
  const timing = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
    Animated.timing(v, { toValue, duration: ms(duration), easing, useNativeDriver: false });
  const nowRef = useRef(now);
  nowRef.current = now;
  const tipRef = useRef(tip);
  tipRef.current = tip;
  // Each strike or counter-attack is one run: a run that was skipped (or timed out) ignores its late callbacks.
  const runSeq = useRef(0);
  /** A strike is playing: the foe it hit stays on stage until it is defeated (the score already counts the next one). */
  const striking = useRef(false);
  // Going away: whatever is still playing is over (its views detach and stop it: its callbacks must do nothing).
  useLayoutEffect(() => () => { runSeq.current++; }, []);

  const showBanner = (text: string) => {
    setBanner(text);
    bannerA.setValue(0);
    Animated.sequence([timing(bannerA, 1, 240), Animated.delay(ms(1000)), timing(bannerA, 0, 320)]).start(({ finished }) => { if (finished) setBanner(null); });
  };
  const hideBubble = () => { bubbleA.stopAnimation(); bubbleA.setValue(0); setBubble(null); };
  // The first foe walks in.
  useEffect(() => { monster.play('enter'); pet.play('enter'); showBanner(`${ZONE_NAME[now.zone]} · ${MONSTER_ART[now.id].name}`); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A right answer: a magic circle gathers, the pet casts (a skill: it lunges), the bolt flies, the monster flashes and
  // loses a hit point; at zero it is defeated, the pet cheers and the next one walks in. One reaction from the cast to
  // the next foe standing: until it is over the next problem waits, and "Bỏ qua" jumps to that end.
  const lastFlash = useRef(flash);
  useEffect(() => {
    if (!flash || flash === lastFlash.current) return;
    lastFlash.current = flash;
    if (flash.kind !== 'hit') return;
    const run = ++runSeq.current;
    const alive = () => runSeq.current === run;
    const streak = combo + 1;
    setCombo(streak);
    hideBubble();
    const skill = skillLevel(streak);
    const next = nowRef.current;
    const before = battleFoe(required, Math.max(0, resolved - 1)); // the foe as it was when it was hit
    const won = resolved >= required;
    const defeated = next.index !== foe.index || (foe.boss && won);
    const standing = (): MonsterMood => (next.boss && next.phase === 3 ? 'attack' : 'idle');
    // The next foe walks in (its own run): once "Câu tiếp theo" is pressed, when the answered question waits for it.
    const enterNext = (entered: () => void) => {
      const step = runSeq.current; // a skip (settle) or going away ends it
      const zoneChanged = next.zone !== foe.zone;
      setFoe(next);
      setMood('idle');
      if (zoneChanged || !reduceMotion) timing(travel, next.index, 900).start();
      showBanner(next.boss ? `${ZONE_NAME.boss}: ${MONSTER_ART.boss.name}!` : `${ZONE_NAME[next.zone]} · ${MONSTER_ART[next.id].name}`);
      monster.play('enter', () => { if (runSeq.current === step) entered(); });
    };
    // Skipped or timed out: the end state at once (a defeated foe stays down while the next one is held back).
    const settle = () => {
      runSeq.current++;
      for (const v of [bolt, pop, charge, travel]) v.stopAnimation();
      bolt.setValue(0); charge.setValue(0);
      setBurst(null);
      pet.stop();
      if (!defeated) { monster.stop(); setMood(standing()); return; }
      if (won) { monster.stop(true); setMood('defeated'); return; }
      if (holdRef.current) { monster.stop(true); setMood('defeated'); advance(enterNext); return; }
      monster.stop();
      setFoe(next); setMood('idle'); travel.setValue(next.index);
    };
    striking.current = true;
    const ended = react.begin('battle:strike', { maxMs: 7000, finish: () => { striking.current = false; settle(); } });
    const end = () => { striking.current = false; ended(); };
    const advance = advanceFor(end);
    pet.play(skill || windup ? 'attack' : 'cast'); // a drawn attack: every spell, and the bolt leaves as it lunges
    sound('cast');
    bolt.setValue(0); pop.setValue(0); charge.setValue(0);
    Animated.sequence([
      timing(charge, 1, windup || 150, Easing.out(Easing.quad)),
      Animated.parallel([timing(charge, 0, 200), timing(bolt, 1, skill ? 320 : 220, Easing.in(Easing.quad))]),
    ]).start(() => {
      if (!alive()) return;
      bolt.setValue(0);
      setBurst({ key: Date.now(), skill, text: before.boss && before.phase === 2 && !defeated ? 'Vỡ khiên! −1' : skill ? `${SKILL_NAME[element.id]}! −1` : '−1' });
      setMood('hurt');
      sound(defeated ? 'break' : 'hit');
      pop.setValue(0);
      timing(pop, 1, 650, Easing.out(Easing.cubic)).start(() => { if (alive()) setBurst(null); });
      if (!defeated) { monster.play('hit', () => { if (!alive()) return; setMood(standing()); pet.play('cheer'); end(); }); return; }
      setMood('defeated');
      monster.play('defeat', () => {
        if (!alive()) return;
        if (won) { sound('complete'); pet.play('celebrate', () => { if (alive()) end(); }); return; } // the stage is won: the result screen comes
        pet.play('celebrate');
        advance(enterNext);
      });
    });
  }, [flash]); // eslint-disable-line react-hooks/exhaustive-deps

  // A wrong answer: the monster lunges and its claws fly at the pet, the pet takes the hit and its lost heart empties,
  // then the pet says a short hint. The same problem stays.
  const firstWrong = useRef(wrongKey);
  const heartsSeen = useRef(hearts);
  useEffect(() => {
    if (wrongKey === firstWrong.current) return;
    firstWrong.current = wrongKey;
    const run = ++runSeq.current;
    const alive = () => runSeq.current === run;
    const lost = heartsMax > 0 && hearts < heartsSeen.current ? hearts : null;
    const standing = (): MonsterMood => (nowRef.current.boss && nowRef.current.phase === 3 ? 'attack' : 'idle');
    const settle = () => {
      runSeq.current++;
      claw.stopAnimation(); claw.setValue(0);
      drain.stopAnimation(); drain.setValue(0);
      setLostAt(null);
      monster.stop(); pet.stop();
      setMood(standing());
    };
    const end = react.begin('battle:counter', { maxMs: 3500, finish: settle });
    setCombo(0);
    setMood('attack');
    sound('wrong');
    monster.play('attack');
    claw.setValue(0);
    timing(claw, 1, 340, Easing.in(Easing.quad)).start(() => {
      if (!alive()) return;
      claw.setValue(0);
      sound('hit');
      setMood(standing());
      if (lost !== null) {
        setLostAt(lost);
        drain.setValue(1);
        timing(drain, 0, 700).start(() => { if (alive()) setLostAt(null); });
      }
      if (!bare) {
        setBubble(tipRef.current || 'Tính lại từng bước nhé!');
        bubbleA.setValue(0);
        Animated.sequence([timing(bubbleA, 1, 220), Animated.delay(ms(3600)), timing(bubbleA, 0, 300)])
          .start(({ finished }) => { if (finished) setBubble(null); });
      }
      pet.play('hit', () => { if (alive()) end(); });
    });
  }, [wrongKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { heartsSeen.current = hearts; }, [hearts]);

  // Keep the foe in step when the session moves on without a hit seen here (reopened, practice turns).
  useEffect(() => { if (!striking.current && mood !== 'defeated' && now.index !== foe.index) { setFoe(now); travel.setValue(now.index); } }, [now.index]); // eslint-disable-line react-hooks/exhaustive-deps

  // The foe on stage, with its hit points and phase as the session has them now (the defeated one keeps its own).
  const shownFoe = foe.index === now.index ? now : foe;
  const Art = MONSTER_ART[foe.id].Art;
  const size = foe.boss ? BOSS : FOE;
  const arenaH = bare ? BARE_H : ARENA_H;
  const ground = arenaH * 0.8;
  const petAt = { x: W * 0.08, y: ground - PET };
  const foeAt = { x: W * 0.92 - size, y: ground - size };
  const from = { x: petAt.x + PET * 0.85, y: petAt.y + PET * 0.4 };
  const to = { x: foeAt.x + size * 0.45, y: foeAt.y + size * 0.5 };
  const skill = skillLevel(combo);
  const boltSize = 26 + skill * 10;
  const shownHp = mood === 'defeated' || foe.index !== now.index ? 0 : now.hp;
  const expression = problem?.prompt.expression ?? '';
  // The problem just solved stays on its card (in green) while the strike plays; then the next one comes.
  const solved = !!problem && flash?.kind === 'hit' && flash.turnId === problem.turn_id;

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.hud}>
        {bare && !heartsMax ? <View style={styles.bar} /> : (
          <Bar label="Pet" value={hearts} max={heartsMax} color="#3FB56B" a11y={`Máu của pet: ${hearts} trên ${heartsMax}`} lostAt={lostAt} drain={drain} />
        )}
        <View style={styles.hudMid}>
          <Text style={styles.stage} accessibilityLabel={`Màn ${foe.index + 1} trên ${foe.count}`}>Màn {foe.index + 1}/{foe.count}</Text>
          {bare && combo < 2 ? null : <Text style={[styles.combo, skill ? { color: element.color } : null]}
            accessibilityLabel={skill ? `Combo ${combo}: kỹ năng ${SKILL_NAME[element.id]}` : `Combo ${combo}`}>
            {skill ? `${element.icon} ${SKILL_NAME[element.id]} x${combo}` : `Combo x${combo}`}
          </Text>}
        </View>
        <Bar label={MONSTER_ART[foe.id].name} value={shownHp} max={foe.max} color={foe.boss ? '#B0324E' : '#E2723B'} right
          a11y={`Máu của ${MONSTER_ART[foe.id].name}: ${shownHp} trên ${foe.max}`} />
      </View>
      <View style={[styles.arena, { height: arenaH }]} accessibilityLabel={`${ZONE_NAME[foe.zone]}: pet đấu với ${MONSTER_ART[foe.id].name}`}>
        {width ? <Parallax width={W} height={arenaH} layers={layersOf(foe.zone)} travel={travel} step={180} drift={1} running={running} reduceMotion={reduceMotion} /> : null}
        {!reduceMotion ? (
          <Animated.View pointerEvents="none" style={[styles.actor, { left: petAt.x - 14, top: petAt.y - 14, opacity: charge,
            transform: [{ scale: charge.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              { rotate: charge.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '120deg'] }) }] }]}>
            <MagicCircle size={PET + 28} color={skill ? element.color : undefined} />
          </Animated.View>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.actor, { left: petAt.x, top: petAt.y }, pet.style]}>
          {skill && !reduceMotion ? <View style={[styles.aura, { backgroundColor: element.color }]} /> : null}
          <PetArt pet={petId} size={PET} stage={petLevel} still={reduceMotion || !running} strike={pet.strike} leap={pet.leap} cheer={pet.cheer} />
          <Animated.View style={[StyleSheet.absoluteFill, styles.hurt, { opacity: pet.flash }]} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.actor, { left: foeAt.x, top: foeAt.y }, monster.style]}
          accessible accessibilityLabel={`${foe.boss ? 'Trùm' : 'Quái vật'} ${MONSTER_ART[foe.id].name}`}>
          {shownFoe.boss && shownFoe.phase === 3 && !reduceMotion ? <View style={[styles.rage, { width: size, height: size, borderRadius: size / 2 }]} /> : null}
          <Art size={size} mood={mood} />
          {shownFoe.boss && shownFoe.phase === 2 && mood !== 'defeated' ? <View style={StyleSheet.absoluteFill}><CrystalShield size={size} /></View> : null}
          <Animated.View style={[StyleSheet.absoluteFill, styles.flash, { opacity: monster.flash }]} />
        </Animated.View>
        {!reduceMotion ? (
          <Animated.View pointerEvents="none" style={[styles.bolt, { opacity: bolt.interpolate({ inputRange: [0, 0.02, 0.98, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateX: bolt.interpolate({ inputRange: [0, 1], outputRange: [from.x - boltSize / 2, to.x - boltSize / 2] }) },
              { translateY: bolt.interpolate({ inputRange: [0, 0.5, 1], outputRange: [from.y - boltSize / 2, Math.min(from.y, to.y) - 34, to.y - boltSize / 2] }) }] }]}>
            <MagicBolt size={boltSize} color={skill ? element.color : undefined} />
          </Animated.View>
        ) : null}
        {!reduceMotion ? (
          <Animated.View pointerEvents="none" style={[styles.bolt, { opacity: claw.interpolate({ inputRange: [0, 0.05, 0.95, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateX: claw.interpolate({ inputRange: [0, 1], outputRange: [foeAt.x - 10, petAt.x + PET * 0.25] }) },
              { translateY: claw.interpolate({ inputRange: [0, 1], outputRange: [foeAt.y + size * 0.3, petAt.y + PET * 0.1] }) },
              { scale: claw.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] }) }] }]}>
            <Slash size={54} color={foe.boss ? '#E0457B' : '#FF6B6B'} />
          </Animated.View>
        ) : null}
        {bubble ? (
          <Animated.View pointerEvents="none" style={[styles.tip, { left: petAt.x + 4, top: Math.max(6, petAt.y - 54), opacity: bubbleA,
            transform: [{ scale: bubbleA.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
            <Text style={styles.tipText} accessibilityLiveRegion="polite" accessibilityLabel={`Gợi ý của pet: ${bubble}`}>{bubble}</Text>
            <View style={styles.tipTail} />
          </Animated.View>
        ) : null}
        {burst ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Animated.View style={[styles.impact, { left: to.x - 40, top: to.y - 40, opacity: pop.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
              transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.4 + burst.skill * 0.3] }) }] }]}>
              <Impact size={80} color={burst.skill ? element.color : undefined} />
            </Animated.View>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i / 6) * Math.PI * 2;
              return (
                <Animated.View key={i} style={[styles.spark, { left: to.x - 9, top: to.y - 9, opacity: pop.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 0] }),
                  transform: [{ translateX: pop.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * 52] }) },
                    { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * 52] }) }] }]}>
                  <Sparkle size={18} color={burst.skill ? element.color : undefined} />
                </Animated.View>
              );
            })}
            <Animated.Text style={[styles.damage, { left: to.x - 70, top: to.y - 64, opacity: pop.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }) }] }]}>{burst.text}</Animated.Text>
          </View>
        ) : null}
        {banner ? (
          <Animated.View pointerEvents="none" style={[styles.banner, { opacity: bannerA }]}>
            <Text style={[styles.bannerText, foe.boss && styles.bannerBoss]} accessibilityLiveRegion="polite">{banner}</Text>
          </Animated.View>
        ) : null}
      </View>
      {bare ? null : <View style={[styles.problem, solved && styles.problemSolved]}
        accessibilityLabel={problem ? (solved ? `Đã giải: ${expression}` : `Bài toán: ${expression} bằng mấy?`) : 'Chờ bài toán tiếp theo'}>
        <Text style={[styles.problemText, solved && styles.problemTextSolved]}>{problem ? `${expression} = ${solved ? '✓' : '?'}` : '…'}</Text>
        {shownFoe.boss && shownFoe.phase === 2 ? <Text style={styles.phase}>Trùm có khiên pha lê: giải đúng để phá khiên!</Text> : null}
        {shownFoe.boss && shownFoe.phase === 3 ? <Text style={styles.phase}>Trùm nổi giận: một câu đúng nữa là thắng!</Text> : null}
      </View>}
    </View>
  );
});

function Bar({ label, value, max, color, right, a11y, lostAt = null, drain }: {
  label: string; value: number; max: number; color: string; right?: boolean; a11y: string;
  /** The cell just lost: it empties (red, shrinking) with `drain` going 1 → 0. */
  lostAt?: number | null; drain?: Animated.Value;
}) {
  return (
    <View style={[styles.bar, right && styles.barRight]} accessibilityLabel={a11y}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        {Array.from({ length: Math.max(1, max) }).map((_, i) => (
          <View key={i} style={[styles.barCell, { backgroundColor: i < value ? color : '#DDE3EA' }]}>
            {i === lostAt && drain ? (
              <Animated.View style={[StyleSheet.absoluteFill, styles.barLost, { opacity: drain, transform: [{ scaleX: drain }] }]} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 8 },
  hud: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hudMid: { alignItems: 'center' },
  stage: { fontSize: 13, fontWeight: '900', color: t.ink },
  combo: { fontSize: 12, fontWeight: '900', color: t.muted },
  bar: { flex: 1, gap: 3 },
  barRight: { alignItems: 'flex-end' },
  barLabel: { fontSize: 12, fontWeight: '900', color: t.ink },
  barTrack: { flexDirection: 'row', gap: 3, alignSelf: 'stretch' },
  barCell: { flex: 1, height: 9, borderRadius: 5, overflow: 'hidden' },
  barLost: { backgroundColor: '#F0473A', borderRadius: 5 },
  tip: { position: 'absolute', maxWidth: 210, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#FFFFFF',
    borderWidth: 2, borderColor: '#F5B841' },
  tipText: { fontSize: 13, fontWeight: '900', color: t.ink },
  tipTail: { position: 'absolute', left: 18, bottom: -7, width: 12, height: 12, backgroundColor: '#FFFFFF', borderRightWidth: 2, borderBottomWidth: 2,
    borderColor: '#F5B841', transform: [{ rotate: '45deg' }] },
  arena: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#2A3B5C' },
  actor: { position: 'absolute' },
  aura: { position: 'absolute', left: -10, top: -10, width: PET + 20, height: PET + 20, borderRadius: (PET + 20) / 2, opacity: 0.3 },
  hurt: { backgroundColor: 'rgba(240,71,58,0.45)', borderRadius: PET / 2 },
  flash: { backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 999, transform: [{ scale: 0.8 }] },
  rage: { position: 'absolute', backgroundColor: 'rgba(215,51,79,0.28)' },
  bolt: { position: 'absolute', left: 0, top: 0 },
  impact: { position: 'absolute', width: 80, height: 80 },
  spark: { position: 'absolute' },
  damage: { position: 'absolute', width: 140, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#FFE9B8',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  banner: { position: 'absolute', left: 0, right: 0, top: 14, alignItems: 'center' },
  bannerText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', backgroundColor: 'rgba(20,30,52,0.75)', paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 14, overflow: 'hidden' },
  bannerBoss: { backgroundColor: 'rgba(176,50,78,0.92)' },
  problem: { alignItems: 'center', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#E7D7F5' },
  problemText: { fontSize: 30, fontWeight: '900', color: t.ink, letterSpacing: 1 },
  problemSolved: { borderColor: '#7FD49A', backgroundColor: '#F0FBF3' },
  problemTextSolved: { color: '#22894A' },
  phase: { marginTop: 2, fontSize: 13, fontWeight: '800', color: '#B0324E', textAlign: 'center' },
});
