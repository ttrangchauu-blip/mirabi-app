import React, { memo, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { Friend } from '../../studyTogether/types';
import { radius, type Tone, type as typeScale } from '../../ui/design';
import { makeStyles, useTheme } from '../../ui/theme';
import { useAtmosphere } from '../../world/atmosphere';
import { ContactShadow, Plate } from '../../world/diorama';
import { Rain, Snow, WeatherChip } from '../../world/living';
import { LiveSky } from '../../world/liveSky';
import { useWeather } from '../../world/weather';
import { FriendsScreen, type FriendsTab } from '../together/FriendsScreen';
import { STREET_ART, STREET_DOORS, STREET_GATES, STREET_LAMPS, STREET_RATIO, STREET_RIDGE } from './streetArt';

type Props = {
  top: number; initialTab: FriendsTab;
  onVisit: (userId: number) => void; onVisitGarden: (userId: number) => void; onOpenStudyRoom: (roomId: number) => void;
  onRequestsChanged: () => void; onOpenFeed: () => void;
  /** Thị trấn Mirabi, for those aged 16 and over. */ onOpenTown?: () => void;
};

const LAND_HEIGHT = 212;
/** The land stands on the card's bottom edge at its own size; what is above it is open sky. */
const STREET_HEIGHT = LAND_HEIGHT + 52;
/** The street's width at least; the card shows part of it and the rest is a walk along it. */
const STREET_WIDTH = Math.round(LAND_HEIGHT * STREET_RATIO);
/** A plot's width and how far down the picture its tappable part starts, as shares of the picture. */
const PLOT = 0.166;
const PLOT_TOP = 0.3;
const NAME_MARGIN = 46;
const PET_SIZE = 42;
const SHOWN = 6;

/** Bạn bè: a street with a house per friend, on top of what was already the friends screen (requests, codes, the list).
 * A tap on a house goes straight in; everything else about a friend stays in their menu in the list. */
export function FriendsSpace({ top, initialTab, onVisit, onVisitGarden, onOpenStudyRoom, onRequestsChanged, onOpenFeed, onOpenTown }: Props) {
  const s = useStyles();
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

function Tile({ icon, title, subtitle, tone, onPress, testID }: { icon: 'newspaper' | 'business'; title: string; subtitle: string; tone: Tone; onPress: () => void; testID?: string }) {
  const s = useStyles();
  const c = useTheme().tones[tone];
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

const Street = memo(function Street({ friends, onVisit }: { friends: Friend[] | null; onVisit: (userId: number) => void }) {
  const { t } = useTheme();
  const s = useStyles();
  const { reading } = useWeather();
  const { hours, mood, light: c, night } = useAtmosphere(reading);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const shown = (friends ?? []).slice(0, SHOWN);
  const length = Math.max(width, STREET_WIDTH);
  const tall = length / STREET_RATIO;
  const top = STREET_HEIGHT - tall;
  const ridge = top + tall * STREET_RIDGE;
  return (
    <View style={s.street} onLayout={onLayout} testID="friend-street">
      {/* The sky's palest colour meets the land. */}
      <LinearGradient colors={c.sky} end={{ x: 0, y: Math.min(1, (ridge + 24) / STREET_HEIGHT) }} style={StyleSheet.absoluteFill} />
      {width ? <LiveSky id="street" width={width} ridge={ridge} hours={hours} c={c} cover={mood.cover} /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ width: length, height: STREET_HEIGHT }} style={StyleSheet.absoluteFill}>
        {width ? <StreetLand length={length} tall={tall} top={top} houses={shown.length} night={night} /> : null}
        {shown.map((f, i) => {
          const [doorX, doorY] = STREET_DOORS[i];
          const plotLeft = (doorX - PLOT / 2) * length;
          const plotTop = top + PLOT_TOP * tall;
          const nameX = Math.max(NAME_MARGIN, Math.min(length - NAME_MARGIN, STREET_GATES[i][0] * length));
          return (
            <Pressable key={f.id} onPress={() => onVisit(f.id)} disabled={!f.can_visit} style={({ pressed }) => [s.plot, { left: plotLeft, top: plotTop, width: PLOT * length }, pressed && s.pressed]} accessibilityRole="button"
              accessibilityLabel={f.can_visit ? `Nhà của ${f.display_name}, chạm để ghé thăm` : `Nhà của ${f.display_name}, đang tắt ghé thăm`} accessibilityState={{ disabled: !f.can_visit }} testID={`friend-house-${f.id}`}>
              <View style={[s.pet, { left: doorX * length - plotLeft + 6, top: (doorY - PLOT_TOP) * tall - PET_SIZE + 22 }]} pointerEvents="none">
                <ContactShadow width={34} height={8} opacity={0.4} style={s.petShadow} />
                <PetArt pet={f.pet} stage={f.pet_level} size={PET_SIZE} still />
              </View>
              <View style={[s.nameRow, { left: nameX - plotLeft - NAME_MARGIN, top: (STREET_GATES[i][1] - PLOT_TOP) * tall - 9 }]} pointerEvents="none">
                <View style={s.nameChip}>
                  {f.can_visit ? null : <View testID={`friend-house-closed-${f.id}`}><Ionicons name="lock-closed" size={10} color={t.muted} /></View>}
                  <Text style={s.houseName} numberOfLines={1}>{f.display_name}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {friends && !friends.length ? <View style={s.emptyStreet} pointerEvents="none"><Text style={s.emptyText}>Con phố còn vắng. Kết bạn bằng mã bên dưới, nhà của bạn bè sẽ hiện ở đây.</Text></View> : null}
      <View style={s.streetChip} pointerEvents="none"><WeatherChip night={night} tone={night ? 'light' : 'dark'} /></View>
      {width ? <><Rain width={width} height={STREET_HEIGHT} strength={mood.rain} wind={mood.wind} ground={0.92} /><Snow width={width} height={STREET_HEIGHT} strength={mood.snow} /></> : null}
    </View>
  );
});

/** The rendered street, moving with the houses: the land, then a patch with a house for each friend. Its lamps glow after dark. */
const StreetLand = memo(function StreetLand({ length, tall, top, houses, night }: { length: number; tall: number; top: number; houses: number; night: boolean }) {
  const s = useStyles();
  const art = STREET_ART[night ? 'night' : 'day'];
  return (
    <View style={[StyleSheet.absoluteFill, s.clip]} pointerEvents="none">
      <Plate source={art.land} width={length} height={tall} style={{ top }} />
      {art.houses.slice(0, houses).map((source, i) => {
        const [left, y, w, h] = art.boxes[i];
        return <Plate key={i} source={source} width={w * length} height={h * tall} style={{ left: left * length, top: top + y * tall }} />;
      })}
      {night ? STREET_LAMPS.map(([x, y]) => <ContactShadow key={x} width={56} height={56} color="#FFE9A8" opacity={0.7} style={[s.lampGlow, { left: x * length - 28, top: top + y * tall - 28 }]} />) : null}
    </View>
  );
});

// The street, its sky, weather and lamp glow are the scene; the name chips and the note over it are interface glass.
const useStyles = makeStyles(({ t }) => StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 28 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  street: { height: STREET_HEIGHT, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 12, backgroundColor: t.hero },
  clip: { overflow: 'hidden' },
  lampGlow: { position: 'absolute' },
  plot: { position: 'absolute', bottom: 0 },
  pet: { position: 'absolute', width: PET_SIZE, alignItems: 'center' },
  petShadow: { position: 'absolute', bottom: 0 },
  nameRow: { position: 'absolute', width: NAME_MARGIN * 2, alignItems: 'center' },
  nameChip: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: NAME_MARGIN * 2, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: t.glass },
  houseName: { ...typeScale.micro, color: t.ink, flexShrink: 1 },
  emptyStreet: { position: 'absolute', left: 24, right: 24, top: 118 },
  emptyText: { ...typeScale.caption, color: t.ink, textAlign: 'center', backgroundColor: t.glass, borderRadius: radius.sm, padding: 8 },
  streetChip: { position: 'absolute', top: 6, right: 8 },
  tiles: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tile: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, backgroundColor: t.card },
  tileIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { ...typeScale.label, fontSize: 14, color: t.ink },
  tileSub: { ...typeScale.micro, fontWeight: '600', color: t.muted },
}));
