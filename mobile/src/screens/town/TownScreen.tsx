import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import type { User } from '../../auth/AuthContext';
import { ItemIcon } from '../../components/ItemIcon';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useDayPeriod } from '../../components/useDayPeriod';
import { useReduceMotion } from '../../components/useReduceMotion';
import { clientRef, townApi, type GiftableItem, type TownFriend, type TownMap, type TownProject } from '../../life/worlds';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, ProgressBar } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { BackHeader, ErrorState, OptionSheet, PetAvatar } from '../together/ui';
import { StarBurst, useLoop } from '../work/workArt';

type Props = { user: User; onBack: () => void; onVisitRoom: (userId: number) => void; onVisitGarden: (userId: number) => void;
  onOpenFriends: () => void };

const HEIGHT = 300;
const HOUSE_GAP = 110;
const MAX_HOUSES = 12;
const ROOFS = ['#E2715E', '#F0B44C', '#7A9FE0', '#9B5DE5', '#5DAF6A'];
/** Where each place stands along the street (points from the left). */
const AT = { square: 20, garden: 230, plaza: 420, shop: 560, hall: 690, houses: 820 };

type Sheet = null | { kind: 'friend'; friend: TownFriend } | { kind: 'project'; project: TownProject } | { kind: 'events' } | { kind: 'shop' }
  | { kind: 'hall' } | { kind: 'visits' };

/**
 * Thị trấn Mirabi: the friends system as a little town to walk around. Friends Street has a house for every friend
 * (visit their room or garden, send a gift, report); the fountain, the community garden and the lantern street are
 * built together with in-game coins; the plaza has the events; the hall shows what friends choose to share. Only
 * friends aged 16 and over appear here, and never across a block.
 */
export function TownScreen({ user, onBack, onVisitRoom, onVisitGarden, onOpenFriends }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [town, setTown] = useState<TownMap | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [burst, setBurst] = useState(0);
  const night = useDayPeriod() === 'night';
  const load = useCallback(async () => {
    try { setTown(await townApi.map()); setError(null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function contribute(project: TownProject, amount: number) {
    try {
      const result = await townApi.contribute(project.id, amount, clientRef());
      setTown((m) => m && { ...m, me: { ...m.me, coins: result.coins }, contribution_left_today: result.contribution_left_today,
        projects: m.projects.map((p) => (p.id === project.id ? result.project : p)) });
      setSheet({ kind: 'project', project: result.project });
      setBurst((b) => b + 1);
      toast(result.project.status === 'completed' ? `🎉 ${result.project.name} đã hoàn thành!` : `Đã góp ${amount} xu. Cảm ơn bạn!`, 'success');
    } catch (e) { showError('Chưa góp được', e); }
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
  const width = AT.houses + Math.max(1, Math.min(MAX_HOUSES, town.friends.length)) * HOUSE_GAP + 40;
  return (
    <View style={s.fill} testID="town">
      <BackHeader title="Thị trấn Mirabi" subtitle={`${town.friends.length} người bạn trong thị trấn`} onBack={onBack}
        right={<View style={s.headRight}>
          <View style={s.coins} accessibilityLabel={`${town.me.coins} xu`}><Text style={s.coinsText}>🪙 {town.me.coins}</Text></View>
          <Pressable onPress={() => setSheet({ kind: 'visits' })} hitSlop={8} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Lịch sử ghé thăm">
            <Ionicons name="time-outline" size={20} color={t.accent} /></Pressable></View>} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.street} contentContainerStyle={{ width, height: HEIGHT }}>
          <StreetArt night={night} lanternStage={lanterns?.stage ?? 0} width={width} />
          <Place x={AT.square} label="Quảng trường" onPress={() => fountain && setSheet({ kind: 'project', project: fountain })}>
            <Fountain stage={fountain?.stage ?? 0} />
          </Place>
          <Place x={AT.garden} label="Vườn Cộng đồng" onPress={() => garden && setSheet({ kind: 'project', project: garden })}>
            <CommunityGarden stage={garden?.stage ?? 0} />
          </Place>
          <Place x={AT.plaza} label="Sân Sự kiện" onPress={() => setSheet({ kind: 'events' })}>
            <Plaza title={activeEvent?.title} />
          </Place>
          <Place x={AT.shop} label="Tiệm Quà tặng" onPress={() => setSheet({ kind: 'shop' })}><Shop /></Place>
          <Place x={AT.hall} label="Sảnh Thành tựu" onPress={() => setSheet({ kind: 'hall' })}><Hall /></Place>
          {town.friends.length === 0 ? (
            <Place x={AT.houses} label="Phố Bạn bè" onPress={onOpenFriends}><House roof="#C9D3DC" empty /></Place>
          ) : null}
          {town.friends.slice(0, MAX_HOUSES).map((f, i) => (
            <Place key={f.id} x={AT.houses + i * HOUSE_GAP} label={f.display_name} onPress={() => setSheet({ kind: 'friend', friend: f })}>
              <House roof={ROOFS[i % ROOFS.length]} lit={night} />
            </Place>
          ))}
          <Walker user={user} width={width} />
          <StarBurst burstKey={burst} />
        </ScrollView>
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
                <House roof={ROOFS[i % ROOFS.length]} lit={night} />
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
            <Button title="Gửi quà" icon="gift-outline" variant="secondary" onPress={() => setSheet({ kind: 'shop' })} />
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
          ) : sheet?.kind === 'shop' ? <GiftShop friends={town.friends} left={town.gifts_left_today} initial={null}
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

function GiftShop({ friends, left, initial, onSent }: { friends: TownFriend[]; left: number; initial: number | null; onSent: () => void }) {
  const [items, setItems] = useState<GiftableItem[] | null>(null);
  const [to, setTo] = useState<number | null>(initial ?? friends[0]?.id ?? null);
  const [item, setItem] = useState<GiftableItem | null>(null);
  const [sending, setSending] = useState(false);
  const ref = useRef(clientRef());
  useEffect(() => { townApi.giftable().then(setItems).catch(() => setItems([])); }, []);
  if (!friends.length) return <Text style={s.note}>Kết bạn để gửi quà nhé.</Text>;
  return (
    <View style={s.sheet}>
      <Text style={s.label}>Gửi cho</Text>
      <View style={s.rowWrap}>{friends.map((f) => (
        <Pressable key={f.id} onPress={() => setTo(f.id)} style={[s.pick, to === f.id && s.pickOn]} accessibilityRole="radio" accessibilityState={{ selected: to === f.id }}
          accessibilityLabel={f.display_name}><Text style={s.pickText}>{f.display_name}</Text></Pressable>))}</View>
      <Text style={s.label}>Món quà từ Kho đồ</Text>
      {items === null ? <Text style={s.note}>Đang tải…</Text> : items.length === 0 ? <Text style={s.note}>Kho đồ chưa có món nào có thể tặng.</Text> : (
        <View style={s.rowWrap}>{items.map((i) => (
          <Pressable key={`${i.id}.${i.variant}`} onPress={() => setItem(i)} style={[s.giftItem, item === i && s.pickOn]} accessibilityRole="radio"
            accessibilityState={{ selected: item === i }} accessibilityLabel={`${i.name}, còn ${i.free}`}>
            <ItemIcon id={i.id} variant={i.variant} art={i.art} size={40} /><Text style={s.small} numberOfLines={1}>{i.name}</Text></Pressable>))}</View>
      )}
      <Text style={s.small}>Hôm nay còn gửi được {left} món quà.</Text>
      <Button title="Gửi quà" icon="gift" loading={sending} disabled={!to || !item || left <= 0} onPress={async () => {
        setSending(true);
        try { await townApi.sendGift(to!, item!, ref.current); ref.current = clientRef(); onSent(); }
        catch (e) { showError('Chưa gửi được quà', e); }
        finally { setSending(false); }
      }} />
    </View>
  );
}

function VisitHistory() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof townApi.visits>> | null>(null);
  useEffect(() => { townApi.visits().then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return <Text style={s.note}>Đang tải…</Text>;
  if (!rows.length) return <Text style={s.note}>Chưa có lượt ghé thăm nào trong 30 ngày qua.</Text>;
  return <>{rows.map((r, i) => (
    <View key={i} style={s.hallRow}><Ionicons name={r.direction === 'in' ? 'enter-outline' : 'exit-outline'} size={18} color={t.accent} />
      <Text style={s.hallName}>{r.direction === 'in' ? `${r.display_name} ghé phòng bạn` : `Bạn ghé phòng ${r.display_name}`}</Text>
      <Text style={s.small}>{new Date(r.visited_at).toLocaleDateString('vi-VN')}</Text></View>))}</>;
}

function Place({ x, label, onPress, children }: { x: number; label: string; onPress: () => void; children?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={[s.place, { left: x }]} accessibilityRole="button" accessibilityLabel={label}>
      {children}
      <Text style={s.placeName} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Sky (by the clock), hills, the road and street lamps that glow at night; lanterns hang as Phố Đèn lồng is built. */
function StreetArt({ night, lanternStage, width: STREET }: { night: boolean; lanternStage: number; width: number }) {
  const glow = useLoop(1800, night);
  const lamps = Array.from({ length: Math.floor(STREET / 250) }, (_, i) => 140 + i * 250);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={STREET} height={HEIGHT}>
        <Defs><SvgGradient id="tsky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={night ? '#22305E' : '#A9DDF7'} /><Stop offset="1" stopColor={night ? '#4B4F8A' : '#E9F7FF'} /></SvgGradient></Defs>
        <Rect width={STREET} height={HEIGHT} fill="url(#tsky)" />
        {night ? Array.from({ length: Math.floor(STREET / 160) }, (_, i) => <Circle key={i} cx={60 + i * 160} cy={24 + (i % 3) * 16} r="1.6" fill="#FFF7D6" />)
          : <Circle cx={STREET - 100} cy={46} r={22} fill="#FFE59A" />}
        <Path d={`M0 200 Q160 150 320 190 T640 180 T${STREET} 185 V${HEIGHT} H0 Z`} fill={night ? '#3E5A7A' : '#9BD3A8'} />
        <Rect x="0" y="244" width={STREET} height="56" fill={night ? '#5B5A6A' : '#CDBFAE'} />
        <Rect x="0" y="268" width={STREET} height="3" fill={night ? '#E6D9A8' : '#FFFFFF'} opacity={0.7} strokeDasharray="14 10" />
        {lamps.map((x) => <G key={x}><Rect x={x} y="190" width="4" height="56" fill="#56616E" /><Circle cx={x + 2} cy="188" r="7" fill={night ? '#FFE27A' : '#E8EDF2'} /></G>)}
        {lanternStage > 0 ? Array.from({ length: Math.min(lanternStage * 4, Math.floor(STREET / 56)) }, (_, i) => (
          <G key={i}><Rect x={40 + i * 56} y="150" width="1" height="10" fill="#8E5A34" /><Ellipse cx={40.5 + i * 56} cy="164" rx="6" ry="7" fill="#E2715E" /></G>)) : null}
      </Svg>
      {night ? lamps.map((x) => (
        <Animated.View key={x} style={[s.lampGlow, { left: x - 26, opacity: glow ? glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] }) : 0.5 }]} />
      )) : null}
    </View>
  );
}

/** My pet strolls along the road, back and forth (still with reduced motion). */
function Walker({ user, width }: { user: User; width: number }) {
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

function Fountain({ stage }: { stage: number }) {
  const spray = useLoop(900, stage >= 2);
  return (
    <View style={s.art}>
      <Svg width={150} height={110} viewBox="0 0 150 110">
        <Ellipse cx="75" cy="96" rx={20 + stage * 12} ry={6 + stage * 2} fill="#9CC7E4" />
        {stage >= 1 ? <Ellipse cx="75" cy="92" rx={18 + stage * 10} ry={5 + stage * 2} fill="#BFE6FA" stroke="#C9C2B8" strokeWidth="3" /> : <Rect x="45" y="86" width="60" height="10" fill="#C9C2B8" />}
        {stage >= 3 ? <Rect x="70" y="56" width="10" height="36" fill="#D8D2C8" /> : null}
        {stage >= 4 ? <Ellipse cx="75" cy="56" rx="22" ry="6" fill="#BFE6FA" stroke="#C9C2B8" strokeWidth="2" /> : null}
      </Svg>
      {stage >= 2 && spray ? <Animated.Text style={[s.spray, { opacity: spray.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.95] }),
        transform: [{ translateY: spray.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }]}>💧</Animated.Text> : null}
    </View>
  );
}

function CommunityGarden({ stage }: { stage: number }) {
  const sway = useLoop(2000);
  return (
    <Animated.View style={[s.art, { transform: [{ rotate: sway ? sway.interpolate({ inputRange: [0, 1], outputRange: ['-1deg', '1deg'] }) : '0deg' }] }]}>
      <Svg width={150} height={100} viewBox="0 0 150 100">
        <Rect x="10" y="70" width="130" height="24" rx="6" fill="#8E5A34" />
        {Array.from({ length: 2 + stage * 3 }, (_, i) => (
          <G key={i}><Rect x={18 + i * 9} y={70 - 10 - (i % 3) * 4} width="2" height={10 + (i % 3) * 4} fill="#5DAF6A" />
            <Circle cx={19 + i * 9} cy={60 - (i % 3) * 4} r="4" fill={['#F2A2B0', '#F7CF7A', '#B9A6F0'][i % 3]} /></G>))}
      </Svg>
    </Animated.View>
  );
}

function Plaza({ title }: { title?: string }) {
  const wave = useLoop(1400, !!title);
  return (
    <View style={s.art}>
      <Svg width={130} height={100} viewBox="0 0 130 100">
        <Rect x="10" y="60" width="110" height="34" rx="4" fill="#C98E5A" /><Rect x="18" y="30" width="4" height="34" fill="#8E5A34" /><Rect x="108" y="30" width="4" height="34" fill="#8E5A34" />
        <Polygon points="10,30 120,30 112,18 18,18" fill="#9B5DE5" />
      </Svg>
      {title ? <Animated.View style={[s.banner, { transform: [{ rotate: wave ? wave.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) : '0deg' }] }]}>
        <Text style={s.bannerText} numberOfLines={1}>{title}</Text></Animated.View> : null}
    </View>
  );
}

function Shop() {
  return (
    <View style={s.art}><Svg width={110} height={100} viewBox="0 0 110 100">
      <Rect x="12" y="40" width="86" height="56" fill="#FFF3E0" /><Polygon points="6,42 55,10 104,42" fill="#F27BAA" />
      <Rect x="12" y="40" width="86" height="10" fill="#F7B5CB" /><Rect x="44" y="64" width="22" height="32" fill="#8E5A34" /><Rect x="20" y="58" width="18" height="16" fill="#BFE6FA" />
      <Rect x="72" y="58" width="18" height="16" fill="#BFE6FA" /></Svg></View>
  );
}

function Hall() {
  return (
    <View style={s.art}><Svg width={110} height={100} viewBox="0 0 110 100">
      <Polygon points="6,36 55,8 104,36" fill="#E9C46A" /><Rect x="10" y="36" width="90" height="8" fill="#F4E3B5" />
      {[18, 38, 66, 86].map((x) => <Rect key={x} x={x} y="44" width="6" height="46" fill="#F4E3B5" />)}<Rect x="6" y="90" width="98" height="8" fill="#D8C9A0" />
      <Circle cx="55" cy="26" r="6" fill="#F6C945" /></Svg></View>
  );
}

function House({ roof, lit = false, empty = false }: { roof: string; lit?: boolean; empty?: boolean }) {
  return (
    <Svg width={90} height={84} viewBox="0 0 90 84">
      <Rect x="12" y="36" width="66" height="46" fill={empty ? '#EEF2F5' : '#FFF6E5'} /><Polygon points="6,38 45,8 84,38" fill={roof} />
      <Rect x="38" y="56" width="16" height="26" fill="#8E5A34" /><Rect x="18" y="48" width="14" height="12" fill={lit ? '#FFE27A' : '#BFE6FA'} />
      <Rect x="58" y="48" width="14" height="12" fill={lit ? '#FFE27A' : '#BFE6FA'} />
      {empty ? <Polygon points="40,60 50,60 45,70" fill="#A7B4C0" /> : null}
    </Svg>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 16 },
  flex: { flex: 1 },
  content: { paddingBottom: 120 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coins: { backgroundColor: '#FFF4CC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  coinsText: { fontWeight: '900', color: '#7A4D00' },
  iconBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  street: { height: HEIGHT, borderRadius: 24, overflow: 'hidden', backgroundColor: '#A9DDF7' },
  skeleton: { opacity: 0.6 },
  place: { position: 'absolute', bottom: 46, alignItems: 'center' },
  placeName: { marginTop: -2, fontSize: 11, fontWeight: '900', color: '#2B3A55', backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 8, paddingHorizontal: 6, overflow: 'hidden' },
  art: { alignItems: 'center', justifyContent: 'flex-end' },
  spray: { position: 'absolute', top: 30, fontSize: 18 },
  banner: { position: 'absolute', top: 4, backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 120 },
  bannerText: { fontSize: 10, fontWeight: '900', color: '#5141A8' },
  lampGlow: { position: 'absolute', top: 162, width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFE9A8' },
  walker: { position: 'absolute', bottom: 22, left: 0 },
  hint: { fontSize: 12, color: t.muted, textAlign: 'center', marginTop: 6 },
  section: { fontSize: 18, fontWeight: '900', color: t.ink, marginTop: 14, marginBottom: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, gap: 6, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pct: { fontWeight: '900', color: '#B4691A' },
  note: { fontSize: 13, color: t.muted },
  small: { fontSize: 11, color: t.muted },
  done: { fontSize: 14, fontWeight: '800', color: '#22703A' },
  houses: { gap: 10, paddingBottom: 4 },
  houseCard: { width: 110, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 8 },
  houseOwner: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 100 },
  houseName: { fontSize: 12, fontWeight: '800', color: t.ink, flexShrink: 1 },
  sheet: { gap: 10, paddingBottom: 8 },
  friendHead: { alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontSize: 14, fontWeight: '900', color: t.ink },
  pick: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: t.tint, minHeight: 38 },
  pickOn: { backgroundColor: '#FFE3C2', borderColor: '#E09A2B', borderWidth: 2 },
  pickText: { fontWeight: '800', color: t.ink },
  giftItem: { width: 76, alignItems: 'center', padding: 6, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: 'transparent' },
  hallRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minHeight: 44 },
  hallMe: { backgroundColor: '#FFF4CC', borderRadius: 12, paddingHorizontal: 6 },
  rank: { width: 20, fontWeight: '900', color: t.muted, textAlign: 'center' },
  hallName: { flex: 1, fontSize: 14, fontWeight: '800', color: t.ink },
});
