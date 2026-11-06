import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { ItemIcon } from '../../components/ItemIcon';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { ApiError } from '../../api/client';
import { clientRef, townApi, type GiftableItem, type TownFriend, type TownMap, type TownProject } from '../../life/worlds';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, ProgressBar } from '../../ui/kit';
import { makeStyles, useTheme } from '../../ui/theme';
import { useToast } from '../../ui/Toast';
import { useAtmosphere } from '../../world/atmosphere';
import { ContactShadow, Plate } from '../../world/diorama';
import { Rain, Snow, WeatherChip } from '../../world/living';
import { LiveSky } from '../../world/liveSky';
import { useWeather } from '../../world/weather';
import { showError } from '../main/shared';
import { BackHeader, ErrorState, OptionSheet, PetAvatar } from '../together/ui';
import { StarBurst, useLoop } from '../work/workArt';
import { type Box, TOWN_ART, TOWN_BANNER, TOWN_DOORS, TOWN_LAMPS, TOWN_PAVING, TOWN_PLACES, TOWN_RATIO, TOWN_RIDGE, TOWN_SPRAY, type TownArt } from './townArt';

type Props = { user: User; onBack: () => void; onVisitRoom: (userId: number) => void; onVisitGarden: (userId: number) => void;
  onOpenFriends: () => void };

/** The land stands on the card's bottom edge; what is above it is open sky. */
const LAND = 268;
const HEIGHT = LAND + 52;
const SKY = HEIGHT - LAND;
const LENGTH = Math.round(LAND * TOWN_RATIO);
const MAX_HOUSES = 12;
/** A place's tappable width and how far down the picture it starts, as shares of the street. */
const WIDE = { fountain: 0.088, garden: 0.082, plaza: 0.066, shop: 0.066, hall: 0.066 } as const;
const PLOT = 0.0505;
const REACH_TOP = 0.3;
const NAME_MARGIN = 54;
const PET_SIZE = 56;
/** A friend's pet waits on the lawn beside the path to the door: how far right of the door, and how far down the picture its feet are. */
const PET_FROM_DOOR = 8;
const PET_FOOT = 0.905;
/** The house on a card: its width in points, and what it shows of the street, as shares across and from the top. */
const CARD_WIDE = 116;
const CARD_SHARE = 0.056;
const CARD_TOP = 0.52;
const LANTERN = require('../../../assets/world/town/lantern.webp');

type Sheet = null | { kind: 'friend'; friend: TownFriend } | { kind: 'project'; project: TownProject } | { kind: 'events' } | { kind: 'shop'; to?: number }
  | { kind: 'hall' } | { kind: 'visits' };
/** One request's `client_ref`: the same until the backend gave a final answer, so a retry after a lost answer counts once. */
type Requests = { refFor: (key: string) => string; settled: (key: string) => void };

/**
 * Thị trấn Mirabi: the friends system as a little town to walk around. Friends Street has a house for every friend
 * (visit their room or garden, send a gift, report); the fountain, the community garden and the lantern street are
 * built together with in-game coins; the plaza has the events; the hall shows what friends choose to share. Only
 * friends aged 16 and over appear here, and never across a block.
 */
export function TownScreen({ user, onBack, onVisitRoom, onVisitGarden, onOpenFriends }: Props) {
  const { t } = useTheme();
  const s = useStyles();
  const toast = useToast();
  const confirm = useConfirm();
  const [town, setTown] = useState<TownMap | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [burst, setBurst] = useState(0);
  const [card, setCard] = useState(0);
  const { reading } = useWeather();
  const sky = useAtmosphere(reading);
  const night = sky.night;
  const load = useCallback(async () => {
    try { setTown(await townApi.map()); setError(null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refs = useRef(new Map<string, string>());
  const requests: Requests = {
    refFor: (key) => { const ref = refs.current.get(key) ?? clientRef(); refs.current.set(key, ref); return ref; },
    settled: (key) => { refs.current.delete(key); },
  };

  async function contribute(project: TownProject, amount: number) {
    const key = `contribute:${project.id}:${amount}`;
    try {
      const result = await townApi.contribute(project.id, amount, requests.refFor(key));
      requests.settled(key);
      setTown((m) => m && { ...m, me: { ...m.me, coins: result.coins }, contribution_left_today: result.contribution_left_today,
        projects: m.projects.map((p) => (p.id === project.id ? result.project : p)) });
      setSheet({ kind: 'project', project: result.project });
      setBurst((b) => b + 1);
      toast(result.project.status === 'completed' ? `🎉 ${result.project.name} đã hoàn thành!` : `Đã góp ${amount} xu. Cảm ơn bạn!`, 'success');
    } catch (e) {
      if (e instanceof ApiError) requests.settled(key); // refused: a new tap is a new request
      showError('Chưa góp được', e);
    }
  }
  async function report(friend: TownFriend) {
    if (!(await confirm({ title: `Báo cáo ${friend.display_name}?`, message: 'Mirabi sẽ xem xét nội dung không phù hợp. Người này không biết ai đã báo cáo.',
      confirmLabel: 'Báo cáo', cancelLabel: 'Hủy', icon: 'flag-outline' }))) return;
    try { await townApi.report(friend.id, 'inappropriate'); setSheet(null); toast('Đã gửi báo cáo. Cảm ơn bạn!', 'success'); }
    catch (e) { showError('Chưa gửi được báo cáo', e); }
  }

  if (!town) {
    return (
      <View style={s.fill}>
        <BackHeader title="Thị trấn Mirabi" subtitle="Thị trấn của bạn và bạn bè" onBack={onBack} />
        {error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <View style={[s.street, s.skeleton]} accessibilityLabel="Đang tải thị trấn" />}
      </View>
    );
  }
  const project = (code: string) => town.projects.find((p) => p.code === code);
  const fountain = project('square_fountain');
  const garden = project('community_garden');
  const lanterns = project('lantern_street');
  const activeEvent = town.events.find((e) => e.status === 'active');
  // The street goes on as far as the last friend's house.
  const shown = town.friends.slice(0, MAX_HOUSES);
  const width = Math.round(Math.min(1, TOWN_DOORS[Math.max(0, shown.length - 1)][0] + PLOT * 0.8) * LENGTH);
  const art = TOWN_ART[night ? 'night' : 'day'];
  const ridge = SKY + LAND * TOWN_RIDGE;
  return (
    <View style={s.fill} testID="town">
      <BackHeader title="Thị trấn Mirabi" subtitle={`${town.friends.length} người bạn trong thị trấn`} onBack={onBack}
        right={<View style={s.headRight}>
          <View style={s.coins} accessibilityLabel={`${town.me.coins} xu`}><Text style={s.coinsText}>🪙 {town.me.coins}</Text></View>
          <Pressable onPress={() => setSheet({ kind: 'visits' })} hitSlop={8} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Lịch sử ghé thăm">
            <Ionicons name="time-outline" size={20} color={t.accent} /></Pressable></View>} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.street} onLayout={(e) => setCard(e.nativeEvent.layout.width)} testID="town-street">
          {/* The sky's palest colour meets the land. */}
          <LinearGradient colors={sky.light.sky} end={{ x: 0, y: Math.min(1, (ridge + 24) / HEIGHT) }} style={StyleSheet.absoluteFill} />
          {card ? <LiveSky id="town" width={card} ridge={ridge} hours={sky.hours} c={sky.light} cover={sky.mood.cover} /> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={StyleSheet.absoluteFill} contentContainerStyle={{ width, height: HEIGHT }}>
            <StreetArt art={art} fountain={fountain?.stage ?? 0} garden={garden?.stage ?? 0} houses={shown.length} night={night} lanternStage={lanterns?.stage ?? 0} width={width} />
            <Place x={TOWN_PLACES.fountain} wide={WIDE.fountain} label="Quảng trường" onPress={() => fountain && setSheet({ kind: 'project', project: fountain })} />
            <Place x={TOWN_PLACES.garden} wide={WIDE.garden} label="Vườn Cộng đồng" onPress={() => garden && setSheet({ kind: 'project', project: garden })} />
            <Place x={TOWN_PLACES.plaza} wide={WIDE.plaza} label="Sân Sự kiện" onPress={() => setSheet({ kind: 'events' })} />
            <Place x={TOWN_PLACES.shop} wide={WIDE.shop} label="Tiệm Quà tặng" onPress={() => setSheet({ kind: 'shop' })} />
            <Place x={TOWN_PLACES.hall} wide={WIDE.hall} label="Sảnh Thành tựu" onPress={() => setSheet({ kind: 'hall' })} />
            {town.friends.length === 0 ? <Place x={TOWN_DOORS[0][0]} wide={PLOT} label="Phố Bạn bè" onPress={onOpenFriends} /> : null}
            {shown.map((f, i) => <Place key={f.id} x={TOWN_DOORS[i][0]} wide={PLOT} label={f.display_name} onPress={() => setSheet({ kind: 'friend', friend: f })} />)}
            {shown.map((f, i) => (
              <View key={f.id} style={[s.housePet, { left: TOWN_DOORS[i][0] * LENGTH + PET_FROM_DOOR, top: SKY + PET_FOOT * LAND - PET_SIZE }]} pointerEvents="none">
                <ContactShadow width={44} height={10} opacity={0.4} style={s.petShadow} />
                <PetArt pet={f.pet} stage={f.pet_level} size={PET_SIZE} still />
              </View>
            ))}
            {fountain && fountain.stage >= 2 ? <Spray stage={fountain.stage} /> : null}
            {activeEvent ? <Banner title={activeEvent.title} /> : null}
            <Walker user={user} width={width} />
            <StarBurst burstKey={burst} />
          </ScrollView>
          <View style={s.weather} pointerEvents="none"><WeatherChip night={night} tone={night ? 'light' : 'dark'} /></View>
          {card ? <><Rain width={card} height={HEIGHT} strength={sky.mood.rain} wind={sky.mood.wind} ground={0.94} /><Snow width={card} height={HEIGHT} strength={sky.mood.snow} /></> : null}
        </View>
        <Text style={s.hint}>Vuốt ngang để dạo quanh thị trấn · chạm vào một nơi để ghé</Text>

        <Text style={s.section} accessibilityRole="header">🏘️ Phố Bạn bè</Text>
        {town.friends.length === 0 ? (
          <View style={s.card}><Text style={s.note}>Chưa có người bạn nào từ 16 tuổi trở lên trong thị trấn.</Text>
            <Button title="Kết bạn" icon="person-add-outline" variant="secondary" onPress={onOpenFriends} /></View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.houses}>
            {town.friends.map((f, i) => (
              <Pressable key={f.id} onPress={() => setSheet({ kind: 'friend', friend: f })} style={s.houseCard} accessibilityRole="button"
                accessibilityLabel={`Nhà của ${f.display_name}`} testID={`house-${f.id}`}>
                <HouseCardArt art={art} index={i} />
                <View style={s.houseOwner}><PetAvatar user={{ pet: f.pet, pet_level: f.pet_level }} size={22} /><Text style={s.houseName} numberOfLines={1}>{f.display_name}</Text></View>
              </Pressable>
            ))}
          </ScrollView>
        )}
        <Text style={s.section} accessibilityRole="header">🏗️ Công trình chung</Text>
        {town.projects.map((p) => (
          <Pressable key={p.id} onPress={() => setSheet({ kind: 'project', project: p })} style={s.card} accessibilityRole="button"
            accessibilityLabel={`${p.name}: ${p.percent}%`}>
            <View style={s.rowBetween}><Text style={s.cardTitle}>{p.name}</Text><Text style={s.pct}>{p.status === 'completed' ? '✨ Hoàn thành' : `${p.percent}%`}</Text></View>
            <ProgressBar value={p.percent / 100} color="#E09A2B" animated />
            <Text style={s.note}>{p.current.toLocaleString('vi-VN')}/{p.target.toLocaleString('vi-VN')} xu · {p.contributors} người góp</Text>
          </Pressable>
        ))}
      </ScrollView>

      <OptionSheet visible={!!sheet} title={sheetTitle(sheet)} onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={s.sheet}>
          {sheet?.kind === 'friend' ? <>
            <View style={s.friendHead}><PetArt pet={sheet.friend.pet} stage={sheet.friend.pet_level} size={80} />
              <Text style={s.note}>{sheet.friend.pet_name ?? 'Pet'} · Cấp {sheet.friend.pet_level}</Text></View>
            <Button title="Ghé thăm phòng" icon="home-outline" disabled={!sheet.friend.can_visit} onPress={() => { setSheet(null); onVisitRoom(sheet.friend.id); }} />
            {!sheet.friend.can_visit ? <Text style={s.note}>Bạn này đang tắt chế độ cho ghé thăm.</Text> : null}
            <Button title="Ghé vườn nhà" icon="leaf-outline" variant="secondary" onPress={() => { setSheet(null); onVisitGarden(sheet.friend.id); }} />
            <Button title="Gửi quà" icon="gift-outline" variant="secondary" onPress={() => setSheet({ kind: 'shop', to: sheet.friend.id })} />
            <Button title="Báo cáo" icon="flag-outline" variant="ghost" onPress={() => { void report(sheet.friend); }} />
          </> : sheet?.kind === 'project' ? <>
            <Text style={s.note}>{sheet.project.description}</Text>
            <ProgressBar value={sheet.project.percent / 100} color="#E09A2B" animated />
            <Text style={s.cardTitle}>{sheet.project.current.toLocaleString('vi-VN')} / {sheet.project.target.toLocaleString('vi-VN')} xu</Text>
            <Text style={s.note}>Bạn đã góp {sheet.project.my_contribution} xu · hôm nay còn góp được {town.contribution_left_today} xu</Text>
            {sheet.project.status === 'completed' ? <Text style={s.done}>✨ Công trình đã hoàn thành nhờ mọi người!</Text> : (
              <View style={s.rowWrap}>{[50, 100, 200].map((n) => (
                <Button key={n} title={`Góp ${n} xu`} variant={n === 100 ? 'primary' : 'secondary'} style={s.flex}
                  disabled={n > town.contribution_left_today || n > town.me.coins} onPress={() => { void contribute(sheet.project, n); }} />))}</View>
            )}
            <Text style={s.small}>Xu là tiền trong game, không phải tiền thật. Góp xu không cộng EXP.</Text>
          </> : sheet?.kind === 'events' ? (
            town.events.length === 0 ? <Text style={s.note}>Hiện chưa có sự kiện nào.</Text> : town.events.map((e) => (
              <View key={e.id} style={s.card}>
                <Text style={s.cardTitle}>{e.status === 'active' ? '🎪' : '🗓️'} {e.title}</Text>
                <Text style={s.note}>{e.description}</Text>
                <Text style={s.small}>{e.status === 'active' ? `Kết thúc ${new Date(e.end_at).toLocaleDateString('vi-VN')}` : `Bắt đầu ${new Date(e.start_at).toLocaleDateString('vi-VN')}`}</Text>
              </View>))
          ) : sheet?.kind === 'shop' ? <GiftShop friends={town.friends} left={town.gifts_left_today} initial={sheet.to ?? null} requests={requests}
            onSent={() => { setSheet(null); setBurst((b) => b + 1); toast('🎁 Đã gửi quà!', 'success'); void load(); }} />
          : sheet?.kind === 'hall' ? town.achievements.map((a, i) => (
            <View key={a.user_id} style={[s.hallRow, a.me && s.hallMe]}>
              <Text style={s.rank}>{i + 1}</Text><PetAvatar user={{ pet: a.pet, pet_level: a.pet_level }} size={30} />
              <Text style={s.hallName} numberOfLines={1}>{a.me ? 'Bạn' : a.display_name}</Text>
              <Text style={s.small}>Cấp {a.pet_level} · 🏅{a.career_badges} · 🎁{a.chests_opened}</Text>
            </View>)) : sheet?.kind === 'visits' ? <VisitHistory /> : null}
        </ScrollView>
      </OptionSheet>
    </View>
  );
}

const sheetTitle = (sheet: Sheet) => !sheet ? '' : sheet.kind === 'friend' ? `Nhà của ${sheet.friend.display_name}` : sheet.kind === 'project' ? sheet.project.name
  : sheet.kind === 'events' ? '🎪 Sân Sự kiện' : sheet.kind === 'shop' ? '🎁 Tiệm Quà tặng' : sheet.kind === 'hall' ? '🏆 Sảnh Thành tựu' : 'Lịch sử ghé thăm';

function GiftShop({ friends, left, initial, requests, onSent }: { friends: TownFriend[]; left: number; initial: number | null; requests: Requests; onSent: () => void }) {
  const s = useStyles();
  const [items, setItems] = useState<GiftableItem[] | null>(null);
  const [to, setTo] = useState<number | null>(initial ?? friends[0]?.id ?? null);
  const [item, setItem] = useState<GiftableItem | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadItems = useCallback(() => {
    setFailed(false);
    townApi.giftable().then(setItems).catch(() => setFailed(true));
  }, []);
  useEffect(loadItems, [loadItems]);
  if (!friends.length) return <Text style={s.note}>Kết bạn để gửi quà nhé.</Text>;
  return (
    <View style={s.sheet}>
      <Text style={s.label}>Gửi cho</Text>
      <View style={s.rowWrap}>{friends.map((f) => (
        <Pressable key={f.id} onPress={() => setTo(f.id)} style={[s.pick, to === f.id && s.pickOn]} accessibilityRole="radio" accessibilityState={{ selected: to === f.id }}
          accessibilityLabel={f.display_name}><Text style={s.pickText}>{f.display_name}</Text></Pressable>))}</View>
      <Text style={s.label}>Món quà từ Kho đồ</Text>
      {failed ? <Pressable onPress={loadItems} accessibilityRole="button"><Text style={s.note}>Chưa tải được Kho đồ. Chạm để thử lại.</Text></Pressable>
        : items === null ? <Text style={s.note}>Đang tải…</Text> : items.length === 0 ? <Text style={s.note}>Kho đồ chưa có món nào có thể tặng.</Text> : (
        <View style={s.rowWrap}>{items.map((i) => (
          <Pressable key={`${i.id}.${i.variant}`} onPress={() => setItem(i)} style={[s.giftItem, item === i && s.pickOn]} accessibilityRole="radio"
            accessibilityState={{ selected: item === i }} accessibilityLabel={`${i.name}, còn ${i.free}`}>
            <ItemIcon id={i.id} variant={i.variant} art={i.art} size={40} /><Text style={s.small} numberOfLines={1}>{i.name}</Text></Pressable>))}</View>
      )}
      <Text style={s.small}>Hôm nay còn gửi được {left} món quà.</Text>
      <Button title="Gửi quà" icon="gift" loading={sending} disabled={!to || !item || left <= 0} onPress={async () => {
        setSending(true);
        // One gift, one request: another friend or item is another gift, never answered "already sent" for this one.
        const key = `gift:${to}:${item!.id}.${item!.variant}`;
        try { await townApi.sendGift(to!, item!, requests.refFor(key)); requests.settled(key); onSent(); }
        catch (e) {
          if (e instanceof ApiError) requests.settled(key); // refused: a new tap is a new request
          showError('Chưa gửi được quà', e);
        }
        finally { setSending(false); }
      }} />
    </View>
  );
}

function VisitHistory() {
  const { t } = useTheme();
  const s = useStyles();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof townApi.visits>> | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRows = useCallback(() => {
    setFailed(false);
    townApi.visits().then(setRows).catch(() => setFailed(true));
  }, []);
  useEffect(loadRows, [loadRows]);
  if (failed) return <Pressable onPress={loadRows} accessibilityRole="button"><Text style={s.note}>Chưa tải được lịch sử ghé thăm. Chạm để thử lại.</Text></Pressable>;
  if (rows === null) return <Text style={s.note}>Đang tải…</Text>;
  if (!rows.length) return <Text style={s.note}>Chưa có lượt ghé thăm nào trong 30 ngày qua.</Text>;
  return <>{rows.map((r, i) => (
    <View key={i} style={s.hallRow}><Ionicons name={r.direction === 'in' ? 'enter-outline' : 'exit-outline'} size={18} color={t.accent} />
      <Text style={s.hallName}>{r.direction === 'in' ? `${r.display_name} ghé phòng bạn` : `Bạn ghé phòng ${r.display_name}`}</Text>
      <Text style={s.small}>{new Date(r.visited_at).toLocaleDateString('vi-VN')}</Text></View>))}</>;
}

/** A place on the street: all of it can be tapped, its name stands on the paving in front of it. */
function Place({ x, wide, label, onPress }: { x: number; wide: number; label: string; onPress: () => void }) {
  const s = useStyles();
  const center = Math.max(NAME_MARGIN, x * LENGTH);
  const reach = wide * LENGTH;
  return (
    <Pressable onPress={onPress} style={[s.place, { left: center - reach / 2, width: reach, top: SKY + REACH_TOP * LAND }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.nameRow, { left: reach / 2 - NAME_MARGIN, top: (TOWN_PAVING - REACH_TOP) * LAND - 10 }]} pointerEvents="none">
        <Text style={s.placeName} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** The rendered street and what stands on it now. Patches are the same picture with a stage or a house in it, the lamps glow at night, and a lantern hangs on a lamp for each step of Phố Đèn lồng. */
function StreetArt({ art, fountain, garden, houses, night, lanternStage, width: STREET }: { art: TownArt; fountain: number; garden: number; houses: number; night: boolean; lanternStage: number; width: number }) {
  const s = useStyles();
  const glow = useLoop(1800, night);
  const tile = LENGTH / art.land.length;
  const patch = (source: ImageSourcePropType, box: Box, key: string) => <Plate key={key} source={source} width={box[2] * LENGTH} height={box[3] * LAND} style={{ left: box[0] * LENGTH, top: SKY + box[1] * LAND }} />;
  const fountainAt = Math.min(4, fountain) - 1, gardenAt = Math.min(4, garden) - 1;
  const lamps = TOWN_LAMPS.filter(([x]) => x * LENGTH < STREET);
  return (
    <View style={[StyleSheet.absoluteFill, s.clip]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {art.land.map((source, i) => <Plate key={i} source={source} width={tile + 1} height={LAND} style={{ left: i * tile, top: SKY }} />)}
      {fountainAt >= 0 ? patch(art.fountain[fountainAt], art.fountainBoxes[fountainAt], 'fountain') : null}
      {gardenAt >= 0 ? patch(art.garden[gardenAt], art.gardenBoxes[gardenAt], 'garden') : null}
      {art.houses.slice(0, houses).map((source, i) => patch(source, art.houseBoxes[i], `house-${i}`))}
      {lamps.slice(0, lanternStage * 4).map(([x, y]) => (
        <Image key={x} source={LANTERN} style={[s.lantern, { left: x * LENGTH - 8, top: SKY + y * LAND + 6 }]} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />))}
      {night ? lamps.map(([x, y]) => (
        <Animated.View key={x} style={[s.lampGlow, { left: x * LENGTH - 40, top: SKY + y * LAND - 40, opacity: glow ? glow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) : 0.85 }]}><ContactShadow width={80} height={80} color="#FFE9A8" opacity={0.7} /></Animated.View>
      )) : null}
    </View>
  );
}

/** A friend's house on its own bit of the street, for the card under the street. */
function HouseCardArt({ art, index }: { art: TownArt; index: number }) {
  const s = useStyles();
  const i = index % art.houses.length;
  const length = CARD_WIDE / CARD_SHARE;
  const tall = length / TOWN_RATIO;
  const tile = length / art.land.length;
  const left = Math.min(1 - CARD_SHARE, TOWN_DOORS[i][0] - CARD_SHARE / 2) * length;
  const top = CARD_TOP * tall;
  const box = art.houseBoxes[i];
  return (
    <View style={s.houseArt}>
      {art.land.map((source, t) => (t * tile < left + CARD_WIDE && (t + 1) * tile > left ? <Plate key={t} source={source} width={tile + 1} height={tall} style={{ left: t * tile - left, top: -top }} /> : null))}
      <Plate source={art.houses[i]} width={box[2] * length} height={box[3] * tall} style={{ left: box[0] * length - left, top: box[1] * tall - top }} />
    </View>
  );
}

/** Water from the fountain's spout, on the stages that have one. */
function Spray({ stage }: { stage: number }) {
  const s = useStyles();
  const spray = useLoop(900, true);
  const [x, y] = TOWN_SPRAY[Math.min(4, stage) - 2];
  if (!spray) return null;
  return <Animated.View pointerEvents="none" style={[s.spray, { left: x * LENGTH - 15, top: SKY + y * LAND - 8, opacity: spray.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.95] }),
    transform: [{ translateY: spray.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }]}><View style={s.drop} /><View style={[s.drop, s.dropHigh]} /><View style={s.drop} /></Animated.View>;
}

/** The running event's name, hung over the stage. */
function Banner({ title }: { title: string }) {
  const s = useStyles();
  const wave = useLoop(1400, true);
  return <Animated.View pointerEvents="none" style={[s.banner, { left: TOWN_BANNER[0] * LENGTH - 60, top: SKY + TOWN_BANNER[1] * LAND - 10, transform: [{ rotate: wave ? wave.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) : '0deg' }] }]}>
    <Text style={s.bannerText} numberOfLines={1}>{title}</Text></Animated.View>;
}

/** My pet strolls along the road, back and forth (still with reduced motion). */
function Walker({ user, width }: { user: User; width: number }) {
  const s = useStyles();
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(0)).current;
  const [facing, setFacing] = useState<1 | -1>(1);
  useEffect(() => {
    if (reduce) return;
    let live = true;
    const go = (to: number) => {
      if (!live) return;
      setFacing(to > 0.5 ? 1 : -1);
      Animated.timing(x, { toValue: to, duration: 14000, easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => { if (finished) go(to > 0.5 ? 0 : 1); });
    };
    go(1);
    return () => { live = false; x.stopAnimation(); };
  }, [reduce, x]);
  return (
    <Animated.View pointerEvents="none" style={[s.walker, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [10, width - 70] }) }] }]}>
      <PetArt pet={user.pet} stage={user.level} size={56} walking={!reduce} moving={reduce ? undefined : facing} strolling />
    </Animated.View>
  );
}

// The street, its sky, the water and the lamps are the scene; the coins, the place names, the event banner and the cards
// are interface. The coin-amber of the projects' bars reads on both themes.
const useStyles = makeStyles(({ t, tones, dark }) => {
  const amber = dark ? '#F2B867' : '#B4691A';
  return StyleSheet.create({
    fill: { flex: 1, paddingHorizontal: 16 },
    flex: { flex: 1 },
    content: { paddingBottom: 120 },
    headRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    coins: { backgroundColor: t.warningBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    coinsText: { fontWeight: '900', color: t.warning },
    iconBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
    street: { height: HEIGHT, borderRadius: 24, overflow: 'hidden', backgroundColor: '#A9DDF7' },
    skeleton: { opacity: 0.6 },
    place: { position: 'absolute', bottom: 0 },
    nameRow: { position: 'absolute', width: NAME_MARGIN * 2, alignItems: 'center' },
    housePet: { position: 'absolute', width: PET_SIZE, alignItems: 'center' },
    petShadow: { position: 'absolute', bottom: 0 },
    weather: { position: 'absolute', top: 8, right: 10 },
    placeName: { fontSize: 11, fontWeight: '900', color: t.ink, backgroundColor: t.glass, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
    houseArt: { width: CARD_WIDE, height: 108, borderRadius: 12, overflow: 'hidden', marginBottom: 6 },
    spray: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
    drop: { width: 5, height: 8, borderRadius: 3, backgroundColor: '#8CD5F0' },
    dropHigh: { marginBottom: 6 },
    lantern: { position: 'absolute', width: 16, height: 32 },
    banner: { position: 'absolute', backgroundColor: t.card, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, width: 120, alignItems: 'center' },
    bannerText: { fontSize: 10, fontWeight: '900', color: tones.lilac.ink },
    clip: { overflow: 'hidden' },
    lampGlow: { position: 'absolute', width: 80, height: 80 },
    walker: { position: 'absolute', bottom: 6, left: 0 },
    hint: { fontSize: 12, color: t.muted, textAlign: 'center', marginTop: 6 },
    section: { fontSize: 18, fontWeight: '900', color: t.ink, marginTop: 14, marginBottom: 8 },
    card: { backgroundColor: t.card, borderRadius: 18, padding: 14, gap: 6, marginBottom: 10 },
    cardTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    pct: { fontWeight: '900', color: amber },
    note: { fontSize: 13, color: t.muted },
    small: { fontSize: 11, color: t.muted },
    done: { fontSize: 14, fontWeight: '800', color: t.success },
    houses: { gap: 10, paddingBottom: 4 },
    houseCard: { width: 132, alignItems: 'center', backgroundColor: t.card, borderRadius: 18, padding: 8 },
    houseOwner: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 116 },
    houseName: { fontSize: 12, fontWeight: '800', color: t.ink, flexShrink: 1 },
    sheet: { gap: 10, paddingBottom: 8 },
    friendHead: { alignItems: 'center' },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    label: { fontSize: 14, fontWeight: '900', color: t.ink },
    pick: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: t.tint, minHeight: 38 },
    pickOn: { backgroundColor: t.warningBg, borderColor: '#E09A2B', borderWidth: 2 },
    pickText: { fontWeight: '800', color: t.ink },
    giftItem: { width: 76, alignItems: 'center', padding: 6, borderRadius: 14, backgroundColor: t.card, borderWidth: 2, borderColor: 'transparent' },
    hallRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minHeight: 44 },
    hallMe: { backgroundColor: t.warningBg, borderRadius: 12, paddingHorizontal: 6 },
    rank: { width: 20, fontWeight: '900', color: t.muted, textAlign: 'center' },
    hallName: { flex: 1, fontSize: 14, fontWeight: '800', color: t.ink },
  });
});
