import React, { memo, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { type Light, mixColor } from '../../components/daylight';
import { Text } from '../../components/Typography';
import type { Friend } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { radius, tones, type as typeScale } from '../../ui/design';
import { useAtmosphere } from '../../world/atmosphere';
import { CloudDeck, Rain, Snow, WeatherChip } from '../../world/living';
import { SkyBodies, Stars, wave } from '../../world/sky';
import { useWeather } from '../../world/weather';
import { FriendsScreen, type FriendsTab } from '../together/FriendsScreen';
import { PetAvatar } from '../together/ui';

type Props = {
  top: number; initialTab: FriendsTab;
  onVisit: (userId: number) => void; onVisitGarden: (userId: number) => void; onOpenStudyRoom: (roomId: number) => void;
  onRequestsChanged: () => void; onOpenFeed: () => void;
  /** Thị trấn Mirabi, for those aged 16 and over. */ onOpenTown?: () => void;
};

const STREET_HEIGHT = 176;
const SHOWN = 6;

/** Bạn bè: a street with a house per friend, on top of what was already the friends screen (requests, codes, the list).
 * A tap on a house goes straight in; everything else about a friend stays in their menu in the list. */
export function FriendsSpace({ top, initialTab, onVisit, onVisitGarden, onOpenStudyRoom, onRequestsChanged, onOpenFeed, onOpenTown }: Props) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  return (
    <ScrollView style={s.fill} contentContainerStyle={[s.body, { paddingTop: top + 10 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" testID="friends-space">
      <Street friends={friends} onVisit={onVisit} />
      <View style={s.tiles}>
        <Tile icon="newspaper" title="Bảng tin" subtitle="Lan tỏa điều tích cực" tone="rose" onPress={onOpenFeed} />
        {onOpenTown ? <Tile icon="business" title="Thị trấn Mirabi" subtitle="Công trình chung, quà tặng" tone="lilac" onPress={onOpenTown} testID="open-town" /> : null}
      </View>
      <FriendsScreen key={initialTab} initialTab={initialTab} onVisit={onVisit} onVisitGarden={onVisitGarden} onOpenStudyRoom={onOpenStudyRoom}
        onRequestsChanged={onRequestsChanged} onFriends={setFriends} embedded />
    </ScrollView>
  );
}

function Tile({ icon, title, subtitle, tone, onPress, testID }: { icon: 'newspaper' | 'business'; title: string; subtitle: string; tone: keyof typeof tones; onPress: () => void; testID?: string }) {
  const c = tones[tone];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`${title}: ${subtitle}`} testID={testID}>
      <LinearGradient colors={[c.from, c.to]} style={s.tileIcon}><Ionicons name={icon} size={18} color={c.ink} /></LinearGradient>
      <View style={s.flex}>
        <Text style={s.tileTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.tileSub} numberOfLines={1}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const HOUSE_COLORS = [['#FFD9B8', '#D9734E'], ['#D4E8FF', '#5B86C4'], ['#DFF3D3', '#5E9E5A'], ['#F4DCF4', '#A365A6'], ['#FFF0BC', '#C08A2E'], ['#D6F2EC', '#3F9486']];

/** One friend's house, its own colours by position in the street; lights on after dark. */
const House = memo(function House({ wall, roof, lit, size }: { wall: string; roof: string; lit: boolean; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect x={12} y={28} width={40} height={32} rx={3} fill={wall} stroke="#3C3A3E" strokeOpacity={0.35} strokeWidth={1.4} />
      <Path d="M6 30 32 8l26 22Z" fill={roof} stroke="#3C3A3E" strokeOpacity={0.35} strokeWidth={1.4} strokeLinejoin="round" />
      <Rect x={27} y={42} width={11} height={18} rx={2} fill={mixColor(roof, '#3C2C20', 0.3)} />
      <Rect x={16} y={36} width={8} height={8} rx={1.5} fill={lit ? '#FFE27A' : '#BFE3F5'} />
      <Rect x={42} y={36} width={7} height={8} rx={1.5} fill={lit ? '#FFE27A' : '#BFE3F5'} />
      <Circle cx={36} cy={52} r={0.9} fill="#FFE27A" />
    </Svg>
  );
});

const Street = memo(function Street({ friends, onVisit }: { friends: Friend[] | null; onVisit: (userId: number) => void }) {
  const { reading } = useWeather();
  const { hours, mood, light: c, night } = useAtmosphere(reading);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const shown = (friends ?? []).slice(0, SHOWN);
  const ground = STREET_HEIGHT - 38;
  return (
    <View style={s.street} onLayout={onLayout} testID="friend-street">
      <LinearGradient colors={c.sky} style={StyleSheet.absoluteFill} />
      {width ? <StreetBack width={width} ground={ground} hours={hours} c={c} cover={mood.cover} /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.houses} style={StyleSheet.absoluteFill}>
        {shown.map((f, i) => (
          <Pressable key={f.id} onPress={() => onVisit(f.id)} disabled={!f.can_visit} style={({ pressed }) => [s.house, pressed && s.pressed, !f.can_visit && s.closed]} accessibilityRole="button"
            accessibilityLabel={f.can_visit ? `Nhà của ${f.display_name}, chạm để ghé thăm` : `Nhà của ${f.display_name}, đang tắt ghé thăm`} accessibilityState={{ disabled: !f.can_visit }} testID={`friend-house-${f.id}`}>
            <House wall={HOUSE_COLORS[i % 6][0]} roof={HOUSE_COLORS[i % 6][1]} lit={night} size={78} />
            <View style={s.housePet}><PetAvatar user={f} size={26} /></View>
            <Text style={s.houseName} numberOfLines={1}>{f.display_name}</Text>
          </Pressable>
        ))}
        {friends && !friends.length ? <View style={s.emptyStreet}><Text style={s.emptyText}>Con phố còn vắng. Kết bạn bằng mã bên dưới, nhà của bạn bè sẽ hiện ở đây.</Text></View> : null}
      </ScrollView>
      <View style={s.streetChip} pointerEvents="none"><WeatherChip night={night} tone={night ? 'light' : 'dark'} /></View>
      {width ? <><Rain width={width} height={STREET_HEIGHT} strength={mood.rain} wind={mood.wind} ground={0.82} /><Snow width={width} height={STREET_HEIGHT} strength={mood.snow} /></> : null}
    </View>
  );
});

const StreetBack = memo(function StreetBack({ width, ground, hours, c, cover }: { width: number; ground: number; hours: number; c: Light; cover: number }) {
  return <>
    {c.stars > 0 ? <Stars width={width} height={ground} opacity={c.stars} /> : null}
    <SkyBodies width={width} hours={hours} c={c} horizon={ground - 14} zenith={22} clip={ground - 6} idPrefix="street" />
    <CloudDeck width={width} top={22} color={c.cloud} opacity={c.cloudOpacity} cover={cover} scale={1} />
    <Svg width={width} height={STREET_HEIGHT} style={StyleSheet.absoluteFill}>
      <Path d={wave(width, ground - 26, 7, 2, STREET_HEIGHT, 0.6)} fill={c.hills[0]} />
      <Path d={wave(width, ground - 4, 2, 2, STREET_HEIGHT, 1.2)} fill={c.meadow} />
      <Rect x={0} y={ground + 12} width={width} height={STREET_HEIGHT} fill={c.path[0]} />
      <Rect x={0} y={ground + 12} width={width} height={3} fill={c.path[1]} />
    </Svg>
  </>;
});

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 28 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  street: { height: STREET_HEIGHT, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 12, backgroundColor: t.hero },
  houses: { minWidth: '100%', flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingBottom: 6, gap: 6, height: STREET_HEIGHT },
  house: { width: 84, alignItems: 'center' },
  closed: { opacity: 0.7 },
  housePet: { position: 'absolute', right: 6, bottom: 26 },
  houseName: { ...typeScale.micro, color: t.ink, marginTop: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.86)', maxWidth: 84 },
  emptyStreet: { flex: 1, alignSelf: 'center', paddingHorizontal: 24 },
  emptyText: { ...typeScale.caption, color: t.ink, textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.86)', borderRadius: radius.sm, padding: 8 },
  streetChip: { position: 'absolute', top: 6, right: 8 },
  tiles: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tile: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, backgroundColor: '#FFFFFF' },
  tileIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { ...typeScale.label, fontSize: 14, color: t.ink },
  tileSub: { ...typeScale.micro, fontWeight: '600', color: t.muted },
});
