import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { Badge, MATERIAL_INK } from '../../achievements/Badge';
import type { Achievement, AchievementsOverview, AchievementTier, ClaimAllResult, ClaimResult, Material } from '../../achievements/types';
import { AppModal } from '../../ui/AppModal';
import { Card, Chip, formatNumber, IconCircle, type IconName, ProgressBar, SectionHeader, Segmented } from '../../ui/kit';
import { radius } from '../../ui/design';
import { useToast } from '../../ui/Toast';
import { makeStyles, useTheme } from '../../ui/theme';
import { Triumph } from '../../world/diorama';
import { request, showError } from '../main/shared';

type Look = 'list' | 'collection';

const MATERIAL_ORDER: Material[] = ['bronze', 'silver', 'gold', 'diamond', 'legendary'];
const BAR: Record<Material, string> = { bronze: '#B9733F', silver: '#7C8E9F', gold: '#D9A514', diamond: '#2C9BC4', legendary: '#7D57D9' };

const pad = (n: number) => String(n).padStart(2, '0');
export const dayOf = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** The badge to show for an achievement: its tier reached, else the next one, frosted. */
const shown = (a: Achievement) => ({ material: a.material ?? a.next?.material ?? 'bronze', locked: a.tier === 0 });
const share = (a: Achievement) => (a.next ? Math.min(1, a.progress / a.next.threshold) : 1);

export function AchievementsScreen({ onBack, onCoins, onOpenKeepsakes }: {
  onBack: () => void;
  /** The user's coin balance after a reward was taken. */
  onCoins?: (coins: number) => void;
  /** "Kỷ vật pet mang về": Kho đồ on its Kỷ vật tab, where this entry used to lead. */
  onOpenKeepsakes?: () => void;
}) {
  const toast = useToast();
  const { t } = useTheme();
  const s = useStyles();
  const ink = useMaterialInk();
  const hero = useHero();
  const [data, setData] = useState<AchievementsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [group, setGroup] = useState('all');
  const [look, setLook] = useState<Look>('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  // Groups start folded to one line each; a row unfolds in place to show its tiers.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const reduceMotion = useReduceMotion();
  const animate = useCallback(() => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
  }, [reduceMotion]);
  const toggle = useCallback((set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    animate();
    set((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, [animate]);
  const [burst, setBurst] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const body = await request('/api/achievements') as AchievementsOverview;
      setData(body);
      // They are on screen now (marked "Mới" this once): no notice for them elsewhere, on any device.
      const fresh = body.achievements.flatMap((a) => a.tiers.filter((tier) => tier.new && tier.unlock_id).map((tier) => tier.unlock_id as number));
      if (fresh.length) void request('/api/achievements/seen', { method: 'POST', body: { ids: fresh } }).catch(() => undefined);
    } catch (e) { setFailed(true); showError('Không tải được thành tựu', e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const claim = useCallback(async (tier: AchievementTier) => {
    if (!tier.unlock_id || busy) return;
    setBusy(tier.unlock_id);
    try {
      const result = await request(`/api/achievements/unlocks/${tier.unlock_id}/claim`, { method: 'POST' }) as ClaimResult;
      onCoins?.(result.coins);
      if (result.paid) { setBurst((b) => b + 1); toast(`+${result.reward_coins} xu cho “${tier.title}”`, 'success'); }
      else toast('Phần thưởng này đã được nhận trước đó.', 'info');
      await load();
    } catch (e) { showError('Chưa nhận được phần thưởng', e); }
    finally { setBusy(null); }
  }, [busy, load, onCoins, toast]);

  const claimAll = useCallback(async () => {
    if (busy) return;
    setBusy('all');
    try {
      const result = await request('/api/achievements/claim-all', { method: 'POST' }) as ClaimAllResult;
      onCoins?.(result.coins);
      toast(result.reward_coins > 0 ? `+${result.reward_coins} xu từ ${result.paid} thành tựu` : 'Các phần thưởng đã được nhận trước đó.', result.reward_coins > 0 ? 'success' : 'info');
      await load();
    } catch (e) { showError('Chưa nhận được phần thưởng', e); }
    finally { setBusy(null); }
  }, [busy, load, onCoins, toast]);

  const byId = useMemo(() => new Map((data?.achievements ?? []).map((a) => [a.id, a])), [data]);
  const groupName = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g.name])), [data]);
  const filtered = useMemo(() => (data?.achievements ?? []).filter((a) => (group === 'all' || a.group === group)), [data, group]);
  const perMaterial = useMemo(() => {
    const counts: Record<Material, number> = { bronze: 0, silver: 0, gold: 0, diamond: 0, legendary: 0 };
    for (const a of data?.achievements ?? []) for (const tier of a.tiers) if (tier.unlocked) counts[tier.material] += 1;
    return counts;
  }, [data]);
  const open = openId ? byId.get(openId) ?? null : null;

  return <View style={s.screen}>
    <View style={s.topRow}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại" style={s.round}>
        <Ionicons name="chevron-back" size={22} color={t.ink} />
      </Pressable>
      <View style={s.heading}><Text style={s.title}>Thành tựu</Text><Text style={s.subtitle}>Ghi nhận hành trình thật của bạn</Text></View>
      <Pressable onPress={() => { void load(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cập nhật thành tựu" style={s.round}>
        <Ionicons name="refresh" size={18} color={t.accent} />
      </Pressable>
    </View>

    {loading && !data ? <ActivityIndicator color={t.accent} style={s.loader} testID="achievements-loading" />
      : failed && !data ? <Card style={s.empty}>
        <Ionicons name="cloud-offline-outline" size={26} color={t.accent} />
        <Text style={s.emptyTitle}>Chưa kết nối được</Text><Text style={s.muted}>Hãy thử tải lại để xem thành tựu của bạn.</Text>
        <Pressable onPress={() => { void load(); }} style={s.primary} accessibilityRole="button"><Text style={s.primaryText}>Thử lại</Text></Pressable>
      </Card>
      : data ? <>
        <LinearGradient colors={hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={s.heroTop}>
            <Badge icon="trophy" material={data.summary.unlocked ? 'gold' : null} locked={!data.summary.unlocked} size={84} />
            <View style={s.heroNumbers}>
              <Text style={s.eyebrow}>ĐÃ MỞ KHÓA</Text>
              <Text style={s.bigNumber} testID="achievements-unlocked">{data.summary.unlocked}<Text style={s.bigTotal}> / {data.summary.total}</Text></Text>
              <Text style={s.muted}>cấp huy hiệu · {data.summary.percent}% hoàn thành</Text>
            </View>
          </View>
          <ProgressBar value={data.summary.total ? data.summary.unlocked / data.summary.total : 0} animated />
          <View style={s.materials}>
            {MATERIAL_ORDER.map((m) => <View key={m} style={s.materialCount} accessibilityLabel={`${data.tiers.find((x) => x.material === m)?.name}: ${perMaterial[m]}`}>
              <Badge icon="star" material={m} locked={!perMaterial[m]} size={30} />
              <Text style={[s.materialNumber, { color: perMaterial[m] ? ink[m] : t.muted }]}>{perMaterial[m]}</Text>
            </View>)}
          </View>
          {data.summary.claimable ? <Pressable onPress={() => { void claimAll(); }} disabled={!!busy} style={[s.primary, s.claimAll]} accessibilityRole="button" testID="claim-all">
            {busy === 'all' ? <ActivityIndicator color={t.onPrimary} /> : <><Ionicons name="cash" size={16} color={t.onPrimary} />
              <Text style={s.primaryText}>Nhận {formatNumber(data.summary.claimable_coins)} xu từ {data.summary.claimable} cấp</Text></>}
          </Pressable> : null}
        </LinearGradient>

        {data.recent.length ? <>
          <SectionHeader title="Mới mở khóa" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recentRow}>
            {data.recent.map((u) => <Pressable key={u.id} onPress={() => setOpenId(u.achievement)} style={s.recentCard} accessibilityRole="button"
              accessibilityLabel={`${u.title}, ${u.name}, ${dayOf(u.unlocked_at)}`}>
              <Badge icon={u.icon} material={u.material} size={56} />
              <Text numberOfLines={2} style={s.recentTitle}>{u.title}</Text>
              <Text style={[s.tierText, { color: ink[u.material] }]}>{u.name}</Text>
              <Text style={s.date}>{dayOf(u.unlocked_at)}</Text>
            </Pressable>)}
          </ScrollView>
        </> : null}

        {data.near.length ? <>
          <SectionHeader title="Sắp đạt được" />
          <Card style={s.list}>{data.near.map((id) => byId.get(id)).filter(Boolean).map((a) => <Row key={a!.id} a={a!} onOpen={() => setOpenId(a!.id)} />)}</Card>
        </> : null}

        <SectionHeader title="Bộ sưu tập huy hiệu" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Chip label="Tất cả" selected={group === 'all'} onPress={() => setGroup('all')} />
          {data.groups.map((g) => <Chip key={g.id} label={`${g.name} ${g.unlocked}/${g.total}`} selected={group === g.id} onPress={() => setGroup(g.id)} />)}
        </ScrollView>
        <View style={s.switches}>
          <Segmented compact value={look} onChange={setLook}
            options={[{ value: 'list', label: 'Danh sách' }, { value: 'collection', label: 'Huy hiệu' }]} />
        </View>

        {!filtered.length ? <Card style={s.empty}><Ionicons name="ribbon-outline" size={24} color={t.accent} />
          <Text style={s.muted}>Chưa có thành tựu nào ở đây.</Text></Card>
          : look === 'collection' ? <Card style={s.grid}>
            {filtered.map((a) => <Pressable key={a.id} onPress={() => setOpenId(a.id)} style={s.cell} accessibilityRole="button"
              accessibilityLabel={`${a.title}${a.tier ? `, ${a.tier_name}` : ', chưa mở khóa'}`} testID={`badge-${a.id}`}>
              <Badge icon={a.icon} {...shown(a)} size={58} />
              <Text numberOfLines={2} style={[s.cellTitle, !a.tier && s.mutedTitle]}>{a.title}</Text>
              {a.new ? <View style={s.newDot} /> : null}
            </Pressable>)}
          </Card>
          : <>
            {group === 'all' ? <View style={s.foldBar}>
              <Text style={s.muted}>{openGroups.size ? `${openGroups.size} nhóm đang mở` : 'Chạm vào một nhóm để xem'}</Text>
              <Pressable onPress={() => { animate(); if (openGroups.size) { setOpenGroups(new Set()); setOpenRows(new Set()); }
                else setOpenGroups(new Set(data.groups.map((g) => g.id))); }} hitSlop={8} accessibilityRole="button" testID="fold-all">
                <Text style={s.link}>{openGroups.size ? 'Thu gọn tất cả' : 'Mở tất cả'}</Text>
              </Pressable>
            </View> : null}
            {(group === 'all' ? data.groups.map((g) => g.id) : [group]).map((gid) => {
              const items = filtered.filter((a) => a.group === gid);
              if (!items.length) return null;
              const meta = data.groups.find((g) => g.id === gid);
              // One group picked in the chips: it is simply shown, nothing to unfold.
              const opened = group !== 'all' || openGroups.has(gid);
              return <View key={gid} style={s.groupBlock}>
                {group === 'all' && meta ? <GroupHeader meta={meta} opened={opened} claimable={items.reduce((n, a) => n + a.claimable, 0)}
                  fresh={items.some((a) => a.new)} onPress={() => toggle(setOpenGroups, gid)} /> : null}
                {opened ? <Card style={s.list}>{items.map((a) => <Row key={a.id} a={a} expanded={openRows.has(a.id)}
                  onToggle={() => toggle(setOpenRows, a.id)} onOpen={() => setOpenId(a.id)} busy={busy} onClaim={claim} />)}</Card> : null}
              </View>;
            })}
          </>}

        {onOpenKeepsakes ? <Pressable onPress={onOpenKeepsakes} style={s.keepsakes} accessibilityRole="button" testID="open-keepsakes">
          <Ionicons name="gift-outline" size={20} color={t.accent} />
          <View style={s.flex}><Text style={s.rowTitle}>Kỷ vật pet mang về</Text><Text style={s.muted}>Xem trong Kho đồ</Text></View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable> : null}
        <Text style={s.footnote}>Tiến độ được tính từ kết quả Mirabi đã ghi nhận: bài học, màn chơi, phiên tập trung, chuyến đi dạo… Xu chỉ nhận một lần cho mỗi cấp.</Text>
      </> : null}

    {open ? <Detail a={open} group={groupName.get(open.group) ?? ''} busy={busy} burst={burst} onClaim={claim} onClose={() => setOpenId(null)} /> : null}
  </View>;
}

function GroupHeader({ meta, opened, claimable, fresh, onPress }: { meta: AchievementsOverview['groups'][number]; opened: boolean;
  claimable: number; fresh: boolean; onPress: () => void }) {
  const { t } = useTheme();
  const s = useStyles();
  return <Pressable onPress={onPress} style={[s.groupHeader, opened && s.groupHeaderOpen]} accessibilityRole="button"
    accessibilityState={{ expanded: opened }} accessibilityLabel={`${meta.name}, ${meta.unlocked} trên ${meta.total} cấp`} testID={`group-${meta.id}`}>
    <IconCircle name={(meta.icon in Ionicons.glyphMap ? meta.icon : 'ribbon') as IconName} size={38} />
    <View style={s.flex}>
      <View style={s.rowHead}>
        <Text numberOfLines={1} style={[s.rowTitle, s.flexShrink]}>{meta.name}</Text>
        {fresh ? <Text style={s.newPill}>Mới</Text> : null}
      </View>
      <View style={s.barRow}>
        <View style={s.flex}><ProgressBar value={meta.total ? meta.unlocked / meta.total : 0} /></View>
        <Text style={s.count}>{meta.unlocked}/{meta.total}</Text>
      </View>
    </View>
    {claimable ? <View style={s.claimDot}><Text style={s.claimDotText}>{claimable}</Text></View> : null}
    <Ionicons name={opened ? 'chevron-up' : 'chevron-down'} size={20} color={t.muted} />
  </Pressable>;
}

/** An achievement. With `onToggle` it unfolds in place (its tiers and rewards); otherwise a tap opens the sheet. */
function Row({ a, expanded = false, onToggle, onOpen, busy = null, onClaim }: { a: Achievement; expanded?: boolean; onToggle?: () => void;
  onOpen: () => void; busy?: number | 'all' | null; onClaim?: (tier: AchievementTier) => void }) {
  const { t } = useTheme();
  const s = useStyles();
  const ink = useMaterialInk();
  const look = shown(a);
  const folds = !!onToggle;
  return <View style={expanded ? s.rowOpen : undefined}>
    <Pressable onPress={folds ? onToggle : onOpen} style={s.row} accessibilityRole="button" testID={`achievement-${a.id}`}
      accessibilityState={folds ? { expanded } : undefined}
      accessibilityLabel={`${a.title}. ${a.tier ? a.tier_name : 'Chưa mở khóa'}. ${a.next ? `${a.progress} trên ${a.next.threshold} ${a.unit}` : 'Đã đạt cấp cao nhất'}`}>
      <Badge icon={a.icon} {...look} size={52} />
      <View style={s.flex}>
        <View style={s.rowHead}>
          <Text numberOfLines={1} style={[s.rowTitle, s.flexShrink]}>{a.title}</Text>
          {a.tier ? <Text style={[s.tierPill, { color: ink[look.material] }]}>{a.tier_name}</Text> : null}
          {a.new ? <Text style={s.newPill}>Mới</Text> : null}
        </View>
        <Text numberOfLines={1} style={s.goal}>{a.next ? a.next.goal : 'Đã đạt cấp cao nhất'}</Text>
        <View style={s.barRow}>
          <View style={s.flex}><ProgressBar value={share(a)} color={BAR[a.next?.material ?? look.material]} /></View>
          <Text style={s.count}>{a.next ? `${formatNumber(a.progress)}/${formatNumber(a.next.threshold)}` : '✓'}</Text>
        </View>
      </View>
      {a.claimable ? <View style={s.claimDot}><Ionicons name="cash" size={14} color={t.onPrimary} /></View> : null}
      <Ionicons name={!folds ? 'chevron-forward' : expanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
    </Pressable>
    {expanded ? <View style={s.unfolded} testID={`achievement-${a.id}-tiers`}>
      <Text style={s.unfoldedText}>{a.description}</Text>
      <TierLadder a={a} busy={busy} onClaim={onClaim} />
      <Pressable onPress={onOpen} style={s.bigBadgeLink} accessibilityRole="button" hitSlop={6}>
        <Ionicons name="expand-outline" size={15} color={t.accent} /><Text style={s.link}>Xem huy hiệu lớn</Text>
      </Pressable>
    </View> : null}
  </View>;
}

function TierLadder({ a, busy, onClaim }: { a: Achievement; busy: number | 'all' | null; onClaim?: (tier: AchievementTier) => void }) {
  const { t } = useTheme();
  const s = useStyles();
  const ink = useMaterialInk();
  return <>{a.tiers.map((tier) => <View key={tier.rank} style={s.tierRow} testID={`tier-${a.id}-${tier.rank}`}>
    <Badge icon={a.icon} material={tier.material} locked={!tier.unlocked} size={38} />
    <View style={s.flex}>
      <Text style={[s.rowTitle, !tier.unlocked && s.mutedTitle]}>{tier.title} <Text style={[s.tierText, { color: tier.unlocked ? ink[tier.material] : t.muted }]}>· {tier.name}</Text></Text>
      <Text style={s.goal}>{tier.goal}</Text>
      <Text style={s.date}>{tier.unlocked ? `Đạt ngày ${dayOf(tier.unlocked_at)}${tier.backfilled ? ' · ghi nhận từ hành trình trước' : ''}`
        : tier.reward_coins ? `Phần thưởng: ${tier.reward_coins} xu` : 'Phần thưởng: huy hiệu'}</Text>
    </View>
    {tier.claimable && onClaim ? <Pressable onPress={() => onClaim(tier)} disabled={!!busy} style={s.claimButton} accessibilityRole="button"
      accessibilityLabel={`Nhận ${tier.reward_coins} xu`} testID={`claim-${a.id}-${tier.rank}`}>
      {busy === tier.unlock_id ? <ActivityIndicator color={t.onPrimary} size="small" /> : <Text style={s.claimText}>+{tier.reward_coins} xu</Text>}
    </Pressable>
      : tier.unlocked && tier.claimed_at ? <Text style={s.claimed}>Đã nhận</Text>
      : tier.unlocked ? <Ionicons name="checkmark-circle" size={20} color={t.success} /> : null}
  </View>)}</>;
}

function Detail({ a, group, busy, burst, onClaim, onClose }: { a: Achievement; group: string; busy: number | 'all' | null; burst: number;
  onClaim: (tier: AchievementTier) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const s = useStyles();
  const ink = useMaterialInk();
  const look = shown(a);
  return <AppModal visible transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Đóng" accessibilityRole="button" />
    <View style={[s.sheet, { paddingBottom: insets.bottom + 18 }]} accessibilityViewIsModal testID="achievement-detail">
      <ScrollView contentContainerStyle={s.sheetBody}>
        <View style={s.detailBadge}>
          <Badge icon={a.icon} {...look} size={124} label={`${a.title}${a.tier ? `, ${a.tier_name}` : ', chưa mở khóa'}`} />
          <Triumph play={burst} size={240} style={{ top: '45%' }} color={look.material === 'legendary' ? '#E9C8FF' : '#FFD66B'} />
        </View>
        <Text style={s.eyebrowCenter}>{group.toUpperCase()}</Text>
        <Text style={s.detailTitle}>{a.title}</Text>
        <Text style={[s.detailTier, { color: a.tier ? ink[look.material] : t.muted }]}>{a.tier ? `Cấp hiện tại: ${a.tier_name}` : 'Chưa mở khóa'}</Text>
        <Text style={s.detailText}>{a.description}</Text>
        <View style={s.progressBox}>
          <View style={s.barRow}><Text style={s.rowTitle}>Tiến độ</Text>
            <Text style={s.count}>{formatNumber(a.progress)}{a.next ? ` / ${formatNumber(a.next.threshold)}` : ''} {a.unit}</Text></View>
          <ProgressBar value={share(a)} color={BAR[a.next?.material ?? look.material]} animated />
          <Text style={s.goal}>{a.next ? `Tiếp theo: ${a.milestone ? '' : `${a.next.name} · `}${a.next.goal}${a.next.reward_coins ? ` · +${a.next.reward_coins} xu` : ''}` : 'Bạn đã đạt cấp cao nhất của thành tựu này.'}</Text>
        </View>
        <Text style={s.ladderTitle}>{a.milestone ? 'Cột mốc' : 'Các cấp'}</Text>
        <TierLadder a={a} busy={busy} onClaim={onClaim} />
        <Pressable onPress={onClose} style={[s.primary, s.close]} accessibilityRole="button"><Text style={s.primaryText}>Đóng</Text></Pressable>
      </ScrollView>
    </View>
  </AppModal>;
}

/** A material's name in its colour: the badge's own deep ink on light, its pale face colours on dark (the deep inks would
 * not read on a dark card). */
const useMaterialInk = makeStyles(({ dark }): Record<Material, string> => (dark
  ? { bronze: '#E8B88E', silver: '#C9D5E0', gold: '#F7D46A', diamond: '#A9E8F8', legendary: '#DCC6FB' } : MATERIAL_INK));
/** The summary card's soft sea gradient. */
const useHero = makeStyles(({ t, dark }): readonly [string, string, ...string[]] => (dark ? [t.hero, t.card, t.seaFoam] : ['#D3EEFB', '#F4FBFF', '#E2F6F4']));

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  screen: { paddingBottom: 24 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1 },
  title: { color: t.ink, fontSize: 22, lineHeight: 29, fontWeight: '900' },
  subtitle: { color: t.muted, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  loader: { marginTop: 60 },
  empty: { alignItems: 'center', gap: 8 },
  emptyTitle: { color: t.ink, fontSize: 16, fontWeight: '900' },
  muted: { color: t.muted, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  primary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 46, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: t.accentFill },
  primaryText: { color: t.onPrimary, fontSize: 15, fontWeight: '900' },
  hero: { borderRadius: radius.xl, padding: 18, gap: 14, marginBottom: 18, borderWidth: 1, borderColor: t.glassBorder,
    shadowColor: t.shadow, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroNumbers: { flex: 1 },
  eyebrow: { color: t.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  bigNumber: { color: t.ink, fontSize: 34, lineHeight: 40, fontWeight: '900' },
  bigTotal: { color: t.muted, fontSize: 18, fontWeight: '800' },
  materials: { flexDirection: 'row', justifyContent: 'space-between' },
  materialCount: { alignItems: 'center', gap: 2 },
  materialNumber: { fontSize: 13, fontWeight: '900' },
  claimAll: { alignSelf: 'stretch' },
  recentRow: { gap: 10, paddingBottom: 6, paddingRight: 6, marginBottom: 12 },
  recentCard: { width: 116, alignItems: 'center', padding: 10, borderRadius: radius.lg, backgroundColor: t.card, gap: 3 },
  recentTitle: { color: t.ink, fontSize: 13, lineHeight: 17, fontWeight: '900', textAlign: 'center', minHeight: 34 },
  tierText: { fontSize: 12, fontWeight: '900' },
  date: { color: t.muted, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  list: { paddingVertical: 4, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 64 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: t.ink, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  mutedTitle: { color: t.muted },
  tierPill: { fontSize: 11, fontWeight: '900', paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: t.surfaceSecondary, overflow: 'hidden' },
  newPill: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: '#E2557F', overflow: 'hidden' },
  goal: { color: t.muted, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  count: { color: t.ink, fontSize: 12, fontWeight: '900', minWidth: 44, textAlign: 'right' },
  claimDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#C08A1E', alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingBottom: 10, paddingRight: 6 },
  switches: { marginBottom: 12 },
  foldBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 4 },
  link: { color: t.accent, fontSize: 13, fontWeight: '900' },
  groupBlock: { marginBottom: 10 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 64, borderRadius: radius.lg, backgroundColor: t.card,
    shadowColor: t.shadow, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  groupHeaderOpen: { marginBottom: 8, borderWidth: 1, borderColor: t.border },
  claimDotText: { color: t.onPrimary, fontSize: 12, fontWeight: '900' },
  rowOpen: { backgroundColor: t.surfaceSecondary, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: radius.md },
  unfolded: { paddingLeft: 4, paddingBottom: 12, gap: 2 },
  unfoldedText: { color: t.muted, fontSize: 13, lineHeight: 18, fontWeight: '600', marginBottom: 4 },
  bigBadgeLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, paddingVertical: 12 },
  cell: { width: '25%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2 },
  cellTitle: { color: t.ink, fontSize: 11, lineHeight: 14, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  newDot: { position: 'absolute', top: 8, right: 14, width: 10, height: 10, borderRadius: 5, backgroundColor: '#E2557F', borderWidth: 2, borderColor: t.card },
  keepsakes: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: t.card, marginTop: 4 },
  footnote: { color: t.muted, fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'center', marginTop: 14, paddingHorizontal: 10 },
  backdrop: { flex: 1, backgroundColor: t.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', backgroundColor: t.card, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  sheetBody: { padding: 20, gap: 8 },
  detailBadge: { alignItems: 'center', paddingTop: 4 },
  eyebrowCenter: { color: t.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  detailTitle: { color: t.ink, fontSize: 22, lineHeight: 29, fontWeight: '900', textAlign: 'center' },
  detailTier: { fontSize: 14, fontWeight: '900', textAlign: 'center' },
  detailText: { color: t.muted, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  progressBox: { backgroundColor: t.surfaceSecondary, borderRadius: radius.md, padding: 12, gap: 4, marginTop: 4 },
  ladderTitle: { color: t.ink, fontSize: 15, fontWeight: '900', marginTop: 8 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  claimButton: { minWidth: 76, minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: '#C08A1E', alignItems: 'center', justifyContent: 'center' },
  claimText: { color: t.onPrimary, fontSize: 13, fontWeight: '900' },
  claimed: { color: t.success, fontSize: 12, fontWeight: '900' },
  close: { marginTop: 10 },
}));
