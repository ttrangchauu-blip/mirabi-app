import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg';
import { Text, TextInput } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import {
  clientRef, financeApi, formatVnd, monthOf, parseVnd,
  type FinanceCategory, type FinanceGoal, type FinanceSummary, type FinanceTx, type Plant, type TxType,
} from '../../life/worlds';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Chip, ProgressBar, Segmented } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { BackHeader, ErrorState } from '../together/ui';
import { StarBurst, useLoop } from '../work/workArt';

const PLANTS: { id: Plant; label: string; leaf: string; bloom: string }[] = [
  { id: 'sakura', label: '🌸 Anh đào', leaf: '#7CC48E', bloom: '#F7B5CB' },
  { id: 'oak', label: '🌳 Sồi', leaf: '#4FA66A', bloom: '#C98E5A' },
  { id: 'sunflower', label: '🌻 Hướng dương', leaf: '#6DBA5A', bloom: '#F6C945' },
  { id: 'bamboo', label: '🎋 Tre', leaf: '#8FCB6B', bloom: '#D9F2B8' },
  { id: 'maple', label: '🍁 Phong', leaf: '#E2715E', bloom: '#F2A65A' },
  { id: 'lotus', label: '🪷 Sen', leaf: '#5DBFAE', bloom: '#F2A2C0' },
];
const plantOf = (p: Plant) => PLANTS.find((x) => x.id === p) ?? PLANTS[0];

type Props = { onBack: () => void };

/**
 * Vườn tài chính: each savings goal is a tree that grows from a seed to a tree in bloom as money is put aside (and
 * shrinks back when some is taken out); plus manual income and expenses, monthly budgets and a monthly summary. Every
 * number is the user's own record: no bank, no in-game coins, no advice.
 */
export function MoneyGardenScreen({ onBack }: Props) {
  const [tab, setTab] = useState<'garden' | 'budget'>('garden');
  const [goals, setGoals] = useState<FinanceGoal[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sheet, setSheet] = useState<null | { kind: 'goal' } | { kind: 'move'; type: TxType }>(null);
  const [burst, setBurst] = useState(0);
  const load = useCallback(async () => {
    try { const g = await financeApi.goals(); setGoals(g); setError(null); setSelected((s) => s ?? g[0]?.id ?? null); }
    catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const goal = goals?.find((g) => g.id === selected) ?? null;
  const onGoal = (next: FinanceGoal | null, grew = false) => {
    if (next) setGoals((list) => (list ? list.map((g) => (g.id === next.id ? next : g)) : list));
    if (grew) setBurst((b) => b + 1);
  };

  return (
    <View style={s.fill} testID="money-garden">
      <BackHeader title="Vườn tài chính" subtitle="Mỗi mục tiêu tiết kiệm là một cái cây" onBack={onBack} />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'garden', label: 'Khu vườn' }, { value: 'budget', label: 'Thu chi' }]} />
      {tab === 'budget' ? <BudgetTab /> : !goals ? (error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} />
        : <View style={[s.garden, s.skeleton]} accessibilityLabel="Đang tải khu vườn" />) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.garden}>
            <GardenBackdrop />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.trees}>
              {goals.map((g) => (
                <Pressable key={g.id} onPress={() => setSelected(g.id)} style={[s.treeSlot, g.id === selected && s.treeOn]} accessibilityRole="button"
                  accessibilityLabel={`${g.name}: ${g.stage_name}, ${g.percent}%`} testID={`tree-${g.id}`}>
                  <GoalTree plant={g.plant} stage={g.stage} />
                  <Text style={s.treeName} numberOfLines={1}>{g.name}</Text>
                  <Text style={s.treePct}>{g.percent}%</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setSheet({ kind: 'goal' })} style={[s.treeSlot, s.newTree]} accessibilityRole="button" accessibilityLabel="Gieo mục tiêu mới">
                <Ionicons name="add-circle" size={36} color="#2F7A55" />
                <Text style={s.newTreeText}>Gieo hạt mới</Text>
              </Pressable>
            </ScrollView>
            <StarBurst burstKey={burst} color="#F7B5CB" />
          </View>
          {goals.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>Khu vườn đang chờ hạt giống đầu tiên</Text>
              <Text style={s.note}>Đặt một mục tiêu (laptop, du lịch, quỹ dự phòng…) và xem cây lớn lên theo từng khoản tiết kiệm.</Text>
              <Button title="Gieo mục tiêu" icon="leaf-outline" onPress={() => setSheet({ kind: 'goal' })} />
            </View>
          ) : goal ? <GoalPanel goal={goal} onMove={(type) => setSheet({ kind: 'move', type })} onChanged={(g) => onGoal(g)}
            onArchived={() => { setSelected(null); void load(); }} /> : null}
          <Text style={s.disclaimer}>Tiền xu trong game không phải tiền thật. Vườn chỉ thay đổi theo số tiền bạn tự ghi lại; Mirabi không kết nối ngân hàng và không đưa ra lời khuyên đầu tư.</Text>
        </ScrollView>
      )}
      <GoalSheet visible={sheet?.kind === 'goal'} onClose={() => setSheet(null)} onCreated={(g) => { setSheet(null); setGoals((list) => [...(list ?? []), g]); setSelected(g.id); }} />
      {goal ? <MoneySheet visible={sheet?.kind === 'move'} type={sheet?.kind === 'move' ? sheet.type : 'deposit'} goal={goal} onClose={() => setSheet(null)}
        onSaved={(g, grew) => { setSheet(null); onGoal(g, grew); }} /> : null}
    </View>
  );
}

function GardenBackdrop() {
  const drift = useLoop(8000);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs><SvgGradient id="gsky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#DFF3FF" /><Stop offset="0.7" stopColor="#F5FBEF" /></SvgGradient></Defs>
        <Rect width="100" height="100" fill="url(#gsky)" />
        <Path d="M0 74 Q25 66 50 72 T100 70 V100 H0 Z" fill="#A9DB98" />
        <Path d="M0 84 Q30 78 60 84 T100 82 V100 H0 Z" fill="#8FCB7E" />
        <Rect x="0" y="94" width="100" height="6" fill="#B98A5E" />
      </Svg>
      <Animated.Text style={[s.cloud, { transform: [{ translateX: drift ? drift.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) : 0 }] }]}>☁️</Animated.Text>
    </View>
  );
}

/** A goal's tree at its stage (0 seed … 5 in bloom): it sways, pops when it grows, and drops petals once in bloom. */
export function GoalTree({ plant, stage, size = 104 }: { plant: Plant; stage: number; size?: number }) {
  const p = plantOf(plant);
  const sway = useLoop(2200 + stage * 150);
  const reduce = useReduceMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const shown = useRef(stage);
  useEffect(() => {
    const grew = stage > shown.current;
    shown.current = stage;
    if (!grew || reduce) return;
    pop.setValue(0.8);
    const anim = Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [stage, reduce, pop]);
  const petals = useLoop(2600, stage >= 5);
  const h = [6, 22, 40, 58, 74, 80][Math.max(0, Math.min(5, stage))];
  const crown = [0, 6, 14, 22, 28, 30][Math.max(0, Math.min(5, stage))];
  return (
    <Animated.View style={{ width: size, height: size, transformOrigin: '50% 100%', transform: [{ scale: pop },
      { rotate: sway ? sway.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) : '0deg' }] }}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Ellipse cx="50" cy="94" rx="26" ry="5" fill="#8E5A34" opacity={0.35} />
        <Ellipse cx="50" cy="92" rx="16" ry="4" fill="#7A4B2A" />
        {stage === 0 ? <Ellipse cx="50" cy="88" rx="5" ry="3.5" fill="#C98E5A" /> : (
          <G>
            <Rect x={50 - (stage >= 3 ? 3 : 1.2)} y={92 - h} width={stage >= 3 ? 6 : 2.4} height={h} rx="1" fill={stage >= 3 ? '#8E5A34' : '#5DAF6A'} />
            {stage <= 2 ? <G><Path d={`M50 ${94 - h} Q40 ${86 - h} 36 ${92 - h}`} stroke="#5DAF6A" strokeWidth="3" fill="none" />
              <Ellipse cx={42} cy={88 - h} rx={stage === 1 ? 6 : 9} ry="4" fill={p.leaf} /><Ellipse cx={58} cy={88 - h} rx={stage === 1 ? 6 : 9} ry="4" fill={p.leaf} /></G>
              : <G><Circle cx="50" cy={92 - h} r={crown} fill={p.leaf} /><Circle cx={50 - crown * 0.7} cy={96 - h} r={crown * 0.7} fill={p.leaf} />
                <Circle cx={50 + crown * 0.7} cy={96 - h} r={crown * 0.7} fill={p.leaf} /></G>}
            {stage >= 4 ? [[-14, -6], [10, -12], [16, 6], [-6, 8], [0, -20]].slice(0, stage === 4 ? 2 : 5).map(([dx, dy], i) => (
              <Circle key={i} cx={50 + dx} cy={92 - h + dy} r={stage === 5 ? 4.5 : 3} fill={p.bloom} />)) : null}
          </G>
        )}
      </Svg>
      {stage >= 5 && petals ? (
        <Animated.Text style={[s.petal, { color: p.bloom, opacity: petals.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
          transform: [{ translateY: petals.interpolate({ inputRange: [0, 1], outputRange: [10, 50] }) }] }]}>✿</Animated.Text>
      ) : null}
    </Animated.View>
  );
}

function GoalPanel({ goal, onMove, onChanged, onArchived }: { goal: FinanceGoal; onMove: (type: TxType) => void;
  onChanged: (g: FinanceGoal) => void; onArchived: () => void }) {
  const confirm = useConfirm();
  const [history, setHistory] = useState<FinanceTx[] | null>(null);
  const reloadHistory = useCallback(() => {
    financeApi.transactions(`?goal_id=${goal.id}&limit=20`).then((r) => setHistory(r.items)).catch(() => setHistory([]));
  }, [goal.id]);
  useEffect(() => { reloadHistory(); }, [reloadHistory, goal.saved_amount]);
  async function remove(tx: FinanceTx) {
    if (!(await confirm({ title: 'Xóa giao dịch?', message: `${tx.transaction_type === 'deposit' ? 'Khoản gửi' : 'Khoản rút'} ${formatVnd(tx.amount)} sẽ bị xóa.`,
      confirmLabel: 'Xóa', cancelLabel: 'Giữ lại', icon: 'trash-outline' }))) return;
    try { const r = await financeApi.deleteTx(tx.id); if (r.goal) onChanged(r.goal); reloadHistory(); }
    catch (e) { showError('Chưa xóa được', e); }
  }
  async function archive() {
    if (!(await confirm({ title: 'Cất mục tiêu này?', message: 'Cây sẽ rời khỏi vườn. Lịch sử giao dịch vẫn được giữ.', confirmLabel: 'Cất đi', cancelLabel: 'Giữ lại', icon: 'archive-outline' }))) return;
    try { await financeApi.updateGoal(goal.id, { status: 'archived' }); onArchived(); } catch (e) { showError('Chưa cất được mục tiêu', e); }
  }
  return (
    <View style={s.panel} testID="goal-panel">
      <Text style={s.panelTitle}>{plantOf(goal.plant).label.split(' ')[0]} {goal.name}</Text>
      <Text style={s.stage}>{goal.stage_name}</Text>
      <Text style={s.amounts} accessibilityLabel={`Đã tiết kiệm ${formatVnd(goal.saved_amount)} trên ${formatVnd(goal.target_amount)}`}>
        {formatVnd(goal.saved_amount)} <Text style={s.target}>/ {formatVnd(goal.target_amount)}</Text>
      </Text>
      <ProgressBar value={goal.percent / 100} color="#2F7A55" animated />
      <View style={s.milestones}>
        {goal.milestones.map((m) => (
          <View key={m.percent} style={s.milestone}><Ionicons name={m.reached ? 'flower' : 'ellipse-outline'} size={16} color={m.reached ? '#E07A9B' : t.muted} />
            <Text style={s.milestoneText}>{m.percent}%</Text></View>
        ))}
      </View>
      <Text style={s.note}>{goal.estimated_date ? `Với tốc độ 90 ngày qua, dự kiến đạt mục tiêu khoảng ${goal.estimated_date.split('-').reverse().join('/')}.`
        : goal.percent >= 100 ? 'Mục tiêu đã hoàn thành, cây đã nở hoa!' : 'Thêm vài khoản tiết kiệm để Mirabi ước tính ngày đạt mục tiêu.'}</Text>
      <View style={s.row}>
        <Button title="Gửi tiết kiệm" icon="add-circle-outline" onPress={() => onMove('deposit')} style={s.flex} />
        <Button title="Rút tiền" icon="remove-circle-outline" variant="secondary" onPress={() => onMove('withdraw')} style={s.flex} />
      </View>
      <Text style={s.label}>Lịch sử đóng góp</Text>
      {history === null ? <Text style={s.note}>Đang tải…</Text> : history.length === 0 ? <Text style={s.note}>Chưa có khoản nào.</Text> : history.map((tx) => (
        <View key={tx.id} style={s.txRow}>
          <Text style={[s.txAmount, { color: tx.transaction_type === 'deposit' ? '#22703A' : '#B4234F' }]}>
            {tx.transaction_type === 'deposit' ? '+' : '−'}{formatVnd(tx.amount)}</Text>
          <Text style={s.txDate}>{new Date(tx.occurred_at).toLocaleDateString('vi-VN')}{tx.note ? ` · ${tx.note}` : ''}</Text>
          <Pressable onPress={() => { void remove(tx); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Xóa giao dịch ${formatVnd(tx.amount)}`}>
            <Ionicons name="trash-outline" size={16} color={t.muted} />
          </Pressable>
        </View>
      ))}
      <Button title="Cất mục tiêu" icon="archive-outline" variant="ghost" onPress={() => { void archive(); }} />
    </View>
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
    <Sheet visible={visible} title="🌱 Gieo mục tiêu mới" onClose={onClose}>
      <View style={s.center}><GoalTree plant={plant} stage={1} size={90} /></View>
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
  onSaved: (g: FinanceGoal | null, grew: boolean) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // One reference per entry: a retry after a lost answer is recognised and counted once.
  const ref = useRef(clientRef());
  useEffect(() => { if (visible) { setAmount(''); setNote(''); ref.current = clientRef(); } }, [visible]);
  const value = parseVnd(amount);
  const deposit = type === 'deposit';
  const tooMuch = !deposit && value != null && value > goal.saved_amount;
  return (
    <Sheet visible={visible} title={deposit ? `💧 Tưới cây: ${goal.name}` : `Rút từ ${goal.name}`} onClose={onClose}>
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
          onSaved(result.goal, !!result.goal && result.goal.stage > before);
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
  const load = useCallback(async () => {
    try {
      const [sum, cats, list] = await Promise.all([financeApi.summary(period), financeApi.categories(),
        financeApi.transactions(`?period=${period}&limit=30`)]);
      setSummary(sum); setCategories(cats); setTxs(list.items.filter((x) => x.transaction_type === 'income' || x.transaction_type === 'expense')); setError(null);
    } catch (e) { setError(e); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);
  const shift = (months: number) => { const [y, m] = period.split('-').map(Number); setPeriod(monthOf(new Date(y, m - 1 + months, 1))); };
  if (!summary) return error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <View style={[s.panel, s.skeleton]} />;
  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} testID="budget-tab">
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
        <Button title="Ghi khoản thu" icon="arrow-down-circle-outline" variant="secondary" onPress={() => setEntry('income')} style={s.flex} />
        <Button title="Ghi khoản chi" icon="arrow-up-circle-outline" onPress={() => setEntry('expense')} style={s.flex} />
      </View>
      <View style={s.panel}>
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
      <View style={s.panel}>
        <Text style={s.label}>Theo danh mục</Text>
        {summary.by_category.length === 0 ? <Text style={s.note}>Chưa ghi khoản thu chi nào.</Text> : summary.by_category.map((c) => (
          <View key={String(c.category_id)} style={s.txRow}>
            <Text style={s.txDate}>{c.icon} {c.name}</Text>
            <Text style={[s.txAmount, { color: c.expense ? '#B4234F' : '#22703A' }]}>{c.expense ? `−${formatVnd(c.expense)}` : `+${formatVnd(c.income)}`}</Text>
          </View>
        ))}
      </View>
      <View style={s.panel}>
        <Text style={s.label}>Giao dịch gần đây</Text>
        {txs.length === 0 ? <Text style={s.note}>Chưa có giao dịch.</Text> : txs.map((tx) => (
          <View key={tx.id} style={s.txRow}>
            <Text style={s.txDate} numberOfLines={1}>{tx.category?.icon ?? '❔'} {tx.category?.name ?? 'Chưa phân loại'}{tx.note ? ` · ${tx.note}` : ''}</Text>
            <Text style={[s.txAmount, { color: tx.transaction_type === 'income' ? '#22703A' : '#B4234F' }]}>
              {tx.transaction_type === 'income' ? '+' : '−'}{formatVnd(tx.amount)}</Text>
          </View>
        ))}
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
  fill: { flex: 1, paddingHorizontal: 16 },
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  content: { paddingBottom: 120, gap: 12 },
  garden: { height: 230, borderRadius: 26, overflow: 'hidden', backgroundColor: '#E8F6E3' },
  skeleton: { opacity: 0.6 },
  cloud: { position: 'absolute', top: 14, left: 24, fontSize: 30 },
  trees: { alignItems: 'flex-end', paddingHorizontal: 10, paddingBottom: 6, gap: 6, minHeight: 230 },
  treeSlot: { width: 112, alignItems: 'center', paddingVertical: 4, borderRadius: 16 },
  treeOn: { backgroundColor: 'rgba(255,255,255,0.55)' },
  treeName: { fontSize: 12, fontWeight: '900', color: '#1F4F2A', maxWidth: 104 },
  treePct: { fontSize: 11, fontWeight: '800', color: '#2F7A55' },
  newTree: { height: 150, justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: '#2F7A55', marginBottom: 8 },
  newTreeText: { fontWeight: '900', color: '#2F7A55', marginTop: 4 },
  petal: { position: 'absolute', left: '58%', top: 10, fontSize: 14 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 6, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: t.ink, textAlign: 'center' },
  panel: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 8 },
  panelTitle: { fontSize: 19, fontWeight: '900', color: t.ink, flexShrink: 1 },
  stage: { fontSize: 13, fontWeight: '800', color: '#2F7A55' },
  amounts: { fontSize: 22, fontWeight: '900', color: t.ink },
  target: { fontSize: 14, fontWeight: '700', color: t.muted },
  milestones: { flexDirection: 'row', justifyContent: 'space-between' },
  milestone: { alignItems: 'center' },
  milestoneText: { fontSize: 11, color: t.muted, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 14, fontWeight: '900', color: t.ink, marginTop: 4 },
  note: { fontSize: 13, color: t.muted },
  error: { color: '#B4234F', fontWeight: '700', fontSize: 13 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  txAmount: { fontSize: 15, fontWeight: '900' },
  txDate: { flex: 1, fontSize: 13, color: t.muted },
  disclaimer: { fontSize: 11, color: t.muted, textAlign: 'center', paddingHorizontal: 8 },
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
