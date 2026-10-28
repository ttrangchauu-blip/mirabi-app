import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useViewportSize } from '../../components/MobileViewport';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { appTheme } from '../../theme';
import { Button } from '../../ui/kit';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Text, TextInput } from '../../components/Typography';
import type { FocusTimer } from './MainApp';
import { FocusRoom } from './FocusRoom';
import { FocusToolPanel } from './FocusToolPanel';
import { FocusSoundSettings, FocusTimeSettings, noSoundOption, soundOptions } from './FocusControls';
import { PomodoroCompletion, PomodoroStatistics, StudyStatsBar, useStudyStatistics } from './PomodoroStatistics';
import { focusTheme as f } from './focusSpaceTheme';

type Panel = 'time' | 'sound' | 'read' | 'notes' | 'statistics';
const toolInfo = {
  time: { title: 'Nhịp học của bạn', subtitle: 'Một nhịp vừa sức để đi được đường dài.' },
  sound: { title: 'Âm thanh của căn phòng', subtitle: 'Chọn một khoảng nền để tâm trí nhẹ hơn.' },
  read: { title: 'Nghe đọc', subtitle: 'Thả lỏng đôi mắt, lắng nghe điều bạn đang học.' },
  notes: { title: 'Ghi chú học tập', subtitle: 'Một nơi nhỏ cho những điều muốn nhớ.' },
  statistics: { title: 'Hành trình tập trung', subtitle: 'Nhìn lại nhịp học và những bước tiến của bạn.' },
};
const tools = [
  { id: 'read' as const, icon: 'volume-medium-outline' as const, label: 'Đọc', accessible: 'Nghe đọc' },
  { id: 'notes' as const, icon: 'create-outline' as const, label: 'Ghi chú', accessible: 'Ghi chú học tập' },
];

type Props = { timer: FocusTimer; petId: string; petName: string | null; petLevel: number; userId: number };

export function PomodoroPanel({ timer, petId, petName, petLevel, userId }: Props) {
  const { width } = useViewportSize();
  const desktop = width >= 1024;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [reading, setReading] = useState(false);
  const [readText, setReadText] = useState('');
  const [note, setNote] = useState('');
  const [goal, setGoal] = useState('');
  const [noteStatus, setNoteStatus] = useState('Đang mở sổ tay…');
  const [notesReady, setNotesReady] = useState(false);
  const [noteRetry, setNoteRetry] = useState(0);
  const data = useStudyStatistics(timer, userId);
  const confirm = useConfirm();
  const owner = useRef(userId); owner.current = userId;
  const mounted = useRef(true);
  const speechRun = useRef(0);
  const opener = useRef<View | null>(null);
  const toolRefs = useRef<Partial<Record<Panel, View | null>>>({});
  const noteKey = `mirabi.study.note:${userId}`;
  const goalKey = `mirabi.study.goal:${userId}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void Speech.stop(); }; }, []);
  useEffect(() => { setPanel(null); setReadText(''); setReading(false); speechRun.current += 1; void Speech.stop(); }, [userId]);
  useEffect(() => {
    let disposed = false;
    setNotesReady(false); setNote(''); setGoal('');
    void AsyncStorage.multiGet([noteKey, goalKey]).then(([n, g]) => {
      if (!disposed) { setNote(n[1] ?? ''); setGoal(g[1] ?? ''); setNoteStatus('Đã lưu trên thiết bị này'); setNotesReady(true); }
    }).catch(() => { if (!disposed) setNoteStatus('Chưa mở được sổ tay. Hãy mở lại công cụ.'); });
    return () => { disposed = true; };
  }, [noteKey, goalKey, noteRetry]);
  const closePanel = useCallback(() => { setPanel(null); opener.current?.focus(); }, []);
  function openPanel(next: Panel) {
    opener.current = toolRefs.current[next] ?? null;
    if (next === 'read' && !readText.trim()) setReadText(note);
    setPanel(current => current === next ? null : next);
  }
  async function saveLocal(kind: 'note' | 'goal', value: string) {
    const requestedBy = userId;
    if (kind === 'note') setNote(value); else setGoal(value);
    setNoteStatus('Đang lưu…');
    try {
      await AsyncStorage.setItem(kind === 'note' ? noteKey : goalKey, value);
      if (mounted.current && owner.current === requestedBy) setNoteStatus('Đã lưu trên thiết bị này');
    } catch { if (mounted.current && owner.current === requestedBy) setNoteStatus('Chưa lưu được. Giữ công cụ mở và thử chỉnh sửa lại.'); }
  }
  function speak(text: string) {
    if (!text.trim()) return;
    const run = ++speechRun.current;
    void Speech.stop(); setReading(true);
    Speech.speak(text.trim(), { language: 'vi-VN', onDone: () => { if (mounted.current && speechRun.current === run) setReading(false); },
      onStopped: () => { if (mounted.current && speechRun.current === run) setReading(false); }, onError: () => { if (mounted.current && speechRun.current === run) setReading(false); } });
  }
  function stopReading() { speechRun.current += 1; void Speech.stop(); setReading(false); }
  const phaseSeconds = (timer.phase === 'focus' ? timer.focusMinutes : timer.phase === 'long_break' ? timer.longBreakMinutes : timer.shortBreakMinutes) * 60;
  const progress = Math.max(0, Math.min(1, (phaseSeconds - timer.seconds) / Math.max(1, phaseSeconds)));
  const remaining = `${String(Math.floor(timer.seconds / 60)).padStart(2, '0')}:${String(timer.seconds % 60).padStart(2, '0')}`;
  const label = timer.phase === 'focus' ? 'Tập trung' : timer.phase === 'long_break' ? 'Nghỉ dài' : 'Nghỉ ngắn';
  const focusing = timer.running && timer.phase === 'focus';
  useEffect(() => { if (focusing) setPanel(null); }, [focusing]);
  const paused = !timer.running && timer.seconds < phaseSeconds;
  const active = timer.running || paused;
  const stopTitle = timer.phase === 'focus' ? 'Kết thúc phiên' : 'Kết thúc giờ nghỉ';
  async function stopSession() {
    const ok = await confirm(timer.phase === 'focus'
      ? { title: 'Kết thúc phiên học?', message: 'Số phút bạn đã học vẫn được ghi lại, nhưng phiên này không tính là phiên hoàn thành.', confirmLabel: 'Kết thúc', icon: 'stop-circle-outline', destructive: true }
      : { title: 'Kết thúc giờ nghỉ?', message: 'Bạn sẽ quay lại phiên tập trung tiếp theo.', confirmLabel: 'Kết thúc', icon: 'stop-circle-outline' });
    if (ok) timer.reset();
  }
  // A new session starts by choosing the subject; pausing, resuming and breaks use the timer directly.
  const startTitle = timer.running ?'Tạm dừng' : paused ? 'Tiếp tục' : timer.phase === 'focus' ? desktop ? 'Bắt đầu tập trung' : 'Bắt đầu' : 'Bắt đầu nghỉ';
  const currentSound = soundOptions.find(sound => sound.id === timer.sound) ?? soundOptions[0];
  const hasPanel = desktop && !!panel;
  const clockSize = desktop ? 236 : 194;
  const clockRadius = clockSize / 2 - 7;

  const panelContent = panel === 'time' ? <FocusTimeSettings timer={timer} onSaved={closePanel} />
    : panel === 'sound' ? <FocusSoundSettings timer={timer} />
    : panel === 'statistics' ? <PomodoroStatistics timer={timer} data={data} />
    : panel === 'notes' ? <>
      <Text style={s.fieldLabel}>Mình muốn hoàn thành điều gì?</Text>
      <TextInput value={goal} editable={notesReady} onChangeText={value => { void saveLocal('goal', value); }} accessibilityLabel="Mục tiêu phiên học" placeholder="Ví dụ: ôn lại chương 3" maxLength={160} style={s.input} />
      <Text style={s.fieldLabel}>Trang ghi chú của bạn</Text>
      <TextInput value={note} editable={notesReady} onChangeText={value => { void saveLocal('note', value); }} accessibilityLabel="Nội dung ghi chú" placeholder="Ghi lại ý chính để xem sau…" multiline maxLength={4000} textAlignVertical="top" style={[s.input, s.notebook]} />
      <Text accessibilityLiveRegion="polite" style={s.caption}>{noteStatus}</Text>
      {!notesReady ? <Button title="Thử mở lại sổ tay" variant="secondary" onPress={() => setNoteRetry(v => v + 1)} /> : null}
    </> : panel === 'read' ? <>
      <Text style={s.fieldLabel}>Nội dung muốn nghe</Text>
      <TextInput value={readText} onChangeText={setReadText} accessibilityLabel="Văn bản cần đọc" placeholder="Dán nội dung bạn muốn nghe…" multiline maxLength={6000} textAlignVertical="top" style={[s.input, s.longInput]} />
      {note ? <View style={s.wrap}><Button title="Dùng ghi chú" variant="secondary" onPress={() => setReadText(note)} /></View> : null}
      <Button title={reading ? 'Dừng đọc' : 'Đọc nội dung'} icon={reading ? 'stop' : 'volume-medium-outline'} disabled={!reading && !readText.trim()} onPress={() => reading ? stopReading() : speak(readText)} />
      <Text style={s.caption}>Giọng đọc tiếng Việt trên thiết bị. Bạn có thể đóng bảng và tiếp tục nghe trong lúc học.</Text>
    </> : null;

  return <View testID="mirabi-focus-space" style={[s.layout, desktop && s.desktopLayout]}>
    <View style={s.main}>
      <View style={[s.space, focusing && s.focusMode]} testID={focusing ? 'active-focus-mode' : 'idle-focus-space'}>
        <View style={[s.spaceHeader, !desktop && s.mobileHeader]}>
          <View style={s.headline}><View style={s.eyebrowRow}><Ionicons name="sparkles-outline" size={13} color={f.blue} /><Text style={s.eyebrow}>MIRABI / FOCUS SPACE</Text></View>
            <Text accessibilityRole="header" style={[s.title, !desktop && s.mobileTitle]}>Một góc nhỏ. Một điều mới.</Text>
            {desktop ? <Text style={s.subtitle}>{focusing ? 'Cứ thong thả, từng phút một.' : `Cất bớt vội vàng, học cùng ${petName || 'bạn đồng hành'}.`}</Text> : null}
          </View>
          <Pressable onPress={timer.toggleFocusMode} accessibilityRole="switch" accessibilityLabel="Chế độ tập trung" accessibilityHint="Khi bật, ẩn thông báo trong ứng dụng lúc phiên học đang chạy" accessibilityState={{ checked: timer.focusMode }} style={[s.soundPill, timer.focusMode && s.focusPillOn]}>
            <Ionicons name={timer.focusMode ? 'moon' : 'moon-outline'} size={16} color={f.blue} />{desktop ? <Text style={s.soundPillText}>{timer.focusMode ? 'Tập trung: Bật' : 'Tập trung: Tắt'}</Text> : null}
          </Pressable>
          <Pressable ref={view => { toolRefs.current.sound = view; }} onPress={() => openPanel('sound')} accessibilityRole="button" accessibilityLabel="Mở âm thanh nền" style={[s.soundPill, timer.soundOn && s.soundPillOn]}>
            <Ionicons name={timer.soundOn ? currentSound.icon : noSoundOption.icon} size={17} color={f.blue} />{desktop ? <Text style={s.soundPillText}>{timer.soundOn ? currentSound.title : 'Âm thanh'}</Text> : null}{timer.soundPlaying ? <View style={s.playDot} /> : null}
          </Pressable>
        </View>
        <View style={[s.heroBody, desktop && s.heroDesktop]}>
          <View style={s.sceneRegion}><View style={s.sceneFrame}><FocusRoom petId={petId} petName={petName} petLevel={petLevel} resting={timer.phase !== 'focus'} compact={!desktop || hasPanel} /></View></View>
          <View style={[s.timer, desktop ? { width: hasPanel ? 272 : 330 } : s.compactTimer]}>
            <View style={desktop ? s.timerReadout : s.compactReadout}>
            <View style={s.phase}><View style={[s.phaseDot, timer.phase !== 'focus' && s.breakDot]} /><Text style={s.phaseText}>{label.toUpperCase()}</Text></View>
            <View style={[s.clock, desktop ? { width: clockSize, height: clockSize } : s.compactClock]} accessibilityRole="progressbar" accessibilityLabel="Tiến trình phiên học" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
              {desktop ? <Svg width={clockSize} height={clockSize} style={StyleSheet.absoluteFill} pointerEvents="none">
                <Circle cx={clockSize / 2} cy={clockSize / 2} r={clockRadius} stroke="#E1E6E4" strokeWidth={2} fill="none" />
                <Circle cx={clockSize / 2} cy={clockSize / 2} r={clockRadius} stroke={timer.phase === 'focus' ? '#82AEBE' : '#9CB59D'} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * clockRadius} ${2 * Math.PI * clockRadius}`} strokeDashoffset={2 * Math.PI * clockRadius * (1 - progress)} transform={`rotate(-90 ${clockSize / 2} ${clockSize / 2})`} />
              </Svg> : null}
              <Text style={[s.time, !desktop && s.compactTime]} accessibilityLabel={`Còn lại ${remaining}`}>{remaining}</Text>
              {desktop ? <Text style={s.timerHint}>{timer.running ? timer.phase === 'focus' ? 'Chỉ bạn và điều đang học' : 'Thở chậm. Nghỉ một chút.' : paused ? 'Mình tiếp tục nhé?' : 'Sẵn sàng khi bạn sẵn sàng'}</Text> : <View style={s.compactTrack}><View style={[s.compactFill, { width: `${progress * 100}%` }]} /></View>}
            </View>
            </View>
            {desktop ? <View style={s.timerReadout}>
            <Button title={startTitle} icon={timer.running ? 'pause' : 'play'} onPress={timer.toggle} disabled={!timer.ready} style={s.start} />
            {active ? <Pressable accessibilityRole="button" accessibilityLabel={stopTitle} onPress={() => { void stopSession(); }} style={s.timeSettings}><Ionicons name="stop-circle-outline" size={16} color={appTheme.danger} /><Text style={[s.timeSettingsText, s.stopText]}>{stopTitle}</Text></Pressable>
            : <Pressable ref={view => { toolRefs.current.time = view; }} accessibilityRole="button" accessibilityLabel="Tùy chỉnh thời gian" onPress={() => openPanel('time')} style={s.timeSettings}><Ionicons name="options-outline" size={15} color={f.muted} /><Text style={s.timeSettingsText}>{`${timer.focusMinutes} phút học / ${timer.shortBreakMinutes} phút nghỉ`}</Text></Pressable>}
            </View> : <View style={s.compactActions}>
              <View style={s.roundRow}>
                {active ? <Pressable accessibilityRole="button" accessibilityLabel={stopTitle} onPress={() => { void stopSession(); }} style={({ pressed }) => [s.roundSettings, s.roundStop, pressed && s.roundPressed]}><Ionicons name="stop" size={17} color={appTheme.danger} /></Pressable>
                  : <Pressable ref={view => { toolRefs.current.time = view; }} accessibilityRole="button" accessibilityLabel="Tùy chỉnh thời gian" onPress={() => openPanel('time')} style={({ pressed }) => [s.roundSettings, pressed && s.roundPressed]}><Ionicons name="options-outline" size={19} color={f.blue} /></Pressable>}
                <Pressable accessibilityRole="button" accessibilityLabel={startTitle} accessibilityState={{ disabled: !timer.ready }} onPress={timer.toggle} disabled={!timer.ready} style={({ pressed }) => [s.roundPlay, pressed && timer.ready && s.roundPressed, !timer.ready && s.roundDimmed]}>
                  <LinearGradient colors={appTheme.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.roundPlayFill}><Ionicons name={timer.running ? 'pause' : 'play'} size={19} color="#FFFFFF" style={!timer.running && s.playNudge} /></LinearGradient>
                </Pressable>
              </View>
              <Text style={s.timeSettingsText}>{`${timer.focusMinutes} / ${timer.shortBreakMinutes} phút`}</Text>
            </View>}
            {desktop ? <View style={s.cycles} accessibilityLabel={`${timer.completedCycles} phiên hoàn thành; nghỉ dài sau mỗi ${timer.longBreakEvery} phiên`}>{Array.from({ length: Math.min(12, timer.longBreakEvery) }, (_, index) => <View key={index} style={[s.cycle, index < timer.completedCycles % timer.longBreakEvery && s.cycleDone]} />)}<Text style={s.cycleLabel}>nhịp học của bạn</Text></View> : null}
          </View>
        </View>
        <PomodoroCompletion timer={timer} />
        <StudyStatsBar data={data} triggerRef={view => { toolRefs.current.statistics = view; }} onPress={() => openPanel('statistics')} />
      </View>
      <View style={s.toolsArea}>
        <Text style={s.toolsLabel}>MỘT CHÚT TRỢ GIÚP, KHI BẠN CẦN</Text>
        <View style={s.toolbar} accessibilityLabel="Công cụ học tập">{tools.map(tool => <Pressable key={tool.id} ref={view => { toolRefs.current[tool.id] = view; }} onPress={() => openPanel(tool.id)} accessibilityRole="button" accessibilityLabel={tool.accessible} accessibilityState={{ expanded: panel === tool.id }} style={[s.tool, desktop && s.desktopTool, panel === tool.id && s.toolActive]}>
          <View style={[s.toolIcon, panel === tool.id && s.toolIconActive]}><Ionicons name={tool.icon} size={20} color={panel === tool.id ? f.blue : '#647D8A'} />{tool.id === 'read' && reading ? <View style={s.readingDot} /> : null}</View><Text style={[s.toolLabel, panel === tool.id && s.toolLabelActive]}>{tool.label}</Text>
        </Pressable>)}</View>
      </View>
    </View>
    {panel ? <FocusToolPanel key={panel} title={toolInfo[panel].title} subtitle={toolInfo[panel].subtitle} desktop={desktop} onClose={closePanel}>{panelContent}</FocusToolPanel> : null}
  </View>;
}

const s = StyleSheet.create({
  layout: { width: '100%', maxWidth: 1440, alignSelf: 'center', gap: 18, minWidth: 0 }, desktopLayout: { flexDirection: 'row', alignItems: 'flex-start' }, main: { flex: 1, minWidth: 0 },
  space: { backgroundColor: f.paper, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF', shadowColor: f.shadow, shadowOpacity: .09, shadowRadius: 26, shadowOffset: { width: 0, height: 10 }, elevation: 2 },
  focusMode: { backgroundColor: '#FAFCF9' }, spaceHeader: { paddingHorizontal: 30, paddingTop: 27, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, mobileHeader: { paddingHorizontal: 20, paddingTop: 20, flexWrap: 'wrap' },
  headline: { flex: 1, minWidth: 0 }, eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }, eyebrow: { fontSize: 10, letterSpacing: 1.8, fontWeight: '800', color: '#67818D' },
  title: { fontSize: 27, lineHeight: 36, fontWeight: '800', color: f.ink, letterSpacing: -.5 }, mobileTitle: { fontSize: 23, lineHeight: 30 }, subtitle: { color: f.muted, fontSize: 12, lineHeight: 19, marginTop: 5 },
  soundPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#EFF4F3', paddingHorizontal: 12, minHeight: 40, borderRadius: 20 }, soundPillOn: { backgroundColor: '#E5F0F0' }, focusPillOn: { backgroundColor: '#DCEAF1', borderWidth: 1, borderColor: '#B9D5E2' }, soundPillText: { fontSize: 11, color: f.blue, fontWeight: '700' }, playDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#709C8F' },
  heroBody: { alignItems: 'center', minWidth: 0 }, heroDesktop: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, paddingBottom: 10, minHeight: 405 },
  sceneRegion: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', width: '100%', padding: 10 }, sceneFrame: { width: '100%', maxWidth: 660 },
  timer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 22, paddingHorizontal: 14, width: '100%', flexShrink: 0 }, phase: { flexDirection: 'row', alignItems: 'center', gap: 7 }, phaseDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#81A9BA' }, breakDot: { backgroundColor: '#96AC92' },
  timerReadout: { alignItems: 'center' }, compactTimer: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 20, gap: 12 },
  compactReadout: { width: 112, alignItems: 'flex-start' }, compactClock: { width: 112, height: 64, marginTop: 0, alignItems: 'flex-start' },
  compactTime: { fontSize: 44, lineHeight: 55, letterSpacing: -1.5 }, compactTrack: { width: '100%', height: 3, borderRadius: 2, backgroundColor: '#E1E6E4', overflow: 'hidden' }, compactFill: { height: 3, borderRadius: 2, backgroundColor: '#82AEBE' },
  compactActions: { alignItems: 'center', gap: 6 }, roundRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  roundSettings: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF4F3', borderWidth: 1, borderColor: '#DCE7EA' },
  roundPlay: { width: 44, height: 44, borderRadius: 22, shadowColor: appTheme.shadow, shadowOpacity: .2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  roundPlayFill: { flex: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, playNudge: { marginLeft: 2 },
  roundStop: { backgroundColor: '#FBEFEE', borderColor: '#F1D9D6' }, stopText: { color: appTheme.danger },
  roundPressed:{ transform: [{ scale: .96 }], opacity: .92 }, roundDimmed: { opacity: .55 },
  phaseText: { fontSize: 10, letterSpacing: 2.3, fontWeight: '800', color: '#667F89' }, clock: { width: 236, height: 236, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  time: { fontSize: 62, lineHeight: 78, fontWeight: '800', color: f.ink, letterSpacing: -2, fontVariant: ['tabular-nums'] }, timerHint: { color: f.muted, fontSize: 11, marginTop: 4 }, start: { width: 224, maxWidth: '100%', marginTop: 5 },
  timeSettings: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, minHeight: 44 }, timeSettingsText: { fontSize: 11, color: f.muted, fontWeight: '600' },
  cycles: { flexDirection: 'row', gap: 5, alignItems: 'center', marginTop: 2 }, cycle: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#DCE2DF' }, cycleDone: { backgroundColor: '#8DAA9E' }, cycleLabel: { marginLeft: 5, fontSize: 10, color: '#71817F' },
  toolsArea: { paddingTop: 20, paddingBottom: 12 }, toolsLabel: { textAlign: 'center', color: '#6B828E', fontSize: 9, letterSpacing: 1.8, fontWeight: '700', marginBottom: 10 }, toolbar: { flexDirection: 'row', justifyContent: 'center', gap: 5, maxWidth: 620, width: '100%', alignSelf: 'center' },
  tool: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 4, paddingVertical: 10, borderRadius: 17, gap: 5 }, desktopTool: { flexDirection: 'row', justifyContent: 'center', gap: 8 }, toolActive: { backgroundColor: '#E5EFF3' },
  toolIcon: { position: 'relative', height: 36, width: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.6)' }, toolIconActive: { backgroundColor: '#D7E9F1' }, toolLabel: { color: f.muted, fontSize: 12, fontWeight: '700' }, toolLabelActive: { color: f.blue }, readingDot: { position: 'absolute', right: 3, top: 3, height: 5, width: 5, borderRadius: 3, backgroundColor: '#739C83' },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: f.ink }, input: { borderWidth: 1, borderColor: f.line, backgroundColor: '#FFFFFF', borderRadius: 15, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, lineHeight: 22, color: f.ink, minWidth: 0 },
  longInput: { minHeight: 155 }, notebook: { minHeight: 280, backgroundColor: '#FFFEFA', lineHeight: 27 }, caption: { color: f.muted, fontSize: 12, lineHeight: 19 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
});
