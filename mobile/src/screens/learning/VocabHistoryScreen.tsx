import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../../components/Typography';
import { learningApi } from '../../learning/api';
import { GAME_INFO, OUTCOME_LABEL } from '../../learning/labels';
import { speakEnglish } from '../../learning/prefs';
import type { VocabAttempt, VocabDirection, VocabFilter, VocabHistory, VocabHistoryItem, VocabResult, VocabWordDetail } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, Segmented } from '../../ui/kit';
import { EmptyState, ErrorState, LoadingState, OptionRow, OptionSheet } from '../together/ui';
import { BackHeader } from './GamePicker';

export type PractiseGame = 'word_shooter' | 'meteor';
/** Start a review stage: these words, or every "Cần ôn" word when `entryKeys` is null. */
export type Practise = (game: PractiseGame, entryKeys: string[] | null) => void;

const GAME_FOR: Record<VocabDirection, PractiseGame> = { en_vi: 'word_shooter', vi_en: 'meteor' };
const DIRECTIONS: VocabDirection[] = ['en_vi', 'vi_en'];
const gameName = (d: VocabDirection) => `${GAME_INFO[GAME_FOR[d]].name} (${GAME_INFO[GAME_FOR[d]].direction})`;
/** The most words a review stage holds (backend PRACTICE_LIMIT). */
const STAGE_WORDS = 12;
const RESULT_LABEL: Record<VocabResult, string> = { correct: 'Đúng', wrong: 'Sai', unanswered: 'Chưa trả lời' };
const FILTERS: { value: VocabFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' }, { value: 'correct', label: 'Trả lời đúng' }, { value: 'review', label: 'Cần ôn' }];

const pad = (n: number) => String(n).padStart(2, '0');
/** "Hôm nay, 10:30", "Hôm qua, 21:05", then the date, in the device's local time. */
export function studiedAt(iso: string | null, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return days === 0 ? `Hôm nay, ${time}` : days === 1 ? `Hôm qua, ${time}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function StatusPill({ status }: { status: VocabHistoryItem['status'] }) {
  const review = status === 'review';
  return (
    <View style={[s.pill, review ? s.pillReview : s.pillOk]}>
      <Text style={[s.pillText, { color: review ? '#9A4B00' : '#1E7A4E' }]}>{review ? 'Cần ôn' : 'Đúng'}</Text>
    </View>
  );
}

/** Which game to practise in; the one(s) the words are due in are marked. */
function GameSheet({ visible, due, onClose, onPick }: { visible: boolean; due: VocabDirection[]; onClose: () => void; onPick: (g: PractiseGame) => void }) {
  return (
    <OptionSheet visible={visible} title="Luyện lại bằng trò chơi" onClose={onClose}>
      {DIRECTIONS.map((d) => (
        <OptionRow key={d} icon={GAME_INFO[GAME_FOR[d]].icon} label={gameName(d)}
          description={due.includes(d) ? 'Có từ cần ôn ở chiều này' : GAME_INFO[GAME_FOR[d]].detail} onPress={() => onPick(GAME_FOR[d])} />
      ))}
    </OptionSheet>
  );
}

// ------------------------------------------------------------------------------------------------ the list
export const PAGE_SIZE = 15;
/** What the list shows; kept by the parent so coming back from a word returns to the same page, filter and search. */
export type VocabView = { filter: VocabFilter; query: string; page: number };
export const FIRST_VIEW: VocabView = { filter: 'all', query: '', page: 0 };
const SEARCH_DELAY_MS = 300;

/** "Từ đã học": every word met in the two vocabulary games, most recently studied first, 15 a page, with search and filters. */
export function VocabHistoryScreen({ view, onViewChange, onOpen, onBack, onPractise, practising, onPageChange }: {
  view: VocabView; onViewChange: (view: VocabView) => void; onOpen: (entryKey: string) => void; onBack: () => void;
  onPractise: Practise; practising: boolean; /** A new page is shown (the screen scrolls back to the top). */ onPageChange?: () => void;
}) {
  const [data, setData] = useState<VocabHistory | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState(view.query);
  const [choose, setChoose] = useState(false);
  const latest = useRef(0);
  const { filter, query, page } = view;

  // Searching waits for a pause in typing, and starts again from the first page.
  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => onViewChange({ ...view, query: typed, page: 0 }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, query, view, onViewChange]);

  const load = useCallback(async () => {
    const id = ++latest.current; // only the answer to the latest request is shown
    setLoading(true); setError(null);
    try {
      const next = await learningApi.vocabHistory(query, filter, page * PAGE_SIZE, PAGE_SIZE);
      if (id !== latest.current) return;
      // A page that emptied meanwhile (words moved to another filter): show the last page that has words.
      if (next.items.length === 0 && page > 0 && next.total > 0) { onViewChange({ ...view, page: Math.ceil(next.total / PAGE_SIZE) - 1 }); return; }
      setData(next);
    } catch (e) { if (id === latest.current) setError(e); }
    finally { if (id === latest.current) setLoading(false); }
    // Reloads when the page, filter or search changes; `view` and `onViewChange` only matter for that correction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter, page]);
  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const due = data ? DIRECTIONS.filter((d) => data.due[d] > 0) : [];
  // Taps while a page is loading are fine: only the answer to the latest request is shown.
  const goTo = (next: number) => { onViewChange({ ...view, page: next }); onPageChange?.(); };
  const searching = !!typed.trim() || !!query.trim();
  return (
    <>
      <BackHeader title="Từ đã học" subtitle={counts ? `${counts.all} từ · ${counts.review} cần ôn · mới học gần nhất trước` : 'Lịch sử từ vựng'} onBack={onBack} />
      {!data ? (error ? <Card><ErrorState error={error} onRetry={() => { void load(); }} /></Card> : <LoadingState label="Đang tải từ đã học…" />)
        : data.counts.all === 0 ? (
          <Card><EmptyState icon="book-outline" title="Chưa có từ nào"
            body="Chơi Bắn từ tiếng Anh hoặc Bắn thiên thạch, các từ bạn gặp sẽ được lưu ở đây." /></Card>
        ) : <>
          <View style={s.search}>
            <Ionicons name="search" size={18} color={t.muted} />
            <TextInput value={typed} onChangeText={setTyped} placeholder="Tìm từ tiếng Anh hoặc nghĩa tiếng Việt" placeholderTextColor="#7F95A8"
              style={s.searchInput} accessibilityLabel="Tìm từ đã học" autoCorrect={false} autoCapitalize="none" returnKeyType="search" maxLength={60}
              onSubmitEditing={() => onViewChange({ ...view, query: typed, page: 0 })} />
            {typed ? <Pressable onPress={() => { setTyped(''); onViewChange({ ...view, query: '', page: 0 }); }} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Xóa tìm kiếm">
              <Ionicons name="close-circle" size={18} color={t.muted} />
            </Pressable> : null}
          </View>
          <Segmented<VocabFilter> value={filter} onChange={(next) => onViewChange({ ...view, filter: next, page: 0 })} options={FILTERS} compact />
          {filter === 'review' && counts && counts.review > 0 ? (
            <Button title={counts.review > STAGE_WORDS ? `Luyện ${STAGE_WORDS} từ cần ôn gần nhất` : `Luyện tất cả từ cần ôn (${counts.review})`} icon="refresh-circle-outline" loading={practising}
              onPress={() => setChoose(true)} style={s.practiseAll} />
          ) : null}
          {error ? <Card><ErrorState error={error} onRetry={() => { void load(); }} /></Card>
            : data.items.length === 0 ? (
              <Card><EmptyState icon={searching ? 'search-outline' : 'checkmark-circle-outline'}
                title={searching ? 'Không tìm thấy từ nào' : filter === 'review' ? 'Không có từ cần ôn' : 'Chưa có từ trả lời đúng'}
                body={searching ? `Không có từ nào khớp “${(query || typed).trim()}”.` : filter === 'review' ? 'Tuyệt vời! Mọi từ đều đúng ở lần gần nhất.' : undefined} /></Card>
            ) : (
              <Card style={[s.list, loading && s.stale]}>
                {data.items.map((item, i) => (
                  <Pressable key={item.entry_key} onPress={() => onOpen(item.entry_key)} accessibilityRole="button"
                    accessibilityLabel={`${item.word}, ${item.meaning_vi}, ${item.status === 'review' ? 'cần ôn' : 'đúng'}`}
                    style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && s.pressed]}>
                    <View style={s.flex}>
                      <Text style={s.word} numberOfLines={1}>{item.word}{item.part_of_speech ? <Text style={s.pos}>  {item.part_of_speech}</Text> : null}</Text>
                      <Text style={s.meaning} numberOfLines={2}>{item.meaning_vi}{item.context_vi ? <Text style={s.context}> · {item.context_vi}</Text> : null}</Text>
                      <Text style={s.when}>Học gần nhất: {studiedAt(item.last_seen_at)}</Text>
                    </View>
                    <StatusPill status={item.status} />
                    <Ionicons name="chevron-forward" size={18} color={t.muted} />
                  </Pressable>
                ))}
              </Card>
            )}
          {!error && data.total > PAGE_SIZE ? (
            <View style={s.pager}>
              <Pressable onPress={() => goTo(page - 1)} disabled={page === 0} accessibilityRole="button" accessibilityLabel="Trang trước"
                accessibilityState={{ disabled: page === 0 }} style={({ pressed }) => [s.pageButton, page === 0 && s.pageOff, pressed && s.pressed]}>
                <Ionicons name="chevron-back" size={18} color={t.accent} />
                <Text style={s.pageButtonText}>Trước</Text>
              </Pressable>
              <View style={s.pageInfo} accessibilityLiveRegion="polite">
                <Text style={s.pageText}>Trang {page + 1}/{pages}</Text>
                <Text style={s.pageRange}>{page * PAGE_SIZE + 1}–{Math.min(data.total, (page + 1) * PAGE_SIZE)} / {data.total} từ</Text>
              </View>
              <Pressable onPress={() => goTo(page + 1)} disabled={page >= pages - 1} accessibilityRole="button" accessibilityLabel="Trang sau"
                accessibilityState={{ disabled: page >= pages - 1 }} style={({ pressed }) => [s.pageButton, page >= pages - 1 && s.pageOff, pressed && s.pressed]}>
                <Text style={s.pageButtonText}>Sau</Text>
                <Ionicons name="chevron-forward" size={18} color={t.accent} />
              </Pressable>
            </View>
          ) : null}
        </>}
      <GameSheet visible={choose} due={due} onClose={() => setChoose(false)} onPick={(g) => { setChoose(false); onPractise(g, null); }} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ one word
function attemptLabel(a: VocabAttempt) {
  if (a.result === 'unanswered') return a.session_open ? 'Chưa trả lời (phiên đang dở)' : 'Chưa trả lời';
  return a.outcome ? OUTCOME_LABEL[a.outcome] : RESULT_LABEL[a.result];
}

/** A word: meaning, pronunciation and example (only when the data has them), results per game, every answer. */
export function VocabWordScreen({ entryKey, onBack, onPractise, practising }: {
  entryKey: string; onBack: () => void; onPractise: Practise; practising: boolean;
}) {
  const [word, setWord] = useState<VocabWordDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [choose, setChoose] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try { setWord(await learningApi.vocabWord(entryKey)); } catch (e) { setError(e); }
  }, [entryKey]);
  useEffect(() => { void load(); }, [load]);

  if (!word) {
    return <>
      <BackHeader title="Chi tiết từ" onBack={onBack} />
      {error ? <Card><ErrorState error={error} onRetry={() => { void load(); }} /></Card> : <LoadingState />}
    </>;
  }
  const due = DIRECTIONS.filter((d) => word.directions[d] && word.directions[d]!.last_result !== 'correct');
  return (
    <>
      <BackHeader title={word.word} subtitle={`Học lần đầu: ${studiedAt(word.first_seen_at)}`} onBack={onBack} />
      <Card>
        <View style={s.headRow}>
          <View style={s.flex}>
            <Text style={s.bigWord} selectable>{word.word}</Text>
            {word.phonetic || word.part_of_speech ? (
              <Text style={s.phonetic}>{[word.phonetic, word.part_of_speech].filter(Boolean).join(' · ')}</Text>
            ) : null}
          </View>
          <Pressable onPress={() => speakEnglish(word.word, { sound: true })} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={`Nghe phát âm ${word.word}`} style={({ pressed }) => [s.speak, pressed && s.pressed]}>
            <Ionicons name="volume-high-outline" size={22} color={t.accent} />
          </Pressable>
        </View>
        <Text style={s.bigMeaning}>{word.meaning_vi}</Text>
        {word.context_vi ? <Text style={s.context}>{word.context_vi}</Text> : null}
        {word.example_en ? (
          <View style={s.example}>
            <Text style={s.exampleEn}>{word.example_en}</Text>
            {word.example_vi ? <Text style={s.exampleVi}>{word.example_vi}</Text> : null}
          </View>
        ) : null}
        <View style={s.statusRow}><StatusPill status={word.status} /><Text style={s.when}>Học gần nhất: {studiedAt(word.last_seen_at)}</Text></View>
      </Card>

      <Text style={s.section} accessibilityRole="header">Theo chiều luyện tập</Text>
      <Card style={s.list}>
        {DIRECTIONS.map((d, i) => {
          const stats = word.directions[d];
          return (
            <View key={d} style={[s.dirRow, i > 0 && s.divider]}>
              <Text style={s.dirName}>{gameName(d)}</Text>
              {stats ? <>
                <Text style={s.dirStats}>Đúng {stats.correct} · Sai {stats.wrong}{stats.unanswered ? ` · Chưa trả lời ${stats.unanswered}` : ''}</Text>
                <Text style={[s.dirLast, stats.last_result !== 'correct' && s.dirLastReview]}>Lần gần nhất: {RESULT_LABEL[stats.last_result]}</Text>
              </> : <Text style={s.dirStats}>Chưa luyện ở chiều này</Text>}
            </View>
          );
        })}
      </Card>

      {word.can_practice ? (
        <Button title="Luyện lại" icon="refresh-circle-outline" loading={practising} onPress={() => setChoose(true)} style={s.practiseAll} />
      ) : <Text style={s.note}>Từ này thuộc bài học cũ, không còn trong kho từ nên chưa luyện lại được.</Text>}

      <Text style={s.section} accessibilityRole="header">Lịch sử trả lời</Text>
      <Card style={s.list}>
        {word.attempts.map((a, i) => (
          <View key={a.turn_id} style={[s.attempt, i > 0 && s.divider]}>
            <Ionicons name={a.result === 'correct' ? 'checkmark-circle' : a.result === 'wrong' ? 'close-circle' : 'ellipse-outline'} size={20}
              color={a.practice ? t.muted : a.result === 'correct' ? '#1E9E62' : a.result === 'wrong' ? t.danger : t.muted} />
            <View style={s.flex}>
              <Text style={s.attemptLabel}>{attemptLabel(a)}{a.practice ? ' · luyện lại sau khi xem đáp án' : ''}</Text>
              <Text style={s.when}>{studiedAt(a.at)} · {GAME_INFO[GAME_FOR[a.direction]].direction}</Text>
            </View>
          </View>
        ))}
      </Card>
      <GameSheet visible={choose} due={due} onClose={() => setChoose(false)} onPick={(g) => { setChoose(false); onPractise(g, [word.entry_key]); }} />
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, minHeight: 48, marginBottom: 12 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, color: t.ink, paddingVertical: 10 },
  practiseAll: { marginBottom: 14 },
  stale: { opacity: 0.55 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  pageButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#FFFFFF' },
  pageOff: { opacity: 0.4 },
  pageButtonText: { fontSize: 14, fontWeight: '800', color: t.accent },
  pageInfo: { flex: 1, alignItems: 'center' },
  pageText: { fontSize: 15, fontWeight: '900', color: t.ink },
  pageRange: { fontSize: 12, color: t.muted, marginTop: 1 },
  list: { paddingVertical: 6, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, minHeight: 64 },
  divider: { borderTopWidth: 1, borderTopColor: t.tint },
  word: { fontSize: 16, fontWeight: '900', color: t.ink },
  pos: { fontSize: 12, fontWeight: '700', color: t.muted },
  meaning: { fontSize: 14, color: t.ink, marginTop: 2, lineHeight: 19 },
  context: { fontSize: 13, color: t.muted },
  when: { fontSize: 12, color: t.muted, marginTop: 3 },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillOk: { backgroundColor: '#E2F6EC' },
  pillReview: { backgroundColor: '#FFF0DC' },
  pillText: { fontSize: 12, fontWeight: '900' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bigWord: { fontSize: 28, fontWeight: '900', color: t.ink },
  phonetic: { fontSize: 15, color: t.muted, marginTop: 2 },
  speak: { width: 44, height: 44, borderRadius: 16, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  bigMeaning: { fontSize: 18, fontWeight: '800', color: t.ink, marginTop: 12 },
  example: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: '#F4F9FC' },
  exampleEn: { fontSize: 15, color: t.ink, fontWeight: '700', lineHeight: 21 },
  exampleVi: { fontSize: 14, color: t.muted, marginTop: 3, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  section: { fontSize: 17, fontWeight: '900', color: t.ink, marginTop: 6, marginBottom: 10 },
  dirRow: { paddingVertical: 12 },
  dirName: { fontSize: 15, fontWeight: '800', color: t.ink },
  dirStats: { fontSize: 14, color: t.ink, marginTop: 3 },
  dirLast: { fontSize: 13, color: '#1E7A4E', fontWeight: '700', marginTop: 2 },
  dirLastReview: { color: '#9A4B00' },
  note: { fontSize: 13, color: t.muted, textAlign: 'center', marginBottom: 14 },
  attempt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  attemptLabel: { fontSize: 14, fontWeight: '700', color: t.ink },
});
