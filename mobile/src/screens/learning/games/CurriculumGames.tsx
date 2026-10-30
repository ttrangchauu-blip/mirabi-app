import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutRectangle, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../../components/PetArt';
import { Text } from '../../../components/Typography';
import { Block, BLOCK_LABEL, blockCount, isLoop, LOOP_MAX, LOOP_MIN, loopTimes, openLoop, Step, walk } from '../../../learning/codePath';
import type { Turn } from '../../../learning/types';
import { appTheme as t } from '../../../theme';

// The curriculum games' play areas. Each also draws a guide page: `demo` sets what it shows (the real layout, with the
// move the page explains) and nothing can be tapped. The backend checks every answer; a wrong one is fixed and tried
// again, with the reason it sends (`feedback`).

type Common = { turn: Turn; disabled: boolean; feedback?: { text: string; tone: 'good' | 'bad' } | null };

function Feedback({ note }: { note?: Common['feedback'] }) {
  if (!note) return null;
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

// --- Ghép chữ -------------------------------------------------------------------------------------------------------

/** Look at the picture, tap the letters (lớp 1) or syllables (lớp 2) in order, then "Kiểm tra". A wrong word keeps its
 * pieces in place to be fixed. Every word done gives the pet a piece of the book. */
export function WordBuild({ turn, disabled, feedback, onSubmit, collected, total, petId, petLevel, demo }: Common & {
  onSubmit: (ids: string[]) => void; collected: number; total: number; petId: string; petLevel: number;
  demo?: { placed: string[]; result?: 'ok' };
}) {
  const tiles = turn.prompt.tiles ?? [];
  const [own, setOwn] = useState<string[]>([]);
  const placed = demo?.placed ?? own;
  const locked = disabled || !!demo;
  const text = (id: string) => tiles.find((x) => x.id === id)?.text ?? '';
  const letters = turn.prompt.unit === 'letter';
  const complete = placed.length === tiles.length;
  return (
    <View style={styles.scene}>
      <View style={styles.bookRow}>
        <View pointerEvents="none"><PetArt pet={petId} size={40} stage={petLevel} still /></View>
        <Text style={styles.bookText} accessibilityLabel={`Pet đã nhận ${collected} trên ${total} mảnh sách`}>📖 Mảnh sách: {collected}/{total}</Text>
      </View>
      <View style={styles.picture} accessible accessibilityRole="image" accessibilityLabel="Hình gợi ý">
        <Text style={styles.pictureEmoji}>{turn.prompt.picture}</Text>
      </View>
      <View style={styles.slots} accessibilityLabel={`Đang ghép: ${placed.map(text).join(letters ? '' : ' ') || 'chưa có'}`}>
        {tiles.map((_, i) => {
          const id = placed[i];
          return id ? (
            <Pressable key={i} onPress={() => setOwn((p) => p.filter((x) => x !== id))} disabled={locked} accessibilityRole="button"
              accessibilityLabel={`Gỡ ${text(id)}`} style={[styles.slot, styles.slotFilled, demo?.result === 'ok' && styles.slotRight]}>
              <Text style={styles.slotText}>{text(id)}</Text>
            </Pressable>
          ) : <View key={i} style={styles.slot} />;
        })}
      </View>
      <View style={styles.tiles}>
        {tiles.filter((tile) => !placed.includes(tile.id)).map((tile) => (
          <Pressable key={tile.id} onPress={() => setOwn((p) => [...p, tile.id])} disabled={locked} accessibilityRole="button"
            accessibilityLabel={`${letters ? 'Chữ' : 'Tiếng'} ${tile.text}`} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
            <Text style={styles.tileText}>{tile.text}</Text>
          </Pressable>
        ))}
      </View>
      <Feedback note={demo?.result === 'ok' ? { text: 'Chính xác! Pet nhận thêm một mảnh sách.', tone: 'good' } : feedback} />
      <Actions onReset={() => setOwn([])} resetDisabled={locked || !placed.length} onCheck={() => onSubmit(placed)}
        checkDisabled={locked || !complete} />
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

/** Drag the card onto its group (or tap a group). A wrong group sends the card back with the reason. */
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
      // The card goes back to its place: the next one comes if it was right, this one stays if it was wrong.
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

// --- Lập trình đường đi ----------------------------------------------------------------------------------------------

const RUN_STEP_MS = 420;
const ARROW: Record<string, React.ComponentProps<typeof Ionicons>['name']> = { N: 'arrow-up', E: 'arrow-forward', S: 'arrow-down', W: 'arrow-back' };

/** Put blocks in the program bar, "Chạy": the pet walks it (here), then the backend checks it. "Dừng" stops the walk,
 * "Đặt lại" puts the pet back; a program can be fixed and run as often as needed. */
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
  const [width, setWidth] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setRunning(false); };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => { stop(); setPath(null); setAt(0); setOwn([]); }, [turn.turn_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const pet = shownPath?.[shownAt] ?? (p.start as Step);

  const run = () => {
    const result = walk(p, program);
    if (!result) return;
    stop();
    setPath(result.path);
    if (reduceMotion) { setAt(result.path.length - 1); onRun(program); return; }
    setAt(0);
    setRunning(true);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      if (i >= result.path.length) { stop(); onRun(program); return; } // the walk is over: the backend says if it was right
      setAt(i);
    }, RUN_STEP_MS);
  };
  const add = (b: Block) => { setPath(null); setAt(0); setOwn((list) => [...list, b]); };
  const remove = (i: number) => {
    setPath(null); setAt(0);
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
  const cell = Math.max(22, Math.min(44, Math.floor((width || 300) / cols)));
  const walls = new Set((p.walls ?? []).map(([x, y]) => `${x},${y}`));
  let inLoop = false;
  return (
    <View style={styles.scene}>
      <View style={styles.boardWrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.board, { width: cell * cols, height: cell * rows }]} accessible accessibilityRole="image"
          accessibilityLabel={`Bản đồ ${cols} × ${rows} ô. Pet ở cột ${pet.x + 1}, hàng ${pet.y + 1}; đích ở cột ${(p.goal?.x ?? 0) + 1}, hàng ${(p.goal?.y ?? 0) + 1}.`}>
          {Array.from({ length: rows }).map((_, y) => Array.from({ length: cols }).map((__, x) => (
            <View key={`${x},${y}`} style={[styles.cell, { left: x * cell, top: y * cell, width: cell, height: cell },
              walls.has(`${x},${y}`) && styles.wall, (shownPath ?? []).slice(1, shownAt + 1).some((s) => s.x === x && s.y === y) && styles.trail]}>
              {walls.has(`${x},${y}`) ? <Text style={{ fontSize: cell * 0.55 }}>🪨</Text> : null}
              {p.goal?.x === x && p.goal?.y === y ? <Text style={{ fontSize: cell * 0.6 }}>🏁</Text> : null}
            </View>
          )))}
          <View pointerEvents="none" style={[styles.pet, { left: pet.x * cell, top: pet.y * cell, width: cell, height: cell }]}>
            <PetArt pet={petId} size={cell * 0.8} stage={petLevel} still />
            <View style={styles.facing}><Ionicons name={ARROW[pet.dir]} size={Math.max(12, cell * 0.34)} color="#FFFFFF" /></View>
          </View>
        </View>
      </View>
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
          return (
            <View key={i} style={styles.blockWrap}>
              <Pressable onPress={() => remove(i)} disabled={locked || running} accessibilityRole="button"
                accessibilityLabel={loop ? `Gỡ khối Lặp ${loopTimes(b)} lần` : b === 'end' ? 'Gỡ dấu đóng lặp' : `Gỡ lệnh ${BLOCK_LABEL[b as 'forward']}`}
                style={[styles.block, loop && styles.blockLoop, b === 'end' && styles.blockEnd, inside && styles.blockInside,
                  running && path && shownAt > 0 && styles.blockRunning]}>
                <Text style={[styles.blockText, (loop || b === 'end') && styles.blockLoopText]}>
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
      <Feedback note={demo ? (demoWalk?.ok && shownAt === (demoWalk.path.length - 1) ? { text: 'Pet đã tới đích!', tone: 'good' } : null) : feedback} />
      <View style={styles.actions}>
        {running ? (
          <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Dừng" style={styles.secondary}>
            <Text style={styles.secondaryText}>Dừng</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => { setPath(null); setAt(0); }} disabled={locked || !path} accessibilityRole="button" accessibilityLabel="Đặt lại"
            style={[styles.secondary, (locked || !path) && styles.dimmed]}><Text style={styles.secondaryText}>Đặt lại</Text></Pressable>
        )}
        <Pressable onPress={() => { stop(); setPath(null); setOwn([]); }} disabled={locked || running || !program.length}
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
  // Ghép chữ
  bookRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center' },
  bookText: { fontSize: 14, fontWeight: '900', color: '#8A5A00' },
  picture: { alignSelf: 'center', width: 140, height: 140, borderRadius: 28, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pictureEmoji: { fontSize: 80, lineHeight: 96 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  slot: { minWidth: 52, minHeight: 56, paddingHorizontal: 10, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: t.border,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  slotFilled: { borderStyle: 'solid', borderColor: t.accent, backgroundColor: t.tint },
  slotRight: { borderColor: t.success, backgroundColor: t.successBg },
  slotText: { fontSize: 26, fontWeight: '900', color: t.ink },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  tile: { minWidth: 56, minHeight: 56, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#FFF6E5', borderWidth: 2, borderColor: '#F2C46D',
    alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 26, fontWeight: '900', color: '#8A5A00' },
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
  board: { backgroundColor: '#E6F5E8', borderRadius: 12, overflow: 'hidden' },
  cell: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderColor: '#BFE3C6', alignItems: 'center', justifyContent: 'center' },
  wall: { backgroundColor: '#C9D3DA' },
  trail: { backgroundColor: '#FFF1C9' },
  pet: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  facing: { position: 'absolute', right: 0, bottom: 0, borderRadius: 999, backgroundColor: t.accent, padding: 1 },
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
  blockRunning: { opacity: 0.85 },
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
