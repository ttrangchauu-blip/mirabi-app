import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutRectangle, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../../components/PetArt';
import { usePetCheer } from '../../../games/engine/rig';
import { Text } from '../../../components/Typography';
import { Block, BLOCK_LABEL, blockCount, fault, Fault, isLoop, LOOP_MAX, LOOP_MIN, loopTimes, openLoop, Step, trace, walk, Walk } from '../../../learning/codePath';
import type { Facing, Turn } from '../../../learning/types';
import { appTheme as t } from '../../../theme';
import { Boulder, Gem, GoalFlag } from '../../../games/art/effects';

// The curriculum games' play areas (Ghép chữ is WordForest.tsx). Each also draws a guide page: `demo` sets what it shows (the real layout, with the
// move the page explains) and nothing can be tapped. The backend checks every answer; the game screen shows the result
// and the explanation under the game (AnswerFeedback).

type Common = { turn: Turn; disabled: boolean; feedback?: { text: string; tone: 'good' | 'bad' } | null };

function Feedback({ note }: { note?: Common['feedback'] }) {
  if (!note || !note.text) return null;
  return (
    <View style={[styles.feedback, note.tone === 'good' ? styles.feedbackGood : styles.feedbackBad]} accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <Ionicons name={note.tone === 'good' ? 'checkmark-circle' : 'information-circle'} size={18} color={note.tone === 'good' ? t.success : t.danger} />
      <Text style={[styles.feedbackText, { color: note.tone === 'good' ? t.success : t.danger }]}>{note.text}</Text>
    </View>
  );
}

function Actions({ onReset, resetLabel = 'Xếp lại', resetDisabled, onCheck, checkLabel = 'Kiểm tra', checkDisabled }: {
  onReset: () => void; resetLabel?: string; resetDisabled: boolean; onCheck: () => void; checkLabel?: string; checkDisabled: boolean;
}) {
  return (
    <View style={styles.actions}>
      <Pressable onPress={onReset} disabled={resetDisabled} accessibilityRole="button" accessibilityLabel={resetLabel}
        style={[styles.secondary, resetDisabled && styles.dimmed]}><Text style={styles.secondaryText}>{resetLabel}</Text></Pressable>
      <Pressable onPress={onCheck} disabled={checkDisabled} accessibilityRole="button" accessibilityLabel={checkLabel}
        accessibilityState={{ disabled: checkDisabled }} style={[styles.primary, checkDisabled && styles.dimmed]}>
        <Text style={styles.primaryText}>{checkLabel}</Text>
      </Pressable>
    </View>
  );
}

// --- Thám tử chính tả ------------------------------------------------------------------------------------------------

/** Tap the misspelled word; then (and only then) the spellings come, choose the right one. */
export function SpellDetective({ turn, disabled, feedback, onFind, onFix, demo }: Common & {
  onFind: (id: string) => void; onFix: (word: string, option: string) => void;
  demo?: { found?: string; tapped?: string; chosen?: string };
}) {
  const p = turn.prompt;
  const found = demo?.found ?? (p.step === 'fix' ? p.found : undefined);
  const locked = disabled || !!demo;
  const word = (id?: string) => (p.tokens ?? []).find((x) => x.id === id)?.text.replace(/[.,!?;:]+$/, '') ?? '';
  return (
    <View style={styles.scene}>
      <Text style={styles.instruction}>{found ? `Chọn cách viết đúng thay cho “${word(found)}”` : 'Chạm vào tiếng viết sai trong câu'}</Text>
      <View style={styles.sentence}>
        {(p.tokens ?? []).map((tk) => {
          const isFound = tk.id === found;
          return (
            <Pressable key={tk.id} onPress={() => onFind(tk.id)} disabled={locked || !!found} accessibilityRole="button"
              accessibilityLabel={isFound ? `${tk.text}, tiếng viết sai` : tk.text}
              style={[styles.word, isFound && styles.wordFound, demo?.tapped === tk.id && !isFound && styles.wordTapped]}>
              <Text style={[styles.wordText, isFound && styles.wordFoundText]}>{tk.text}</Text>
            </Pressable>
          );
        })}
      </View>
      {found && (p.options || demo) ? (
        <View style={styles.options}>
          {(p.options ?? []).map((o) => (
            <Pressable key={o.id} onPress={() => onFix(found, o.id)} disabled={locked} accessibilityRole="button"
              accessibilityLabel={`Cách viết ${o.text}`} style={({ pressed }) => [styles.option, demo?.chosen === o.id && styles.optionRight, pressed && styles.pressed]}>
              <Text style={[styles.optionText, demo?.chosen === o.id && styles.optionRightText]}>{o.text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Feedback note={feedback} />
    </View>
  );
}

// --- Phân loại cùng pet ----------------------------------------------------------------------------------------------

type Zone = { id: string } & LayoutRectangle;

/** The group under a point (both in the play area's coordinates), if any. */
export function zoneAt(point: { x: number; y: number }, zones: Zone[]): string | null {
  const hit = zones.find((z) => point.x >= z.x && point.x <= z.x + z.width && point.y >= z.y && point.y <= z.y + z.height);
  return hit?.id ?? null;
}

/** Drag the card onto its group (or tap a group). */
export function SortCards({ turn, disabled, feedback, onPlace, demo }: Common & {
  onPlace: (group: string) => void; demo?: { over?: string; placed?: string };
}) {
  const p = turn.prompt;
  const groups = p.groups ?? [];
  const locked = disabled || !!demo;
  const drag = useRef(new Animated.ValueXY()).current;
  const card = useRef<LayoutRectangle | null>(null);
  const zonesTop = useRef(0);
  const zones = useRef<Record<string, LayoutRectangle>>({});
  const [over, setOver] = useState<string | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;
  useEffect(() => { drag.setValue({ x: 0, y: 0 }); setOver(null); }, [turn.turn_id, drag]);

  const target = (dx: number, dy: number) => {
    if (!card.current) return null;
    const point = { x: card.current.x + card.current.width / 2 + dx, y: card.current.y + card.current.height / 2 + dy };
    return zoneAt(point, Object.entries(zones.current).map(([id, z]) => ({ id, ...z, y: z.y + zonesTop.current })));
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !lockedRef.current,
    onMoveShouldSetPanResponder: () => !lockedRef.current,
    onPanResponderMove: (_, g) => { drag.setValue({ x: g.dx, y: g.dy }); setOver(target(g.dx, g.dy)); },
    onPanResponderRelease: (_, g) => {
      const group = target(g.dx, g.dy);
      setOver(null);
      // The card goes back to its place while the answer is checked.
      Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 7 }).start();
      if (group) placeRef.current(group);
    },
    onPanResponderTerminate: () => { setOver(null); drag.setValue({ x: 0, y: 0 }); },
  }), [drag]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownOver = demo?.over ?? over;

  return (
    <View style={styles.scene}>
      {p.title ? <Text style={styles.instruction}>{p.title}</Text> : null}
      <View style={styles.cardArea}>
        <Animated.View {...responder.panHandlers} onLayout={(e) => { card.current = e.nativeEvent.layout; }}
          style={[styles.sortCard, { transform: drag.getTranslateTransform() }, demo?.over && styles.sortCardDragged]}
          accessible accessibilityLabel={`Thẻ: ${p.card?.text ?? ''}. Kéo vào nhóm phù hợp, hoặc chạm vào tên nhóm.`}>
          {p.card?.picture ? <Text style={styles.cardEmoji}>{p.card.picture}</Text> : null}
          <Text style={styles.cardText}>{p.card?.text}</Text>
        </Animated.View>
      </View>
      <View style={styles.zones} onLayout={(e) => { zonesTop.current = e.nativeEvent.layout.y; }}>
        {groups.map((g) => (
          <Pressable key={g.id} onLayout={(e) => { zones.current[g.id] = e.nativeEvent.layout; }} onPress={() => onPlace(g.id)}
            disabled={locked} accessibilityRole="button" accessibilityLabel={`Nhóm ${g.label}`}
            style={[styles.zone, groups.length > 3 && styles.zoneSmall, shownOver === g.id && styles.zoneOver,
              demo?.placed === g.id && styles.zoneRight]}>
            <Text style={styles.zoneIcon}>{g.icon}</Text>
            <Text style={styles.zoneLabel}>{g.label}</Text>
          </Pressable>
        ))}
      </View>
      <Feedback note={demo?.placed ? { text: 'Chính xác!', tone: 'good' } : feedback} />
    </View>
  );
}

// --- Lập trình đường đi: Robot Adventure -----------------------------------------------------------------------------

const RUN_STEP_MS = 420;
const ANGLE: Record<Facing, number> = { N: 0, E: 90, S: 180, W: 270 };
/** The angle to turn to for `dir` from `from`, the short way (never a spin of 270°). */
const turnTo = (from: number, dir: Facing) => from + ((((ANGLE[dir] - from) % 360) + 540) % 360) - 180;
const WHY: Record<Fault['reason'], string> = { wall: 'robot đụng tảng đá', edge: 'robot đi ra ngoài bản đồ', short: '', goal: '' };
const blockName = (b: Block | undefined) => (!b ? '' : isLoop(b) ? `Lặp ${loopTimes(b)} lần` : b === 'end' ? 'Đóng lặp' : BLOCK_LABEL[b as 'forward']);

/** The pet drives a little robot through the maze. Put blocks in the program bar, "Chạy": the robot rolls the program
 * step by step (the block it is doing lights up), then the backend checks it. Off course, it stops at the step that
 * went wrong: that block turns red, the robot bumps into the rock (or the edge) and the step is named.
 * "Dừng" stops the run, "Đặt lại" puts the robot back. */
export function CodePath({ turn, disabled, feedback, onRun, petId, petLevel, reduceMotion, demo }: Common & {
  onRun: (program: Block[]) => void; petId: string; petLevel: number; reduceMotion: boolean;
  demo?: { program: Block[]; step?: number };
}) {
  const p = turn.prompt;
  const [own, setOwn] = useState<Block[]>([]);
  const program = demo?.program ?? own;
  const [path, setPath] = useState<Step[] | null>(null);
  const [at, setAt] = useState(0);
  const [running, setRunning] = useState(false);
  const [wrong, setWrong] = useState<Fault | null>(null);
  const [won, setWon] = useState(false);
  const cheer = usePetCheer(petId, petLevel, won, reduceMotion);
  const [width, setWidth] = useState(0);
  const start = (p.start ?? { x: 0, y: 0, dir: 'E' }) as Step;
  // The robot: where it is (in cells), which way it looks, a bump against a rock, a hop at the goal.
  const rx = useRef(new Animated.Value(start.x)).current;
  const ry = useRef(new Animated.Value(start.y)).current;
  const angle = useRef(ANGLE[start.dir]);
  const rot = useRef(new Animated.Value(ANGLE[start.dir])).current;
  const bump = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const place = (s: Step) => {
    rx.setValue(s.x); ry.setValue(s.y);
    angle.current = ANGLE[s.dir]; rot.setValue(angle.current);
    bump.setValue(0); hop.setValue(0);
  };
  const stop = () => { anim.current?.stop(); anim.current = null; setRunning(false); };
  useEffect(() => () => anim.current?.stop(), []);
  useEffect(() => { stop(); setPath(null); setAt(0); setOwn([]); setWrong(null); setWon(false); place(start); }, [turn.turn_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = disabled || !!demo;
  const max = p.max_blocks ?? 0;
  const used = blockCount(program);
  const loopOpen = openLoop(program);
  const loops = (p.blocks ?? []).includes('repeat');
  const full = used >= max;
  const complete = program.length > 0 && !loopOpen;

  const demoWalk = demo ? walk(p, demo.program) : null;
  const shownPath = demo ? demoWalk?.path ?? null : path;
  const shownAt = demo ? Math.min(demo.step ?? 0, (demoWalk?.path.length ?? 1) - 1) : at;
  const robot = shownPath?.[shownAt] ?? start;
  useEffect(() => { if (demo) place(robot); }, [demo?.step, demo?.program.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = useMemo(() => trace(program) ?? [], [program]);
  // The block being done: the move that brought the robot here.
  const doing = (running || demo) && shownAt > 0 ? steps[shownAt - 1] ?? null : null;

  const finish = (result: Walk) => {
    const f = fault(program, result);
    setWrong(f);
    setWon(result.ok);
    const done = () => { anim.current = null; setRunning(false); onRun(program); }; // the backend says if it was right
    if (reduceMotion || (!f?.blocked && !result.ok)) { done(); return; }
    const move = f?.blocked ? bump : hop;
    anim.current = Animated.sequence([
      Animated.timing(move, { toValue: 1, duration: f?.blocked ? 140 : 180, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.timing(move, { toValue: 0, duration: f?.blocked ? 220 : 260, easing: Easing.bounce, useNativeDriver: false }),
    ]);
    anim.current.start(({ finished }) => { if (finished) done(); });
  };
  const run = () => {
    const result = walk(p, program);
    if (!result) return;
    stop();
    setWrong(null); setWon(false);
    place(start);
    setPath(result.path);
    if (reduceMotion) { setAt(result.path.length - 1); place(result.path[result.path.length - 1]); finish(result); return; }
    setAt(0);
    setRunning(true);
    const go = (i: number) => {
      if (i >= result.path.length) { finish(result); return; }
      const s = result.path[i];
      angle.current = turnTo(angle.current, s.dir);
      anim.current = Animated.parallel([
        Animated.timing(rx, { toValue: s.x, duration: RUN_STEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(ry, { toValue: s.y, duration: RUN_STEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(rot, { toValue: angle.current, duration: RUN_STEP_MS * 0.7, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]);
      setAt(i);
      anim.current.start(({ finished }) => { if (finished) go(i + 1); });
    };
    go(1);
  };
  const edited = () => { setPath(null); setAt(0); setWrong(null); setWon(false); place(start); };
  const add = (b: Block) => { edited(); setOwn((list) => [...list, b]); };
  const remove = (i: number) => {
    edited();
    setOwn((list) => {
      const b = list[i];
      if (!isLoop(b)) return list.filter((_, j) => j !== i); // a move, or a closing bracket (the loop opens again)
      const end = list.indexOf('end', i);
      return list.filter((_, j) => j < i || (end >= 0 ? j > end : false)); // a loop goes with what it holds
    });
  };
  const cycle = (i: number) => setOwn((list) => list.map((b, j) => (j === i && isLoop(b)
    ? `repeat:${loopTimes(b) >= LOOP_MAX ? LOOP_MIN : loopTimes(b) + 1}` as Block : b)));

  const cols = p.cols ?? 1;
  const rows = p.rows ?? 1;
  const cell = Math.max(22, Math.min(46, Math.floor((width || 300) / cols)));
  const walls = new Set((p.walls ?? []).map(([x, y]) => `${x},${y}`));
  const trail = new Set((shownPath ?? []).slice(1, shownAt + 1).map((s) => `${s.x},${s.y}`));
  const blocked = wrong?.blocked ? `${wrong.blocked.x},${wrong.blocked.y}` : null;
  const toward = wrong?.blocked ? [wrong.blocked.x - robot.x, wrong.blocked.y - robot.y] : [0, 0];
  const nudge = bump.interpolate({ inputRange: [0, 1], outputRange: [0, cell * 0.32] });
  const wrongText = wrong ? (wrong.reason === 'short'
    ? `Robot đã chạy hết ${wrong.move} bước nhưng chưa tới đích.`
    : `Bước ${wrong.move}${wrong.block !== null ? ` (${blockName(program[wrong.block])})` : ''}: ${WHY[wrong.reason]}.`) : null;
  let inLoop = false;
  return (
    <View style={styles.scene}>
      <View style={styles.boardWrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.board, { width: cell * cols, height: cell * rows }]} accessible accessibilityRole="image"
          accessibilityLabel={`Mê cung ${cols} × ${rows} ô. Robot ở cột ${robot.x + 1}, hàng ${robot.y + 1}; đích ở cột ${(p.goal?.x ?? 0) + 1}, hàng ${(p.goal?.y ?? 0) + 1}.`}>
          {Array.from({ length: rows }).map((_, y) => Array.from({ length: cols }).map((__, x) => {
            const key = `${x},${y}`;
            const goal = p.goal?.x === x && p.goal?.y === y;
            return (
              <View key={key} style={[styles.cell, { left: x * cell, top: y * cell, width: cell, height: cell }, (x + y) % 2 === 1 && styles.cellAlt,
                walls.has(key) && styles.wall, trail.has(key) && styles.trail, blocked === key && styles.cellBlocked, goal && won && styles.cellWon]}>
                {walls.has(key) ? <View accessibilityLabel={blocked === key ? 'Tảng đá chặn đường' : undefined}><Boulder size={cell * 0.86} /></View> : null}
                {goal ? ( // the goal: a flag, and the gem to collect (gone once the robot has it; the flag goes up)
                  <View style={styles.goal} accessibilityLabel={won ? 'Đích: robot đã tới, nhặt được viên ngọc' : 'Đích'}>
                    <GoalFlag size={cell * 0.8} reached={won} />
                    {!won ? <View style={styles.goalGem}><Gem size={cell * 0.42} /></View> : null}
                  </View>
                ) : null}
              </View>
            );
          }))}
          <Animated.View pointerEvents="none" style={[styles.robot, { width: cell, height: cell, transform: [
            { translateX: Animated.add(Animated.multiply(rx, cell), Animated.multiply(nudge, toward[0])) },
            { translateY: Animated.add(Animated.multiply(ry, cell), Animated.add(Animated.multiply(nudge, toward[1]),
              hop.interpolate({ inputRange: [0, 1], outputRange: [0, -cell * 0.45] }))) },
          ] }]}>
            <View style={[styles.dome, { width: cell * 0.78, height: cell * 0.6, borderTopLeftRadius: cell * 0.4, borderTopRightRadius: cell * 0.4 }]}>
              <PetArt pet={petId} size={cell * 0.55} stage={petLevel} still cheer={cheer} />
            </View>
            <View style={[styles.chassis, { width: cell * 0.86, height: cell * 0.26 }, wrong?.blocked && styles.chassisHurt]}>
              <View style={styles.wheel} /><View style={styles.wheel} />
            </View>
            <Animated.View style={[styles.facing, { transform: [{ rotate: rot.interpolate({ inputRange: [-3600, 3600], outputRange: ['-3600deg', '3600deg'] }) }] }]}>
              <Ionicons name="arrow-up" size={Math.max(11, cell * 0.3)} color="#FFFFFF" />
            </Animated.View>
          </Animated.View>
        </View>
      </View>
      {wrongText ? (
        <View style={styles.fault} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="hardware-chip-outline" size={18} color="#9A3B12" />
          <Text style={styles.faultText}>{wrongText}</Text>
        </View>
      ) : null}
      <View style={styles.programHead}>
        <Text style={styles.programTitle}>Chương trình</Text>
        <Text style={[styles.counter, full && styles.counterFull]} accessibilityLabel={`Đã dùng ${used} trên ${max} lệnh`}>Lệnh: {used}/{max}</Text>
      </View>
      <View style={styles.program} accessibilityLabel={program.length ? undefined : 'Thanh chương trình trống'}>
        {program.length === 0 ? <Text style={styles.programEmpty}>Chạm các lệnh bên dưới để xếp chương trình</Text> : program.map((b, i) => {
          const loop = isLoop(b);
          if (loop) inLoop = true;
          const inside = inLoop && !loop && b !== 'end';
          if (b === 'end') inLoop = false;
          const lit = doing === i || wrong?.block === i;
          return (
            <View key={i} style={styles.blockWrap}>
              <Pressable onPress={() => remove(i)} disabled={locked || running} accessibilityRole="button"
                accessibilityLabel={`${loop ? `Gỡ khối Lặp ${loopTimes(b)} lần` : b === 'end' ? 'Gỡ dấu đóng lặp' : `Gỡ lệnh ${BLOCK_LABEL[b as 'forward']}`}${wrong?.block === i ? ', bước sai' : ''}`}
                style={[styles.block, loop && styles.blockLoop, b === 'end' && styles.blockEnd, inside && styles.blockInside,
                  doing === i && styles.blockDoing, wrong?.block === i && styles.blockWrong]}>
                <Text style={[styles.blockText, (loop || b === 'end' || lit) && styles.blockLoopText]}>
                  {loop ? `🔁 Lặp ${loopTimes(b)} lần [` : b === 'end' ? ']' : BLOCK_LABEL[b as 'forward']}
                </Text>
              </Pressable>
              {loop ? (
                <Pressable onPress={() => cycle(i)} disabled={locked || running} accessibilityRole="button"
                  accessibilityLabel={`Đổi số lần lặp, đang là ${loopTimes(b)}`} hitSlop={6} style={styles.times}>
                  <Text style={styles.timesText}>×{loopTimes(b)}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={styles.palette}>
        {(['forward', 'left', 'right'] as const).map((b) => (
          <Pressable key={b} onPress={() => add(b)} disabled={locked || running || full} accessibilityRole="button"
            accessibilityLabel={`Thêm lệnh ${BLOCK_LABEL[b]}`} style={[styles.paletteBlock, (locked || running || full) && styles.dimmed]}>
            <Ionicons name={b === 'forward' ? 'arrow-up' : b === 'left' ? 'arrow-undo' : 'arrow-redo'} size={16} color={t.accent} />
            <Text style={styles.paletteText}>{BLOCK_LABEL[b]}</Text>
          </Pressable>
        ))}
        {loops ? (loopOpen ? (
          <Pressable onPress={() => add('end')} disabled={locked || running || isLoop(program[program.length - 1])}
            accessibilityRole="button" accessibilityLabel="Đóng khối Lặp lại"
            style={[styles.paletteBlock, styles.paletteLoop, (locked || running || isLoop(program[program.length - 1])) && styles.dimmed]}>
            <Text style={styles.paletteLoopText}>] Đóng lặp</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => add(`repeat:${LOOP_MIN}`)} disabled={locked || running || full} accessibilityRole="button"
            accessibilityLabel="Thêm khối Lặp lại" style={[styles.paletteBlock, styles.paletteLoop, (locked || running || full) && styles.dimmed]}>
            <Text style={styles.paletteLoopText}>🔁 {BLOCK_LABEL.repeat}</Text>
          </Pressable>
        )) : null}
      </View>
      <Feedback note={demo ? (demoWalk?.ok && shownAt === (demoWalk.path.length - 1) ? { text: 'Robot đã tới đích!', tone: 'good' } : null) : feedback} />
      <View style={styles.actions}>
        {running ? (
          <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Dừng" style={styles.secondary}>
            <Text style={styles.secondaryText}>Dừng</Text>
          </Pressable>
        ) : (
          <Pressable onPress={edited} disabled={locked || !path} accessibilityRole="button" accessibilityLabel="Đặt lại"
            style={[styles.secondary, (locked || !path) && styles.dimmed]}><Text style={styles.secondaryText}>Đặt lại</Text></Pressable>
        )}
        <Pressable onPress={() => { stop(); edited(); setOwn([]); }} disabled={locked || running || !program.length}
          accessibilityRole="button" accessibilityLabel="Xóa hết lệnh" style={[styles.secondary, (locked || running || !program.length) && styles.dimmed]}>
          <Text style={styles.secondaryText}>Xóa hết</Text>
        </Pressable>
        <Pressable onPress={run} disabled={locked || running || !complete} accessibilityRole="button" accessibilityLabel="Chạy"
          accessibilityState={{ disabled: locked || running || !complete }} style={[styles.primary, (locked || running || !complete) && styles.dimmed]}>
          <Text style={styles.primaryText}>▶ Chạy</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { gap: 12, paddingVertical: 4 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  dimmed: { opacity: 0.45 },
  instruction: { fontSize: 16, fontWeight: '800', color: t.ink, textAlign: 'center' },
  feedback: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: 10 },
  feedbackGood: { backgroundColor: t.successBg },
  feedbackBad: { backgroundColor: t.dangerBg },
  feedbackText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  secondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.accent, fontWeight: '900', fontSize: 15 },
  // Thám tử chính tả
  sentence: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14 },
  word: { minHeight: 44, paddingHorizontal: 10, borderRadius: 12, backgroundColor: t.tint, justifyContent: 'center' },
  wordText: { fontSize: 20, fontWeight: '800', color: t.ink },
  wordFound: { backgroundColor: t.dangerBg, borderWidth: 2, borderColor: t.danger },
  wordFoundText: { color: t.danger, textDecorationLine: 'underline' },
  wordTapped: { borderWidth: 2, borderColor: t.accent },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  option: { minWidth: 96, minHeight: 50, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: t.border,
    alignItems: 'center', justifyContent: 'center' },
  optionText: { fontSize: 20, fontWeight: '900', color: t.ink },
  optionRight: { borderColor: t.success, backgroundColor: t.successBg },
  optionRightText: { color: t.success },
  // Phân loại cùng pet
  cardArea: { alignItems: 'center', minHeight: 150, justifyContent: 'center', zIndex: 2 },
  sortCard: { width: 150, minHeight: 130, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 10,
    borderWidth: 2, borderColor: '#F2C46D', shadowColor: t.shadow, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  sortCardDragged: { transform: [{ translateY: 40 }, { rotate: '-4deg' }] },
  cardEmoji: { fontSize: 54, lineHeight: 64 },
  cardText: { fontSize: 16, fontWeight: '900', color: t.ink, textAlign: 'center' },
  zones: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  zone: { width: '46%', minHeight: 92, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: t.accent, backgroundColor: t.tint,
    alignItems: 'center', justifyContent: 'center', padding: 8, gap: 4 },
  zoneSmall: { width: '30%', minHeight: 80 },
  zoneOver: { borderStyle: 'solid', backgroundColor: '#CFE8F7' },
  zoneRight: { borderStyle: 'solid', borderColor: t.success, backgroundColor: t.successBg },
  zoneIcon: { fontSize: 26 },
  zoneLabel: { fontSize: 14, fontWeight: '900', color: t.ink, textAlign: 'center' },
  // Lập trình đường đi
  boardWrap: { alignItems: 'center' },
  board: { backgroundColor: '#E6F5E8', borderRadius: 14, overflow: 'hidden', borderWidth: 3, borderColor: '#5E8C5A' },
  cell: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderColor: '#BFE3C6', alignItems: 'center', justifyContent: 'center' },
  cellAlt: { backgroundColor: '#DCF0DF' },
  wall: { backgroundColor: '#C9D3DA' },
  trail: { backgroundColor: '#FFF1C9' },
  cellBlocked: { backgroundColor: '#FFC9CF' },
  cellWon: { backgroundColor: '#FFE9A8' },
  goal: { alignItems: 'center', justifyContent: 'center' },
  goalGem: { position: 'absolute', right: -4, bottom: -2 },
  robot: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'flex-end' },
  dome: { backgroundColor: 'rgba(200,232,255,0.85)', borderWidth: 1.5, borderColor: '#5B8DB8', alignItems: 'center', justifyContent: 'flex-end',
    overflow: 'hidden' },
  chassis: { borderRadius: 5, backgroundColor: '#5B6F86', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 2,
    marginBottom: 1 },
  chassisHurt: { backgroundColor: '#C2414F' },
  wheel: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1D2B36', marginBottom: -3 },
  facing: { position: 'absolute', right: -1, top: -1, borderRadius: 999, backgroundColor: t.accent, padding: 1 },
  fault: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: 12, padding: 10, backgroundColor: '#FFF1E8', borderWidth: 1.5, borderColor: '#F0A37A' },
  faultText: { flex: 1, fontSize: 14, fontWeight: '800', color: '#9A3B12' },
  programHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  programTitle: { fontSize: 14, fontWeight: '900', color: t.ink },
  counter: { fontSize: 13, fontWeight: '900', color: t.accent },
  counterFull: { color: t.danger },
  program: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 52, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 8,
    borderWidth: 1.5, borderColor: t.border, alignItems: 'center' },
  programEmpty: { color: t.muted, fontSize: 13 },
  blockWrap: { flexDirection: 'row', alignItems: 'center' },
  block: { minHeight: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: t.tint, justifyContent: 'center' },
  blockInside: { backgroundColor: '#EFE7FF' },
  blockLoop: { backgroundColor: '#5141A8' },
  blockEnd: { backgroundColor: '#5141A8', paddingHorizontal: 8 },
  blockDoing: { backgroundColor: '#F2A93B', transform: [{ scale: 1.08 }] },
  blockWrong: { backgroundColor: t.danger },
  blockText: { fontSize: 13, fontWeight: '900', color: t.accent },
  blockLoopText: { color: '#FFFFFF' },
  times: { marginLeft: 2, minHeight: 36, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#EEEAFF', justifyContent: 'center' },
  timesText: { fontSize: 13, fontWeight: '900', color: '#5141A8' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paletteBlock: { flexGrow: 1, minHeight: 44, minWidth: 90, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: t.border,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  paletteText: { fontSize: 14, fontWeight: '900', color: t.accent },
  paletteLoop: { borderColor: '#5141A8', backgroundColor: '#EEEAFF' },
  paletteLoopText: { fontSize: 14, fontWeight: '900', color: '#5141A8' },
});
