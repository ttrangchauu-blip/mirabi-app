import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../../components/Typography';
import { showAlert } from '../../components/dialogs';
import { Button, Chip } from '../../ui/kit';
import type { FocusTimer } from './MainApp';
import { focusTheme as f } from './focusSpaceTheme';

export const soundOptions = [
  { id: 'rain', title: 'Mưa nhẹ', icon: 'rainy-outline' as const, hint: 'Bên hiên nhà' },
  { id: 'forest', title: 'Rừng xanh', icon: 'leaf-outline' as const, hint: 'Một chút thiên nhiên' },
  { id: 'stream', title: 'Suối nhỏ', icon: 'water-outline' as const, hint: 'Dòng chảy êm đềm' },
  { id: 'cafe', title: 'Quán cà phê', icon: 'cafe-outline' as const, hint: 'Góc quen yên tĩnh' },
  { id: 'lofi', title: 'Lo-fi', icon: 'musical-notes-outline' as const, hint: 'Nhịp điệu nhẹ nhàng' },
  { id: 'white', title: 'White noise', icon: 'radio-outline' as const, hint: 'Khoảng lặng riêng' },
];
/** The default: no background sound. Picking a track turns sound on, picking this turns it off. */
export const noSoundOption = { id: 'none', title: 'Không có', icon: 'volume-mute-outline' as const, hint: 'Học trong yên lặng' };

export function FocusTimeSettings({ timer, onSaved }: { timer: FocusTimer; onSaved: () => void }) {
  const [focus, setFocus] = useState(String(timer.focusMinutes));
  const [short, setShort] = useState(timer.shortBreakMinutes);
  const [long, setLong] = useState(timer.longBreakMinutes);
  const [every, setEvery] = useState(timer.longBreakEvery);
  const [advanced, setAdvanced] = useState(false);
  const valid = /^\d+$/.test(focus) && +focus >= 1 && +focus <= 180;
  function save() {
    const apply = () => {
      timer.configure({ ...(Number(focus) !== timer.focusMinutes ? { focusMinutes: Number(focus) } : {}),
        shortBreakMinutes: short, longBreakMinutes: long, longBreakEvery: every }); onSaved();
    };
    if (timer.activeCycle && +focus !== timer.focusMinutes) showAlert('Đổi thời lượng phiên học?', 'Phiên đang tạm dừng sẽ bị hủy. Thời lượng mới áp dụng cho phiên tiếp theo.',
      [{ text: 'Giữ phiên hiện tại', style: 'cancel' }, { text: 'Đổi thời lượng', onPress: apply }]);
    else apply();
  }
  return <>
    <Text style={s.label}>Thời gian tập trung</Text>
    <View style={s.wrap}>{[15, 25, 45].map(minutes => <Chip key={minutes} label={`${minutes} phút`} selected={+focus === minutes} onPress={() => setFocus(String(minutes))} />)}</View>
    <View style={s.row}><TextInput accessibilityLabel="Thời gian tập trung tùy chỉnh" keyboardType="number-pad" value={focus} onChangeText={setFocus} maxLength={3} style={s.number} /><Text style={s.copy}>phút · từ 1 đến 180</Text></View>
    <Text style={s.label}>Nghỉ ngắn</Text><View style={s.wrap}>{[3, 5, 10].map(minutes => <Chip key={minutes} label={`${minutes}p nghỉ ngắn`} selected={short === minutes} onPress={() => setShort(minutes)} />)}</View>
    <Text style={s.label}>Nghỉ dài</Text><View style={s.wrap}>{[15, 20, 30].map(minutes => <Chip key={minutes} label={`${minutes}p nghỉ dài`} selected={long === minutes} onPress={() => setLong(minutes)} />)}</View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(v => !v)} style={s.advanced}><Text style={s.link}>Cài đặt nâng cao</Text><Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={16} color={f.blue} /></Pressable>
    {advanced ? <><Text style={s.label}>Nghỉ dài sau</Text><View style={s.wrap}>{[2, 4, 6, 8].map(value => <Chip key={value} label={`${value} phiên`} selected={every === value} onPress={() => setEvery(value)} />)}</View></> : null}
    {timer.running ? <Text style={s.copy}>Tạm dừng đồng hồ trước khi áp dụng cài đặt thời gian.</Text> : null}
    <Button title="Lưu thời gian" icon="checkmark" onPress={save} disabled={!valid || timer.running} />
    <View style={s.divider} />
    <View style={s.row}><Button title="Đặt lại" icon="refresh-outline" variant="secondary" onPress={() => {
      if (!timer.activeCycle) { timer.reset(); onSaved(); return; }
      showAlert('Đặt lại phiên học?', 'Phiên hiện tại sẽ bị hủy và không được tính là hoàn thành.',
        [{ text: 'Tiếp tục học', style: 'cancel' }, { text: 'Đặt lại', onPress: () => { timer.reset(); onSaved(); } }]);
    }} style={s.half} /><Button title="Bỏ qua" icon="play-skip-forward-outline" variant="secondary" onPress={() => {
      if (timer.phase !== 'focus' || !timer.activeCycle) { timer.skip(); onSaved(); return; }
      showAlert('Bỏ qua phiên học?', 'Phiên này sẽ không được tính vào thống kê hay Study Streak.',
        [{ text: 'Tiếp tục học', style: 'cancel' }, { text: 'Bỏ qua', onPress: () => { timer.skip(); onSaved(); } }]);
    }} style={s.half} /></View>
    <Text style={s.copy}>Nhịp học của bạn: {timer.focusMinutes} phút tập trung, nghỉ ngắn {timer.shortBreakMinutes} phút; nghỉ dài sau mỗi {timer.longBreakEvery} phiên.</Text>
  </>;
}

export function FocusSoundSettings({ timer }: { timer: FocusTimer }) {
  // `timer.sound` remembers the last track; while sound is off, "Không có" is the selected choice.
  const selected = timer.soundOn ? timer.sound : noSoundOption.id;
  return <>
    <View style={s.sounds}>{[noSoundOption, ...soundOptions].map(sound => <Pressable key={sound.id} accessibilityRole="radio" accessibilityState={{ checked: selected === sound.id }} accessibilityLabel={sound.title}
      onPress={() => timer.selectSound(sound.id === noSoundOption.id ? null : sound.id)} style={[s.sound, selected === sound.id && s.soundActive]}>
      <Ionicons name={sound.icon} size={23} color={selected === sound.id ? f.blue : f.muted} /><Text style={s.soundName}>{sound.title}</Text><Text style={s.soundHint}>{sound.hint}</Text>
    </Pressable>)}</View>
    {timer.soundOn && !timer.soundPlaying ? <Text style={s.copy} accessibilityLiveRegion="polite">
      {timer.previewing ? 'Đang nghe thử. ' : ''}Âm thanh sẽ phát trong suốt phiên tập trung khi bạn bấm Bắt đầu.</Text> : null}
    <Text style={s.label}>Âm lượng · {Math.round(timer.volume * 100)}%</Text>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Giảm âm lượng" onPress={() => timer.configure({ volume: Math.max(0, Math.round((timer.volume - .1) * 100) / 100) })} style={s.volumeButton}><Ionicons name="volume-low-outline" size={21} color={f.ink} /></Pressable>
      <View style={s.volumeTrack} accessibilityRole="progressbar" accessibilityLabel="Âm lượng" accessibilityValue={{ min: 0, max: 100, now: Math.round(timer.volume * 100) }}><View style={[s.volumeFill, { width: `${timer.volume * 100}%` }]} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Tăng âm lượng" onPress={() => timer.configure({ volume: Math.min(1, Math.round((timer.volume + .1) * 100) / 100) })} style={s.volumeButton}><Ionicons name="volume-high-outline" size={21} color={f.ink} /></Pressable>
    </View>
    <Text style={s.copy}>Âm thanh nền đi theo phiên học: phát khi phiên chạy, tạm dừng cùng phiên và tắt khi bạn kết thúc phiên.</Text>
  </>;
}

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '800', color: f.ink, marginTop: 4 }, copy: { color: f.muted, fontSize: 12, lineHeight: 19, flexShrink: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, half: { flex: 1, minWidth: 0 },
  number: { width: 72, padding: 12, borderWidth: 1, borderColor: f.line, borderRadius: 12, fontSize: 16, color: f.ink, backgroundColor: '#FFFFFF' },
  advanced: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }, link: { color: f.blue, fontWeight: '700', fontSize: 13 }, divider: { height: 1, backgroundColor: f.line, marginVertical: 8 },
  sounds: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, sound: { flexBasis: '46%', flexGrow: 1, minWidth: 0, padding: 14, borderRadius: 16, backgroundColor: f.cream, gap: 6, borderWidth: 1, borderColor: 'transparent' },
  soundActive: { backgroundColor: '#EDF5F8', borderColor: '#A7CDDD' }, soundName: { color: f.ink, fontSize: 13, fontWeight: '700' }, soundHint: { fontSize: 10, color: f.muted },
  volumeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: f.cream, borderRadius: 14 },
  volumeTrack: { height: 5, flex: 1, borderRadius: 3, backgroundColor: '#E1E5E5', overflow: 'hidden' }, volumeFill: { height: 5, borderRadius: 3, backgroundColor: f.blue },
});
