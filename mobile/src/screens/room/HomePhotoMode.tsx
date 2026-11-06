import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../components/Typography';
import { AppModal } from '../../ui/AppModal';
import { PhotoControls } from '../life/PhotoControls';

/**
 * Nhà của Pet alone on the screen: no places bar, no pet's bar, no buttons of the room and no menu bar, only the whole room and pet,
 * a small way out, the shutter (to the device's photos) and "Album" (the memory album, as before). It only covers the screen: the
 * room, its decorating and the pet stay exactly as they were. What is captured is `children`, never the controls.
 */
export function HomePhotoMode({ onClose, onAlbum, children }: {
  onClose: () => void;
  /** "Lưu vào Album kỷ niệm": leaves photo mode for the album's photo sheet. */
  onAlbum?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scene = useRef<View | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error'; action?: { label: string; onPress: () => void } } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (text: string, kind: 'success' | 'error', action?: { label: string; onPress: () => void }) => {
    setNotice({ text, kind, action });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), action ? 6000 : 2600);
  };
  return (
    <AppModal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.root} testID="home-photo-mode">
        <View ref={scene} collapsable={false} style={StyleSheet.absoluteFill}>{children}</View>
        <PhotoControls scene={scene} top={insets.top + 10} bottom={insets.bottom + 22} onClose={onClose} notify={notify} fileName="mirabi-nha-cua-pet" testPrefix="home-photo" />
        {onAlbum ? (
          <Pressable onPress={onAlbum} style={[s.album, { bottom: insets.bottom + 34 }]} accessibilityRole="button" accessibilityLabel="Lưu vào Album kỷ niệm"
            hitSlop={8} testID="home-photo-album">
            <Ionicons name="images-outline" size={18} color="#FFFFFF" />
            <Text style={s.albumText}>Album</Text>
          </Pressable>
        ) : null}
        {notice ? (
          <View style={[s.notice, { top: insets.top + 64 }, notice.kind === 'error' && s.noticeError]} accessibilityLiveRegion="polite">
            <Text style={s.noticeText}>{notice.text}</Text>
            {notice.action ? <Pressable onPress={notice.action.onPress} accessibilityRole="button" hitSlop={6}><Text style={s.noticeAction}>{notice.action.label}</Text></Pressable> : null}
          </View>
        ) : null}
      </View>
    </AppModal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#E8F2FA' },
  album: { position: 'absolute', left: 18, height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(24,40,64,0.42)' },
  albumText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  notice: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#173B52' },
  noticeError: { backgroundColor: '#8A3B36' },
  noticeText: { flex: 1, color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  noticeAction: { color: '#FFE9A8', fontSize: 13, fontWeight: '900' },
});
