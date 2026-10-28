import React, { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { Card, SoftInput } from '../../ui/kit';
import { request, showError } from './shared';
import { combineLocal, displayDateTime, localDate, localTime } from './taskDateTime';

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
type Category = 'study' | 'health' | 'habit' | 'personal' | 'other';
type Props = { visible: boolean; initialDate: string; onClose: () => void; onCreated: (date: string) => void };
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'study', label: 'Học tập' }, { id: 'health', label: 'Sức khỏe' }, { id: 'habit', label: 'Thói quen' },
  { id: 'personal', label: 'Cá nhân' }, { id: 'other', label: 'Khác' },
];
const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'none', label: 'Không lặp lại' }, { id: 'daily', label: 'Hằng ngày' }, { id: 'weekly', label: 'Hằng tuần' },
  { id: 'monthly', label: 'Hằng tháng' }, { id: 'custom', label: 'Tùy chỉnh' },
];
const FREQUENCIES: { id: Frequency; label: string }[] = [
  { id: 'daily', label: 'Ngày' }, { id: 'weekly', label: 'Tuần' }, { id: 'monthly', label: 'Tháng' }, { id: 'yearly', label: 'Năm' },
];
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const frequencyLabel: Record<Frequency, string> = { daily: 'ngày', weekly: 'tuần', monthly: 'tháng', yearly: 'năm' };
const localWeekday = (date: string) => (new Date(`${date}T00:00:00`).getDay() + 6) % 7;

export function TaskCreateModal({ visible, initialDate, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('study');
  const [scheduledDate, setScheduledDate] = useState(initialDate);
  const [startTime, setStartTime] = useState('');
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const [iosPickerValue, setIosPickerValue] = useState(() => combineLocal(initialDate, ''));
  const [iosAllDay, setIosAllDay] = useState(false);
  const webPickerRef = useRef<HTMLInputElement>(null);
  const [iosEndDateVisible, setIosEndDateVisible] = useState(false);
  const [iosEndDateValue, setIosEndDateValue] = useState(() => combineLocal(initialDate, ''));
  const endDatePickerRef = useRef<HTMLInputElement>(null);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [interval, setInterval] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<'never' | 'date'>('never');
  const [repeatUntil, setRepeatUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const activeFrequency: Frequency = repeat === 'custom' ? frequency : repeat === 'none' ? 'daily' : repeat;
  const repeatEnabled = repeat !== 'none';

  useEffect(() => { if (visible) setScheduledDate(initialDate); }, [visible, initialDate]);
  function toggleWeekday(day: number) {
    setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort());
  }

  function applyPickedDateTime(value: Date) {
    // Preserve local wall-clock date/time. Never round-trip through toISOString(),
    // which would shift a task across dates in non-UTC time zones.
    setScheduledDate(localDate(value));
    setStartTime(localTime(value));
  }

  function openDateTimePicker() {
    const currentValue = combineLocal(scheduledDate, startTime);
    if (Platform.OS === 'web') {
      const input = webPickerRef.current;
      if (input) {
        try { input.showPicker(); }
        catch { input.focus(); input.click(); }
      }
      return;
    }
    if (Platform.OS === 'ios') {
      setIosPickerValue(currentValue);
      setIosAllDay(!startTime);
      setIosPickerVisible(true);
      return;
    }
    DateTimePickerAndroid.open({
      value: currentValue, mode: 'date', display: 'default',
      onChange: (event: DateTimePickerEvent, selectedDate?: Date) => {
        if (event.type !== 'set' || !selectedDate) return;
        const selected = new Date(selectedDate);
        if (startTime) {
          const [hour, minute] = startTime.split(':').map(Number);
          selected.setHours(hour, minute, 0, 0);
        }
        setScheduledDate(localDate(selected));
        setTimeout(() => DateTimePickerAndroid.open({
            value: selected, mode: 'time', display: 'default', is24Hour: true,
            onChange: (timeEvent: DateTimePickerEvent, selectedTime?: Date) => {
              if (timeEvent.type === 'set' && selectedTime) applyPickedDateTime(selectedTime);
            },
          }), 120);
      },
    });
  }

  function onWebDateTimeChange(value: string) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
    if (!match) return;
    setScheduledDate(match[1]);
    setStartTime(match[2]);
  }

  function openRepeatEndPicker() {
    const selected = validDate(repeatUntil) ? repeatUntil : scheduledDate;
    const pickerValue = combineLocal(selected, '');
    if (Platform.OS === 'web') {
      const input = endDatePickerRef.current;
      if (input) {
        try { input.showPicker(); }
        catch { input.focus(); input.click(); }
      }
      return;
    }
    if (Platform.OS === 'ios') {
      setIosEndDateValue(pickerValue);
      setIosEndDateVisible(true);
      return;
    }
    DateTimePickerAndroid.open({
      value: pickerValue, mode: 'date', display: 'default', minimumDate: combineLocal(scheduledDate, ''),
      onChange: (event: DateTimePickerEvent, value?: Date) => {
        if (event.type === 'set' && value) setRepeatUntil(localDate(value));
      },
    });
  }

  async function createTask() {
    if (saving) return;
    if (!title.trim()) { showError('Thiếu tên nhiệm vụ', new Error('Hãy nhập tên nhiệm vụ.')); return; }
    if (!validDate(scheduledDate)) { showError('Ngày không hợp lệ', new Error('Nhập ngày theo định dạng YYYY-MM-DD.')); return; }
    const time = startTime.trim();
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { showError('Giờ không hợp lệ', new Error('Nhập giờ theo định dạng HH:MM.')); return; }
    const repeatInterval = Number(interval);
    if (repeat === 'custom' && (!Number.isInteger(repeatInterval) || repeatInterval < 1 || repeatInterval > 365)) {
      showError('Khoảng lặp không hợp lệ', new Error('Nhập số từ 1 đến 365.')); return;
    }
    if (activeFrequency === 'weekly' && repeatEnabled && !weekdays.length) {
      showError('Chưa chọn thứ', new Error('Hãy chọn ít nhất một ngày trong tuần.')); return;
    }
    if (endMode === 'date' && (!validDate(repeatUntil) || repeatUntil < scheduledDate)) {
      showError('Ngày kết thúc không hợp lệ', new Error('Ngày kết thúc phải hợp lệ và từ ngày bắt đầu trở đi.')); return;
    }

    setSaving(true);
    try {
      await request('/api/tasks', { method: 'POST', body: {
        title: title.trim(), category, scheduled_date: scheduledDate, repeat,
        all_day: !time, start_time: time || null,
        repeat_interval: repeat === 'custom' ? repeatInterval : 1,
        repeat_frequency: repeat === 'custom' ? frequency : null,
        repeat_weekdays: activeFrequency === 'weekly'
          ? (weekdays.length ? weekdays : [localWeekday(scheduledDate)]) : [],
        repeat_month_day: activeFrequency === 'monthly' ? Number(scheduledDate.slice(8, 10)) : null,
        repeat_until: !repeatEnabled || endMode === 'never' ? null : repeatUntil,
        repeat_count: null,
      } });
      setTitle(''); setCategory('study'); setRepeat('none'); setStartTime('');
      setWeekdays([]); setEndMode('never'); setRepeatUntil('');
      onCreated(scheduledDate); onClose();
    } catch (e) { showError('Không tạo được nhiệm vụ', e); }
    finally { setSaving(false); }
  }

  if (!visible) return null;
  return <View style={styles.overlay} accessibilityViewIsModal>
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng biểu mẫu" />
    <View style={styles.backdrop}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <View style={styles.header}><Text style={styles.title}>Tạo nhiệm vụ</Text><Pressable style={styles.closeButton} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng biểu mẫu"><Ionicons name="close" size={19} color={t.muted} /></Pressable></View>
          <SectionTitle icon="sparkles-outline" title="Thông tin nhiệm vụ" />
          <Text style={styles.label}>Tên nhiệm vụ</Text>
          <SoftInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ví dụ: Đọc sách 20 phút" maxLength={120} accessibilityLabel="Tên nhiệm vụ" />
          <Text style={styles.label}>Danh mục</Text>
          <View style={styles.choices}>{CATEGORIES.map((item) => <Pill key={item.id} label={item.label} selected={category === item.id} onPress={() => setCategory(item.id)} />)}</View>
          <SectionTitle icon="calendar-outline" title="Thời gian" />
          <Text style={styles.label}>Thời gian thực hiện</Text>
          <View style={styles.dateTimeWrap}>
            <Pressable onPress={openDateTimePicker} style={styles.dateTimeField} accessibilityRole="button" accessibilityLabel="Chọn ngày và giờ thực hiện">
              <Ionicons name="calendar-outline" size={17} color={t.accent} />
              <Text style={[styles.dateTimeText, !startTime && styles.dateTimePlaceholder]}>{displayDateTime(scheduledDate, startTime) || 'Chọn ngày và giờ'}</Text>
              <Ionicons name="chevron-down" size={16} color={t.muted} />
            </Pressable>
            {startTime ? <Pressable onPress={() => setStartTime('')} style={styles.clearTimeButton} accessibilityRole="button" accessibilityLabel="Xóa giờ, đặt cả ngày"><Ionicons name="sunny-outline" size={17} color={t.accent} /></Pressable> : null}
            {Platform.OS === 'web' ? React.createElement('input', {
              ref: webPickerRef,
              type: 'datetime-local',
              value: `${scheduledDate}T${startTime || '09:00'}`,
              onChange: (event: { currentTarget: { value: string } }) => onWebDateTimeChange(event.currentTarget.value),
              'aria-label': 'Thời gian thực hiện',
              lang: 'vi-VN',
              style: { position: 'absolute', top: 0, bottom: 0, left: 0, right: startTime ? 48 : 0, opacity: 0, pointerEvents: 'none', cursor: 'pointer' },
            }) : null}
          </View>
          <Text style={styles.helper}>Để trống giờ nếu nhiệm vụ cả ngày.</Text>

          <AppModal visible={iosPickerVisible} transparent animationType="fade" onRequestClose={() => setIosPickerVisible(false)}>
            <View style={styles.pickerOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setIosPickerVisible(false)} />
              <View style={styles.pickerCard}><View style={styles.pickerHeader}><Text style={styles.pickerTitle}>Chọn thời gian</Text><Pressable onPress={() => setIosAllDay(true)}><Text style={styles.pickerAllDay}>Cả ngày</Text></Pressable></View>
                <DateTimePicker value={iosPickerValue} mode="datetime" display="spinner" locale="vi-VN" onChange={(_event, value) => { if (value) { setIosPickerValue(value); setIosAllDay(false); } }} />
                <Pressable style={styles.pickerDone} onPress={() => { if (iosAllDay) { setScheduledDate(localDate(iosPickerValue)); setStartTime(''); } else applyPickedDateTime(iosPickerValue); setIosPickerVisible(false); }}><Text style={styles.pickerDoneText}>Xong</Text></Pressable>
              </View>
            </View>
          </AppModal>
          <AppModal visible={iosEndDateVisible} transparent animationType="fade" onRequestClose={() => setIosEndDateVisible(false)}>
            <View style={styles.pickerOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setIosEndDateVisible(false)} />
              <View style={styles.pickerCard}><View style={styles.pickerHeader}><Text style={styles.pickerTitle}>Kết thúc lặp vào</Text></View>
                <DateTimePicker value={iosEndDateValue} mode="date" display="spinner" locale="vi-VN" minimumDate={combineLocal(scheduledDate, '')} onChange={(_event, value) => { if (value) setIosEndDateValue(value); }} />
                <Pressable style={styles.pickerDone} onPress={() => { setRepeatUntil(localDate(iosEndDateValue)); setIosEndDateVisible(false); }}><Text style={styles.pickerDoneText}>Xong</Text></Pressable>
              </View>
            </View>
          </AppModal>

          <SectionTitle icon="repeat-outline" title="Lặp lại" />
          <View style={styles.choices}>{REPEATS.map((item) => <Pill key={item.id} label={item.label} selected={repeat === item.id} onPress={() => setRepeat(item.id)} />)}</View>
          {repeatEnabled && <>
            {repeat === 'weekly' && <><Text style={styles.label}>Ngày trong tuần</Text><View style={styles.choices}>{WEEKDAYS.map((day, index) => <Pill key={day} label={day} selected={weekdays.includes(index)} onPress={() => toggleWeekday(index)} />)}</View></>}
            {repeat === 'monthly' && <Text style={styles.helper}>Lặp vào ngày {Number(scheduledDate.slice(8, 10)) || '—'} hằng tháng.</Text>}
            {repeat === 'custom' && <>
              <Text style={styles.label}>Lặp mỗi</Text>
              <View style={styles.customRepeatRow}><SoftInput style={[styles.input, styles.intervalInput]} value={interval} onChangeText={setInterval} keyboardType="number-pad" accessibilityLabel="Khoảng lặp" /><View style={styles.frequencyOptions}>{FREQUENCIES.map((item) => <Pill key={item.id} label={item.label} selected={frequency === item.id} onPress={() => setFrequency(item.id)} />)}</View></View>
              {frequency === 'weekly' && <><Text style={styles.label}>Ngày trong tuần</Text><View style={styles.choices}>{WEEKDAYS.map((day, index) => <Pill key={day} label={day} selected={weekdays.includes(index)} onPress={() => toggleWeekday(index)} />)}</View></>}
            </>}
            <Text style={styles.label}>Kết thúc lặp lại</Text>
            <View style={styles.choices}><Pill label="Không kết thúc" selected={endMode === 'never'} onPress={() => setEndMode('never')} /><Pill label="Đến ngày" selected={endMode === 'date'} onPress={() => setEndMode('date')} /></View>
            {endMode === 'date' && <View style={styles.dateTimeWrap}>
              <Pressable onPress={openRepeatEndPicker} style={styles.dateTimeField} accessibilityRole="button" accessibilityLabel="Chọn ngày kết thúc lặp">
                <Ionicons name="calendar-outline" size={17} color={t.accent} />
                <Text style={[styles.dateTimeText, !repeatUntil && styles.dateTimePlaceholder]}>{repeatUntil ? displayDateTime(repeatUntil, '') : 'Chọn ngày kết thúc'}</Text>
                <Ionicons name="chevron-down" size={16} color={t.muted} />
              </Pressable>
              {Platform.OS === 'web' ? React.createElement('input', {
                ref: endDatePickerRef, type: 'date', value: repeatUntil, min: scheduledDate,
                onChange: (event: { currentTarget: { value: string } }) => setRepeatUntil(event.currentTarget.value),
                'aria-label': 'Ngày kết thúc lặp', lang: 'vi-VN',
                style: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, opacity: 0, pointerEvents: 'none', cursor: 'pointer' },
              }) : null}
            </View>}
          </>}
          <Pressable onPress={() => void createTask()} disabled={saving} style={[styles.save, saving && styles.disabled]} accessibilityRole="button" accessibilityState={{ busy: saving }}><Text style={styles.saveText}>{saving ? 'Đang lưu…' : 'Lưu nhiệm vụ'}</Text></Pressable>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView></View>
  </View>;
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]} accessibilityRole="button" accessibilityState={{ selected }}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>{selected ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}</Pressable>;
}

function SectionTitle({ icon, title }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string }) {
  return <View style={styles.sectionTitle}><View style={styles.sectionIcon}><Ionicons name={icon} size={15} color={t.accent} /></View><Text style={styles.sectionText}>{title}</Text></View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, justifyContent: 'center', backgroundColor: 'rgba(17, 39, 58, 0.48)' },
  backdrop: { width: '100%', maxWidth: 500, maxHeight: '100%', alignSelf: 'center', justifyContent: 'center', padding: 12 },
  keyboard: { maxHeight: '100%' }, content: { flexGrow: 1, justifyContent: 'center' },
  card: { marginBottom: 0, paddingHorizontal: 18, paddingTop: 15, paddingBottom: 16, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', shadowColor: '#164D70', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 7 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E8F2F8' },
  title: { color: t.ink, fontSize: 21, fontWeight: '900' }, closeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 7 }, sectionIcon: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.tint }, sectionText: { color: t.ink, fontSize: 14, fontWeight: '900' },
  label: { color: t.muted, fontSize: 12, fontWeight: '800', marginTop: 12, marginBottom: 7 },
  input: { minHeight: 46, paddingVertical: 8, borderRadius: 14, textAlignVertical: 'center', backgroundColor: '#F0F8FC', borderColor: '#E6F2F8', borderWidth: 1, fontSize: 15 },
  dateTimeWrap: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 7, position: 'relative', marginBottom: 3 },
  dateTimeField: { minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#F0F8FC', borderWidth: 1, borderColor: '#E6F2F8' },
  dateTimeText: { flex: 1, color: t.ink, fontSize: 15, fontWeight: '700' }, dateTimePlaceholder: { color: t.muted, fontWeight: '500' },
  clearTimeButton: { width: 44, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: t.tint },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,39,58,0.38)', padding: 12 },
  pickerCard: { borderRadius: 20, padding: 14, backgroundColor: '#FFFFFF' }, pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTitle: { fontSize: 15, fontWeight: '900', color: t.ink }, pickerAllDay: { color: t.accent, fontWeight: '800', fontSize: 12 },
  pickerDone: { height: 42, borderRadius: 13, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, pickerDoneText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }, choice: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#EFF8FD', borderWidth: 1, borderColor: '#E3F1F9' },
  choiceSelected: { backgroundColor: t.accent, borderColor: t.accent }, choiceText: { color: t.accent, fontSize: 12, fontWeight: '800' }, choiceTextSelected: { color: '#FFFFFF' },
  helper: { fontSize: 12, color: t.muted, marginTop: 8, marginBottom: 5 }, customRepeatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, intervalInput: { width: 58, textAlign: 'center' }, frequencyOptions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  save: { height: 48, marginTop: 17, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent }, saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' }, disabled: { opacity: 0.55 },
});
