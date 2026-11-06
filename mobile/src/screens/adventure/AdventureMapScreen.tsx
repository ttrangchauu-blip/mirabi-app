import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import type { User } from '../../auth/AuthContext';
import { ItemIcon } from '../../components/ItemIcon';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { adventureApi, localDay, type AdventureMap, type AdventureRegion, type ItemReward } from '../../life/worlds';
import { appTheme as t } from '../../theme';
import { Button, ProgressBar } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { BackHeader, ErrorState, OptionSheet } from '../together/ui';
import { ChestArt, StarBurst, useLoop } from '../work/workArt';

type Props = { user: User; onBack: () => void; onRewards?: () => void; onOpenInventory?: () => void };

/** Where each region sits on the map (percent of its width and height), from the valley at the bottom to the peak. */
const SPOTS: Record<string, { x: number; y: number }> = {
  green_valley: { x: 24, y: 86 }, cozy_village: { x: 72, y: 70 }, knowledge_forest: { x: 26, y: 50 },
  dream_lake: { x: 70, y: 32 }, adventure_mountain: { x: 36, y: 12 },
};
const MAP_HEIGHT = 470;

/**
 * Phiêu lưu cuộc sống: a map of five regions joined by a winding trail. Real-life activities are taken on from a region
 * (each becomes a task of the day) and ticked once done; the backend counts them, opens the next region and gives the
 * milestone chests. The pet stands in the furthest open region and walks there when a new one opens.
 */
export function AdventureMapScreen({ user, onBack, onRewards, onOpenInventory }: Props) {
  const toast = useToast();
  const [data, setData] = useState<AdventureMap | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [rewards, setRewards] = useState<ItemReward[] | null>(null);
  const [width, setWidth] = useState(340);

  const load = useCallback(async () => {
    try { const fresh = await adventureApi.map(); setData(fresh); setError(null); }
    catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function start(code: string) {
    setBusy(code);
    try { await adventureApi.start(code); toast('Đã nhận hoạt động! Làm xong ngoài đời rồi đánh dấu ✓ nhé.', 'success'); await load(); }
    catch (e) { showError('Chưa nhận được hoạt động', e); }
    finally { setBusy(null); }
  }
  async function complete(taskId: number, day: string) {
    setBusy(`task:${taskId}`);
    try {
      const before = data?.regions.filter((r) => r.unlocked).length ?? 0;
      const result = await adventureApi.complete(taskId, day);
      setBurst((b) => b + 1);
      if (result.awarded_exp) onRewards?.();
      // It is done from here on, whether or not the map can be read again right now.
      const fresh = await adventureApi.map().catch(() => null);
      if (fresh) setData(fresh);
      else setData((shown) => shown && { ...shown, regions: shown.regions.map((r) => ({ ...r, tasks_today: r.tasks_today.map((x) => (x.id === taskId ? { ...x, completed: true } : x)) })) });
      const opened = !!fresh && fresh.regions.filter((r) => r.unlocked).length > before;
      toast(opened ? '🎉 Vùng mới đã mở khóa!' : result.awarded_exp ? `Hoàn thành! +${result.awarded_exp} EXP` : 'Hoàn thành!', 'success');
    } catch (e) { showError('Chưa đánh dấu được', e); }
    finally { setBusy(null); }
  }
  async function claim(code: string) {
    setBusy(code);
    try {
      const result = await adventureApi.claim(code);
      setData(result.map); setBurst((b) => b + 1); setRewards(result.rewards);
    } catch (e) { showError('Chưa nhận được phần thưởng', e); }
    finally { setBusy(null); }
  }

  if (!data) {
    return (
      <View style={s.fill}>
        <BackHeader title="Phiêu lưu cuộc sống" subtitle="Mỗi việc tốt ngoài đời là một bước phiêu lưu" onBack={onBack} />
        {error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <View style={[s.mapCard, s.skeleton]} accessibilityLabel="Đang tải bản đồ" />}
      </View>
    );
  }
  const region = data.regions.find((r) => r.code === (selected ?? data.pet_region))!;
  return (
    <View style={s.fill} testID="adventure-map">
      <BackHeader title="Phiêu lưu cuộc sống" subtitle={`Đã đi ${data.total_progress} bước trên hành trình`} onBack={onBack} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.mapCard} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <MapArt regions={data.regions} />
          {data.regions.map((r) => (
            <Pressable key={r.code} onPress={() => setSelected(r.code)} accessibilityRole="button"
              accessibilityLabel={`${r.name}: ${r.unlocked ? `${r.progress} hoạt động` : `chưa mở, ${r.unlock_hint}`}`}
              style={[s.spot, { left: `${SPOTS[r.code].x}%`, top: `${SPOTS[r.code].y}%` }]} testID={`region-${r.code}`}>
              <View style={[s.badge, !r.unlocked && s.badgeLocked, region.code === r.code && s.badgeOn]}>
                <Text style={s.badgeEmoji}>{r.unlocked ? r.emoji : '🔒'}</Text>
              </View>
              <Text style={[s.spotName, !r.unlocked && s.spotLocked]} numberOfLines={1}>{r.name}</Text>
            </Pressable>
          ))}
          <PetMarker user={user} at={data.pet_region} width={width} />
          <StarBurst burstKey={burst} />
        </View>
        <RegionPanel region={region} busy={busy} onStart={(c) => { void start(c); }} onComplete={(id, day) => { void complete(id, day); }}
          onClaim={(c) => { void claim(c); }} limit={data.daily_count_limit} />
      </ScrollView>
      <OptionSheet visible={!!rewards} title="🎁 Phần thưởng chặng đường" onClose={() => setRewards(null)}>
        <View style={s.rewardList}>
          {rewards?.map((item) => (
            <View key={item.id} style={s.rewardRow}><ItemIcon id={item.id} art={item.art} size={44} /><Text style={s.rewardName}>{item.name} ×{item.quantity}</Text></View>
          ))}
          <Text style={s.note}>Phần thưởng đã vào Kho đồ.</Text>
          {onOpenInventory ? <Button title="Xem kho đồ" variant="secondary" icon="cube-outline" onPress={() => { setRewards(null); onOpenInventory(); }} /> : null}
        </View>
      </OptionSheet>
    </View>
  );
}

/** The pet on the map, walking to its region whenever that changes (still with reduced motion). */
function PetMarker({ user, at, width }: { user: User; at: string; width: number }) {
  const reduce = useReduceMotion();
  const spot = SPOTS[at];
  const target = { x: (spot.x / 100) * width - 26, y: (spot.y / 100) * MAP_HEIGHT - 58 };
  const pos = useRef(new Animated.ValueXY(target)).current;
  const [walking, setWalking] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || reduce) { first.current = false; pos.setValue(target); return; }
    setWalking(true);
    const anim = Animated.timing(pos, { toValue: target, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    anim.start(() => setWalking(false));
    return () => anim.stop();
  }, [at, width]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View pointerEvents="none" style={[s.pet, { transform: pos.getTranslateTransform() }]} accessibilityLabel={`${user.pet_name ?? 'Pet'} đang ở đây`}>
      <PetArt pet={user.pet} stage={user.level} size={52} walking={walking} />
    </Animated.View>
  );
}

/** The map itself: sky, meadow, the winding trail and each region's landmark; unopened regions sit under a cloud. */
function MapArt({ regions }: { regions: AdventureRegion[] }) {
  const sway = useLoop(2600);
  const shimmer = useLoop(1800, true, 400);
  const open = Object.fromEntries(regions.map((r) => [r.code, r.unlocked]));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <SvgGradient id="land" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#CFE8F7" /><Stop offset="0.25" stopColor="#D9F0D2" /><Stop offset="1" stopColor="#A9DB98" />
          </SvgGradient>
        </Defs>
        <Rect width="100" height="100" fill="url(#land)" />
        <Path d="M24 92 C 40 88, 70 84, 72 74 S 30 62, 26 54 S 66 42, 70 36 S 40 22, 36 14" stroke="#E9D3A3" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <Path d="M24 92 C 40 88, 70 84, 72 74 S 30 62, 26 54 S 66 42, 70 36 S 40 22, 36 14" stroke="#FFF6DD" strokeWidth="0.8" fill="none" strokeDasharray="1.5 2" />
      </Svg>
      <Landmark spot="adventure_mountain" open={open.adventure_mountain}>
        <Svg width={110} height={80} viewBox="0 0 110 80"><Polygon points="5,78 40,10 75,78" fill="#8E9AAF" /><Polygon points="40,10 52,34 28,34" fill="#FFFFFF" />
          <Polygon points="45,78 75,26 105,78" fill="#A3AEC2" /><Polygon points="75,26 84,42 66,42" fill="#FFFFFF" /><Rect x="39" y="0" width="2" height="12" fill="#56616E" /><Path d="M41 0 L52 4 L41 8 Z" fill="#E2715E" /></Svg>
      </Landmark>
      <Landmark spot="dream_lake" open={open.dream_lake}>
        <View>
          <Svg width={110} height={60} viewBox="0 0 110 60"><Ellipse cx="55" cy="38" rx="50" ry="18" fill="#7FC4E8" /><Ellipse cx="55" cy="36" rx="40" ry="12" fill="#A6DCF4" />
            <Circle cx="88" cy="10" r="7" fill="#FFF3C9" /></Svg>
          <Animated.View style={[s.shine, { opacity: shimmer ? shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] }) : 0.4 }]} />
        </View>
      </Landmark>
      <Landmark spot="knowledge_forest" open={open.knowledge_forest}>
        <Animated.View style={{ transform: [{ rotate: sway ? sway.interpolate({ inputRange: [0, 1], outputRange: ['-1.5deg', '1.5deg'] }) : '0deg' }] }}>
          <Svg width={110} height={70} viewBox="0 0 110 70">{[[18, 30], [42, 18], [66, 26], [90, 34]].map(([x, h]) => (
            <G key={x}><Rect x={x - 2} y={56} width="4" height="12" fill="#8E5A34" /><Polygon points={`${x - 14},58 ${x},${58 - h - 10} ${x + 14},58`} fill="#3E8D52" /></G>))}</Svg>
        </Animated.View>
      </Landmark>
      <Landmark spot="cozy_village" open={open.cozy_village}>
        <Svg width={110} height={60} viewBox="0 0 110 60">{[[10, '#E2715E'], [42, '#F0B44C'], [74, '#7A9FE0']].map(([x, roof]) => (
          <G key={String(x)}><Rect x={Number(x) + 2} y="30" width="24" height="22" fill="#FFF3E0" /><Polygon points={`${Number(x)},32 ${Number(x) + 14},16 ${Number(x) + 28},32`} fill={String(roof)} />
            <Rect x={Number(x) + 11} y="40" width="6" height="12" fill="#8E5A34" /></G>))}</Svg>
      </Landmark>
      <Landmark spot="green_valley" open>
        <Svg width={110} height={50} viewBox="0 0 110 50"><Path d="M0 50 Q30 10 60 40 T110 30 V50 Z" fill="#7DC293" />
          {[[20, 36], [50, 40], [80, 34], [96, 42]].map(([x, y]) => <Circle key={x} cx={x} cy={y} r="3" fill={x % 20 ? '#F7CF7A' : '#F2A2B0'} />)}</Svg>
      </Landmark>
    </View>
  );
}

function Landmark({ spot, open, children }: { spot: string; open: boolean; children: React.ReactNode }) {
  const p = SPOTS[spot];
  return (
    <View style={[s.landmark, { left: `${p.x}%`, top: `${p.y}%`, opacity: open ? 1 : 0.45 }]}>
      {children}
      {!open ? <View style={s.fog}><Text style={s.fogText}>☁️☁️</Text></View> : null}
    </View>
  );
}

function RegionPanel({ region, busy, onStart, onComplete, onClaim, limit }: {
  region: AdventureRegion; busy: string | null; onStart: (code: string) => void; onComplete: (taskId: number, day: string) => void;
  onClaim: (code: string) => void; limit: number;
}) {
  const next = region.next_milestone;
  return (
    <View style={s.panel} testID={`region-panel-${region.code}`}>
      <Text style={s.panelTitle} accessibilityRole="header">{region.emoji} {region.name}</Text>
      <Text style={s.panelTheme}>{region.theme} · {region.description}</Text>
      {!region.unlocked ? (
        <View style={s.lockBox}><Ionicons name="lock-closed" size={16} color={t.muted} /><Text style={s.lockText}>{region.unlock_hint}</Text></View>
      ) : <>
        <View style={s.progressRow}>
          <Text style={s.progressText}>{next ? `${region.progress}/${next} đến rương tiếp theo` : `${region.progress} hoạt động · đã nhận đủ rương`}</Text>
          <View style={s.flex}><ProgressBar value={next ? region.progress / next : 1} color="#5DAF6A" animated /></View>
        </View>
        {region.tasks_today.length ? <Text style={s.label}>Hôm nay</Text> : null}
        {region.tasks_today.map((task) => (
          <View key={task.occurrence_id} style={s.taskRow}>
            <Text style={[s.taskTitle, task.completed && s.done]}>{task.title}</Text>
            {task.completed ? <Ionicons name="checkmark-circle" size={22} color="#22A06B" accessibilityLabel="Đã hoàn thành" />
              : <Pressable onPress={() => onComplete(task.id, task.scheduled_date)} disabled={!!busy} style={s.check} accessibilityRole="button"
                accessibilityLabel={`Đã làm xong ${task.title}`}><Ionicons name="checkmark" size={18} color="#FFFFFF" /></Pressable>}
          </View>
        ))}
        <Text style={s.label}>Hoạt động</Text>
        {region.activities.map((a) => {
          const taken = region.tasks_today.some((x) => x.adventure_activity === a.code);
          return (
            <View key={a.code} style={s.activity}>
              <Text style={s.activityEmoji}>{a.emoji}</Text>
              <Text style={s.activityName}>{a.name}</Text>
              <Pressable onPress={() => onStart(a.code)} disabled={taken || busy === a.code} style={[s.take, taken && s.takeOff]} accessibilityRole="button"
                accessibilityLabel={taken ? `${a.name}: đã nhận hôm nay` : `Nhận hoạt động ${a.name}`}>
                <Text style={[s.takeText, taken && s.takeTextOff]}>{taken ? 'Đã nhận' : 'Nhận'}</Text>
              </Pressable>
            </View>
          );
        })}
        <Text style={s.label}>Rương chặng đường</Text>
        <View style={s.chests}>
          {region.milestones.map((m) => (
            <Pressable key={m.code} onPress={() => (m.status === 'ready' ? onClaim(m.code) : undefined)} style={s.chest} accessibilityRole="button"
              accessibilityLabel={`Rương ${m.required} hoạt động: ${m.status === 'claimed' ? 'đã nhận' : m.status === 'ready' ? 'sẵn sàng' : 'chưa đủ'}`}>
              <ChestArt status={m.status === 'claimed' ? 'opened' : m.status} size={48} opening={busy === m.code} />
              <Text style={s.chestText}>{m.required} bước</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.note}>Mỗi ngày tối đa {limit} hoạt động của một vùng được tính vào hành trình.</Text>
      </>}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 16 },
  flex: { flex: 1 },
  content: { paddingBottom: 120 },
  mapCard: { height: MAP_HEIGHT, borderRadius: 26, overflow: 'hidden', backgroundColor: '#D9F0D2', marginBottom: 12 },
  skeleton: { opacity: 0.6 },
  landmark: { position: 'absolute', marginLeft: -55, marginTop: -62, alignItems: 'center' },
  fog: { position: 'absolute', top: 12, alignSelf: 'center' },
  fogText: { fontSize: 34, opacity: 0.95 },
  shine: { position: 'absolute', left: 30, top: 30, width: 50, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  spot: { position: 'absolute', marginLeft: -48, marginTop: -4, width: 96, alignItems: 'center' },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#5DAF6A', shadowColor: '#1F4F2A', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  badgeLocked: { borderColor: '#A7B4C0', backgroundColor: '#EEF2F5' },
  badgeOn: { borderColor: '#E09A2B', transform: [{ scale: 1.12 }] },
  badgeEmoji: { fontSize: 20 },
  spotName: { marginTop: 2, fontSize: 11, fontWeight: '900', color: '#1F4F2A', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 8, paddingHorizontal: 5, overflow: 'hidden' },
  spotLocked: { color: t.muted },
  pet: { position: 'absolute', left: 0, top: 0 },
  panel: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 8 },
  panelTitle: { fontSize: 20, fontWeight: '900', color: t.ink },
  panelTheme: { fontSize: 13, color: t.muted },
  lockBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F5F8', borderRadius: 12, padding: 12 },
  lockText: { flex: 1, color: t.muted, fontWeight: '700' },
  progressRow: { gap: 6 },
  progressText: { fontSize: 13, fontWeight: '800', color: '#22703A' },
  label: { fontSize: 14, fontWeight: '900', color: t.ink, marginTop: 6 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F4FAF2', borderRadius: 12, padding: 10, minHeight: 48 },
  taskTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: t.ink },
  done: { color: t.muted, textDecorationLine: 'line-through' },
  check: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#22A06B', alignItems: 'center', justifyContent: 'center' },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  activityEmoji: { fontSize: 22 },
  activityName: { flex: 1, fontSize: 15, color: t.ink },
  take: { backgroundColor: '#5DAF6A', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  takeOff: { backgroundColor: '#E3EFE0' },
  takeText: { color: '#FFFFFF', fontWeight: '900' },
  takeTextOff: { color: '#5B7A5F' },
  chests: { flexDirection: 'row', gap: 12 },
  chest: { alignItems: 'center' },
  chestText: { fontSize: 11, fontWeight: '800', color: t.muted },
  note: { fontSize: 12, color: t.muted },
  rewardList: { gap: 10 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardName: { fontSize: 15, fontWeight: '800', color: t.ink },
});

