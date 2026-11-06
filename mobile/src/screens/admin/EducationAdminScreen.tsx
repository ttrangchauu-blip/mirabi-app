import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { educationAdminApi, type CalendarAlert, type CalendarChange, type CalendarInput, type CalendarYear, type LearnerDetail,
  type LearnerRow } from '../../learning/education';
import { GRADES, gradeLabel } from '../../studyProfile';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Card, Segmented, SoftInput } from '../../ui/kit';
import { makeStyles, useTheme } from '../../ui/theme';
import { useToast } from '../../ui/Toast';
import { BackHeader } from '../learning/GamePicker';

// Quản trị lớp học (backend education.py, /api/admin/education): learners' grades, "học lại" / "lên lớp", the region whose
// calendar applies, and the school calendar itself. Shown to administrators only; the backend checks the role on every
// call. Every change asks for a reason and the check that verified it, and is confirmed before it is saved; the
// backend records who made it and when.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_LABEL: Record<string, string> = {
  enrollment: 'Đăng ký', migration: 'Chuyển dữ liệu cũ', promotion: 'Lên lớp', repeat: 'Học lại', repeat_request: 'Xác nhận học lại',
  completed: 'Hoàn thành chương trình', correction: 'Sửa lớp', region_change: 'Đổi địa phương',
};
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

function Field({ label, ...props }: React.ComponentProps<typeof SoftInput> & { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <SoftInput accessibilityLabel={label} autoCapitalize="none" {...props} />
    </View>
  );
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T | null;
  onChange: (id: T) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="radio" accessibilityState={{ checked: o.id === value }}
            accessibilityLabel={o.label} style={[styles.chip, o.id === value && styles.chipOn]}>
            <Text style={[styles.chipText, o.id === value && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Alerts({ alerts }: { alerts: CalendarAlert[] }) {
  const { t } = useTheme();
  const styles = useStyles();
  if (!alerts.length) return null;
  return (
    <View style={styles.alert} accessibilityRole="alert">
      <Ionicons name="warning-outline" size={18} color={t.warning} />
      <View style={styles.flex}>
        {alerts.map((a) => (
          <Text key={`${a.region}.${a.academic_year}`} style={styles.alertText}>
            {a.level === 'overdue' ? 'Đã đến năm học' : 'Sắp đến năm học'} {a.label} ({a.region}) nhưng lịch chưa được xác minh
            {a.waiting ? ` · ${a.waiting} học sinh đang giữ nguyên lớp` : ''}.
          </Text>
        ))}
      </View>
    </View>
  );
}

export function EducationAdminScreen({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  const [tab, setTab] = useState<'learners' | 'calendar'>('learners');
  const [alerts, setAlerts] = useState<CalendarAlert[]>([]);
  const [regions, setRegions] = useState<{ id: string; label: string }[]>([{ id: 'VN', label: 'Việt Nam' }]);
  const loadAlerts = useCallback(() => {
    void educationAdminApi.alerts().then((a) => setAlerts(Array.isArray(a) ? a : [])).catch(() => {});
  }, []);
  useEffect(() => {
    loadAlerts();
    void educationAdminApi.regions().then((r) => {
      if (Array.isArray(r?.items) && r.items.length) setRegions(r.items.map((x) => ({ id: x.code, label: x.name })));
    }).catch(() => {});
  }, [loadAlerts]);
  return (
    <>
      <BackHeader title="Quản trị lớp học" subtitle="Lớp học, học lại / lên lớp, lịch năm học" onBack={onBack} />
      <Alerts alerts={alerts} />
      <Segmented options={[{ value: 'learners', label: 'Học sinh' }, { value: 'calendar', label: 'Lịch năm học' }]} value={tab} onChange={setTab} />
      <View style={styles.gap} />
      {tab === 'learners' ? <Learners regions={regions} onChanged={loadAlerts} /> : <Calendar regions={regions} onChanged={loadAlerts} />}
    </>
  );
}

// --- Học sinh -------------------------------------------------------------------------------------------------------------

type Action = 'grade' | 'repeat' | 'promote' | 'region';
const ACTION_LABEL: Record<Action, string> = { grade: 'Sửa lớp', repeat: 'Xác nhận học lại', promote: 'Xác nhận lên lớp', region: 'Đổi địa phương' };

function Learners({ regions, onChanged }: { regions: { id: string; label: string }[]; onChanged: () => void }) {
  const { t } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<LearnerRow[] | null>(null);
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [verification, setVerification] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (query.trim().length < 2) { setError('Nhập ít nhất 2 ký tự (email hoặc tên).'); return; }
    setError(null);
    try { setFound((await educationAdminApi.findUsers(query)).items); } catch (e) { setError(errorMessage(e)); }
  };
  const open = async (id: number) => {
    setError(null); setAction(null);
    try { setLearner(await educationAdminApi.user(id)); } catch (e) { setError(errorMessage(e)); }
  };
  const start = (a: Action) => { setAction(a); setGrade(learner?.grade ?? null); setRegion(learner?.region ?? null); setReason(''); setVerification(''); };

  const submit = async () => {
    if (!learner || !action || busy) return;
    if (reason.trim().length < 5) { setError('Lý do cần ít nhất 5 ký tự.'); return; }
    if (verification.trim().length < 3) { setError('Ghi mã yêu cầu hỗ trợ hoặc cách đã xác minh (ít nhất 3 ký tự).'); return; }
    if (action === 'grade' && !grade) { setError('Chọn lớp đúng.'); return; }
    const what = action === 'grade' ? `đổi lớp từ ${learner.grade_label || '—'} sang ${gradeLabel(grade)}`
      : action === 'repeat' ? `giữ ${learner.grade_label} cho năm học sau (học lại)`
      : action === 'promote' ? `cho ${learner.email} lên lớp ngay (đóng năm học ${learner.academic_year_label})`
      : `áp dụng lịch năm học của ${regions.find((r) => r.id === region)?.label ?? region}`;
    const ok = await confirm({ title: `${ACTION_LABEL[action]}?`, message: `Xác nhận ${what}. Lý do: ${reason.trim()}`,
      confirmLabel: 'Lưu thay đổi', cancelLabel: 'Huỷ', icon: 'shield-checkmark-outline' });
    if (!ok) return;
    setBusy(true); setError(null);
    const s = { reason: reason.trim(), verification: verification.trim() };
    try {
      if (action === 'grade') await educationAdminApi.correctGrade(learner.id, grade!, s);
      else if (action === 'repeat') await educationAdminApi.repeat(learner.id, s);
      else if (action === 'promote') await educationAdminApi.promote(learner.id, s);
      else await educationAdminApi.changeRegion(learner.id, region!, s);
      toast('Đã lưu thay đổi');
      setAction(null);
      await open(learner.id);
      onChanged();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  if (learner) {
    return (
      <>
        <Button title="Danh sách tìm kiếm" icon="arrow-back" variant="ghost" onPress={() => { setLearner(null); setAction(null); }} />
        <Card style={styles.card}>
          <Text style={styles.title}>{learner.display_name}</Text>
          <Text style={styles.muted}>{learner.email}</Text>
          <Text style={styles.line}>Lớp: {learner.grade_label || 'Chưa có'}{learner.academic_year_label ? ` · Năm học ${learner.academic_year_label}` : ''}</Text>
          <Text style={styles.line}>Địa phương: {learner.region ?? '—'} · Lớp khi đăng ký: {gradeLabel(learner.initial_grade) || '—'}</Text>
          {learner.hold_next_promotion ? <Text style={styles.note}>Năm học sau sẽ học lại lớp này.</Text> : null}
          {learner.awaiting_calendar ? <Text style={styles.note}>Năm học {learner.awaiting_calendar} đã bắt đầu nhưng lịch chưa xác minh: đang giữ nguyên lớp.</Text> : null}
        </Card>
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {action ? (
          <Card style={styles.card}>
            <Text style={styles.title}>{ACTION_LABEL[action]}</Text>
            {action === 'grade' ? <Chips label="Lớp đúng" options={GRADES.map((g) => ({ id: g.id as string, label: g.label }))} value={grade} onChange={setGrade} /> : null}
            {action === 'region' ? <Chips label="Địa phương" options={regions} value={region} onChange={setRegion} /> : null}
            <Field label="Lý do" value={reason} onChangeText={setReason} placeholder="Ví dụ: phụ huynh xác nhận đăng ký nhầm lớp" maxLength={300} />
            <Field label="Xác minh" value={verification} onChangeText={setVerification} placeholder="Mã yêu cầu hỗ trợ / cách xác minh" maxLength={120} />
            <View style={styles.row}>
              <Button title="Lưu" icon="checkmark" style={styles.flex} loading={busy} onPress={() => void submit()} />
              <Button title="Huỷ" variant="secondary" style={styles.flex} disabled={busy} onPress={() => setAction(null)} />
            </View>
          </Card>
        ) : learner.academic_year !== null ? (
          <View style={styles.actions}>
            <Button title={ACTION_LABEL.grade} icon="create-outline" variant="secondary" onPress={() => start('grade')} />
            <Button title={ACTION_LABEL.repeat} icon="repeat-outline" variant="secondary" disabled={learner.status !== 'studying'} onPress={() => start('repeat')} />
            <Button title={ACTION_LABEL.promote} icon="arrow-up-circle-outline" variant="secondary" disabled={!learner.can_promote} onPress={() => start('promote')} />
            <Button title={ACTION_LABEL.region} icon="map-outline" variant="secondary" onPress={() => start('region')} />
          </View>
        ) : <Text style={styles.muted}>Tài khoản này chưa có lớp học.</Text>}
        <Text style={styles.section} accessibilityRole="header">Lịch sử thay đổi lớp</Text>
        {learner.history.slice().reverse().map((h) => (
          <View key={h.id} style={styles.history}>
            <Text style={styles.historyTitle}>{KIND_LABEL[h.kind] ?? h.kind}: {h.from_grade ? `${gradeLabel(h.from_grade)} → ` : ''}{gradeLabel(h.to_grade)} · {h.academic_year_label}</Text>
            <Text style={styles.small}>{when(h.at)} · {h.actor ?? 'Hệ thống'}{h.skipped ? ' · năm không học' : ''}</Text>
            {h.reason ? <Text style={styles.small}>{h.reason}</Text> : null}
          </View>
        ))}
      </>
    );
  }
  return (
    <>
      <View style={styles.row}>
        <SoftInput value={query} onChangeText={setQuery} placeholder="Email hoặc tên học sinh" accessibilityLabel="Tìm học sinh"
          autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => void search()} style={styles.flex} />
        <Button title="Tìm" icon="search" onPress={() => void search()} />
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {found && !found.length ? <Text style={styles.muted}>Không tìm thấy tài khoản nào.</Text> : null}
      {found?.map((u) => (
        <Pressable key={u.id} onPress={() => void open(u.id)} accessibilityRole="button" accessibilityLabel={`${u.display_name}, ${u.email}`}
          style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.historyTitle}>{u.display_name} · {u.email}</Text>
            <Text style={styles.small}>{u.grade_label || 'Chưa có lớp'}{u.academic_year_label ? ` · ${u.academic_year_label}` : ''}{u.region ? ` · ${u.region}` : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
      ))}
    </>
  );
}

// --- Lịch năm học --------------------------------------------------------------------------------------------------------

type Form = Record<'academic_year' | 'school_start_date' | 'opening_date' | 'promotion_date' | 'end_date' | 'source' | 'decision_number' | 'reason', string>
  & { verified: boolean };

const formOf = (y: CalendarYear | null, year: number): Form => ({
  academic_year: String(y?.academic_year ?? year), school_start_date: y?.school_start_date ?? '', opening_date: y?.opening_date ?? '',
  promotion_date: y?.promotion_date ?? '', end_date: y?.end_date ?? '', source: y?.source ?? '', decision_number: y?.decision_number ?? '',
  verified: y?.verified ?? false, reason: '',
});

function Calendar({ regions, onChanged }: { regions: { id: string; label: string }[]; onChanged: () => void }) {
  const { t } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const confirm = useConfirm();
  const [region, setRegion] = useState('VN');
  const [years, setYears] = useState<CalendarYear[] | null>(null);
  const [changes, setChanges] = useState<CalendarChange[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try { const body = await educationAdminApi.calendar(region); setYears(body.years); setChanges(body.changes); }
    catch (e) { setError(errorMessage(e)); }
  }, [region]);
  useEffect(() => { void load(); }, [load]);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async () => {
    if (!form || busy) return;
    const year = Number(form.academic_year);
    const dates = ['school_start_date', 'opening_date', 'promotion_date', 'end_date'] as const;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { setError('Năm học là năm bắt đầu, ví dụ 2027.'); return; }
    if (!DATE.test(form.school_start_date)) { setError('Ngày tựu trường dạng YYYY-MM-DD.'); return; }
    if (dates.some((d) => form[d] && !DATE.test(form[d]))) { setError('Các ngày dạng YYYY-MM-DD (để trống nếu chưa có).'); return; }
    if (form.verified && (!form.source.trim() || !form.decision_number.trim())) { setError('Đã xác minh cần có nguồn và số văn bản.'); return; }
    if (form.reason.trim().length < 5) { setError('Lý do cần ít nhất 5 ký tự.'); return; }
    const input: CalendarInput = { region, academic_year: year, school_start_date: form.school_start_date,
      opening_date: form.opening_date || null, promotion_date: form.promotion_date || null, end_date: form.end_date || null,
      source: form.source.trim() || null, decision_number: form.decision_number.trim() || null, verified: form.verified, reason: form.reason.trim() };
    const ok = await confirm({ title: `Lưu lịch năm học ${year}–${year + 1}?`,
      message: form.verified ? `Học sinh sẽ tự lên lớp vào ngày ${input.promotion_date ?? input.school_start_date} (giờ Việt Nam).`
        : 'Lịch chưa xác minh: học sinh sẽ giữ nguyên lớp cho đến khi lịch được xác minh.',
      confirmLabel: 'Lưu lịch', cancelLabel: 'Huỷ', icon: 'calendar-outline' });
    if (!ok) return;
    setBusy(true); setError(null);
    try { await educationAdminApi.saveCalendar(input); toast('Đã lưu lịch năm học'); setForm(null); await load(); onChanged(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const nextYear = years?.length ? years[years.length - 1].academic_year + 1 : new Date().getFullYear();
  return (
    <>
      {regions.length > 1 ? <Chips label="Địa phương" options={regions} value={region} onChange={setRegion} /> : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {form ? (
        <Card style={styles.card}>
          <Text style={styles.title}>Năm học {form.academic_year}–{Number(form.academic_year) + 1}</Text>
          <Field label="Năm bắt đầu" value={form.academic_year} onChangeText={(v) => set({ academic_year: v })} keyboardType="number-pad" maxLength={4} />
          <Field label="Tựu trường" value={form.school_start_date} onChangeText={(v) => set({ school_start_date: v })} placeholder="YYYY-MM-DD" />
          <Field label="Khai giảng" value={form.opening_date} onChangeText={(v) => set({ opening_date: v })} placeholder="YYYY-MM-DD" />
          <Field label="Ngày lên lớp (mặc định: tựu trường)" value={form.promotion_date} onChangeText={(v) => set({ promotion_date: v })} placeholder="YYYY-MM-DD" />
          <Field label="Kết thúc năm học" value={form.end_date} onChangeText={(v) => set({ end_date: v })} placeholder="YYYY-MM-DD" />
          <Field label="Nguồn quyết định" value={form.source} onChangeText={(v) => set({ source: v })} placeholder="Ví dụ: Khung kế hoạch thời gian năm học" maxLength={200} />
          <Field label="Số văn bản" value={form.decision_number} onChangeText={(v) => set({ decision_number: v })} placeholder="Ví dụ: 1234/QĐ-BGDĐT" maxLength={80} />
          <Pressable onPress={() => set({ verified: !form.verified })} accessibilityRole="switch" accessibilityState={{ checked: form.verified }}
            accessibilityLabel="Đã xác minh theo văn bản" style={styles.toggle}>
            <Ionicons name={form.verified ? 'checkbox' : 'square-outline'} size={22} color={form.verified ? t.success : t.muted} />
            <Text style={styles.line}>Đã xác minh theo văn bản (cho phép tự động lên lớp)</Text>
          </Pressable>
          <Field label="Lý do thay đổi" value={form.reason} onChangeText={(v) => set({ reason: v })} placeholder="Ví dụ: Bộ ban hành khung kế hoạch" maxLength={300} />
          <View style={styles.row}>
            <Button title="Lưu" icon="checkmark" style={styles.flex} loading={busy} onPress={() => void save()} />
            <Button title="Huỷ" variant="secondary" style={styles.flex} disabled={busy} onPress={() => setForm(null)} />
          </View>
        </Card>
      ) : <Button title="Thêm năm học" icon="add" onPress={() => setForm(formOf(null, nextYear))} />}
      {!years && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
      {years && !years.length ? <Text style={styles.muted}>Chưa có năm học nào. Học sinh giữ nguyên lớp cho đến khi có lịch đã xác minh.</Text> : null}
      {years?.slice().reverse().map((y) => (
        <View key={y.academic_year} style={styles.year}>
          <View style={styles.row}>
            <Text style={[styles.historyTitle, styles.flex]}>Năm học {y.label}</Text>
            <View style={[styles.badge, { backgroundColor: y.verified ? t.successBg : t.warningBg }]}>
              <Text style={[styles.badgeText, { color: y.verified ? t.success : t.warning }]}>{y.verified ? 'Đã xác minh' : 'Chưa xác minh'}</Text>
            </View>
          </View>
          <Text style={styles.small}>Tựu trường {y.school_start_date} · Lên lớp {y.promotion_date}{y.opening_date ? ` · Khai giảng ${y.opening_date}` : ''}</Text>
          <Text style={styles.small}>{y.decision_number ? `${y.decision_number} · ` : ''}{y.source ?? 'Chưa có nguồn'}{y.verified_at ? ` · xác minh ${when(y.verified_at)}` : ''}</Text>
          <Button title="Sửa" icon="create-outline" variant="ghost" onPress={() => setForm(formOf(y, y.academic_year))} />
        </View>
      ))}
      {changes.length ? <Text style={styles.section} accessibilityRole="header">Thay đổi gần đây</Text> : null}
      {changes.map((c, i) => (
        <View key={i} style={styles.history}>
          <Text style={styles.historyTitle}>Năm học {c.academic_year}–{c.academic_year + 1} · {c.actor ?? '—'}</Text>
          <Text style={styles.small}>{when(c.at)} · {c.reason}</Text>
        </View>
      ))}
    </>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  flex: { flex: 1 },
  gap: { height: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loading: { marginVertical: 12 },
  card: { gap: 6 },
  title: { fontSize: 17, fontWeight: '900', color: t.ink },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  line: { fontSize: 14, color: t.ink, lineHeight: 20, flexShrink: 1 },
  small: { fontSize: 12, color: t.muted, lineHeight: 17, marginTop: 2 },
  note: { fontSize: 13, fontWeight: '700', color: t.warning, lineHeight: 18 },
  error: { color: t.danger, fontWeight: '700', marginVertical: 8 },
  section: { fontSize: 15, fontWeight: '900', color: t.ink, marginTop: 16, marginBottom: 6 },
  field: { marginBottom: 6 },
  label: { fontSize: 12, fontWeight: '800', color: t.muted, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: t.card, justifyContent: 'center' },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 13, fontWeight: '800', color: t.ink },
  chipTextOn: { color: t.onPrimary },
  alert: { flexDirection: 'row', gap: 8, backgroundColor: t.warningBg, borderRadius: 14, padding: 10, marginBottom: 12 },
  alertText: { fontSize: 13, fontWeight: '700', color: t.warning, lineHeight: 18 },
  actions: { gap: 8, marginTop: 4 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.card, borderRadius: 14, padding: 12, marginTop: 8 },
  pressed: { opacity: 0.85 },
  history: { backgroundColor: t.card, borderRadius: 12, padding: 10, marginBottom: 6 },
  historyTitle: { fontSize: 14, fontWeight: '800', color: t.ink },
  year: { backgroundColor: t.card, borderRadius: 14, padding: 12, marginTop: 8 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '900' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
}));
