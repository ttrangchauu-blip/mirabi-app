import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SvgXml } from 'react-native-svg';
import { Text } from '../../components/Typography';
import { PetArt } from '../../components/PetArt';
import type { Memory, MemoryPalette, MemoryTemplate } from './memoryTypes';

const PALETTES: Record<MemoryPalette, readonly [string, string, string]> = {
  sky: ['#DDF1F6', '#F5F1DD', '#FDF8ED'],
  lilac: ['#E9E4F8', '#F5EEFA', '#FFF9ED'],
  peach: ['#F9E2D9', '#FFF0DB', '#F8F4E9'],
};
const defaults: Record<MemoryTemplate, string> = {
  auto: 'Kỷ niệm của chúng mình', hatch: 'Ngày chúng mình gặp nhau', evolve: 'Một bước trưởng thành',
  study: 'Thêm một ngày tiến bộ', together: 'Cùng nhau tiến bộ', walk: 'Một chuyến đi đáng nhớ',
};
export const templateFor = (event: string): MemoryTemplate => event === 'pet_hatched' ? 'hatch' : event === 'pet_evolved' ? 'evolve'
  : event === 'first_group_session' ? 'together' : event === 'first_learning_session' || event === 'first_daily_quests' ? 'study' : 'auto';

/** A memory's picture. Room photos show the image taken in the room (stored, never redrawn); other memories draw
 * their poster from the snapshot. */
export function MemoryImage({ memory, compact = false }: { memory: Parameters<typeof MemoryPoster>[0]['memory'] & Pick<Memory, 'thumbnail_svg' | 'image_svg'>; compact?: boolean }) {
  const stored = memory.event_type === 'room_photo' ? (compact ? memory.thumbnail_svg : memory.image_svg) : null;
  if (!stored) return <MemoryPoster memory={memory} compact={compact} />;
  return <View style={compact ? styles.compact : styles.large} testID="room-photo-image" accessible accessibilityRole="image"
    accessibilityLabel={memory.title}><SvgXml xml={stored} width="100%" height="100%" /></View>;
}

export function MemoryPoster({ memory, compact = false }: { memory: Pick<Memory, 'snapshot' | 'title' | 'message' | 'event_at' | 'event_type' | 'template_key' | 'palette_key' | 'include_message'>; compact?: boolean }) {
  const template = memory.template_key && memory.template_key !== 'auto' ? memory.template_key : templateFor(memory.event_type);
  const palette = PALETTES[memory.palette_key ?? 'sky'];
  const date = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(memory.event_at));
  const title = memory.title || defaults[template];
  return <LinearGradient colors={palette} style={[styles.poster, compact ? styles.compact : styles.large]}>
    <View style={[styles.sun, compact && styles.sunSmall]} />
    <View style={[styles.cloud, styles.cloudOne]} /><View style={[styles.cloud, styles.cloudTwo]} />
    {!compact && <View style={styles.heading}><Text numberOfLines={2} adjustsFontSizeToFit style={styles.title}>{title}</Text></View>}
    {compact && <View style={styles.miniLabel}><Ionicons name={template === 'study' ? 'book' : template === 'together' ? 'people' : 'sparkles'} size={12} color="#496775" /></View>}
    <View style={[styles.petStage, compact && styles.petStageSmall]}>
      {template === 'evolve' && memory.snapshot.level > 1 && !compact ? <View style={styles.before}><PetArt pet={memory.snapshot.pet_id} stage={memory.snapshot.level - 1} size={82} still /></View> : null}
      <PetArt pet={memory.snapshot.pet_id} stage={memory.snapshot.level} size={compact ? 104 : 200} still />
    </View>
    {!compact && <View style={styles.footer}>
      {memory.snapshot.result ? <Text numberOfLines={2} style={styles.result}>{memory.snapshot.result}</Text> : <Text style={styles.petName}>{memory.snapshot.pet_name}</Text>}
      {memory.include_message && memory.message ? <Text numberOfLines={2} style={styles.message}>{memory.message}</Text> : null}
      <Text style={styles.date}>{date}</Text>
    </View>}
    <Text style={[styles.brand, compact && styles.brandSmall]}>Mirabi</Text>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  poster: { overflow: 'hidden', alignItems: 'center', position: 'relative' }, compact: { height: 132 }, large: { width: '100%', aspectRatio: 1080 / 1350 },
  sun: { position: 'absolute', width: 168, height: 168, borderRadius: 84, backgroundColor: '#FFF8DDBB', top: 112 }, sunSmall: { width: 76, height: 76, top: 29 },
  cloud: { position: 'absolute', height: 26, width: 92, borderRadius: 30, backgroundColor: '#FFFFFF70' }, cloudOne: { left: -18, top: 90 }, cloudTwo: { right: -25, top: 180 },
  heading: { position: 'absolute', top: 24, left: 24, right: 24, minHeight: 62, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 23, lineHeight: 28, fontWeight: '900', color: '#173B52', textAlign: 'center' },
  miniLabel: { position: 'absolute', left: 11, top: 11, width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFFC9', alignItems: 'center', justifyContent: 'center' },
  petStage: { position: 'absolute', top: 92, left: 20, right: 20, height: 218, alignItems: 'center', justifyContent: 'center' }, petStageSmall: { top: 17, height: 108 },
  before: { position: 'absolute', left: 0, bottom: 8, width: 92, height: 92, borderRadius: 18, backgroundColor: '#FFFFFFA6', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 24, right: 24, bottom: 31, alignItems: 'center' }, result: { color: '#173B52', fontWeight: '900', fontSize: 17, lineHeight: 22, textAlign: 'center' }, petName: { color: '#173B52', fontWeight: '900', fontSize: 18 }, message: { color: '#4F6C79', textAlign: 'center', marginTop: 5, fontSize: 12, lineHeight: 16 }, date: { color: '#58717E', marginTop: 6, fontSize: 12, fontWeight: '700' },
  brand: { position: 'absolute', right: 20, bottom: 14, color: '#35728E', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, brandSmall: { right: 9, bottom: 7, fontSize: 8 },
});
