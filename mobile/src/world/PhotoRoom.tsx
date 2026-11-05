import React, { useRef, useState } from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Typography';
import { PhotoControls, type PhotoNotice } from '../screens/life/PhotoControls';
import { AppModal } from '../ui/AppModal';

/** The rendered rooms' pictures: 1280 x 880, with 860 more above and below for photo mode, of the same camera. */
const BAND = 880 / 1280, BLEED = 860 / 1280;

/** How wide a study room is drawn on a screen of this size: a little past its sides on a tall phone, and as much as the pictures above and below it need. */
export function photoBand(width: number, height: number) {
  const tall = width / height < 1 / BAND;
  const w = tall ? Math.max(width * 1.08, height / (BAND + 2 * BLEED)) : Math.max(width, height / BAND);
  return { width: w, height: w * BAND, bleed: w * BLEED };
}

/**
 * A study room alone on the screen: no header, no tabs, no timer and no menu bar, only the room with more of its wall above and floor
 * below, a small way out and the shutter. It only covers the screen: the session under it goes on as it was, so nothing about the timer,
 * the connection or the reward changes. What is captured is `children` and those two pictures, never anything else.
 */
export function PhotoRoom({ onClose, top, near, fileName, testPrefix, children }: {
  onClose: () => void; top: ImageSourcePropType; near: ImageSourcePropType; fileName: string; testPrefix: string; children: (width: number, height: number) => React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scene = useRef<View | null>(null);
  const [size, setSize] = useState({ width: 390, height: 844 });
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error'; action?: { label: string; onPress: () => void } } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify: PhotoNotice = (text, kind, action) => {
    setNotice({ text, kind, action });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), action ? 6000 : 2600);
  };
  const band = photoBand(size.width, size.height);
  const left = (size.width - band.width) / 2, y = (size.height - band.height) / 2;
  return (
    <AppModal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.root} testID={`${testPrefix}-mode`} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setSize((old) => (old.width === width && old.height === height ? old : { width, height })); }}>
        <View ref={scene} collapsable={false} style={StyleSheet.absoluteFill}>
          <Image source={top} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', left, top: y - band.bleed + 1, width: band.width, height: band.bleed }} />
          <Image source={near} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', left, top: y + band.height - 1, width: band.width, height: band.bleed }} />
          <View style={{ position: 'absolute', left, top: y, width: band.width, height: band.height }}>{children(band.width, band.height)}</View>
        </View>
        <PhotoControls scene={scene} top={insets.top + 10} bottom={insets.bottom + 22} onClose={onClose} notify={notify} fileName={fileName} testPrefix={testPrefix} />
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
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#22304A' },
  notice: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#173B52' },
  noticeError: { backgroundColor: '#8A3B36' },
  noticeText: { flex: 1, color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  noticeAction: { color: '#FFE9A8', fontSize: 13, fontWeight: '900' },
});
