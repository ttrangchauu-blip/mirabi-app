import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { newIdempotencyKey } from '../../api/client';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { roomApi } from '../../room/api';
import type { Pose } from '../../room/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { Button, SoftInput } from '../../ui/kit';
import type { Memory } from '../main/memoryTypes';

type Props = { visible: boolean; pose: Pose; onClose: () => void; onSaved: (memory: Memory) => void };

/**
 * "Chụp ảnh": preview -> optional title and note -> save to the memory album. The preview is the image the backend
 * will store (same renderer), and "Lưu" waits until the preview shows the current text, so what is saved is what was
 * seen. A failed save keeps everything and offers to try again with the same request id (never a duplicate).
 */
export function PhotoSheet({ visible, pose, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ svg: string; for: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryPreview, setRetryPreview] = useState(0);
  const requestId = useRef(newIdempotencyKey());
  const wanted = useMemo(() => JSON.stringify([pose, title.trim(), message.trim()]), [pose, title, message]);

  useEffect(() => {
    if (!visible) return;
    requestId.current = newIdempotencyKey();
    setTitle(''); setMessage(''); setPreview(null); setPreviewError(null); setSaveError(null);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let stale = false;
    const timer = setTimeout(() => {
      roomApi.preview(pose, title, message)
        .then((r) => { if (!stale) { setPreview({ svg: r.svg, for: wanted }); setPreviewError(null); } })
        .catch((e) => { if (!stale) setPreviewError(errorMessage(e)); });
    }, preview ? 450 : 0);
    return () => { stale = true; clearTimeout(timer); };
  }, [visible, wanted, retryPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = preview?.for === wanted;
  async function save() {
    setSaving(true); setSaveError(null);
    try {
      onSaved(await roomApi.savePhoto(pose, title, message, requestId.current));
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally { setSaving(false); }
  }

  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!saving) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!saving) onClose(); }} accessibilityRole="button" accessibilityLabel="Đóng" />
        <View style={[s.sheet, { marginTop: insets.top + 12 }]} accessibilityViewIsModal testID="room-photo-sheet">
          <View style={s.header}>
            <View style={s.flex}>
              <Text style={s.title} accessibilityRole="header">Chụp ảnh phòng</Text>
              <Text style={s.subtitle}>Ảnh chỉ có căn phòng và pet, không có nút hay thanh menu.</Text>
            </View>
            <Pressable onPress={onClose} disabled={saving} style={s.close} accessibilityRole="button" accessibilityLabel="Đóng chụp ảnh">
              <Ionicons name="close" size={20} color={t.ink} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.body, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={s.preview} testID="room-photo-preview">
              {preview ? <SvgXml xml={preview.svg} width="100%" height="100%" /> : null}
              {!current && !previewError ? <View style={s.previewBusy}><ActivityIndicator color={t.accent} /></View> : null}
              {previewError ? (
                <View style={s.previewBusy}>
                  <Text style={s.errorText}>{`Chưa tạo được ảnh xem trước. ${previewError}`}</Text>
                  <Button title="Thử lại" icon="refresh" variant="secondary" onPress={() => { setPreviewError(null); setRetryPreview((n) => n + 1); }} />
                </View>
              ) : null}
            </View>
            <Text style={s.label}>Tiêu đề (không bắt buộc)</Text>
            <SoftInput value={title} onChangeText={setTitle} maxLength={40} placeholder="Ví dụ: Buổi chiều yên tĩnh" accessibilityLabel="Tiêu đề ảnh" />
            <Text style={s.label}>Lời nhắn ngắn (không bắt buộc)</Text>
            <SoftInput value={message} onChangeText={setMessage} maxLength={60} placeholder="Một dòng nhỏ để nhớ lại" accessibilityLabel="Lời nhắn trên ảnh" />
            {saveError ? <Text style={s.errorText} accessibilityLiveRegion="polite">{`Chưa lưu được ảnh: ${saveError} Nội dung vẫn được giữ, bạn thử lại nhé.`}</Text> : null}
            <Button title={saveError ? 'Thử lại' : 'Lưu vào Album kỷ niệm'} icon="images-outline" loading={saving} disabled={!current}
              onPress={() => { void save(); }} style={s.save} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,40,58,0.36)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '94%', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  title: { color: t.ink, fontSize: 19, fontWeight: '900' },
  subtitle: { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.tint },
  body: { paddingHorizontal: 20 },
  preview: { width: '100%', maxWidth: 300, aspectRatio: 1080 / 1350, alignSelf: 'center', borderRadius: 18, overflow: 'hidden',
    backgroundColor: '#FBF6EE', borderWidth: 1, borderColor: '#EDE4D8' },
  previewBusy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, backgroundColor: '#FBF6EEB3' },
  label: { color: t.ink, fontSize: 13, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  errorText: { color: t.danger, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  save: { marginTop: 16 },
});
