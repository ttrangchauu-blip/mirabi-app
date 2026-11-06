import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { User } from '../../auth/AuthContext';
import { petById } from '../../pets';
import { Card } from '../../ui/kit';
import { request, showError } from './shared';
import { mixColor } from '../../components/daylight';
import { makeStyles, useTheme } from '../../ui/theme';

type Day = { date: string; checked_in: boolean; is_today: boolean; streak_count: number | null; daily_exp: number };
type Milestone = { days: number; exp: number; reached: boolean; claimed: boolean };
type Streak = { current_streak: number; longest_streak: number; last_login_date: string | null; today_claimed: boolean;
  today_exp: number; today_milestone_exp: number; calendar: Day[]; milestones: Milestone[] };

export function LoginStreakScreen({ onBack, user, onUserUpdated }: { onBack: () => void; user: User; onUserUpdated: (user: User) => void }) {
  const { t, tones } = useTheme();
  const styles = useStyles();
  const look = useLook();
  const [data, setData] = useState<Streak | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const pet = petById(user.pet);
  const element = look.element(pet.element.color, pet.element.halo);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const [streak, dashboard] = await Promise.all([request('/api/streak') as Promise<Streak>, request('/api/dashboard')]);
      setData(streak);
      if (dashboard?.user) onUserUpdated(dashboard.user as User);
    } catch (e) { setError(true); showError('Không tải được hành trình', e); }
    finally { setLoading(false); }
  }, [onUserUpdated]);
  useEffect(() => { void load(); }, [load]);

  const count = data ? (data.today_claimed ? data.current_streak : data.current_streak ? data.current_streak + 1 : 1) : 0;
  const nextMilestone = data?.milestones.find((milestone) => !milestone.reached) ?? null;
  const progress = nextMilestone ? Math.min(1, count / nextMilestone.days) : 1;

  return <View style={styles.screen}>
    <View style={styles.topRow}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại" style={styles.back}>
        <Ionicons name="chevron-back" size={22} color={t.ink} />
      </Pressable>
      <View style={styles.heading}><Text style={styles.title}>Hành trình phép màu</Text><Text style={styles.subtitle}>Mỗi lần trở lại, thế giới lại sáng hơn</Text></View>
      <Pressable onPress={() => { void load(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cập nhật hành trình" style={styles.refresh}>
        <Ionicons name="refresh" size={18} color={t.accent} />
      </Pressable>
    </View>

    {loading && !data ? <ActivityIndicator color={t.accent} style={styles.loader} /> : error && !data ? <Card style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name="cloud-offline-outline" size={26} color={t.accent} /></View>
      <Text style={styles.emptyTitle}>Đường mòn đang khuất sương</Text><Text style={styles.body}>Hãy thử tải lại để xem hành trình của bạn.</Text>
      <Pressable onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Thử lại</Text></Pressable>
    </Card> : data ? <>
      <LinearGradient colors={element.scene} style={styles.scene}>
        <View pointerEvents="none" style={[styles.orb, { backgroundColor: pet.element.halo[1] }]} />
        <View style={styles.sceneTop}><View style={styles.petNamePill}><Text style={styles.elementIcon}>{pet.element.icon}</Text><Text style={[styles.petName, { color: element.ink }]}>{user.pet_name || pet.name}</Text></View>
          <View style={styles.levelPill}><Ionicons name="sparkles" size={13} color={tones.sun.ink} /><Text style={styles.levelText}>Lv.{user.level}</Text></View></View>
        <View style={styles.petStage}>
          <View style={[styles.petHalo, { backgroundColor: `${pet.element.color}12`, borderColor: `${pet.element.color}24` }]} />
          <View style={styles.floatSparkle}><Ionicons name="sparkles" size={17} color="#F0B84A" /></View>
          <View style={styles.smallSparkle}><Ionicons name="star" size={12} color={element.ink} /></View>
          <PetArt pet={user.pet} size={164} stage={Math.max(0, Math.min(6, user.level))} />
        </View>
        <View style={styles.greeting}><Text style={styles.greetingTitle}>{data.today_claimed ? 'Que vui vì bạn đã trở lại!' : 'Mirabi đang chờ bạn!'}</Text>
          <Text style={styles.body}>{data.today_claimed ? `${user.pet_name || pet.name} cùng bạn tiếp tục hành trình nhé.` : 'Mỗi ngày là một khởi đầu mới. Cùng chăm sóc phép màu nhé!'}</Text></View>
      </LinearGradient>

      <Card style={styles.journeyCard}>
        <View style={styles.journeyHead}><View><Text style={styles.eyebrow}>HÀNH TRÌNH CỦA BẠN</Text><Text style={styles.streakNumber}>{count} <Text style={styles.streakUnit}>ngày liên tiếp</Text></Text></View>
          <View style={styles.rewardCrystal}><Ionicons name="diamond" size={19} color={tones.sky.ink} /><Text style={styles.crystalLabel}>+{data.today_exp} EXP</Text></View></View>
        <Text style={styles.journeyCopy}>{data.today_claimed ? 'Bạn đã nuôi dưỡng phép màu hôm nay!' : 'Đăng nhập hôm nay để thắp sáng điểm tiếp theo.'}</Text>
        <View style={styles.pathWrap}><MagicalLoginPath calendar={data.calendar} currentStreak={count} todayClaimed={data.today_claimed} color={pet.element.color} ink={element.ink} /></View>
        {data.today_claimed ? <View style={styles.claimed}><Ionicons name="checkmark-circle" size={17} color={t.success} /><Text style={styles.claimedText}>Bạn đã nhận EXP hôm nay</Text></View>
          : <View style={styles.pending}><Ionicons name="time-outline" size={16} color={t.accent} /><Text style={styles.pendingText}>Phần thưởng sẽ được ghi nhận khi đăng nhập</Text></View>}
      </Card>

      <Card style={styles.milestoneCard}>
        <View style={styles.milestoneIcon}><Ionicons name={nextMilestone ? 'gift-outline' : 'trophy-outline'} size={23} color={tones.sun.ink} /></View>
        <View style={styles.milestoneContent}>
          <Text style={styles.milestoneEyebrow}>{nextMilestone ? 'CỘT MỐC TIẾP THEO' : 'KỶ LỤC HÀNH TRÌNH'}</Text>
          <Text style={styles.milestoneTitle}>{nextMilestone ? `${nextMilestone.days} ngày · +${nextMilestone.exp} EXP` : `${data.longest_streak} ngày liên tiếp`}</Text>
          <Text style={styles.milestoneHint}>{nextMilestone ? `Còn ${Math.max(0, nextMilestone.days - count)} ngày nữa để chạm mốc` : 'Bạn đã chạm mọi cột mốc hiện có!'}</Text>
          {nextMilestone ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: pet.element.color }]} /></View> : null}
        </View>
      </Card>

      {data.today_milestone_exp > 0 ? <LinearGradient colors={look.celebration} style={styles.celebration}>
        <Ionicons name="sparkles" size={20} color={tones.sun.ink} /><Text style={styles.celebrationText}>Mốc mới mở khóa · thêm {data.today_milestone_exp} EXP!</Text>
      </LinearGradient> : null}
      <Text style={styles.record}>Hành trình dài nhất của bạn: {data.longest_streak} ngày</Text>
    </> : null}
  </View>;
}

/** `color` fills the lit days; `ink` is the same colour as text, lighter on the dark theme. */
function MagicalLoginPath({ calendar, currentStreak, todayClaimed, color, ink }: { calendar: Day[]; currentStreak: number; todayClaimed: boolean; color: string; ink: string }) {
  const styles = useStyles();
  const { t } = useTheme();
  const today = calendar.find((day) => day.is_today);
  return <View style={styles.path}>
    <View style={styles.pathConnector} />
    {calendar.map((day) => {
      const date = new Date(`${day.date}T12:00:00`);
      const isToday = day.is_today;
      const lit = day.checked_in;
      const missed = !lit && !isToday;
      const label = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
      return <View key={day.date} style={styles.pathRow}>
        <View style={[styles.node, lit && { backgroundColor: color, borderColor: color }, isToday && !lit && [styles.nodeToday, { borderColor: color }], missed && styles.nodeMissed]}>
          {lit ? <Ionicons name="checkmark" size={15} color={t.onPrimary} /> : isToday ? <Ionicons name="diamond" size={14} color={color} /> : <Text style={styles.nodeDate}>{date.getDate()}</Text>}
        </View>
        <Text style={[styles.pathLabel, isToday && { color: ink, fontWeight: '900' }]}>{isToday ? 'HÔM NAY' : label}</Text>
        <Text style={[styles.pathDate, isToday && { color: ink }]}>{date.getDate()}</Text>
      </View>;
    })}
    {today && !today.checked_in ? <View style={styles.pathHint}><Ionicons name="arrow-up" size={13} color={ink} /><Text style={[styles.pathHintText, { color: ink }]}>Điểm sáng tiếp theo đang chờ bạn</Text></View> : null}
  </View>;
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  screen: { gap: 14, paddingBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1 }, title: { color: t.ink, fontSize: 19, fontWeight: '900' }, subtitle: { color: t.muted, fontSize: 11, marginTop: 1 },
  refresh: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' }, loader: { marginTop: 60 },
  scene: { borderRadius: 28, padding: 16, alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: t.glassBorder },
  orb: { position: 'absolute', width: 210, height: 210, borderRadius: 105, opacity: 0.28, top: 42 },
  sceneTop: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  petNamePill: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.72)', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 99 },
  elementIcon: { fontSize: 14 }, petName: { fontSize: 12, fontWeight: '900' }, levelPill: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.72)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99 }, levelText: { color: tones.sun.ink, fontSize: 11, fontWeight: '900' },
  petStage: { height: 178, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  petHalo: { position: 'absolute', width: 142, height: 142, borderRadius: 71, borderWidth: 1 },
  floatSparkle: { position: 'absolute', top: 26, right: '23%' }, smallSparkle: { position: 'absolute', top: 65, left: '24%' },
  greeting: { alignItems: 'center', marginTop: -1 }, greetingTitle: { color: t.ink, fontSize: 18, fontWeight: '900', textAlign: 'center' }, body: { color: t.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  journeyCard: { padding: 16 }, journeyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { color: t.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, streakNumber: { color: t.ink, fontSize: 28, fontWeight: '900', marginTop: 2 }, streakUnit: { color: t.muted, fontSize: 14, fontWeight: '800' },
  rewardCrystal: { backgroundColor: tones.sky.from, borderRadius: 17, minWidth: 84, paddingVertical: 10, alignItems: 'center', gap: 3 }, crystalLabel: { color: tones.sky.ink, fontSize: 11, fontWeight: '900' }, journeyCopy: { color: t.muted, fontSize: 12, marginTop: 3 },
  pathWrap: { marginTop: 12, backgroundColor: t.surfaceSecondary, borderRadius: 18, paddingHorizontal: 9, paddingTop: 12, paddingBottom: 10 }, path: { flexDirection: 'row', justifyContent: 'space-between', position: 'relative' },
  pathConnector: { position: 'absolute', left: '7%', right: '7%', top: 14, height: 2, backgroundColor: t.border },
  pathRow: { width: '13.5%', alignItems: 'center', gap: 4 }, node: { width: 29, height: 29, borderRadius: 15, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' }, nodeToday: { borderWidth: 2, backgroundColor: t.card }, nodeMissed: { backgroundColor: dark ? t.surfaceSecondary : '#F1F4F6', borderColor: dark ? t.border : '#E4E9EC' }, nodeDate: { color: t.placeholder, fontSize: 11, fontWeight: '800' }, pathLabel: { color: t.placeholder, fontSize: 8, fontWeight: '800' }, pathDate: { color: dark ? t.placeholder : '#A4B2BC', fontSize: 8, fontWeight: '700', marginTop: -3 },
  pathHint: { width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3, marginTop: 2 }, pathHintText: { fontSize: 10, fontWeight: '800' },
  claimed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 }, claimedText: { color: t.success, fontSize: 12, fontWeight: '900' }, pending: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 }, pendingText: { color: t.accent, fontSize: 11, fontWeight: '800' },
  milestoneCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: dark ? t.card : '#FFFCF4' }, milestoneIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: tones.sun.from, alignItems: 'center', justifyContent: 'center' }, milestoneContent: { flex: 1 }, milestoneEyebrow: { color: tones.sun.ink, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, milestoneTitle: { color: t.ink, fontSize: 15, fontWeight: '900', marginTop: 2 }, milestoneHint: { color: t.muted, fontSize: 10, marginTop: 2 }, progressTrack: { height: 6, backgroundColor: dark ? t.track : '#F3E8CC', borderRadius: 99, overflow: 'hidden', marginTop: 8 }, progressFill: { height: '100%', borderRadius: 99 },
  celebration: { minHeight: 42, borderRadius: 15, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, celebrationText: { color: tones.sun.ink, fontSize: 12, fontWeight: '900' }, record: { color: t.muted, fontSize: 11, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 22 }, emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: t.ink, fontSize: 16, fontWeight: '900', marginTop: 12 }, retry: { marginTop: 14, borderRadius: 99, backgroundColor: t.tint, paddingHorizontal: 18, paddingVertical: 9 }, retryText: { color: t.accent, fontWeight: '900', fontSize: 12 },
}));

/** Colours that are not styles: the pet's stage and the milestone banner. */
const useLook = makeStyles(({ t, tones, dark }) => ({
  /** The element's halo with white on light; on dark a deep wash of the element's colour, and its ink lightened to read on it. */
  element: (color: string, halo: readonly [string, string, string]) => (dark
    ? { scene: [mixColor(color, t.card, 0.72), t.card, mixColor(color, t.card, 0.8)] as const, ink: mixColor(color, '#FFFFFF', 0.55) }
    : { scene: [halo[0], '#FFFFFF', halo[2]] as const, ink: color }),
  celebration: (dark ? [tones.sun.to, tones.sun.from] : ['#FFF4CD', '#FFF9E9']) as readonly [string, string],
}));
