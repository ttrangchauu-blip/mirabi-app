import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { educationApi, type Note, type NoteInput } from '../../learning/education';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Card, SoftInput } from '../../ui/kit';
import { useToast } from '../../ui/Toast';

// Sổ tay kiến thức → Ghi chú của tôi (backend education.py /api/education/notes): notes the learner writes, on a subject
// and optionally a lesson, kept per school year. They are never touched by a promotion; older years' notes stay listed.

export type NoteSubject = { code: string; name: string };
export type NoteLesson = { key: string; title: string; subject: string };
/** Open the editor at once, for a lesson (the "Ghi chú" button of a lesson). */
export type NoteDraft = { subject: string; lessonKey?: string | null };

type Props = {
  /** The subjects of the learner's grade (a note belongs to one). */
  subjects: NoteSubject[];
  /** Lessons a note can be linked to (those studied this year). */
  lessons: NoteLesson[];
  /** The current school year: its notes can be filtered apart from older ones. */
  academicYear?: number | null;
  draft?: NoteDraft | null;
};

type Editing = { id: number | null; input: NoteInput };

const empty = (subject = '', lessonKey: string | null = null): NoteInput => ({ title: '', body: '', subject, lesson_key: lessonKey });

/** The notes list (search, this year / every year), with an inline editor to add, edit or delete one. */
export function NotesPanel({ subjects, lessons, academicYear, draft }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [onlyThisYear, setOnlyThisYear] = useState(true);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(draft ? { id: null, input: empty(draft.subject, draft.lessonKey ?? null) } : null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await educationApi.notes({ q: query, academic_year: onlyThisYear ? academicYear : null });
      setNotes(body.items);
    } catch (e) { setError(errorMessage(e)); }
  }, [query, onlyThisYear, academicYear]);
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, query ? 250 : 0); // typing searches once it pauses
    return () => clearTimeout(timer);
  }, [load, query]);

  const save = async () => {
    if (!editing || saving) return;
    const input = { ...editing.input, title: editing.input.title.trim(), body: editing.input.body.trim() };
    if (!input.subject) { setFormError('Hãy chọn môn học cho ghi chú.'); return; }
    if (!input.body) { setFormError('Hãy viết nội dung ghi chú.'); return; }
    setSaving(true); setFormError(null);
    try {
      if (editing.id === null) await educationApi.createNote(input); else await educationApi.updateNote(editing.id, input);
      toast(editing.id === null ? 'Đã lưu ghi chú' : 'Đã cập nhật ghi chú');
      setEditing(null);
      void load();
    } catch (e) { setFormError(errorMessage(e)); }
    finally { setSaving(false); }
  };

  const remove = async (note: Note) => {
    const ok = await confirm({ title: 'Xoá ghi chú?', message: `“${note.title || note.body.slice(0, 40)}” sẽ bị xoá.`,
      confirmLabel: 'Xoá', cancelLabel: 'Giữ lại', destructive: true, icon: 'trash-outline' });
    if (!ok) return;
    try { await educationApi.deleteNote(note.id); setNotes((list) => list?.filter((n) => n.id !== note.id) ?? null); }
    catch (e) { toast(errorMessage(e), 'error'); }
  };

  const set = (patch: Partial<NoteInput>) => setEditing((e) => (e ? { ...e, input: { ...e.input, ...patch } } : e));
  const subjectLessons = editing ? lessons.filter((l) => l.subject === editing.input.subject) : [];

  return (
    <>
      {editing ? (
        <Card style={styles.editor}>
          <Text style={styles.cardTitle} accessibilityRole="header">{editing.id === null ? 'Ghi chú mới' : 'Sửa ghi chú'}</Text>
          <SoftInput value={editing.input.title} onChangeText={(title) => set({ title })} placeholder="Tiêu đề (không bắt buộc)"
            accessibilityLabel="Tiêu đề ghi chú" maxLength={120} />
          <SoftInput value={editing.input.body} onChangeText={(body) => set({ body })} placeholder="Viết điều bạn muốn nhớ…"
            accessibilityLabel="Nội dung ghi chú" multiline maxLength={5000} style={styles.body} />
          <Text style={styles.label}>Môn học</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Môn học">
            {subjects.map((s) => {
              const on = editing.input.subject === s.code;
              return (
                <Pressable key={s.code} onPress={() => set({ subject: s.code, lesson_key: null })} accessibilityRole="radio"
                  accessibilityState={{ checked: on }} accessibilityLabel={s.name} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {subjectLessons.length ? (
            <>
              <Text style={styles.label}>Bài học (không bắt buộc)</Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Bài học">
                {subjectLessons.map((l) => {
                  const on = editing.input.lesson_key === l.key;
                  return (
                    <Pressable key={l.key} onPress={() => set({ lesson_key: on ? null : l.key })} accessibilityRole="radio"
                      accessibilityState={{ checked: on }} accessibilityLabel={l.title} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{l.title}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          {formError ? <Text style={styles.error} accessibilityLiveRegion="polite">{formError}</Text> : null}
          <View style={styles.row}>
            <Button title="Lưu" icon="checkmark" style={styles.flex} loading={saving} onPress={() => void save()} />
            <Button title="Huỷ" variant="secondary" style={styles.flex} disabled={saving} onPress={() => { setEditing(null); setFormError(null); }} />
          </View>
        </Card>
      ) : (
        <Button title="Thêm ghi chú" icon="add" disabled={!subjects.length}
          onPress={() => setEditing({ id: null, input: empty(subjects.length === 1 ? subjects[0].code : '') })} />
      )}
      <SoftInput value={query} onChangeText={setQuery} placeholder="Tìm ghi chú" accessibilityLabel="Tìm ghi chú" returnKeyType="search"
        style={styles.search} />
      {academicYear ? (
        <View style={styles.chips}>
          {[true, false].map((only) => (
            <Pressable key={String(only)} onPress={() => setOnlyThisYear(only)} accessibilityRole="radio" accessibilityState={{ checked: onlyThisYear === only }}
              style={[styles.chip, onlyThisYear === only && styles.chipOn]}>
              <Text style={[styles.chipText, onlyThisYear === only && styles.chipTextOn]}>{only ? 'Năm học này' : 'Tất cả năm học'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={() => void load()} /></Card> : null}
      {!notes && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
      {notes && !notes.length ? (
        <Text style={styles.muted}>{query ? 'Không tìm thấy ghi chú nào.' : 'Chưa có ghi chú. Ghi lại điều bạn muốn nhớ khi học nhé.'}</Text>
      ) : null}
      {notes?.map((n) => (
        <View key={n.id} style={styles.note} accessible={false}>
          <View style={styles.row}>
            <View style={styles.flex}>
              {n.title ? <Text style={styles.noteTitle}>{n.title}</Text> : null}
              <Text style={styles.meta}>{[n.subject_name, n.lesson_title, n.academic_year_label ? `${n.grade_label} · ${n.academic_year_label}` : null]
                .filter(Boolean).join(' · ')}</Text>
            </View>
            <Pressable onPress={() => setEditing({ id: n.id, input: { title: n.title, body: n.body, subject: n.subject, lesson_key: n.lesson_key } })}
              accessibilityRole="button" accessibilityLabel={`Sửa ghi chú ${n.title || ''}`.trim()} hitSlop={8} style={styles.icon}>
              <Ionicons name="create-outline" size={20} color={t.accent} />
            </Pressable>
            <Pressable onPress={() => void remove(n)} accessibilityRole="button" accessibilityLabel={`Xoá ghi chú ${n.title || ''}`.trim()}
              hitSlop={8} style={styles.icon}>
              <Ionicons name="trash-outline" size={20} color={t.danger} />
            </Pressable>
          </View>
          <Text style={styles.noteBody}>{n.body}</Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loading: { marginVertical: 12 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  error: { color: t.danger, fontWeight: '700', marginVertical: 6 },
  editor: { gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  body: { minHeight: 110, textAlignVertical: 'top' },
  label: { fontSize: 13, fontWeight: '800', color: t.muted, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 13, fontWeight: '800', color: t.ink },
  chipTextOn: { color: '#FFFFFF' },
  search: { marginTop: 12 },
  note: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginTop: 10, gap: 6 },
  noteTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  meta: { fontSize: 12, fontWeight: '700', color: t.muted, marginTop: 1 },
  noteBody: { fontSize: 15, lineHeight: 22, color: t.ink },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
