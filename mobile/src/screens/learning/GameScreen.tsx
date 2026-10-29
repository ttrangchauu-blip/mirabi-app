import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, KeyboardAvoidingView, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { newIdempotencyKey } from '../../api/client';
import { useViewportSize } from '../../components/MobileViewport';
import { Text } from '../../components/Typography';
import { learningApi, TurnAction } from '../../learning/api';
import { ERROR_TYPE_LABEL, formatClock, GAME_INFO, POS_LABEL } from '../../learning/labels';
import { LearningPrefs, speakEnglish } from '../../learning/prefs';
import type { Intro, LearningSession, Turn, TurnResult } from '../../learning/types';
import { useGameAssets } from '../../learning/useGameAssets';
import { useGameClock } from '../../learning/useGameClock';
import { answerKey } from '../../learning/answerKey';
import { useLearningSession } from '../../learning/useLearningSession';
import { appTheme as t } from '../../theme';
import { Button, IconName, SoftInput } from '../../ui/kit';
import { useConfirm } from '../../ui/ConfirmDialog';
import { useToast } from '../../ui/Toast';
import { GateChoice, MathBridge, WordBridge } from './games/ChoiceGames';
import { NumberPad, showNumber } from './games/NumberPad';
import { Burst, Flash, Playfield, Shot } from './games/Playfield';
import { GameTutorial } from './GameTutorial';
import { IntroContent } from './LessonIntro';

type Props = {
  initial: LearningSession;
  /** Start with the countdown (coming from the lesson); otherwise a paused session waits for "Tiếp tục". */
  autoStart?: boolean;
  petId: string;
  petLevel: number;
  prefs: LearningPrefs;
  /** The session ended (completed, failed, abandoned, or ended on another device). */
  onEnded: (session: LearningSession) => void;
  /** Studying together: the moment the room starts the game (ms, this device's clock); the countdown follows it. */
  startsAt?: number | null;
};

const MOVING = new Set(['vocab_typing', 'word_spelling', 'math_input']);
/** Falling words answered by typing (Việt → Anh, Anh → Việt): the answer boxes ride on the aimed word. */
const TYPED = new Set(['vocab_typing', 'word_spelling']);
const MISSED: Record<string, string> = { vocab_typing: 'Thiên thạch chạm đất', word_spelling: 'Từ chạm đất', math_input: 'Quái vật tới căn cứ' };
const WAITING_POSITION = 0.3; // turns that are not moving targets
// Học tập: meteors and monsters drift in slowly, then stop short of the ground/base and wait (never a miss).
const PRACTICE_APPROACH_MS = 30000;
const PRACTICE_STOP = 0.8;
const NEXT_TARGET_AT = 0.45; // Thử thách: a second target appears when the first is this far along
const EXTEND_MINUTES = 5;
/** Falling words: every box filled but not a right answer, then a pause this long (still typing a longer equivalent?):
 * it is sent and counts as a wrong answer, as before. A right answer is sent as soon as it is typed. */
const WRONG_AFTER_MS = 700;

type Notice = { text: string; tone: 'good' | 'bad' | 'info' } | null;

export function GameScreen({ initial, autoStart = false, petId, petLevel, prefs, onEnded, startsAt = null }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const notify = useCallback((message: string, tone: 'info' | 'error' = 'info') => toast(message, tone), [toast]);
  // The countdown waits for the pictures the game starts with, so it never counts over an empty field.
  const assetsReady = useGameAssets(petId, petLevel);
  const ctl = useLearningSession(initial, notify, autoStart, { ready: assetsReady, startsAt });
  const { session } = ctl;
  const [feedback, setFeedback] = useState<TurnResult | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  // Falling words answered right, held where they were until the pet's shot breaks them; and a wrong answer's shake.
  const [shots, setShots] = useState<Shot[]>([]);
  const [wrongKey, setWrongKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [scratch, setScratch] = useState('');
  const [intro, setIntro] = useState<Intro | 'loading' | null>(null);
  const [howTo, setHowTo] = useState(false); // "Cách chơi" read again from the pause menu
  const clock = useGameClock(ctl.running && !feedback && !intro, prefs.reduceMotion);
  const spawnedAt = useRef(new Map<string, number>());
  const missSent = useRef(new Set<string>());
  const nextAsked = useRef(new Set<string>());
  const completing = useRef(false);
  const endedSent = useRef(false);
  const sync = useRef({ remaining: session.remaining_ms, clock: 0 });
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const offlineRef = useRef(ctl.offline);
  offlineRef.current = ctl.offline;

  const challenge = session.mode === 'challenge';
  const moving = session.game_type === 'meteor' || session.game_type === 'defense';
  const open = session.open_turns;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  // A target first seen after reopening the game continues from where it was, not from the top.
  for (const turn of open) if (!spawnedAt.current.has(turn.turn_id)) spawnedAt.current.set(turn.turn_id, clock - (turn.on_screen_ms ?? 0));
  /** 0 = just appeared, 1 = reached the ground/base, at the current game clock. */
  const progressAt = useCallback((turn: Turn) => {
    if (!MOVING.has(turn.kind)) return WAITING_POSITION;
    const now = clockRef.current;
    const elapsed = now - (spawnedAt.current.get(turn.turn_id) ?? now);
    if (challenge && turn.travel_seconds > 0) return elapsed / (turn.travel_seconds * 1000);
    return Math.min(PRACTICE_STOP, (elapsed / PRACTICE_APPROACH_MS) * PRACTICE_STOP);
  }, [challenge]);
  const progress = progressAt;
  // Default target: the one closest to the ground/base. The user can tap another.
  const nearest = [...open].sort((a, b) => progress(b) - progress(a))[0];
  const turn = open.find((x) => x.turn_id === selectedId) ?? nearest;

  useEffect(() => { sync.current = { remaining: session.remaining_ms, clock }; }, [session.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const remaining = Math.max(0, sync.current.remaining - (clock - sync.current.clock));

  // Back (Android or the arrow in the HUD) pauses the game and asks: continue learning or end the session.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { ctl.pause(); return true; });
    return () => sub.remove();
  }, [ctl.pause]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(timer);
  }, [notice]);

  // A word's meaning (or English word) shown where it broke. It fades on the play field's effect clock (it stops while
  // paused) and never blocks typing or the next shot; the play field says when it is gone.
  const burstSeq = useRef(0);
  const addBurst = useCallback((burst: Omit<Burst, 'id'>) => {
    const id = `${burst.position}-${++burstSeq.current}`;
    setBursts((list) => [...list, { ...burst, id }]);
  }, []);
  const dropBurst = useCallback((id: string) => setBursts((list) => list.filter((b) => b.id !== id)), []);
  const dropShot = useCallback((id: string) => setShots((list) => list.filter((s) => s.id !== id)), []);
  // The bullet reached the word: it breaks there and shows its meaning (Anh → Việt) or the pair to remember (Việt → Anh).
  // Stable (the sound setting is read when it happens), so the shooter does not re-render with every game tick.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onImpact = useCallback((shot: Shot) => {
    const w = shot.word;
    if (!w) return;
    addBurst(shot.turn.kind === 'word_spelling'
      ? { position: shot.turn.position, progress: shot.progress, title: w.vi, sub: [w.en, w.phonetic].filter(Boolean).join(' '), tone: 'hit' }
      : { position: shot.turn.position, progress: shot.progress, title: `${w.en} — ${w.vi}`, sub: w.phonetic, tone: 'hit' });
    speakEnglish(w.en, prefsRef.current);
  }, [addBurst]);

  const onResult = useCallback((response: { result: TurnResult | null }, aimed: Turn, targets: Turn[]) => {
    const r = response.result;
    if (!r) return;
    // A typed shot hits whichever falling word it matches (the backend says which), not always the aimed one.
    const target = targets.find((x) => x.turn_id === r.turn_id) ?? aimed;
    const hearts = r.hearts_delta < 0 ? ' · −1 tim' : '';
    const word = r.word ?? null;
    if (r.event === 'hint') {
      return; // shown in the question card
    } else if (r.correct) {
      setDraft('');
      const points = r.score_delta ? ` +${r.score_delta}` : '';
      setNotice({ text: `Chính xác!${points}${r.combo > 1 ? ` · Combo x${r.combo}` : ''}`, tone: 'good' });
      if (TYPED.has(target.kind)) {
        // Shoot → hit → break → meaning: the word is not removed at once. It stays where it was (no longer falling, the
        // backend has resolved it: it can never be missed or counted again) until the pet's bullet breaks it.
        const shot: Shot = { id: target.turn_id, turn: target, progress: Math.min(1, progressAt(target)), aimed: target.turn_id === aimed.turn_id,
          word: word ?? (r.correct_answer ? { en: r.correct_answer, vi: '', phonetic: null } : null) };
        setShots((list) => (list.some((s) => s.id === shot.id) ? list : [...list, shot]));
      } else setFlash({ turnId: target.turn_id, kind: 'hit' });
    } else if (r.event === 'answer' && r.retry_allowed) {
      setNotice({ text: `Chưa đúng, sửa lại nhé!${hearts}`, tone: 'bad' });
      setWrongKey((k) => k + 1); // no shot: the pet shakes a little, the word keeps falling
    } else if (r.event === 'miss') {
      // A missed word shows its English–Vietnamese pair, to review it.
      const pair = word ? `${word.en} — ${word.vi}` : `Đáp án: ${r.correct_answer}`;
      setNotice({ text: `${MISSED[target.kind] ?? 'Bỏ lỡ'}! ${pair}${hearts}`, tone: 'bad' });
      if (word) addBurst({ position: target.position, progress: 1, title: word.en, sub: word.vi, tone: 'miss' });
    } else {
      setDraft('');
      setFeedback(r); // wrong choice or "Xem đáp án": read the answer and explanation, then "Tiếp tục"
    }
  }, [addBurst, progressAt]);

  const act = useCallback((action: TurnAction, target: Turn, targets: Turn[] = [target]) =>
    ctl.run(() => learningApi.turn(session.id, action), (res) => onResult(res, target, targets)), [ctl, onResult, session.id]);
  const submit = (target: Turn, answer: string | string[]) => {
    if (typeof answer === 'string' && !answer.trim()) return; // empty input is never sent, never counted as wrong
    void act({ type: 'answer', turnId: target.turn_id, answer, eventId: newIdempotencyKey() }, target, open);
  };
  const hint = (target: Turn) => void act({ type: 'hint', turnId: target.turn_id, eventId: newIdempotencyKey() }, target);
  const reveal = (target: Turn) => void act({ type: 'reveal', turnId: target.turn_id, eventId: newIdempotencyKey() }, target);

  // A moving target that reached the ground/base: report it once (the backend checks it and takes the heart).
  useEffect(() => {
    if (!moving || !challenge || !ctl.running || ctl.busy || feedback) return;
    const arrived = open.find((x) => progress(x) >= 1 && !missSent.current.has(x.turn_id));
    if (!arrived) return;
    missSent.current.add(arrived.turn_id);
    void act({ type: 'miss', turnId: arrived.turn_id, eventId: newIdempotencyKey() }, arrived).then((res) => {
      if (!res && !offlineRef.current) setTimeout(() => missSent.current.delete(arrived.turn_id), 2000);
    });
  }); // runs every clock tick

  // Thử thách: bring in a second target once the first one is on its way.
  useEffect(() => {
    if (!moving || !challenge || !ctl.running || ctl.busy || feedback || session.time_up || open.length !== 1) return;
    const only = open[0];
    if (progress(only) >= NEXT_TARGET_AT && !nextAsked.current.has(only.turn_id)) {
      nextAsked.current.add(only.turn_id);
      void ctl.run(() => learningApi.next(session.id, 1));
    }
  });

  // Every turn done: finish the stage. The reward shown afterwards is whatever the backend confirms.
  useEffect(() => {
    if (!session.can_complete || completing.current || ctl.busy || feedback || ctl.offline) return;
    completing.current = true;
    void ctl.control(() => learningApi.complete(session.id)).then((res) => { if (!res) completing.current = false; });
  }, [session.can_complete, ctl, feedback]);

  // Show the result once the session has ended (after the last explanation is closed). The short delay lets the last
  // notice be seen; it must not be cancelled by the re-renders that keep happening meanwhile.
  useEffect(() => {
    if (endedSent.current || feedback) return;
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'abandoned') {
      endedSent.current = true;
      const ended = session;
      setTimeout(() => onEndedRef.current(ended), ended.status === 'failed' ? 900 : 300);
    }
  }, [session, feedback]);

  const openIntro = async () => {
    setIntro('loading');
    try { setIntro(await learningApi.intro(session.id)); } catch { setIntro(null); toast('Chưa tải được phần kiến thức.', 'error'); }
  };
  const endEarly = async () => {
    const ok = await confirm({ title: 'Kết thúc phiên này?', message: 'Tiến độ đã làm vẫn được lưu, nhưng phiên chưa hoàn thành sẽ không nhận thưởng.',
      confirmLabel: 'Kết thúc', cancelLabel: 'Chơi tiếp', icon: 'flag-outline', destructive: true });
    if (ok) void ctl.control(() => learningApi.abandon(session.id, 'user_ended'));
  };

  // The pet, its bullets and the effects stop together with the falling words.
  const fxRunning = ctl.running && !feedback && !intro && !ctl.offline;

  const timeUp = session.time_up && open.length === 0 && !session.can_complete && session.status === 'active' && !feedback;
  const disabled = ctl.busy || !ctl.running;
  const counting = ctl.countdown !== null;

  // Falling words shoot by themselves: no "Bắn", no Enter. A typed text that is right for any falling word (its key is
  // one of the keys the backend sent) is sent at once; the backend checks it and says which word it hit. Every box
  // filled but not right is sent after a short pause and counts as wrong (the penalty is unchanged). The same text is
  // never sent twice, so a wrong answer waits for a change.
  const autoSent = useRef<string | null>(null);
  const aimedTyped = !counting && turn && TYPED.has(turn.kind) ? turn : undefined;
  useEffect(() => {
    if (!aimedTyped || !draft.trim() || ctl.busy || !ctl.running || ctl.offline) return;
    const key = `${aimedTyped.turn_id}|${draft}`;
    if (autoSent.current === key) return;
    const typed = open.filter((x) => TYPED.has(x.kind));
    const send = () => { autoSent.current = key; submit(aimedTyped, draft); };
    if (typed.some((x) => x.prompt.answer_keys?.includes(answerKey(x.turn_id, draft)))) { send(); return; }
    const total = aimedTyped.prompt.letters?.reduce((a, b) => a + b, 0) ?? 0;
    if (!total || draft.replace(/\s+/g, '').length < total) return;
    // Without keys (an older backend) nothing can be known here: every box filled is sent at once, as Enter did.
    const timer = setTimeout(send, typed.some((x) => x.prompt.answer_keys) ? WRONG_AFTER_MS : 0);
    return () => clearTimeout(timer);
  }, [draft, aimedTyped?.turn_id, ctl.busy, ctl.running, ctl.offline, open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing of the first question shows (or can be answered) before "Bắt đầu!".
  const shown = counting ? undefined : turn;
  const info = GAME_INFO[session.game];
  // Falling words: the question card above the field and the help row under it keep their place and their height while
  // words come and go (no word for a moment, a hint, a notice), so the field never moves and no word jumps on screen.
  const falling = session.game_type === 'meteor';
  const playfield = (
    <Playfield variant={session.game === 'word_shooter' ? 'words' : session.game_type as 'meteor' | 'defense'} turns={counting ? [] : open} progress={progress}
      selectedId={shown?.turn_id ?? null} onSelect={setSelectedId} petId={petId} petLevel={petLevel} reduceMotion={prefs.reduceMotion}
      flash={flash} bursts={bursts} running={fxRunning} shots={shots} onImpact={onImpact} onShotDone={dropShot} onBurstDone={dropBurst}
      wrongKey={wrongKey} sound={prefs.sound}
      answer={session.game_type === 'meteor' && !counting ? { value: draft, onChange: setDraft, editable: !ctl.offline } : undefined} />
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Hud session={session} remaining={remaining} prefs={prefs} onPause={ctl.pause} />
      {ctl.offline ? (
        <View style={styles.offline} accessibilityRole="alert">
          <Ionicons name="cloud-offline-outline" size={20} color={t.danger} />
          <Text style={styles.offlineText}>Mất kết nối. Trò chơi tạm dừng, đáp án bạn đang nhập vẫn được giữ. Đang thử lại…</Text>
          <Pressable onPress={() => void ctl.retry()} accessibilityRole="button" accessibilityLabel="Thử lại kết nối" style={styles.retry}>
            <Text style={styles.retryText}>Thử lại</Text>
          </Pressable>
        </View>
      ) : null}
      {falling ? (
        <Steady testID="game-prompt-area">{shown ? <PromptCard turn={shown} game={info.name} notice={notice} /> : <PromptBlank />}</Steady>
      ) : shown ? <PromptCard turn={shown} game={info.name} notice={notice} /> : (
        <View style={styles.waiting}>{counting ? null : ctl.busy ? <ActivityIndicator color={t.accent} /> : <Text style={styles.muted}>Chuẩn bị lượt tiếp theo…</Text>}</View>
      )}
      <View style={styles.playWrap}>
      {notice && !(shown && TYPED.has(shown.kind)) ? (
        <View style={styles.noticeLayer} pointerEvents="none">
          <Text style={[styles.notice, styles[notice.tone]]} accessibilityLiveRegion="polite">{notice.text}</Text>
        </View>
      ) : null}
      {session.game_type === 'meteor' ? (
        // The falling words are not in a scroll view: nothing can scroll them away (on the web focusing the answer field
        // would otherwise move them).
        <View style={[styles.fill, styles.playArea]}>{playfield}</View>
      ) : (
      <ScrollView style={styles.fill} contentContainerStyle={styles.playArea} keyboardShouldPersistTaps="handled" scrollEnabled={!moving}>
        {moving ? playfield : null}
        {shown && shown.kind === 'gate_choice' ? <GateChoice turn={shown} onChoose={(id) => submit(shown, id)} disabled={disabled} petId={petId} petLevel={petLevel} reduceMotion={prefs.reduceMotion} /> : null}
        {shown && shown.kind === 'bridge_order' ? <WordBridge key={shown.turn_id} turn={shown} onSubmit={(ids) => submit(shown, ids)} disabled={disabled} petId={petId} petLevel={petLevel} reduceMotion={prefs.reduceMotion} /> : null}
        {shown && (shown.kind === 'missing_number' || shown.kind === 'compare') ? (
          <MathBridge turn={shown} built={session.resolved_count} total={session.required_count} draft={draft} setDraft={setDraft}
            onSubmit={(a) => submit(shown, a)} disabled={disabled} />
        ) : null}
        {session.subject.code === 'math' ? (
          <View style={styles.scratch}>
            <Pressable onPress={() => setScratchOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: scratchOpen }}
              accessibilityLabel="Khu vực nháp" style={styles.scratchToggle}>
              <Ionicons name="create-outline" size={16} color={t.accent} />
              <Text style={styles.scratchLabel}>{scratchOpen ? 'Thu gọn nháp' : 'Nháp'}</Text>
            </Pressable>
            {scratchOpen ? <SoftInput value={scratch} onChangeText={setScratch} multiline placeholder="Ghi các bước tính ở đây (không gửi đi)" accessibilityLabel="Nội dung nháp" /> : null}
          </View>
        ) : null}
      </ScrollView>
      )}
      </View>
      {falling ? (
        <Steady testID="game-help-area">
          <View style={styles.inputArea}>
            <View style={styles.helpRow}>
              <Pressable onPress={() => { if (shown) hint(shown); }} disabled={!shown || disabled || shown.hints_shown.length >= shown.hints_total}
                accessibilityRole="button" accessibilityLabel={shown ? `Gợi ý, đã dùng ${shown.hints_shown.length} trên ${shown.hints_total}` : 'Gợi ý'}
                style={[styles.help, (!shown || disabled || shown.hints_shown.length >= shown.hints_total) && styles.dimmed]}>
                <Ionicons name="bulb-outline" size={16} color={t.accent} />
                <Text style={styles.helpText}>{shown ? `Gợi ý ${shown.hints_shown.length}/${shown.hints_total}` : 'Gợi ý'}</Text>
              </Pressable>
              {shown?.kind !== 'word_spelling' ? ( // Anh → Việt: the word to type is already on screen
                <Pressable onPress={() => { if (shown) reveal(shown); }} disabled={!shown || disabled} accessibilityRole="button" accessibilityLabel="Xem đáp án"
                  style={[styles.help, (!shown || disabled) && styles.dimmed]}>
                  <Ionicons name="eye-outline" size={16} color={t.accent} />
                  <Text style={styles.helpText}>Xem đáp án</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Steady>
      ) : shown ? (
        <View style={styles.inputArea}>
          {shown.kind === 'math_input' ? (
            <NumberPad value={draft} onChange={setDraft} onSubmit={() => submit(shown, draft)} allowNegative={!!shown.prompt.allow_negative}
              disabled={disabled} submitLabel="Tấn công" />
          ) : null}
          <View style={styles.helpRow}>
            <Pressable onPress={() => hint(shown)} disabled={disabled || shown.hints_shown.length >= shown.hints_total} accessibilityRole="button"
              accessibilityLabel={`Gợi ý, đã dùng ${shown.hints_shown.length} trên ${shown.hints_total}`}
              style={[styles.help, (disabled || shown.hints_shown.length >= shown.hints_total) && styles.dimmed]}>
              <Ionicons name="bulb-outline" size={16} color={t.accent} />
              <Text style={styles.helpText}>Gợi ý {shown.hints_shown.length}/{shown.hints_total}</Text>
            </Pressable>
            {shown.kind !== 'word_spelling' ? ( // Anh → Việt: the word to type is already on screen
              <Pressable onPress={() => reveal(shown)} disabled={disabled} accessibilityRole="button" accessibilityLabel="Xem đáp án"
                style={[styles.help, disabled && styles.dimmed]}>
                <Ionicons name="eye-outline" size={16} color={t.accent} />
                <Text style={styles.helpText}>Xem đáp án</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {feedback ? <FeedbackCard result={feedback} onContinue={() => setFeedback(null)} /> : null}
      {timeUp ? (
        <Overlay title="Hết thời lượng phiên" icon="alarm-outline"
          message="Bạn đã học đủ thời gian đã chọn. Hết giờ không phải là thua: kết thúc ở đây, hoặc học thêm để hoàn thành chặng.">
          <Button title={`Học thêm ${EXTEND_MINUTES} phút`} icon="add-circle-outline" loading={ctl.busy}
            onPress={() => { const eventId = newIdempotencyKey(); void ctl.control(() => learningApi.extend(session.id, EXTEND_MINUTES, eventId)); }} />
          <Button title="Kết thúc" variant="secondary" onPress={() => void ctl.control(() => learningApi.abandon(session.id, 'time_up'))} />
        </Overlay>
      ) : null}
      {counting && !ctl.offline ? <Countdown value={ctl.countdown!} preparing={ctl.preparing} reduceMotion={prefs.reduceMotion} /> : null}
      {ctl.paused && ctl.countdown === null && !ctl.offline && session.status !== 'completed' ? (
        <Overlay title="Tạm dừng" icon="pause-circle-outline" message="Đồng hồ, mục tiêu và thời gian câu hỏi đều đã dừng lại.">
          <Button title="Tiếp tục học" icon="play" onPress={ctl.resume} />
          <View style={styles.toggles}>
            <Toggle label="Âm thanh" icon={prefs.sound ? 'volume-high-outline' : 'volume-mute-outline'} value={prefs.sound} onChange={prefs.setSound} />
            <Toggle label="Giảm chuyển động" icon="walk-outline" value={prefs.reduceMotion} onChange={prefs.setReduceMotion} />
          </View>
          <View style={styles.toggles}>
            <Button title="Cách chơi" variant="secondary" icon="help-circle-outline" style={styles.flex} onPress={() => setHowTo(true)} />
            <Button title="Kiến thức" variant="secondary" icon="book-outline" style={styles.flex} onPress={() => void openIntro()} />
          </View>
          <Button title="Kết thúc phiên" variant="danger" icon="flag-outline" onPress={() => void endEarly()} />
        </Overlay>
      ) : null}
      {intro ? (
        <View style={styles.overlay}>
          <View style={[styles.sheet, styles.introSheet]}>
            {intro === 'loading' ? <ActivityIndicator color={t.accent} /> : (
              <ScrollView><IntroContent intro={intro} prefs={prefs} /></ScrollView>
            )}
            <Button title="Đóng" variant="secondary" onPress={() => setIntro(null)} />
          </View>
        </View>
      ) : null}
      {howTo ? (
        <View style={styles.overlay}>
          <View style={[styles.sheet, styles.introSheet]}>
            <ScrollView>
              <GameTutorial game={session.game} petId={petId} petLevel={petLevel} reduceMotion={prefs.reduceMotion} finishLabel="Đã hiểu"
                onFinish={() => setHowTo(false)} onClose={() => setHowTo(false)} />
            </ScrollView>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** "3 → 2 → 1 → Bắt đầu!", big in the middle, over a screen dark enough that the first question is not read early. */
function Countdown({ value, preparing, reduceMotion }: { value: number; preparing: boolean; reduceMotion: boolean }) {
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion || preparing) { pop.setValue(1); return; }
    pop.setValue(0.6);
    const animation = Animated.timing(pop, { toValue: 1, duration: 320, easing: Easing.out(Easing.back(2)), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [value, preparing, reduceMotion, pop]);
  const waiting = preparing || value > 3; // pictures still loading, or the room starts a little later
  const label = waiting ? 'Đang chuẩn bị…' : value === 0 ? 'Bắt đầu!' : String(value);
  return (
    <View style={[styles.overlay, styles.countdownLayer]} accessibilityRole="alert" accessibilityLiveRegion="assertive"
      accessibilityLabel={waiting ? 'Đang chuẩn bị trò chơi' : value === 0 ? 'Bắt đầu!' : `Bắt đầu sau ${value}`}>
      {waiting ? <ActivityIndicator color="#FFFFFF" size="large" /> : null}
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Text style={[styles.countdown, (waiting || value === 0) && styles.countdownWord]}>{label}</Text>
      </Animated.View>
      {waiting ? null : <Text style={styles.countdownHint}>Sẵn sàng nhé!</Text>}
    </View>
  );
}

function Hud({ session, remaining, prefs, onPause }: { session: LearningSession; remaining: number; prefs: LearningPrefs; onPause: () => void }) {
  const challenge = session.mode === 'challenge';
  const { width } = useViewportSize();
  // Thử thách adds hearts and score: on a narrow phone the row only keeps "Tạm dừng" (the back arrow does the same:
  // it pauses and asks to continue or end), and the clock drops its icon, so nothing is pushed off screen.
  const crowded = challenge && session.hearts_max > 0 && width < 400;
  return (
    <View style={styles.hud}>
      {crowded ? null : (
        <Pressable onPress={onPause} accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8} style={styles.hudButton}>
          <Ionicons name="chevron-back" size={20} color={t.accent} />
        </Pressable>
      )}
      <Pressable onPress={onPause} accessibilityRole="button" accessibilityLabel="Tạm dừng" hitSlop={8} style={styles.hudButton}>
        <Ionicons name="pause" size={20} color={t.accent} />
      </Pressable>
      <Text style={styles.hudText} accessibilityLabel={`Thời gian còn lại ${formatClock(remaining)}`}>
        {crowded && width < 360 ? '' : '⏱ '}{formatClock(remaining)}
      </Text>
      <Text style={styles.hudText} accessibilityLabel={`Đã xong ${session.resolved_count} trên ${session.required_count} lượt`}>
        {session.resolved_count}/{session.required_count}
      </Text>
      {session.hearts_max > 0 ? (
        <Text style={styles.hearts} accessibilityLabel={`Còn ${session.hearts} tim`}>
          {'♥'.repeat(session.hearts)}<Text style={styles.heartLost}>{'♥'.repeat(Math.max(0, session.hearts_max - session.hearts))}</Text>
        </Text>
      ) : null}
      {challenge ? (
        <Text style={styles.hudText} accessibilityLabel={`Điểm ${session.score}, combo ${session.combo}`}>⭐ {session.score}{session.combo > 1 ? ` x${session.combo}` : ''}</Text>
      ) : null}
      <View style={styles.flex} />
      <Pressable onPress={() => prefs.setSound(!prefs.sound)} accessibilityRole="switch" accessibilityState={{ checked: prefs.sound }}
        accessibilityLabel="Âm thanh" hitSlop={8} style={styles.hudButton}>
        <Ionicons name={prefs.sound ? 'volume-high-outline' : 'volume-mute-outline'} size={20} color={t.accent} />
      </Pressable>
    </View>
  );
}

/** Never shorter than it has been: what it holds can change (or be gone for a moment) without moving what is under it. */
function Steady({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const [height, setHeight] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setHeight((was) => Math.max(was, h));
  };
  return <View testID={testID} onLayout={onLayout} style={{ minHeight: height }}>{children}</View>;
}

/** The falling words' card while no word is falling (before "Bắt đầu!", or the next word is on its way): the same size. */
function PromptBlank() {
  return (
    <View style={[styles.prompt, styles.promptCompact]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.promptHead}>
        <Text style={[styles.promptChip, styles.promptBlank]}> </Text>
        <Text style={styles.promptInline}> </Text>
      </View>
      <Text style={styles.promptSub}> </Text>
    </View>
  );
}

function PromptCard({ turn, game, notice }: { turn: Turn; game: string; notice?: Notice }) {
  const p = turn.prompt;
  let main = '';
  let sub: string | null = null;
  if (turn.kind === 'vocab_typing') {
    main = p.meaning_vi ?? '';
    sub = p.context_vi ? `Ngữ cảnh: ${p.context_vi}` : 'Gõ từ tiếng Anh: đúng là pet tự bắn';
  }
  else if (turn.kind === 'word_spelling') { main = p.word ?? ''; sub = 'Gõ lại đúng từ này: đúng là pet tự bắn'; }
  else if (turn.kind === 'gate_choice') {
    main = p.sentence ?? '';
    sub = p.context_vi ? `Tình huống: ${p.context_vi}` : 'Chọn đáp án đúng để điền vào chỗ trống';
  }
  else if (turn.kind === 'bridge_order') {
    main = p.meaning_vi ?? '';
    sub = p.context_vi ? `Tình huống: ${p.context_vi} · Xếp các mảnh thành câu tiếng Anh` : 'Xếp các mảnh thành câu tiếng Anh có nghĩa như trên';
  }
  else if (turn.kind === 'math_input') { main = `${p.expression} = ?`; }
  else if (turn.kind === 'missing_number') { main = (p.equation ?? '').replace('__', '▢'); sub = 'Tìm số còn thiếu'; }
  else { main = `${p.left}  ▢  ${p.right}`; sub = 'Chọn dấu >, < hoặc ='; }
  // Falling words already carry the word on screen: one compact line leaves the room to the play field.
  const compact = TYPED.has(turn.kind);
  return (
    <View style={[styles.prompt, compact && styles.promptCompact]} accessible accessibilityLabel={`${game}. ${main}. ${sub ?? ''}`}>
      <View style={styles.promptHead}>
        <Text style={styles.promptChip}>
          {turn.practice ? 'Luyện lại · ' : ''}{turn.skill_label}{p.part_of_speech && POS_LABEL[p.part_of_speech] ? ` · ${POS_LABEL[p.part_of_speech]}` : ''}
        </Text>
        {compact ? <Text style={styles.promptInline} numberOfLines={1}>{main}</Text> : null}
        {p.level ? <Text style={styles.promptLevel}>{p.level}</Text> : null}
      </View>
      {compact ? null : <Text style={styles.promptMain}>{main}</Text>}
      {/* Falling words: one line under the word, at most two. "Chính xác!" / "Chưa đúng" takes it for a moment, the hints
          take the instruction's place: the card keeps its height and the field under it never moves. */}
      {compact ? (notice ? (
        <Text style={[styles.promptSub, styles.promptNotice, notice.tone === 'good' ? styles.noticeGood : notice.tone === 'bad' ? styles.noticeBad : null]}
          numberOfLines={2} accessibilityLiveRegion="polite">{notice.text}</Text>
      ) : turn.hints_shown.length ? (
        <Text style={[styles.promptSub, styles.hintInline]} numberOfLines={2}>💡 {turn.hints_shown.join(' · ')}</Text>
      ) : sub ? <Text style={styles.promptSub} numberOfLines={2}>{sub}</Text> : null) : sub ? <Text style={styles.promptSub}>{sub}</Text> : null}
      {compact ? null : turn.hints_shown.map((h, i) => (
        <View key={i} style={styles.hintRow}>
          <Ionicons name="bulb" size={14} color="#E9A23B" />
          <Text style={styles.hint}>{h}</Text>
        </View>
      ))}
    </View>
  );
}

function FeedbackCard({ result, onContinue }: { result: TurnResult; onContinue: () => void }) {
  const revealed = result.outcome === 'revealed';
  const answer = result.correct_answer ? showNumber(result.correct_answer) : '';
  return (
    <View style={styles.overlay}>
      <View style={styles.sheet} accessibilityRole="alert">
        <Text style={styles.sheetTitle}>{revealed ? 'Đáp án' : 'Chưa đúng rồi'}{result.hearts_delta < 0 ? ' · −1 tim' : ''}</Text>
        <Text style={styles.answerLabel}>Đáp án đúng</Text>
        <Text style={styles.answer}>{answer}</Text>
        {result.explanation ? <Text style={styles.explanation}>{result.explanation}</Text> : null}
        {result.error_type && ERROR_TYPE_LABEL[result.error_type] ? <Text style={styles.errorType}>Lỗi thường gặp: {ERROR_TYPE_LABEL[result.error_type]}</Text> : null}
        {result.practice_added ? <Text style={styles.muted}>Câu này sẽ quay lại để bạn luyện thêm một lần.</Text> : null}
        <Button title="Tiếp tục" icon="arrow-forward" onPress={onContinue} />
      </View>
    </View>
  );
}

function Overlay({ title, icon, message, children }: { title: string; icon: IconName; message: string; children: React.ReactNode }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.sheet} accessibilityRole="alert">
        <Ionicons name={icon} size={34} color={t.accent} style={styles.center} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <Text style={styles.muted}>{message}</Text>
        {children}
      </View>
    </View>
  );
}

function Toggle({ label, icon, value, onChange }: { label: string; icon: IconName; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}
      style={[styles.toggle, value && styles.toggleOn]}>
      <Ionicons name={icon} size={18} color={value ? '#FFFFFF' : t.accent} />
      <Text style={[styles.toggleText, value && styles.toggleTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  center: { alignSelf: 'center' },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20 },
  hud: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  hudButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  // Never wrapped or squeezed: with hearts and score (Thử thách) the row is full on a phone.
  hudText: { fontSize: 15, fontWeight: '900', color: t.ink, flexShrink: 0 },
  hearts: { fontSize: 18, color: '#E0475B', fontWeight: '900', flexShrink: 0 },
  heartLost: { color: '#D3DCE3' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.dangerBg, borderRadius: 14, padding: 10, marginBottom: 8 },
  offlineText: { flex: 1, color: t.danger, fontSize: 13, fontWeight: '700' },
  retry: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  retryText: { color: t.danger, fontWeight: '900' },
  waiting: { minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  prompt: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, marginBottom: 8,
    shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  promptCompact: { paddingVertical: 10 },
  promptHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  promptChip: { fontSize: 11, fontWeight: '900', color: t.accent, backgroundColor: t.tint, textTransform: 'uppercase', letterSpacing: 0.4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  promptInline: { flex: 1, fontSize: 17, fontWeight: '800', color: t.ink },
  promptLevel: { marginLeft: 'auto', fontSize: 11, fontWeight: '900', color: t.muted, borderWidth: 1, borderColor: t.border,
    borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  promptMain: { fontSize: 24, fontWeight: '900', color: t.ink, marginTop: 6 },
  promptSub: { fontSize: 13, color: t.muted, marginTop: 4 },
  promptNotice: { fontWeight: '900' },
  promptBlank: { backgroundColor: 'transparent' },
  noticeGood: { color: t.success },
  noticeBad: { color: t.danger },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: '#FFF6E5', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 5 },
  hint: { flex: 1, fontSize: 14, color: '#8A5A00', fontWeight: '700' },
  hintInline: { color: '#8A5A00', fontWeight: '700' },
  // Floats over the top of the play area: showing it never moves the game down.
  noticeLayer: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  notice: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, fontWeight: '800', overflow: 'hidden', maxWidth: '92%', textAlign: 'center',
    shadowColor: '#0B2A4A', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  playWrap: { flex: 1 },
  good: { backgroundColor: t.successBg, color: t.success },
  bad: { backgroundColor: t.dangerBg, color: t.danger },
  info: { backgroundColor: t.tint, color: t.accent },
  playArea: { flexGrow: 1 },
  scratch: { marginTop: 4 },
  scratchToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  scratchLabel: { color: t.accent, fontWeight: '800' },
  inputArea: { paddingTop: 6 },
  dimmed: { opacity: 0.5 },
  helpRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  help: { flex: 1, minHeight: 40, borderRadius: 12, backgroundColor: t.tint, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  helpText: { color: t.accent, fontWeight: '800', fontSize: 14 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(18,59,92,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, gap: 6 },
  introSheet: { maxHeight: '85%' },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: t.ink, textAlign: 'center' },
  answerLabel: { fontSize: 13, color: t.muted, fontWeight: '700', marginTop: 6 },
  answer: { fontSize: 22, fontWeight: '900', color: t.success },
  explanation: { fontSize: 15, color: t.ink, lineHeight: 22 },
  errorType: { fontSize: 13, color: t.danger, fontWeight: '800' },
  countdownLayer: { backgroundColor: 'rgba(14,44,72,0.9)', gap: 10, zIndex: 20 },
  countdown: { fontSize: 112, lineHeight: 128, fontWeight: '900', color: '#FFFFFF', textAlign: 'center' },
  countdownWord: { fontSize: 52, lineHeight: 64 },
  countdownHint: { fontSize: 16, fontWeight: '800', color: 'rgba(255,255,255,0.8)' },
  toggles: { flexDirection: 'row', gap: 8, marginTop: 8 },
  toggle: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: t.tint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  toggleOn: { backgroundColor: t.accent },
  toggleText: { color: t.accent, fontWeight: '800', fontSize: 13 },
  toggleTextOn: { color: '#FFFFFF' },
});
