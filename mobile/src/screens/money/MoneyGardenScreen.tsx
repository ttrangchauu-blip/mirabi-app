import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, type ImageSourcePropType, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useViewportSize } from '../../components/MobileViewport';
import { Text, TextInput } from '../../components/Typography';
import {
  clientRef, financeApi, formatVnd, monthOf, parseVnd,
  type FinanceCategory, type FinanceGoal, type FinanceSummary, type FinanceTx, type Plant, type TxType,
} from '../../life/worlds';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Chip, ProgressBar } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { localZone } from '../../life/api';
import { request, showError } from '../main/shared';
import { ErrorState } from '../together/ui';
import { useWorldMotion } from '../../world/budget';
import { Knob, Paper, SceneHeader, SceneIn } from '../../world/diorama';
import { GoalTree, PlantArt } from './GardenArt';
import { CHROME, GardenScene, landFor } from './GardenScene';
import { ICON, PLANT_ART } from './gardenAssets';

export { GoalTree };

const PLANTS: { id: Plant; label: string; leaf: string; bloom: string }[] = [
  { id: 'sakura', label: '🌸 Anh đào', leaf: '#7CC48E', bloom: '#F7B5CB' },
  { id: 'oak', label: '🌳 Sồi', leaf: '#4FA66A', bloom: '#C98E5A' },
  { id: 'sunflower', label: '🌻 Hướng dương', leaf: '#6DBA5A', bloom: '#F6C945' },
  { id: 'bamboo', label: '🎋 Tre', leaf: '#8FCB6B', bloom: '#D9F2B8' },
  { id: 'maple', label: '🍁 Phong', leaf: '#E2715E', bloom: '#F2A65A' },
  { id: 'lotus', label: '🪷 Sen', leaf: '#5DBFAE', bloom: '#F2A2C0' },
];
const plantOf = (p: Plant) => PLANTS.find((x) => x.id === p) ?? PLANTS[0];
/** The share of the target each stage stands for: reaching it is a milestone. The stage itself is the server's. */
const MILESTONE_OF_STAGE: Record<number, number> = { 2: 25, 3: 50, 4: 75, 5: 100 };

type Props = {
  onBack: () => void;
  /** The user's own pet, when it is at home: it never comes from anywhere else, and the garden has no pet without it. */
  pet?: { id: string; level: number } | null;
};
type SheetState = null | { kind: 'goal' } | { kind: 'move'; type: TxType } | { kind: 'edit' } | { kind: 'menu' } | { kind: 'help' };

/**
 * Vườn tài chính: each savings goal is a plant in a real place, under the sky of this hour and the weather really
 * outside, growing from a seed to full bloom as money is put aside (and shrinking back when some is taken out); plus
 * manual income and expenses, monthly budgets and a monthly summary. Every number is the user's own record: no bank, no
 * in-game coins, no advice. Only recording a saving moves money; a tap on a plant or on the watering can is just for
 * the joy of it and sends nothing. What plays when money is saved plays only after the server has said it is saved.
 */
export function MoneyGardenScreen({ onBack, pet = null }: Props) {
  const toast = useToast();
  const { level } = useWorldMotion();
  const { width: screenWide, height: screen } = useViewportSize();
  const [tab, setTab] = useState<'garden' | 'budget'>('garden');
  const [goals, setGoals] = useState<FinanceGoal[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [burst, setBurst] = useState(0);
  const [watering, setWatering] = useState(0);
  const [folded, setFolded] = useState(false);
  const [room, setRoom] = useState(0);
  const load = useCallback(async () => {
    try { const g = await financeApi.goals(); setGoals(g); setError(null); setSelected((s) => s ?? g[0]?.id ?? null); }
    catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const goal = goals?.find((g) => g.id === selected) ?? null;
  const land = landFor(screen, folded && !!goal, room);
  const fold = () => {
    if (level !== 'still' && Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFolded((f) => !f);
  };
  const onGoal = (next: FinanceGoal | null, grew = false, deposit = false) => {
    if (next) setGoals((list) => (list ? list.map((g) => (g.id === next.id ? next : g)) : list));
    if (deposit) setWatering((n) => n + 1);
    if (grew) {
      setBurst((b) => b + 1);
      const mark = next ? MILESTONE_OF_STAGE[next.stage] : undefined;
      if (mark) toast(mark === 100 ? 'Mục tiêu đã hoàn thành, cây nở hoa rồi!' : `Đã đạt mốc ${mark}%!`, 'success');
    }
  };

  return (
    <View style={s.fill} testID="money-garden">
      <View style={s.chrome}>
        <SceneHeader title="Vườn tài chính" subtitle="Mỗi mục tiêu tiết kiệm là một cái cây" onBack={onBack} tone="sky"
          leading={screenWide >= 350 ? <Image source={ICON.piggy} style={s.headerIcon} fadeDuration={0} accessibilityIgnoresInvertColors /> : undefined}
          right={<Knob icon="help" label="Trợ giúp" onPress={() => setSheet({ kind: 'help' })} />} />
        <GardenTabs value={tab} onChange={setTab} />
      </View>
      {tab === 'budget' ? <BudgetTab /> : !goals ? (error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} />
        : <View style={[s.garden, s.skeleton, { height: CHROME + land }]} accessibilityLabel="Đang tải khu vườn" />) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
          <SceneIn>
            <GardenScene goals={goals} selected={selected} onSelect={setSelected} onNew={() => setSheet({ kind: 'goal' })} watering={watering} burst={burst} land={land} pet={pet} />
          </SceneIn>
          <View style={s.ground}>
            <LinearGradient colors={['#BFE08A', '#E4F4C6', '#EAF7FD']} locations={[0, 0.18, 0.5]} style={StyleSheet.absoluteFill} />
            {goals.length === 0 ? (
              <Paper style={s.empty}>
                <View style={s.seedOnly}><PlantArt plant="sakura" stage={0} size={170} /></View>
                <Text style={s.emptyTitle}>Khu vườn đang chờ hạt giống đầu tiên</Text>
                <Text style={s.note}>Đặt một mục tiêu (laptop, du lịch, quỹ dự phòng…) và xem cây lớn lên theo từng khoản tiết kiệm.</Text>
                <Button title="Gieo mục tiêu" icon="leaf-outline" onPress={() => setSheet({ kind: 'goal' })} />
              </Paper>
            ) : goal ? <GoalPanel goal={goal} folded={folded} onFold={fold} onEdit={() => setSheet({ kind: 'edit' })} onMenu={() => setSheet({ kind: 'menu' })} onMove={(type) => setSheet({ kind: 'move', type })} onChanged={(g) => onGoal(g)} /> : null}
            {folded && goal ? null : <Text style={s.disclaimer}>Tiền xu trong game không phải tiền thật. Vườn chỉ thay đổi theo số tiền bạn tự ghi lại; Mirabi không kết nối ngân hàng và không đưa ra lời khuyên đầu tư.</Text>}
          </View>
        </ScrollView>
      )}
      <GoalSheet visible={sheet?.kind === 'goal'} onClose={() => setSheet(null)} onCreated={(g) => { setSheet(null); setGoals((list) => [...(list ?? []), g]); setSelected(g.id); }} />
      {goal ? <MoneySheet visible={sheet?.kind === 'move'} type={sheet?.kind === 'move' ? sheet.type : 'deposit'} goal={goal} onClose={() => setSheet(null)}
        onSaved={(g, grew, deposit) => { setSheet(null); onGoal(g, grew, deposit); }} /> : null}
      {goal ? <EditGoalSheet visible={sheet?.kind === 'edit'} goal={goal} onClose={() => setSheet(null)} onSaved={(g) => { setSheet(null); onGoal(g); }} /> : null}
      {goal ? <GoalMenu visible={sheet?.kind === 'menu'} goal={goal} onClose={() => setSheet(null)} onEdit={() => setSheet({ kind: 'edit' })} onArchived={() => { setSheet(null); setSelected(null); void load(); }} /> : null}
      <HelpSheet visible={sheet?.kind === 'help'} onClose={() => setSheet(null)} />
    </View>
  );
}

/** Khu vườn and Thu chi, on a rounded bar over the sky. */
function GardenTabs({ value, onChange }: { value: 'garden' | 'budget'; onChange: (v: 'garden' | 'budget') => void }) {
  const tabs = [{ id: 'garden', label: 'Khu vườn', icon: 'leaf' }, { id: 'budget', label: 'Thu chi', icon: 'stats-chart' }] as const;
  return (
    <View style={s.tabs} accessibilityRole="tablist">
      {tabs.map((o) => {
        const on = value === o.id;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label} style={[s.tab, on && s.tabOn]}>
            <Ionicons name={o.icon} size={17} color={on ? (o.id === 'garden' ? '#3FA45A' : t.accent) : t.muted} />
            <Text numberOfLines={1} style={[s.tabText, on && s.tabTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** How many of a goal's latest savings the card shows before "Xem thêm lịch sử". */
const HISTORY_SHOWN = 3;

function GoalPanel({ goal, folded, onFold, onEdit, onMenu, onMove, onChanged }: { goal: FinanceGoal; folded: boolean; onFold: () => void; onEdit: () => void; onMenu: () => void; onMove: (type: TxType) => void;
  onChanged: (g: FinanceGoal) => void }) {
  const confirm = useConfirm();
  const [history, setHistory] = useState<FinanceTx[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [older, setOlder] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [wholeHistory, setWholeHistory] = useState(false);
  useEffect(() => { setWholeHistory(false); }, [goal.id]);
  const reloadHistory = useCallback(() => {
    financeApi.transactions(`?goal_id=${goal.id}&limit=20`).then((r) => { setHistory(r.items); setOlder(r.next_before); setHistoryFailed(false); })
      .catch(() => { setHistory([]); setOlder(null); setHistoryFailed(true); });
  }, [goal.id]);
  useEffect(() => { reloadHistory(); }, [reloadHistory, goal.saved_amount]);
  const moreOnHand = !wholeHistory && (history?.length ?? 0) > HISTORY_SHOWN;
  async function loadOlder() {
    setWholeHistory(true);
    if (moreOnHand || older === null) return;
    setLoadingOlder(true);
    try { const r = await financeApi.transactions(`?goal_id=${goal.id}&limit=20&before=${older}`); setHistory((list) => [...(list ?? []), ...r.items]); setOlder(r.next_before); }
    catch (e) { showError('Chưa tải được lịch sử', e); }
    finally { setLoadingOlder(false); }
  }
  async function remove(tx: FinanceTx) {
    if (!(await confirm({ title: 'Xóa giao dịch?', message: `${tx.transaction_type === 'deposit' ? 'Khoản gửi' : 'Khoản rút'} ${formatVnd(tx.amount)} sẽ bị xóa.`,
      confirmLabel: 'Xóa', cancelLabel: 'Giữ lại', icon: 'trash-outline' }))) return;
    try { const r = await financeApi.deleteTx(tx.id); if (r.goal) onChanged(r.goal); reloadHistory(); }
    catch (e) { showError('Chưa xóa được', e); }
  }
  return (
    <Paper style={s.panel} testID="goal-panel">
      <Pressable onPress={onFold} hitSlop={10} accessibilityRole="button" accessibilityLabel={folded ? 'Mở rộng thẻ' : 'Thu gọn thẻ'} accessibilityState={{ expanded: !folded }} style={s.grip}>
        <Ionicons name={folded ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
      </Pressable>
      <View style={s.panelHead}>
        <PlantBadge plant={goal.plant} />
        <View style={s.flex}>
          <Text style={s.panelTitle} numberOfLines={folded ? 1 : undefined}>{goal.name}</Text>
          <Text style={s.stage} numberOfLines={folded ? 1 : undefined}>{plantOf(goal.plant).label.replace(/^\S+\s/, '')} · {goal.stage_name}</Text>
        </View>
        <Knob icon="pencil" label="Chỉnh sửa mục tiêu" onPress={onEdit} />
        <Knob icon="ellipsis-horizontal" label="Thao tác khác" onPress={onMenu} />
      </View>
      <View style={s.barRow}><View style={s.flex}><ProgressBar value={goal.percent / 100} color="#2F9E4F" animated /></View><Text style={s.barPercent}>{goal.percent}%</Text></View>
      {folded ? null : <>
        <View style={s.sums} accessible accessibilityLabel={`Đã tiết kiệm ${formatVnd(goal.saved_amount)} trên ${formatVnd(goal.target_amount)}`}>
          <Sum icon={ICON.target} label="Mục tiêu" value={goal.target_amount} tint="#E8F4FC" color={t.ink} />
          <Sum icon={ICON.piggy} label="Đã tiết kiệm" value={goal.saved_amount} tint="#E8F7EC" color="#22703A" />
          <Sum icon={ICON.coins} label="Còn thiếu" value={Math.max(0, goal.target_amount - goal.saved_amount)} tint="#FDECEF" color="#B4234F" />
        </View>
        <Milestones goal={goal} />
        {goal.estimated_date && goal.percent < 100 ? <Text style={s.note}>Dự kiến đạt khoảng {goal.estimated_date.split('-').reverse().join('/')}, theo 90 ngày qua.</Text> : null}
        <View style={s.row}>
          <Button title="Gửi tiết kiệm" icon="add-circle-outline" onPress={() => onMove('deposit')} style={s.flex} />
          <Button title="Rút tiền" icon="remove-circle-outline" variant="secondary" onPress={() => onMove('withdraw')} style={s.flex} />
        </View>
        <Text style={s.label}>Lịch sử đóng góp</Text>
        {history === null ? <Text style={s.note}>Đang tải…</Text> : historyFailed ? <>
          <Text style={s.note}>Chưa tải được lịch sử.</Text>
          <Button title="Tải lại lịch sử" variant="ghost" onPress={reloadHistory} />
        </> : history.length === 0 ? <Text style={s.note}>Chưa có khoản nào.</Text> : <View>{(wholeHistory ? history : history.slice(0, HISTORY_SHOWN)).map((tx) => (
          <View key={tx.id} style={s.txRow}>
            <Text style={[s.txAmount, { color: tx.transaction_type === 'deposit' ? '#22703A' : '#B4234F' }]}>
              {tx.transaction_type === 'deposit' ? '+' : '−'}{formatVnd(tx.amount)}</Text>
            <Text style={s.txDate}>{new Date(tx.occurred_at).toLocaleDateString('vi-VN')}{tx.note ? ` · ${tx.note}` : ''}</Text>
            <Pressable onPress={() => { void remove(tx); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Xóa giao dịch ${formatVnd(tx.amount)}`}>
              <Ionicons name="trash-outline" size={16} color={t.muted} />
            </Pressable>
          </View>
        ))}</View>}
        {older !== null || moreOnHand ? <Button title="Xem thêm lịch sử" variant="ghost" loading={loadingOlder} onPress={() => { void loadOlder(); }} /> : null}
      </>}
    </Paper>
  );
}

/** The species at its fullest, a small round picture at the head of the card. */
function PlantBadge({ plant }: { plant: Plant }) {
  return (
    <View style={s.badge} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Image source={(PLANT_ART[plant] ?? PLANT_ART.sakura)[5]} style={s.badgeArt} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />
    </View>
  );
}

/** The goal's marks on a line, a flower for each one reached. The line is drawn up to what the server says is reached. */
function Milestones({ goal }: { goal: FinanceGoal }) {
  return (
    <View style={s.milestones} accessibilityLabel={`Các mốc đã đạt: ${goal.milestones.filter((m) => m.reached).map((m) => `${m.percent}%`).join(', ') || 'chưa có'}`}>
      <View style={s.track}><View style={[s.trackOn, { width: `${Math.max(0, Math.min(100, ((goal.percent - 25) / 75) * 100))}%` }]} /></View>
      {goal.milestones.map((m) => (
        <View key={m.percent} style={s.milestone}>
          <Image source={m.reached ? ICON.flowerOn : ICON.flowerOff} style={s.flower} fadeDuration={0} accessibilityIgnoresInvertColors />
          <Text style={s.milestoneText}>{m.percent}%</Text>
        </View>
      ))}
    </View>
  );
}

function Sum({ icon, label, value, tint, color }: { icon: ImageSourcePropType; label: string; value: number; tint: string; color: string }) {
  return (
    <View style={[s.sum, { backgroundColor: tint }]}>
      <View style={s.sumHead}>
        <Image source={icon} style={s.sumIcon} fadeDuration={0} accessibilityIgnoresInvertColors />
        <Text style={s.sumLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[s.sumValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatVnd(value)}</Text>
    </View>
  );
}

/** What the "…" of the card holds. */
function GoalMenu({ visible, goal, onClose, onEdit, onArchived }: { visible: boolean; goal: FinanceGoal; onClose: () => void; onEdit: () => void; onArchived: () => void }) {
  const confirm = useConfirm();
  async function archive() {
    onClose();
    if (!(await confirm({ title: 'Cất mục tiêu này?', message: 'Cây sẽ rời khỏi vườn. Lịch sử giao dịch vẫn được giữ.', confirmLabel: 'Cất đi', cancelLabel: 'Giữ lại', icon: 'archive-outline' }))) return;
    try { await financeApi.updateGoal(goal.id, { status: 'archived' }); onArchived(); } catch (e) { showError('Chưa cất được mục tiêu', e); }
  }
  return (
    <Sheet visible={visible} title={goal.name} onClose={onClose}>
      <Button title="Chỉnh sửa mục tiêu" icon="pencil" variant="secondary" onPress={onEdit} />
      <Button title="Cất mục tiêu" icon="archive-outline" variant="ghost" onPress={() => { void archive(); }} />
    </Sheet>
  );
}

/** Changing a goal changes only its name, its target and its species: what was saved stays what was saved. */
function EditGoalSheet({ visible, goal, onClose, onSaved }: { visible: boolean; goal: FinanceGoal; onClose: () => void; onSaved: (g: FinanceGoal) => void }) {
  const show = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const [name, setName] = useState(goal.name);
  const [amount, setAmount] = useState(show(goal.target_amount));
  const [plant, setPlant] = useState<Plant>(goal.plant);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) { setName(goal.name); setAmount(show(goal.target_amount)); setPlant(goal.plant); } }, [visible, goal.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = parseVnd(amount);
  const clean = name.trim();
  return (
    <Sheet visible={visible} title="Chỉnh sửa mục tiêu" onClose={onClose}>
      <View style={s.center}><PlantArt plant={plant} stage={goal.stage} size={150} /></View>
      <Text style={s.label}>Tên mục tiêu</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Ví dụ: Mua laptop, Quỹ du lịch" placeholderTextColor="#7F95A8" maxLength={60} style={s.input} accessibilityLabel="Tên mục tiêu" />
      <Text style={s.label}>Số tiền mục tiêu (₫)</Text>
      <AmountInput value={amount} onChange={setAmount} label="Số tiền mục tiêu" />
      <Text style={s.note}>Đã tiết kiệm {formatVnd(goal.saved_amount)}. Đổi mục tiêu không làm thay đổi số tiền này.</Text>
      <View style={s.chips}>{PLANTS.map((p) => <Chip key={p.id} label={p.label} selected={plant === p.id} onPress={() => setPlant(p.id)} />)}</View>
      <Button title="Lưu thay đổi" icon="checkmark" loading={saving} disabled={!clean || !target} onPress={async () => {
        const body = { ...(clean !== goal.name ? { name: clean } : {}), ...(target !== goal.target_amount ? { target_amount: target! } : {}), ...(plant !== goal.plant ? { plant } : {}) };
        if (!Object.keys(body).length) { onClose(); return; }
        setSaving(true);
        try { onSaved(await financeApi.updateGoal(goal.id, body)); }
        catch (e) { showError('Chưa lưu được mục tiêu', e); }
        finally { setSaving(false); }
      }} />
    </Sheet>
  );
}

/** How the garden works, in plain words. */
function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const steps = ['Mỗi mục tiêu tiết kiệm là một cái cây. Bạn chọn loại cây khi gieo và đổi được bất cứ lúc nào.', 'Cây lớn theo số tiền bạn đã ghi: hạt giống, mầm non, rồi đến các mốc 25%, 50%, 75%, và nở hoa ở 100%.',
    'Rút tiền hay xóa một khoản thì cây nhỏ lại đúng theo số tiền còn lại.', 'Chạm vào cây để xem chi tiết. Tưới cây cho vui không làm thay đổi số tiền.'];
  return (
    <Sheet visible={visible} title="Vườn tài chính hoạt động thế nào?" onClose={onClose}>
      {steps.map((text) => <View key={text} style={s.helpRow}><Image source={ICON.flowerOn} style={s.helpIcon} fadeDuration={0} accessibilityIgnoresInvertColors /><Text style={s.helpText}>{text}</Text></View>)}
      <Text style={s.note}>Mirabi không kết nối ngân hàng. Mọi con số là do bạn tự ghi lại.</Text>
    </Sheet>
  );
}

function AmountInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TextInput value={value} onChangeText={(v) => { const n = parseVnd(v); onChange(n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : v.replace(/[^\d]/g, '')); }}
      keyboardType="number-pad" placeholder="0" placeholderTextColor="#7F95A8" style={[s.input, s.amountInput]} accessibilityLabel={label} maxLength={16} />
  );
}

function GoalSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (g: FinanceGoal) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [plant, setPlant] = useState<Plant>('sakura');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) { setName(''); setAmount(''); setPlant('sakura'); } }, [visible]);
  const target = parseVnd(amount);
  return (
    <Sheet visible={visible} title="Gieo mục tiêu mới" onClose={onClose}>
      <View style={s.center}><PlantArt plant={plant} stage={3} size={150} /></View>
      <TextInput value={name} onChangeText={setName} placeholder="Ví dụ: Mua laptop, Quỹ du lịch" placeholderTextColor="#7F95A8" maxLength={60} style={s.input}
        accessibilityLabel="Tên mục tiêu" />
      <Text style={s.label}>Số tiền mục tiêu (₫)</Text>
      <AmountInput value={amount} onChange={setAmount} label="Số tiền mục tiêu" />
      <View style={s.chips}>{PLANTS.map((p) => <Chip key={p.id} label={p.label} selected={plant === p.id} onPress={() => setPlant(p.id)} />)}</View>
      <Button title="Gieo hạt" icon="leaf" loading={saving} disabled={!name.trim() || !target} onPress={async () => {
        setSaving(true);
        try { onCreated(await financeApi.createGoal({ name: name.trim(), target_amount: target!, plant })); }
        catch (e) { showError('Chưa tạo được mục tiêu', e); }
        finally { setSaving(false); }
      }} />
    </Sheet>
  );
}

function MoneySheet({ visible, type, goal, onClose, onSaved }: { visible: boolean; type: TxType; goal: FinanceGoal; onClose: () => void;
  onSaved: (g: FinanceGoal | null, grew: boolean, deposit: boolean) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // One reference per entry: a retry after a lost answer is recognised and counted once.
  const ref = useRef(clientRef());
  useEffect(() => { if (visible) { setAmount(''); setNote(''); ref.current = clientRef(); } }, [visible]);
  // Changed after a failed save, it is another entry: the old reference would answer with what was first sent.
  useEffect(() => { ref.current = clientRef(); }, [amount, note]);
  const value = parseVnd(amount);
  const deposit = type === 'deposit';
  const tooMuch = !deposit && value != null && value > goal.saved_amount;
  return (
    <Sheet visible={visible} title={deposit ? `Tưới cây: ${goal.name}` : `Rút từ ${goal.name}`} onClose={onClose}>
      <Text style={s.note}>{deposit ? 'Ghi lại số tiền bạn vừa để dành ngoài đời.' : `Hiện có ${formatVnd(goal.saved_amount)}.`}</Text>
      <AmountInput value={amount} onChange={setAmount} label="Số tiền" />
      <TextInput value={note} onChangeText={setNote} placeholder="Ghi chú (không bắt buộc)" placeholderTextColor="#7F95A8" maxLength={200} style={s.input}
        accessibilityLabel="Ghi chú" />
      {tooMuch ? <Text style={s.error}>Không thể rút nhiều hơn số tiền đang có.</Text> : null}
      <Button title={deposit ? 'Gửi tiết kiệm' : 'Rút tiền'} loading={saving} disabled={!value || tooMuch} onPress={async () => {
        setSaving(true);
        try {
          const before = goal.stage;
          const result = await financeApi.record({ transaction_type: type, amount: value!, goal_id: goal.id, note: note.trim() || null, client_ref: ref.current });
          onSaved(result.goal, !!result.goal && result.goal.stage > before, deposit);
        } catch (e) { showError('Chưa lưu được', e); }
        finally { setSaving(false); }
      }} />
    </Sheet>
  );
}

/** Thu chi: the month's income and expenses, budgets per category and the latest entries. */
function BudgetTab() {
  const toast = useToast();
  const [period, setPeriod] = useState(monthOf());
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [txs, setTxs] = useState<FinanceTx[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [entry, setEntry] = useState<'income' | 'expense' | 'budget' | null>(null);
  const [older, setOlder] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // The month is the one on this device's calendar, so the server counts it in this device's zone.
  const zone = localZone();
  const entries = `?period=${period}&transaction_type=income,expense&limit=30&tz=${encodeURIComponent(zone)}`;
  const load = useCallback(async () => {
    try {
      const [sum, cats, list] = await Promise.all([financeApi.summary(period, zone), financeApi.categories(),
        financeApi.transactions(entries)]);
      setSummary(sum); setCategories(cats); setTxs(list.items); setOlder(list.next_before); setError(null);
    } catch (e) { setError(e); }
  }, [period, zone, entries]);
  useEffect(() => { void load(); }, [load]);
  async function loadOlder() {
    if (older === null) return;
    setLoadingOlder(true);
    try { const list = await financeApi.transactions(`${entries}&before=${older}`); setTxs((old) => [...old, ...list.items]); setOlder(list.next_before); }
    catch (e) { showError('Chưa tải được giao dịch', e); }
    finally { setLoadingOlder(false); }
  }
  // An entry is dated when it is saved, so it can only go into the month on the calendar now.
  const thisMonth = period === monthOf();
  const shift =(months: number) => { const [y, m] = period.split('-').map(Number); setPeriod(monthOf(new Date(y, m - 1 + months, 1))); };
  if (!summary) return error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <View style={[s.budgetPanel, s.skeleton]} />;
  return (
    <ScrollView contentContainerStyle={s.budgetPage} showsVerticalScrollIndicator={false} testID="budget-tab">
      <View style={s.monthRow}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Tháng trước"><Ionicons name="chevron-back" size={22} color={t.accent} /></Pressable>
        <Text style={s.month}>Tháng {Number(period.slice(5))}/{period.slice(0, 4)}</Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Tháng sau"><Ionicons name="chevron-forward" size={22} color={t.accent} /></Pressable>
      </View>
      <View style={s.totals}>
        <Total label="Thu" value={summary.income} color="#22703A" />
        <Total label="Chi" value={summary.expense} color="#B4234F" />
        <Total label="Còn lại" value={summary.net} color={summary.net >= 0 ? t.ink : '#B4234F'} />
      </View>
      <View style={s.row}>
        <Button title="Ghi khoản thu" icon="arrow-down-circle-outline" variant="secondary" disabled={!thisMonth} onPress={() => setEntry('income')} style={s.flex} />
        <Button title="Ghi khoản chi" icon="arrow-up-circle-outline" disabled={!thisMonth} onPress={() => setEntry('expense')} style={s.flex} />
      </View>
      {thisMonth ? null : <Text style={s.note}>Chỉ ghi được khoản thu chi của tháng hiện tại. Khoản mới luôn tính vào ngày bạn ghi.</Text>}
      <View style={s.budgetPanel}>
        <View style={s.headRow}><Text style={s.label}>Ngân sách tháng</Text>
          <Pressable onPress={() => setEntry('budget')} accessibilityRole="button" accessibilityLabel="Đặt ngân sách"><Text style={s.link}>+ Đặt ngân sách</Text></Pressable></View>
        {summary.budgets.length === 0 ? <Text style={s.note}>Chưa có ngân sách nào cho tháng này.</Text> : summary.budgets.map((b) => (
          <View key={b.id} style={s.budget}>
            <Text style={s.budgetName}>{b.category?.icon} {b.category?.name}</Text>
            <ProgressBar value={Math.min(1, b.spent / b.limit_amount)} color={b.over ? '#B4234F' : '#2F7A55'} />
            <Text style={[s.note, b.over && s.error]}>{formatVnd(b.spent)} / {formatVnd(b.limit_amount)}{b.over ? ' · đã vượt ngân sách' : ''}</Text>
          </View>
        ))}
      </View>
      <View style={s.budgetPanel}>
        <Text style={s.label}>Theo danh mục</Text>
        {summary.by_category.length === 0 ? <Text style={s.note}>Chưa ghi khoản thu chi nào.</Text> : summary.by_category.map((c) => (
          <View key={String(c.category_id)} style={s.txRow}>
            <Text style={s.txDate}>{c.icon} {c.name}</Text>
            {c.income || !c.expense ? <Text style={[s.txAmount, { color: '#22703A' }]}>+{formatVnd(c.income)}</Text> : null}
            {c.expense ? <Text style={[s.txAmount, { color: '#B4234F' }]}>−{formatVnd(c.expense)}</Text> : null}
          </View>
        ))}
      </View>
      <View style={s.budgetPanel}>
        <Text style={s.label}>Giao dịch gần đây</Text>
        {txs.length === 0 ? <Text style={s.note}>Chưa có giao dịch.</Text> : txs.map((tx) => (
          <View key={tx.id} style={s.txRow}>
            <Text style={s.txDate} numberOfLines={1}>{tx.category?.icon ?? '❔'} {tx.category?.name ?? 'Chưa phân loại'}{tx.note ? ` · ${tx.note}` : ''}</Text>
            <Text style={[s.txAmount, { color: tx.transaction_type === 'income' ? '#22703A' : '#B4234F' }]}>
              {tx.transaction_type === 'income' ? '+' : '−'}{formatVnd(tx.amount)}</Text>
          </View>
        ))}
        {older !== null ? <Button title="Xem thêm giao dịch" variant="ghost" loading={loadingOlder} onPress={() => { void loadOlder(); }} /> : null}
      </View>
      <EntrySheet kind={entry} period={period} categories={categories} onClose={() => setEntry(null)}
        onSaved={() => { setEntry(null); toast('Đã lưu!', 'success'); void load(); }} />
    </ScrollView>
  );
}

function Total({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={s.total}><Text style={s.totalLabel}>{label}</Text><Text style={[s.totalValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{formatVnd(value)}</Text></View>;
}

function EntrySheet({ kind, period, categories, onClose, onSaved }: { kind: 'income' | 'expense' | 'budget' | null; period: string;
  categories: FinanceCategory[]; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef(clientRef());
  useEffect(() => { if (kind) { setAmount(''); setCategory(null); setNote(''); ref.current = clientRef(); } }, [kind]);
  // Changed after a failed save, it is another entry: the old reference would answer with what was first sent.
  useEffect(() => { ref.current = clientRef(); }, [amount, category, note]);
  const type = kind === 'income' ? 'income' : 'expense';
  const value = parseVnd(amount);
  const title = kind === 'income' ? 'Ghi khoản thu' : kind === 'expense' ? 'Ghi khoản chi' : 'Ngân sách tháng';
  return (
    <Sheet visible={!!kind} title={title} onClose={onClose}>
      <Text style={s.label}>{kind === 'budget' ? 'Hạn mức (₫)' : 'Số tiền (₫)'}</Text>
      <AmountInput value={amount} onChange={setAmount} label={kind === 'budget' ? 'Hạn mức' : 'Số tiền'} />
      <Text style={s.label}>Danh mục</Text>
      <View style={s.chips}>{categories.filter((c) => c.type === type).map((c) => (
        <Chip key={c.id} label={`${c.icon} ${c.name}`} selected={category === c.id} onPress={() => setCategory(c.id)} />))}</View>
      {kind !== 'budget' ? <TextInput value={note} onChangeText={setNote} placeholder="Ghi chú (không bắt buộc)" placeholderTextColor="#7F95A8" maxLength={200}
        style={s.input} accessibilityLabel="Ghi chú" /> : null}
      <Button title="Lưu" loading={saving} disabled={!value || (kind === 'budget' && !category)} onPress={async () => {
        setSaving(true);
        try {
          if (kind === 'budget') await financeApi.setBudget({ category_id: category!, period, limit_amount: value! });
          else await financeApi.record({ transaction_type: type, amount: value!, category_id: category, note: note.trim() || null, client_ref: ref.current });
          onSaved();
        } catch (e) { showError('Chưa lưu được', e); }
        finally { setSaving(false); }
      }} />
    </Sheet>
  );
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" />
        <View style={s.sheet} accessibilityViewIsModal>
          <View style={s.headRow}><Text style={s.panelTitle} accessibilityRole="header">{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng"><Ionicons name="close" size={22} color={t.muted} /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetBody}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  seedOnly: { height: 84, justifyContent: 'flex-end', overflow: 'hidden' },
  headerIcon: { width: 34, height: 34, marginRight: -2 },
  tabs: { flexDirection: 'row', gap: 4, marginHorizontal: 14, padding: 4, borderRadius: 24, backgroundColor: 'rgba(234,247,253,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: t.shadow, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  tab: { flex: 1, flexDirection: 'row', minHeight: 40, gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  tabOn: { backgroundColor: '#FFFFFF', shadowColor: t.shadow, shadowOpacity: 0.16, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabText: { fontSize: 15, fontWeight: '800', color: t.muted },
  tabTextOn: { color: t.accent, fontWeight: '900' },
  ground: { flexGrow: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 12, marginTop: -18, overflow: 'hidden' },
  panel: { gap: 8, borderRadius: 28, paddingTop: 4, backgroundColor: '#F8FCFF', borderWidth: 1, borderColor: '#D6ECF7' },
  grip: { alignSelf: 'center', minWidth: 72, minHeight: 16, alignItems: 'center', justifyContent: 'center' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', backgroundColor: '#EAF7FD', borderWidth: 1, borderColor: '#D6ECF7' },
  badgeArt: { position: 'absolute', left: -18, top: -6, width: 66, height: 66 * (600 / 672) },
  panelTitle: { fontSize: 18, fontWeight: '900', color: t.ink, flexShrink: 1 },
  stage: { fontSize: 12, fontWeight: '800', color: '#4F6C86' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barPercent: { fontSize: 14, fontWeight: '900', color: '#22703A' },
  sums: { flexDirection: 'row', gap: 6 },
  sum: { flex: 1, minWidth: 0, gap: 2, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 6 },
  sumHead: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sumIcon: { width: 16, height: 16 },
  sumLabel: { flexShrink: 1, fontSize: 11, fontWeight: '800', color: '#4F6C86' },
  sumValue: { fontSize: 13, fontWeight: '900' },
  milestones: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  milestone: { alignItems: 'center', width: 40 },
  flower: { width: 22, height: 22 },
  milestoneText: { fontSize: 11, color: t.muted, fontWeight: '800' },
  track: { position: 'absolute', left: 22, right: 22, top: 9, height: 4, borderRadius: 2, backgroundColor: '#E4E9EE', overflow: 'hidden' },
  trackOn: { height: 4, backgroundColor: '#F58FB3' },
  helpRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  helpIcon: { width: 22, height: 22 },
  helpText: { flex: 1, fontSize: 14, lineHeight: 20, color: t.ink },
  center: { alignItems: 'center' },
  chrome: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3 },
  content: { flexGrow: 1 },
  budgetPage: { paddingTop: 124, paddingBottom: 16, gap: 12, paddingHorizontal: 16 },
  garden: { overflow: 'hidden', backgroundColor: '#BFE3F5' },
  skeleton: { opacity: 0.6 },
  empty: { gap: 6, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: t.ink, textAlign: 'center' },
  budgetPanel: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 14, fontWeight: '900', color: t.ink, marginTop: 4 },
  note: { fontSize: 13, color: t.muted },
  error: { color: '#B4234F', fontWeight: '700', fontSize: 13 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  txAmount: { fontSize: 14, fontWeight: '900' },
  txDate: { flex: 1, fontSize: 12, color: t.muted },
  disclaimer: { fontSize: 11, lineHeight: 15, color: '#4F6C86', textAlign: 'center', paddingHorizontal: 8 },
  input: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink },
  amountInput: { fontSize: 22, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  month: { fontSize: 17, fontWeight: '900', color: t.ink },
  totals: { flexDirection: 'row', gap: 8 },
  total: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 10 },
  totalLabel: { fontSize: 12, fontWeight: '800', color: t.muted },
  totalValue: { fontSize: 15, fontWeight: '900' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  link: { color: t.accent, fontWeight: '800' },
  budget: { gap: 4 },
  budgetName: { fontSize: 14, fontWeight: '800', color: t.ink },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,36,56,0.45)' },
  sheet: { maxHeight: '88%', backgroundColor: '#FBFFF8', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  sheetBody: { gap: 10, paddingTop: 10, paddingBottom: 20 },
});
