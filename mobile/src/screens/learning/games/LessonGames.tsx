import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../../components/Typography';
import type { Turn } from '../../../learning/types';
import { appTheme as t } from '../../../theme';

// The lesson games (backend lesson_catalog.py): one gameplay each, whatever the lesson. Sắp xếp thứ tự (vòng đời, dòng
// thời gian, quy trình…), Ghép cặp (sự kiện–nhân vật, phép tính–kết quả…) and Chọn đáp án có giải thích (tình huống,
// đọc hiểu, dự đoán…). The backend checks every answer; a wrong one is fixed and tried again, with the reason it sends,
// and what was already right (`kept`) stays in place. Each also draws a guide page (`demo`: nothing can be tapped).

type Note = { text: string; tone: 'good' | 'bad' } | null;
type Common = { turn: Turn; disabled: boolean; feedback?: Note;
  /** After a wrong answer: the cards in the right place, or the right pairs ("a1b3"), from the backend. */ kept?: string[] | null };

function Feedback({ note }: { note?: Note }) {
  if (!note || !note.text) return null;
  const good = note.tone === 'good';
  return (
    <View style={[styles.feedback, good ? styles.feedbackGood : styles.feedbackBad]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name={good ? 'checkmark-circle' : 'information-circle'} size={18} color={good ? t.success : t.danger} />
      <Text style={[styles.feedbackText, { color: good ? t.success : t.danger }]}>{note.text}</Text>
    </View>
  );
}

function Actions({ onReset, resetDisabled, onCheck, checkDisabled }: { onReset: () => void; resetDisabled: boolean; onCheck: () => void; checkDisabled: boolean }) {
  return (
    <View style={styles.actions}>
      <Pressable onPress={onReset} disabled={resetDisabled} accessibilityRole="button" accessibilityLabel="Xếp lại"
        style={[styles.secondary, resetDisabled && styles.dimmed]}><Text style={styles.secondaryText}>Xếp lại</Text></Pressable>
      <Pressable onPress={onCheck} disabled={checkDisabled} accessibilityRole="button" accessibilityLabel="Kiểm tra"
        accessibilityState={{ disabled: checkDisabled }} style={[styles.primary, checkDisabled && styles.dimmed]}>
        <Text style={styles.primaryText}>Kiểm tra</Text>
      </Pressable>
    </View>
  );
}

// --- Sắp xếp thứ tự -------------------------------------------------------------------------------------------------

/** Tap the cards in order: each fills the next free place. Tap a placed card to take it back. After a wrong answer the
 * cards already in their right place stay (locked, green); the others come back to be placed again. */
export function OrderSteps({ turn, disabled, feedback, kept, onSubmit, demo }: Common & {
  onSubmit: (ids: string[]) => void; demo?: { placed: string[]; result?: 'ok' };
}) {
  const p = turn.prompt;
  const cards = p.cards ?? [];
  const n = cards.length;
  const [own, setOwn] = useState<(string | null)[]>(() => Array(n).fill(null));
  const [locked, setLocked] = useState<Set<string>>(new Set());
  // A wrong answer: keep what is in its right place, free the rest.
  useEffect(() => {
    if (!kept) return;
    const keep = new Set(kept);
    setLocked(keep);
    setOwn((places) => places.map((id) => (id && keep.has(id) ? id : null)));
  }, [kept]);
  const places = demo ? [...demo.placed, ...Array(Math.max(0, n - demo.placed.length)).fill(null)] : own;
  const off = disabled || !!demo;
  const text = (id: string | null) => cards.find((c) => c.id === id)?.text ?? '';
  const left = cards.filter((c) => !places.includes(c.id));
  const place = (id: string) => setOwn((list) => { const next = [...list]; const free = next.indexOf(null); if (free >= 0) next[free] = id; return next; });
  const remove = (i: number) => setOwn((list) => list.map((id, j) => (j === i ? null : id)));
  const full = places.every(Boolean);
  return (
    <View style={styles.scene}>
      {p.prompt ? <Text style={styles.instruction}>{p.prompt}</Text> : null}
      <View style={styles.places} accessibilityLabel={`Thứ tự đang xếp: ${places.map((id, i) => `${i + 1}. ${text(id) || 'trống'}`).join(', ')}`}>
        {places.map((id, i) => {
          const fixed = !!id && locked.has(id);
          const end = i === 0 ? p.first : i === n - 1 ? p.last : null;
          return (
            <View key={i} style={styles.placeRow}>
              <View style={[styles.number, fixed && styles.numberFixed]}><Text style={styles.numberText}>{i + 1}</Text></View>
              {id ? (
                <Pressable onPress={() => remove(i)} disabled={off || fixed} accessibilityRole="button"
                  accessibilityLabel={fixed ? `${text(id)}, đúng vị trí` : `Gỡ ${text(id)}`}
                  style={[styles.placed, fixed && styles.placedFixed, demo?.result === 'ok' && styles.placedFixed]}>
                  <Text style={styles.placedText}>{text(id)}</Text>
                  {fixed ? <Ionicons name="lock-closed" size={14} color={t.success} /> : null}
                </Pressable>
              ) : (
                <View style={styles.empty}><Text style={styles.emptyText}>{end ?? 'Chạm một thẻ để đặt vào đây'}</Text></View>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.pool}>
        {left.map((c) => (
          <Pressable key={c.id} onPress={() => place(c.id)} disabled={off} accessibilityRole="button" accessibilityLabel={`Thẻ ${c.text}`}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <Text style={styles.cardText}>{c.text}</Text>
          </Pressable>
        ))}
      </View>
      <Feedback note={demo?.result === 'ok' ? { text: 'Chính xác! Đúng thứ tự rồi.', tone: 'good' } : feedback} />
      <Actions onReset={() => setOwn((list) => list.map((id) => (id && locked.has(id) ? id : null)))}
        resetDisabled={off || places.every((id) => !id || locked.has(id))}
        onCheck={() => onSubmit(places as string[])} checkDisabled={off || !full} />
    </View>
  );
}

// --- Ghép cặp ---------------------------------------------------------------------------------------------------------

const PAIR_COLORS = ['#FFE3B3', '#D7ECFF', '#DDF5DF', '#F6DDF7', '#FFE0DA'];

/** Tap a card on the left, then its partner on the right. Tap a paired card to undo. "Kiểm tra" once every left card
 * has a partner. After a wrong answer the right pairs stay (locked); the others are undone. */
export function MatchPairs({ turn, disabled, feedback, kept, onSubmit, demo }: Common & {
  onSubmit: (pairs: string[]) => void; demo?: { pairs: Record<string, string>; selected?: string; result?: 'ok' };
}) {
  const p = turn.prompt;
  const lefts = p.lefts ?? [];
  const rights = p.rights ?? [];
  const [own, setOwn] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!kept) return;
    const keep = new Set(kept);
    setLocked(new Set(kept.map((pair) => pair.slice(0, pair.indexOf('b')))));
    setOwn((pairs) => Object.fromEntries(Object.entries(pairs).filter(([a, b]) => keep.has(a + b))));
    setSelected(null);
  }, [kept]);
  const pairs = demo?.pairs ?? own;
  const chosen = demo?.selected ?? selected;
  const off = disabled || !!demo;
  const order = lefts.map((l) => l.id).filter((id) => pairs[id]);
  const colorOf = (left: string) => PAIR_COLORS[order.indexOf(left) % PAIR_COLORS.length];
  const leftOf = (right: string) => Object.keys(pairs).find((a) => pairs[a] === right);
  const tapLeft = (id: string) => {
    if (pairs[id]) { if (!locked.has(id)) setOwn((x) => { const { [id]: _drop, ...rest } = x; return rest; }); return; }
    setSelected((s) => (s === id ? null : id));
  };
  const tapRight = (id: string) => {
    const owner = leftOf(id);
    if (owner) { if (!locked.has(owner)) setOwn((x) => { const { [owner]: _drop, ...rest } = x; return rest; }); return; }
    if (!selected) return;
    setOwn((x) => ({ ...x, [selected]: id }));
    setSelected(null);
  };
  const full = lefts.length > 0 && lefts.every((l) => pairs[l.id]);
  const label = (id: string) => [...lefts, ...rights].find((c) => c.id === id)?.text ?? '';
  return (
    <View style={styles.scene}>
      {p.prompt ? <Text style={styles.instruction}>{p.prompt}</Text> : null}
      <Text style={styles.hint}>{chosen ? `Chọn thẻ ghép với “${label(chosen)}”` : 'Chạm một thẻ bên trái, rồi chạm thẻ ghép với nó bên phải'}</Text>
      <View style={styles.columns}>
        <View style={styles.column}>
          {p.left_label ? <Text style={styles.columnLabel}>{p.left_label}</Text> : null}
          {lefts.map((c) => {
            const pair = pairs[c.id];
            return (
              <Pressable key={c.id} onPress={() => tapLeft(c.id)} disabled={off} accessibilityRole="button"
                accessibilityState={{ selected: chosen === c.id }}
                accessibilityLabel={pair ? `${c.text}, đã ghép với ${label(pair)}` : c.text}
                style={[styles.matchCard, pair && { backgroundColor: colorOf(c.id) }, chosen === c.id && styles.matchChosen,
                  locked.has(c.id) && styles.matchLocked]}>
                <Text style={styles.matchText}>{c.text}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.column}>
          {p.right_label ? <Text style={styles.columnLabel}>{p.right_label}</Text> : null}
          {rights.map((c) => {
            const owner = leftOf(c.id);
            return (
              <Pressable key={c.id} onPress={() => tapRight(c.id)} disabled={off} accessibilityRole="button"
                accessibilityLabel={owner ? `${c.text}, đã ghép với ${label(owner)}` : c.text}
                style={[styles.matchCard, owner && { backgroundColor: colorOf(owner) }, owner && locked.has(owner) && styles.matchLocked]}>
                <Text style={styles.matchText}>{c.text}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Feedback note={demo?.result === 'ok' ? { text: 'Chính xác! Các cặp đều đúng.', tone: 'good' } : feedback} />
      <Actions onReset={() => { setOwn((x) => Object.fromEntries(Object.entries(x).filter(([a]) => locked.has(a)))); setSelected(null); }}
        resetDisabled={off || Object.keys(pairs).every((a) => locked.has(a))}
        onCheck={() => onSubmit(lefts.map((l) => l.id + pairs[l.id]))} checkDisabled={off || !full} />
    </View>
  );
}

// --- Chọn đáp án có giải thích ----------------------------------------------------------------------------------------

/** A passage that is a program (Tin học: Python, HTML, a spreadsheet formula): shown in a fixed-width font so its
 * indentation reads as written. */
export const looksLikeCode = (text: string) =>
  /^( {2,}|\t)\S/m.test(text) || /\b(print|def|for|while|if)\b.*[(:]/.test(text) || /<\/?[a-z][a-z0-9]*[\s>]/i.test(text)
  || /^=\w+\(/m.test(text);
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const STYLE_HINT: Record<string, string> = {
  situation: 'Đọc tình huống và chọn cách ứng xử phù hợp', reading: 'Đọc đoạn văn rồi trả lời câu hỏi',
  predict: 'Dự đoán điều gì sẽ xảy ra', reflect: 'Chọn câu đúng với em nhất: không có đáp án sai', quiz: 'Chọn đáp án đúng',
};

/** Read (the passage, when there is one), then tap an option. A wrong one says why and is crossed out; try another.
 * The right one's explanation shows before the next question. A self-assessment (tự đánh giá) has no wrong answer. */
export function ChoiceExplain({ turn, disabled, feedback, onChoose, demo }: Common & {
  onChoose: (id: string) => void; demo?: { chosen?: string; result?: 'ok' | 'bad' };
}) {
  const p = turn.prompt;
  const [tried, setTried] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => { if (feedback?.tone === 'bad' && last) setTried((x) => (x.includes(last) ? x : [...x, last])); }, [feedback, last]);
  const off = disabled || !!demo;
  const [open, setOpen] = useState(true);
  return (
    <View style={styles.scene}>
      <Text style={styles.hint}>{STYLE_HINT[p.style ?? 'quiz'] ?? STYLE_HINT.quiz}</Text>
      {p.passage ? (
        <View style={styles.passage}>
          <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? 'Thu gọn đoạn văn' : 'Mở đoạn văn'} style={styles.passageHead}>
            <Ionicons name="document-text-outline" size={16} color={t.accent} />
            <Text style={styles.passageLabel}>{p.style === 'reading' ? 'Đoạn văn' : 'Tư liệu'}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.muted} />
          </Pressable>
          {open ? <Text style={[styles.passageText, looksLikeCode(p.passage) && styles.code]}>{p.passage}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.question}>{p.question}</Text>
      <View style={styles.choices}>
        {(p.options ?? []).map((o) => {
          const crossed = tried.includes(o.id);
          const right = demo?.chosen === o.id && demo.result === 'ok';
          const wrong = demo?.chosen === o.id && demo.result === 'bad';
          return (
            <Pressable key={o.id} onPress={() => { setLast(o.id); onChoose(o.id); }} disabled={off || crossed} accessibilityRole="button"
              accessibilityState={{ disabled: off || crossed }} accessibilityLabel={crossed ? `${o.text}, chưa đúng` : o.text}
              style={({ pressed }) => [styles.choice, (crossed || wrong) && styles.choiceWrong, right && styles.choiceRight, pressed && styles.pressed]}>
              <Text style={[styles.choiceText, (crossed || wrong) && styles.choiceWrongText]}>{o.text}</Text>
            </Pressable>
          );
        })}
      </View>
      <Feedback note={demo?.result === 'bad' ? { text: 'Chưa phù hợp: mỗi lựa chọn đều có lời giải thích. Thử lựa chọn khác nhé.', tone: 'bad' }
        : demo?.result === 'ok' ? { text: 'Chính xác! Đọc lời giải thích rồi sang câu tiếp theo.', tone: 'good' } : feedback} />
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { gap: 12, paddingVertical: 4 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  dimmed: { opacity: 0.45 },
  instruction: { fontSize: 16, fontWeight: '800', color: t.ink, textAlign: 'center' },
  hint: { fontSize: 13, fontWeight: '700', color: t.muted, textAlign: 'center' },
  feedback: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: 10 },
  feedbackGood: { backgroundColor: t.successBg },
  feedbackBad: { backgroundColor: t.dangerBg },
  feedbackText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  secondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.accent, fontWeight: '900', fontSize: 15 },
  // Sắp xếp
  places: { gap: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  number: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  numberFixed: { backgroundColor: t.successBg },
  numberText: { fontSize: 14, fontWeight: '900', color: t.accent },
  placed: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, borderWidth: 2, borderColor: t.accent,
    backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8 },
  placedFixed: { borderColor: t.success, backgroundColor: t.successBg },
  placedText: { flex: 1, fontSize: 15, fontWeight: '800', color: t.ink },
  empty: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: t.border, justifyContent: 'center',
    paddingHorizontal: 12 },
  emptyText: { fontSize: 13, color: t.muted, fontWeight: '700' },
  pool: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  card: { minHeight: 46, maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: '#FFF6E5',
    borderWidth: 2, borderColor: '#F2C46D', justifyContent: 'center' },
  cardText: { fontSize: 15, fontWeight: '800', color: '#8A5A00' },
  // Ghép cặp
  columns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1, gap: 8 },
  columnLabel: { fontSize: 12, fontWeight: '900', color: t.muted, textAlign: 'center' },
  matchCard: { minHeight: 50, borderRadius: 14, borderWidth: 2, borderColor: t.border, backgroundColor: '#FFFFFF', justifyContent: 'center',
    paddingHorizontal: 10, paddingVertical: 8 },
  matchChosen: { borderColor: t.accent, borderWidth: 3 },
  matchLocked: { borderColor: t.success },
  matchText: { fontSize: 15, fontWeight: '800', color: t.ink, textAlign: 'center' },
  // Chọn đáp án
  passage: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, gap: 6 },
  passageHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passageLabel: { flex: 1, fontSize: 13, fontWeight: '900', color: t.accent },
  passageText: { fontSize: 15, lineHeight: 22, color: t.ink },
  code: { fontFamily: MONO, fontSize: 14, lineHeight: 20, backgroundColor: '#F4F6F8', borderRadius: 8, padding: 8 },
  question: { fontSize: 17, fontWeight: '900', color: t.ink, lineHeight: 24 },
  choices: { gap: 8 },
  choice: { minHeight: 50, borderRadius: 14, borderWidth: 2, borderColor: t.border, backgroundColor: '#FFFFFF', justifyContent: 'center',
    paddingHorizontal: 14, paddingVertical: 10 },
  choiceWrong: { borderColor: t.danger, backgroundColor: t.dangerBg },
  choiceWrongText: { color: t.danger, textDecorationLine: 'line-through' },
  choiceRight: { borderColor: t.success, backgroundColor: t.successBg },
  choiceText: { fontSize: 15, fontWeight: '800', color: t.ink },
});
