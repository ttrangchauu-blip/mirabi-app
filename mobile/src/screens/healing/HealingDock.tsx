import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { NetworkError } from '../../api/client';
import { healingApi, healingCache } from '../../life/api';
import type { Ambience, AmbiencePrefs, HealingSummary, JournalEntry, Mood, PetMoodResponse, RelaxActivity } from '../../life/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { AMBIENCES, AMBIENCE_ORDER, BREATH_CYCLE, BREATH_STEPS, MOODS, moodOf } from './ambience';

type Props = {
  /** Opens on the journal ("Nhật ký phản tư" in Tiện ích); `onJournalStarted` says it has. */
  startJournal?: boolean; onJournalStarted?: () => void;
  userId: number;
  ambience: Ambience;
  onAmbience: (a: Ambience) => void;
  /** The pet answers a mood check-in (its line in the room's speech bubble). */
  onPetResponse: (response: PetMoodResponse) => void;
  /** "Vuốt ve": the room's own petting interaction. */
  onPet: () => void;
  /** The pet lies down (rest pose) while a rest or breathing session runs. */
  onResting: (resting: boolean) => void;
  bottom: number;
};

/** Plays the scene's sound only after the user turned it on in this visit; pauses in the background and stops when the
 * dock goes away (leaving Healing mode, the tab or the app). */
function useAmbientSound(source: number, on: boolean, volume: number) {
  const player = useAudioPlayer(null);
  const loaded = useRef<number | null>(null);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    try {
      if (!on || !foreground) { player.pause(); return; }
      if (loaded.current !== source) { player.pause(); player.replace(source); loaded.current = source; }
      player.loop = true; player.volume = volume; player.play();
    } catch { /* no audio device: the room stays silent */ }
  }, [player, source, on, volume, foreground]);
  useEffect(() => () => { try { player.pause(); } catch { /* already released */ } }, [player]);
}

/**
 * Góc thư giãn's panel over the bottom of the room: the scene, a mood check-in the pet answers, and the relaxation
 * activities (breathing, nature sound, journal, three good things, a short rest, petting). It folds down to one row so
 * the room stays in view. Opens with the last known state even offline.
 */
export function HealingDock({ userId, ambience, onAmbience, onPetResponse, onPet, onResting, bottom, startJournal = false, onJournalStarted }: Props) {
  const toast = useToast();
  const [summary, setSummary] = useState<HealingSummary | null>(null);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(true);
  const [mood, setMood] = useState<Mood | null>(null);
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // Sound is opt-in for each visit, whatever was saved.
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [modal, setModal] = useState<'breathing' | 'rest' | 'journal' | 'gratitude' | null>(startJournal ? 'journal' : null);
  useEffect(() => { if (startJournal) onJournalStarted?.(); }, [startJournal, onJournalStarted]);
  useAmbientSound(AMBIENCES[ambience].sound, soundOn, volume);
  const soundStarted = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await healingApi.summary();
      setSummary(fresh); setOffline(false);
      setMood(fresh.mood_today?.mood ?? null);
      setVolume(fresh.ambience.volume);
      onAmbience(fresh.ambience.ambience_type);
      void healingCache.store(userId, fresh);
    } catch (e) {
      const cached = await healingCache.load(userId);
      if (cached) { setSummary((s) => s ?? cached); onAmbience(cached.ambience.ambience_type); }
      // Only a missing connection is "offline"; any other failure just keeps the room as it is.
      setOffline(e instanceof NetworkError);
    }
  }, [userId, onAmbience]);
  useEffect(() => { void load(); }, [load]);

  const savePrefs = (prefs: AmbiencePrefs) => { healingApi.saveAmbience(prefs).catch(() => { /* kept on screen; saved next time */ }); };
  const pickAmbience = (a: Ambience) => { onAmbience(a); savePrefs({ ambience_type: a, sound_enabled: soundOn, volume }); };
  const reportSound = () => {
    if (soundStarted.current) {
      const seconds = (Date.now() - soundStarted.current) / 1000;
      soundStarted.current = null;
      if (seconds >= 30) void relaxed('nature_sound', seconds);
    }
  };
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    if (next) soundStarted.current = Date.now(); else reportSound();
    savePrefs({ ambience_type: ambience, sound_enabled: next, volume });
  };
  useEffect(() => () => reportSound(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function relaxed(activity: RelaxActivity, seconds: number) {
    try {
      const result = await healingApi.relaxed(activity, seconds);
      if (result?.summary) setSummary((s) => (s ? { ...s, relaxation: result.summary } : s));
    } catch { /* a session that couldn't be reported is not worth an error over a calm moment */ }
  }

  async function checkIn(next: Mood) {
    if (checking) return;
    setChecking(true); setMood(next);
    try {
      const result = await healingApi.checkIn(next);
      onPetResponse(result.pet);
      setHint(result.pet.support_hint ?? null);
      setSummary((s) => (s ? { ...s, mood_today: result.entry, pet: result.pet } : s));
    } catch (e) {
      setMood(summary?.mood_today?.mood ?? null);
      showError('Chưa lưu được tâm trạng', e);
    } finally { setChecking(false); }
  }

  const minutesToday = Math.round((summary?.relaxation.today_seconds ?? 0) / 60);
  const a = AMBIENCES[ambience];
  return (
    <View style={[s.dock, { bottom }]} testID="healing-dock">
      <Pressable onPress={() => setOpen((o) => !o)} style={s.head} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`Góc thư giãn, ${a.label}. ${open ? 'Thu gọn' : 'Mở rộng'}`}>
        <Text style={s.headTitle}>🌿 Góc thư giãn · {a.emoji} {a.label}</Text>
        {offline ? <Ionicons name="cloud-offline-outline" size={16} color={t.muted} accessibilityLabel="Ngoại tuyến" /> : null}
        <Text style={s.headMeta}>{minutesToday ? `${minutesToday}' hôm nay` : ''}</Text>
        <Ionicons name={open ? 'chevron-down' : 'chevron-up'} size={18} color={t.muted} />
      </Pressable>
      {open ? (
        <ScrollView style={s.body} contentContainerStyle={s.bodyContent} showsVerticalScrollIndicator={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scenes}>
            {AMBIENCE_ORDER.map((id) => (
              <Pressable key={id} onPress={() => pickAmbience(id)} style={[s.scene, ambience === id && s.sceneOn]} accessibilityRole="radio"
                accessibilityState={{ selected: ambience === id }} accessibilityLabel={AMBIENCES[id].label}>
                <Text style={s.sceneEmoji}>{AMBIENCES[id].emoji}</Text>
                <Text style={[s.sceneLabel, ambience === id && s.sceneLabelOn]} numberOfLines={1}>{AMBIENCES[id].label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={s.label}>Hôm nay bạn thấy thế nào?</Text>
          <View style={s.moods}>
            {MOODS.map((m) => (
              <Pressable key={m.id} onPress={() => { void checkIn(m.id); }} disabled={checking}
                style={[s.mood, { backgroundColor: mood === m.id ? m.color : '#FFFFFF' }]} accessibilityRole="radio"
                accessibilityState={{ selected: mood === m.id, disabled: checking }} accessibilityLabel={m.label} testID={`mood-${m.id}`}>
                <Text style={s.moodEmoji}>{m.emoji}</Text>
                <Text style={s.moodLabel} numberOfLines={1}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          {hint ? <Text style={s.hint}>💛 {hint}</Text> : null}
          <View style={s.activities}>
            <Activity icon="leaf-outline" label="Hít thở" onPress={() => setModal('breathing')} />
            <Activity icon={soundOn ? 'volume-high' : 'volume-mute-outline'} label={soundOn ? a.soundLabel : 'Bật âm thanh'} active={soundOn} onPress={toggleSound} />
            <Activity icon="book-outline" label="Nhật ký" onPress={() => setModal('journal')} />
            <Activity icon="sunny-outline" label="3 điều tốt" onPress={() => setModal('gratitude')} />
            <Activity icon="bed-outline" label="Nghỉ 5–10'" onPress={() => setModal('rest')} />
            <Activity icon="heart-outline" label="Vuốt ve" onPress={() => { onPet(); void relaxed('pet', 15); }} />
          </View>
          {summary ? <Text style={s.week}>Tuần này: {summary.relaxation.calm_days} ngày thư giãn · {Math.round(summary.relaxation.week_seconds / 60)} phút</Text> : null}
        </ScrollView>
      ) : null}
      <BreathingModal visible={modal === 'breathing'} onClose={(seconds) => {
        setModal(null); onResting(false);
        if (seconds >= 20) { void relaxed('breathing', seconds); toast('Bạn đã hít thở thật đều. Giỏi lắm!', 'success'); }
      }} onStart={() => onResting(true)} />
      <RestModal visible={modal === 'rest'} onStart={() => onResting(true)} onClose={(seconds) => {
        setModal(null); onResting(false);
        if (seconds >= 30) { void relaxed('rest', seconds); toast('Nghỉ ngơi xong rồi, mình tiếp tục nhẹ nhàng nhé!', 'success'); }
      }} />
      <JournalSheet visible={modal === 'journal' || modal === 'gratitude'} gratitude={modal === 'gratitude'} mood={mood}
        onClose={() => setModal(null)} onSaved={(entry, seconds) => {
          void relaxed(entry.kind === 'gratitude' ? 'gratitude' : 'journal', seconds);
          setSummary((x) => (x ? { ...x, journal_count: x.journal_count + 1 } : x));
          toast(entry.memory_id ? 'Đã lưu nhật ký và thêm vào Album kỷ niệm!' : 'Đã lưu nhật ký riêng tư.', 'success');
        }} />
    </View>
  );
}

function Activity({ icon, label, onPress, active }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.activity, active && s.activityOn, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={active ? '#FFFFFF' : '#2F7A55'} />
      <Text style={[s.activityLabel, active && s.activityLabelOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** A session's elapsed seconds, counted while it runs. */
function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!running) { started.current = null; setSeconds(0); return; }
    started.current = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started.current!) / 1000)), 250);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

/** Guided breathing: a circle that grows as you breathe in, holds, and shrinks as you breathe out (4-4-6). With reduced
 * motion the circle stays still and the words and count guide instead. */
export function BreathingModal({ visible, onClose, onStart }: { visible: boolean; onClose: (seconds: number) => void; onStart?: () => void }) {
  const reduce = useReduceMotion();
  const [running, setRunning] = useState(false);
  const elapsed = useElapsed(running);
  const scale = useRef(new Animated.Value(0.55)).current;
  useEffect(() => { if (!visible) setRunning(false); }, [visible]);
  const inCycle = elapsed % BREATH_CYCLE;
  let at = 0;
  const stepIndex = BREATH_STEPS.findIndex((st) => { at += st.seconds; return inCycle < at; });
  const step = BREATH_STEPS[Math.max(0, stepIndex)];
  const left = at - inCycle;
  useEffect(() => {
    if (!running || reduce) return;
    const anim = Animated.timing(scale, { toValue: step.scale, duration: step.seconds * 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [running, reduce, stepIndex, step, scale]);
  const finish = () => { const seconds = elapsed; setRunning(false); scale.setValue(0.55); onClose(seconds); };
  return (
    <AppModal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={s.modalBackdrop}>
        <View style={s.modal} accessibilityViewIsModal>
          <Text style={s.modalTitle} accessibilityRole="header">Hít thở cùng pet</Text>
          <View style={s.breathArea}>
            <Animated.View style={[s.breathCircle, { transform: [{ scale: reduce ? 0.8 : scale }] }]} />
            <View style={s.breathText} accessibilityLiveRegion="polite">
              <Text style={s.breathStep}>{running ? step.label : 'Sẵn sàng'}</Text>
              {running ? <Text style={s.breathCount}>{left}</Text> : null}
            </View>
          </View>
          <Text style={s.modalNote}>{running ? `Vòng ${Math.floor(elapsed / BREATH_CYCLE) + 1} · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : 'Hít vào 4 giây, giữ 4 giây, thở ra 6 giây.'}</Text>
          {running ? <Button title="Kết thúc" variant="secondary" onPress={finish} />
            : <Button title="Bắt đầu" icon="play" onPress={() => { setRunning(true); onStart?.(); }} />}
          {!running ? <Button title="Đóng" variant="ghost" onPress={finish} /> : null}
        </View>
      </View>
    </AppModal>
  );
}

function RestModal({ visible, onClose, onStart }: { visible: boolean; onClose: (seconds: number) => void; onStart: () => void }) {
  const [length, setLength] = useState<number | null>(null);
  const elapsed = useElapsed(length !== null);
  useEffect(() => { if (!visible) setLength(null); }, [visible]);
  const left = length ? Math.max(0, length * 60 - elapsed) : 0;
  const finish = useCallback(() => { const seconds = length ? Math.min(elapsed, length * 60) : 0; setLength(null); onClose(seconds); }, [length, elapsed, onClose]);
  useEffect(() => { if (length && left === 0) finish(); }, [length, left, finish]);
  return (
    <AppModal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={s.modalBackdrop}>
        <View style={s.modal} accessibilityViewIsModal>
          <Text style={s.modalTitle} accessibilityRole="header">Nghỉ ngơi một chút</Text>
          {length ? <>
            <Text style={s.restClock} accessibilityLiveRegion="polite">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Text>
            <Text style={s.modalNote}>Đặt điện thoại xuống, thả lỏng vai. Pet nằm nghỉ cùng bạn.</Text>
            <Button title="Dừng lại" variant="secondary" onPress={finish} />
          </> : <>
            <Text style={s.modalNote}>Chọn thời gian nghỉ:</Text>
            <View style={s.restChoices}>
              {[5, 10].map((m) => <Button key={m} title={`${m} phút`} style={s.flex} onPress={() => { setLength(m); onStart(); }} />)}
            </View>
            <Button title="Đóng" variant="ghost" onPress={finish} />
          </>}
        </View>
      </View>
    </AppModal>
  );
}

/** The private journal: earlier pages and a new one (free, or "three good things"). Pages are only ever the owner's. */
function JournalSheet({ visible, gratitude, mood, onClose, onSaved }: {
  visible: boolean; gratitude: boolean; mood: Mood | null; onClose: () => void; onSaved: (entry: JournalEntry, seconds: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const confirm = useConfirm();
  const [items, setItems] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [good, setGood] = useState(['', '', '']);
  const [album, setAlbum] = useState(false);
  const [saving, setSaving] = useState(false);
  const [older, setOlder] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const opened = useRef(Date.now());
  useEffect(() => {
    if (!visible) return;
    opened.current = Date.now();
    setTitle(gratitude ? 'Ba điều tích cực hôm nay' : ''); setContent(''); setGood(['', '', '']); setAlbum(false); setError(false);
    healingApi.journal().then((r) => { setItems(r.items); setOlder(r.next_before); }).catch(() => { setItems([]); setOlder(null); setError(true); });
  }, [visible, gratitude]);
  const loadOlder = async () => {
    if (older === null) return;
    setLoadingOlder(true);
    try { const r = await healingApi.journal(older); setItems((list) => [...(list ?? []), ...r.items]); setOlder(r.next_before); }
    catch (e) { showError('Chưa tải được nhật ký', e); }
    finally { setLoadingOlder(false); }
  };
  const body = gratitude ? good.map((g, i) => (g.trim() ? `${i + 1}. ${g.trim()}` : '')).filter(Boolean).join('\n') : content.trim();
  const save = async () => {
    setSaving(true);
    try {
      const entry = await healingApi.writeJournal({ kind: gratitude ? 'gratitude' : 'free', title: title.trim() || 'Nhật ký', content: body, mood, save_to_album: album });
      setItems((list) => [entry, ...(list ?? [])]);
      onSaved(entry, (Date.now() - opened.current) / 1000);
      setContent(''); setGood(['', '', '']); if (!gratitude) setTitle('');
    } catch (e) { showError('Chưa lưu được nhật ký', e); }
    finally { setSaving(false); }
  };
  const remove = async (entry: JournalEntry) => {
    if (!(await confirm({ title: 'Xóa trang nhật ký?', message: 'Trang này sẽ bị xóa vĩnh viễn.', confirmLabel: 'Xóa', cancelLabel: 'Giữ lại', icon: 'trash-outline' }))) return;
    try { await healingApi.deleteJournal(entry.id); setItems((list) => (list ?? []).filter((x) => x.id !== entry.id)); }
    catch (e) { showError('Chưa xóa được', e); }
  };
  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <Pressable style={s.modalBackdropFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 14 }]} accessibilityViewIsModal>
          <View style={s.sheetHead}>
            <Text style={s.modalTitle} accessibilityRole="header">{gratitude ? '☀️ Ba điều tích cực' : '📔 Nhật ký riêng tư'}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng"><Ionicons name="close" size={22} color={t.muted} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetBody}>
            <Text style={s.private}><Ionicons name="lock-closed" size={12} color={t.muted} /> Chỉ mình bạn đọc được nhật ký này.</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Tiêu đề" placeholderTextColor="#7F95A8" maxLength={120} style={s.input} accessibilityLabel="Tiêu đề nhật ký" />
            {gratitude ? good.map((g, i) => (
              <TextInput key={i} value={g} onChangeText={(v) => setGood((x) => x.map((y, j) => (j === i ? v : y)))} placeholder={`Điều tốt thứ ${i + 1}…`}
                placeholderTextColor="#7F95A8" maxLength={300} style={s.input} accessibilityLabel={`Điều tốt thứ ${i + 1}`} />
            )) : (
              <TextInput value={content} onChangeText={setContent} placeholder={mood ? `Hôm nay bạn thấy ${moodOf(mood).label.toLowerCase()}. Viết vài dòng nhé…` : 'Hôm nay của bạn thế nào?'}
                placeholderTextColor="#7F95A8" maxLength={5000} multiline style={[s.input, s.multiline]} accessibilityLabel="Nội dung nhật ký" />
            )}
            <View style={s.albumRow}>
              <Text style={s.albumText}>Lưu khoảnh khắc này vào Album (chỉ tiêu đề)</Text>
              <Switch value={album} onValueChange={setAlbum} accessibilityLabel="Lưu vào Album kỷ niệm" />
            </View>
            <Button title="Lưu nhật ký" icon="save-outline" loading={saving} disabled={!body} onPress={() => { void save(); }} />
            <Text style={s.label}>Những trang trước</Text>
            {error ? <Text style={s.modalNote}>Chưa tải được nhật ký. Kiểm tra kết nối nhé.</Text>
              : items === null ? <Text style={s.modalNote}>Đang tải…</Text>
              : items.length === 0 ? <Text style={s.modalNote}>Chưa có trang nào. Trang đầu tiên đang chờ bạn!</Text>
              : items.map((entry) => (
                <View key={entry.id} style={s.page}>
                  <View style={s.pageHead}>
                    <Text style={s.pageTitle} numberOfLines={1}>{entry.mood ? `${moodOf(entry.mood).emoji} ` : ''}{entry.title}</Text>
                    <Pressable onPress={() => { void remove(entry); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Xóa ${entry.title}`}>
                      <Ionicons name="trash-outline" size={16} color={t.muted} />
                    </Pressable>
                  </View>
                  <Text style={s.pageDate}>{new Date(entry.created_at).toLocaleDateString('vi-VN')}{entry.memory_id ? ' · 📸 Trong Album' : ''}</Text>
                  <Text style={s.pageBody} numberOfLines={4}>{entry.content}</Text>
                </View>
              ))}
            {older !== null && !error ? <Button title="Xem trang nhật ký cũ hơn" variant="ghost" loading={loadingOlder} onPress={() => { void loadOlder(); }} /> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  dock: { position: 'absolute', left: 10, right: 10, borderRadius: 22, backgroundColor: 'rgba(255,252,246,0.95)',
    shadowColor: '#3B2A1A', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 46 },
  headTitle: { flex: 1, fontSize: 14, fontWeight: '900', color: t.ink },
  headMeta: { fontSize: 12, fontWeight: '700', color: t.muted },
  body: { maxHeight: 300 },
  bodyContent: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  scenes: { gap: 8 },
  scene: { width: 76, alignItems: 'center', paddingVertical: 6, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: 'transparent' },
  sceneOn: { borderColor: '#2F7A55', backgroundColor: '#E8F6EC' },
  sceneEmoji: { fontSize: 22 },
  sceneLabel: { fontSize: 11, fontWeight: '700', color: t.muted },
  sceneLabelOn: { color: '#22603F', fontWeight: '900' },
  label: { fontSize: 13, fontWeight: '900', color: t.ink, marginTop: 2 },
  moods: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  mood: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 6, minHeight: 56 },
  moodEmoji: { fontSize: 22 },
  moodLabel: { fontSize: 10, fontWeight: '700', color: t.ink },
  hint: { fontSize: 12, color: '#7A4D00', fontWeight: '700', backgroundColor: '#FFF4CC', borderRadius: 10, padding: 8 },
  activities: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activity: { width: '31.5%', alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: 14, backgroundColor: '#E8F6EC', minHeight: 52 },
  activityOn: { backgroundColor: '#2F7A55' },
  activityLabel: { fontSize: 11, fontWeight: '800', color: '#22603F' },
  activityLabelOn: { color: '#FFFFFF' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  week: { fontSize: 11, color: t.muted, fontWeight: '700', textAlign: 'center' },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(10,30,40,0.5)' },
  modalBackdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,30,40,0.45)' },
  modal: { width: '100%', maxWidth: 360, backgroundColor: '#FFFCF6', borderRadius: 26, padding: 22, gap: 8, alignItems: 'stretch' },
  modalTitle: { fontSize: 19, fontWeight: '900', color: t.ink },
  modalNote: { fontSize: 14, color: t.muted, textAlign: 'center' },
  breathArea: { height: 220, alignItems: 'center', justifyContent: 'center' },
  breathCircle: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: '#BFE8D2' },
  breathText: { alignItems: 'center' },
  breathStep: { fontSize: 22, fontWeight: '900', color: '#22603F' },
  breathCount: { fontSize: 34, fontWeight: '900', color: '#22603F', fontVariant: ['tabular-nums'] },
  restClock: { fontSize: 48, fontWeight: '900', color: t.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  restChoices: { flexDirection: 'row', gap: 10 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: '#FFFCF6', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  sheetBody: { padding: 20, gap: 10 },
  private: { fontSize: 12, color: t.muted, fontWeight: '700' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.5, borderColor: '#EADBC2', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  albumText: { flex: 1, fontSize: 13, color: t.ink, fontWeight: '700' },
  page: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, gap: 2 },
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: t.ink },
  pageDate: { fontSize: 11, color: t.muted, fontWeight: '700' },
  pageBody: { fontSize: 14, color: t.ink, lineHeight: 20 },
});
