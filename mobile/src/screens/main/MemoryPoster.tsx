import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, TextStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { Text } from '../../components/Typography';
import { nunito } from '../../fonts';
import { memoryPicture } from './memoryPicture';
import type { Memory } from './memoryTypes';

/** Stored pictures name the font "Nunito" (older ones a list ending in "sans-serif") and a weight. A phone finds a
 * font loaded by expo-font only by its exact name (Nunito_800ExtraBold), and iOS then picks the file nearest the
 * asked weight, so the weight must be that file's. The web declares those names at the normal weight: asking for 800
 * there would thicken the letters a second time, so it asks for normal. */
export function deviceFonts(svg: string): string {
  return svg.replace(/<text\b([^>]*)>/g, (_, attrs: string) => {
    const asked = /\sfont-weight="([^"]*)"/.exec(attrs)?.[1] ?? '400';
    const family = nunito(asked as TextStyle['fontWeight']);
    const weight = Platform.OS === 'web' ? 'normal' : family.slice(7, 10);
    return `<text${attrs.replace(/\s(?:font-family|font-weight)="[^"]*"/g, '')} font-family="${family}" font-weight="${weight}">`;
  });
}

/** A memory's album card: the thumbnail the backend drew from the event when it happened (memories.py), never
 * redrawn from the pet, room or garden as they are now. Older thumbnails (360 x 260) fill the same 400 x 280 frame,
 * centred. A picture still being drawn shows that, with no stand-in pet. */
export function MemoryImage({ memory }: { memory: Pick<Memory, 'title' | 'thumbnail_svg'> }) {
  const xml = useMemo(() => memory.thumbnail_svg ? deviceFonts(memory.thumbnail_svg) : '', [memory.thumbnail_svg]);
  if (!xml) return <PictureState compact />;
  return <View style={styles.compact} testID="memory-image" accessible accessibilityRole="image" accessibilityLabel={memory.title}>
    <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" /></View>;
}

/** The memory's full picture: the PNG that "Tải ảnh" and "Chia sẻ" hand over (memoryPicture). Nothing stands in
 * while it loads (no enlarged thumbnail); `onReady` gets its URI once it is on screen, and null until then. */
export function MemoryPicture({ memory, onReady }: {
  memory: Pick<Memory, 'id' | 'title' | 'image_key'>; onReady: (uri: string | null) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    let live = true;
    setUri(null); setState('loading'); ready.current(null);
    memoryPicture(memory.id, memory.image_key, attempt > 0)
      .then((next) => { if (live) setUri(next); })
      .catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [memory.id, memory.image_key, attempt]);
  const failed = () => { setUri(null); setState('failed'); ready.current(null); };
  if (state === 'failed') {
    return <PictureState failed text="Chưa tải được ảnh kỷ niệm" onRetry={() => setAttempt((n) => n + 1)} />;
  }
  return <View style={styles.large}>
    {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" testID="memory-picture"
      accessible accessibilityRole="image" accessibilityLabel={memory.title}
      onLoad={() => { setState('shown'); ready.current(uri); }} onError={failed} /> : null}
    {state === 'loading' ? <PictureState text="Đang tải ảnh kỷ niệm…" loading overlay /> : null}
  </View>;
}

/** The create sheet's preview: the PNG of the picture "Lưu kỷ niệm" will store, rendered by the server like the
 * album's (POST /api/memories/preview). `updating`: a newer preview is on its way. */
export function MemoryPreview({ png, label, updating }: { png: string; label: string; updating: boolean }) {
  return <View style={styles.large}>
    <Image source={{ uri: `data:image/png;base64,${png}` }} style={StyleSheet.absoluteFill} resizeMode="contain"
      testID="memory-preview" accessible accessibilityRole="image" accessibilityLabel={label} />
    {updating ? <View style={styles.updating}><ActivityIndicator color="#35728E" /></View> : null}
  </View>;
}

export function PictureState({ compact = false, onRetry, retrying = false, loading = false, failed = false, overlay = false,
  text = 'Đang tạo ảnh kỷ niệm…' }: {
  compact?: boolean; onRetry?: () => void; retrying?: boolean; loading?: boolean; failed?: boolean; overlay?: boolean;
  text?: string;
}) {
  return <View style={[styles.waiting, overlay ? StyleSheet.absoluteFill : compact ? styles.compact : styles.large]}
    testID={failed ? 'memory-image-failed' : 'memory-image-pending'}>
    {retrying || loading ? <ActivityIndicator color="#35728E" />
      : <Ionicons name={failed ? 'alert-circle-outline' : 'hourglass-outline'} size={compact ? 22 : 34} color="#5F8796" />}
    <Text style={[styles.waitingText, compact && styles.waitingSmall]}>{text}</Text>
    {onRetry && !compact ? <Pressable accessibilityRole="button" onPress={onRetry} disabled={retrying} style={styles.retry}>
      <Text style={styles.retryText}>Thử lại</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  compact: { width: '100%', aspectRatio: 400 / 280 }, large: { width: '100%', aspectRatio: 1080 / 1350 },
  waiting: { alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EAF3F4', padding: 12 },
  waitingText: { color: '#4F6C79', fontWeight: '800', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  waitingSmall: { fontSize: 11, lineHeight: 16 },
  retry: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 16, backgroundColor: '#FFFFFF' },
  retryText: { color: '#136FA8', fontWeight: '900' },
  updating: { position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: 19, alignItems: 'center',
    justifyContent: 'center', backgroundColor: '#FFFFFFD9' },
});
