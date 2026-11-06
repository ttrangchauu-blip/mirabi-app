import React, { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme } from '../../ui/theme';
import { useWorldMotion } from '../../world/budget';
import { captureScene, PhotosDenied, saveScene } from './exploreShot';

export type PhotoNotice = (text: string, kind: 'success' | 'error', action?: { label: string; onPress: () => void }) => void;

/**
 * All that is left on the screen in photo mode: leave, and the shutter. They stand beside the scene, not in it, so no picture can
 * have them in. `notify` says how it went (a screen inside a native modal can't use the app's toasts).
 */
export function PhotoControls({ scene, top, bottom, onClose, notify, fileName = 'mirabi-kham-pha', testPrefix = 'explore-photo' }: {
  scene: React.RefObject<View | null>; top: number; bottom: number; onClose: () => void; notify: PhotoNotice; fileName?: string; testPrefix?: string;
}) {
  const { t } = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const flash = useRef(new Animated.Value(0)).current;
  const { animate } = useWorldMotion();
  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureScene(scene);
      if (animate) { flash.setValue(0.7); Animated.timing(flash, { toValue: 0, duration: 320, useNativeDriver: true }).start(); }
      const how = await saveScene(uri, fileName);
      notify(how === 'saved' ? 'Đã lưu ảnh vào thư viện' : 'Ảnh đang được tải xuống', 'success');
    } catch (e) {
      if (e instanceof PhotosDenied) {
        notify(e.message, 'error', e.canAskAgain ? undefined : { label: 'Mở Cài đặt', onPress: () => { void Linking.openSettings(); } });
      } else notify('Chưa chụp được ảnh. Hãy thử lại nhé.', 'error');
    } finally { setBusy(false); }
  };
  return <>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.flash, { opacity: flash }]} />
    <Pressable onPress={onClose} style={[s.exit, { top }]} accessibilityRole="button" accessibilityLabel="Thoát chế độ chụp ảnh" hitSlop={8} testID={`${testPrefix}-close`}>
      <Ionicons name="contract-outline" size={22} color="#FFFFFF" />
    </Pressable>
    <Pressable onPress={() => { void shoot(); }} disabled={busy} style={[s.shutter, { bottom }]} accessibilityRole="button" accessibilityLabel="Chụp ảnh và lưu vào thư viện" accessibilityState={{ busy, disabled: busy }} hitSlop={8} testID={`${testPrefix}-shoot`}>
      <View style={s.shutterFace}>{busy ? <ActivityIndicator color={t.accent} /> : <Ionicons name="camera" size={26} color={t.accent} />}</View>
    </Pressable>
  </>;
}

// The flash and the dark round "leave" button stay the same over any scene; the shutter's face is interface glass.
const useStyles = makeStyles(({ t }) => StyleSheet.create({
  flash: { backgroundColor: '#FFFFFF' },
  exit: { position: 'absolute', right: 14, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(24,40,64,0.42)' },
  shutter: { position: 'absolute', alignSelf: 'center', width: 72, height: 72, borderRadius: 36, padding: 5, backgroundColor: 'rgba(255,255,255,0.42)' },
  shutterFace: { flex: 1, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass },
}));
