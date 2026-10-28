import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '../../auth/messages';
import { PetArt } from '../../components/PetArt';
import { Text, TextInput } from '../../components/Typography';
import type { Presence, PublicUser } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { Button, IconCircle, IconName } from '../../ui/kit';

export function BackHeader({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quay lại" style={s.back}>
        <Ionicons name="chevron-back" size={22} color={t.ink} />
      </Pressable>
      <View style={s.flex}>
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  return <View style={s.state} accessibilityLiveRegion="polite"><ActivityIndicator color={t.accent} /><Text style={s.stateText}>{label}</Text></View>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <View style={s.state} accessibilityLiveRegion="polite">
      <IconCircle name="cloud-offline-outline" color={t.danger} bg={t.dangerBg} />
      <Text style={s.stateText}>{errorMessage(error)}</Text>
      <Button title="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} />
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={s.empty}>
      <IconCircle name={icon} />
      <Text style={s.emptyTitle}>{title}</Text>
      {body ? <Text style={s.stateText}>{body}</Text> : null}
      {action}
    </View>
  );
}

const PRESENCE: Record<Presence | 'away', { color: string; label: string }> = {
  studying: { color: '#1F9D6A', label: 'Đang học' },
  online: { color: '#2E9AD6', label: 'Trực tuyến' },
  offline: { color: '#A7B4C0', label: 'Ngoại tuyến' },
  away: { color: '#E0A43A', label: 'Tạm vắng' },
  hidden: { color: '#C9D3DC', label: 'Ẩn trạng thái' },
};

export function PresenceLabel({ presence }: { presence: Presence | 'away' }) {
  const p = PRESENCE[presence];
  return (
    <View style={s.presence}>
      <View style={[s.dot, { backgroundColor: p.color }]} />
      <Text style={s.presenceText}>{p.label}</Text>
    </View>
  );
}

/** A person shown by their pet (the app's identity), never by photo or contact details. */
export function PetAvatar({ user, size = 48 }: { user: Pick<PublicUser, 'pet' | 'pet_level'>; size?: number }) {
  return (
    <View style={[s.petAvatar, { width: size, height: size, borderRadius: size / 2.6 }]}>
      <PetArt pet={user.pet} size={size * 0.9} stage={user.pet_level} still />
    </View>
  );
}

export function PersonRow({ user, subtitle, right, children }: { user: PublicUser; subtitle?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={s.personRow}>
      <PetAvatar user={user} size={46} />
      <View style={s.flex}>
        <Text style={s.personName} numberOfLines={1}>{user.display_name}</Text>
        {typeof subtitle === 'string' ? <Text style={s.personSub} numberOfLines={1}>{subtitle}</Text> : subtitle}
        {children}
      </View>
      {right}
    </View>
  );
}

export function SmallButton({ title, onPress, variant = 'secondary', icon, disabled, loading }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; icon?: IconName; disabled?: boolean; loading?: boolean;
}) {
  const color = variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? t.danger : t.accent;
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.dangerBg : t.tint;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [s.small, { backgroundColor: bg }, (disabled || loading) && s.dimmed, pressed && s.pressed]}>
      {loading ? <ActivityIndicator size="small" color={color} /> : icon ? <Ionicons name={icon} size={15} color={color} /> : null}
      <Text style={[s.smallText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, ...props }: React.ComponentProps<typeof TextInput> & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#7F95A8" accessibilityLabel={label} {...props}
        style={[s.input, !!error && s.inputError, props.style]} />
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/** − value + control with 44pt touch targets. */
export function Stepper({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <View style={s.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: `${value}${unit ? ` ${unit}` : ''}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === 'increment' ? step : -step))}>
      <Text style={[s.flex, s.stepLabel]}>{label}</Text>
      <Pressable onPress={() => set(value - step)} disabled={value <= min} style={[s.stepBtn, value <= min && s.dimmed]}
        accessibilityRole="button" accessibilityLabel={`Giảm ${label}`} hitSlop={4}>
        <Ionicons name="remove" size={18} color={t.accent} />
      </Pressable>
      <Text style={s.stepValue}>{value}{unit ? <Text style={s.stepUnit}> {unit}</Text> : null}</Text>
      <Pressable onPress={() => set(value + step)} disabled={value >= max} style={[s.stepBtn, value >= max && s.dimmed]}
        accessibilityRole="button" accessibilityLabel={`Tăng ${label}`} hitSlop={4}>
        <Ionicons name="add" size={18} color={t.accent} />
      </Pressable>
    </View>
  );
}

export function ToggleRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.toggle}>
      <View style={s.flex}>
        <Text style={s.toggleLabel}>{label}</Text>
        {description ? <Text style={s.hint}>{description}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: '#7CC0E6', false: '#D6E2EA' }}
        thumbColor={value ? t.accent : '#FFFFFF'} />
    </View>
  );
}

/** A bottom sheet with a list of choices (report reason, quest template, friends to invite…). */
export function OptionSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <AppModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Đóng" accessibilityRole="button" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 20, maxHeight: '80%' }]} accessibilityViewIsModal>
        <View style={s.sheetHeader}>
          <Text style={s.sheetTitle} accessibilityRole="header">{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng"><Ionicons name="close" size={22} color={t.muted} /></Pressable>
        </View>
        {children}
      </View>
    </AppModal>
  );
}

export function OptionRow({ label, description, icon, selected, onPress }: { label: string; description?: string; icon?: IconName; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.option, pressed && s.pressed]} accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected }} accessibilityLabel={label}>
      {icon ? <IconCircle name={icon} size={36} /> : null}
      <View style={s.flex}>
        <Text style={s.optionLabel}>{label}</Text>
        {description ? <Text style={s.hint}>{description}</Text> : null}
      </View>
      {selected !== undefined ? <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={t.accent} /> : <Ionicons name="chevron-forward" size={18} color={t.muted} />}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  back: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: t.ink },
  subtitle: { fontSize: 13, color: t.muted, marginTop: 1 },
  state: { alignItems: 'center', gap: 10, paddingVertical: 36 },
  stateText: { fontSize: 14, color: t.muted, textAlign: 'center', lineHeight: 20 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 18, paddingHorizontal: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: t.ink, textAlign: 'center', marginTop: 4 },
  presence: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  presenceText: { fontSize: 12, color: t.muted, fontWeight: '700' },
  petAvatar: { backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  personName: { fontSize: 15, fontWeight: '800', color: t.ink },
  personSub: { fontSize: 12, color: t.muted, marginTop: 2 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 12 },
  smallText: { fontSize: 13, fontWeight: '800' },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  field: { marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '800', color: t.ink, marginBottom: 6 },
  input: { backgroundColor: t.bg, borderRadius: 14, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: 14, minHeight: 48, fontSize: 16, color: t.ink },
  inputError: { borderColor: t.danger, backgroundColor: '#FFF7F9' },
  error: { color: t.danger, fontSize: 13, marginTop: 5, fontWeight: '700' },
  hint: { color: t.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, minHeight: 52 },
  stepLabel: { fontSize: 15, fontWeight: '700', color: t.ink },
  stepBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 64, textAlign: 'center', fontSize: 17, fontWeight: '900', color: t.ink },
  stepUnit: { fontSize: 12, fontWeight: '700', color: t.muted },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 52 },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: t.ink },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(18,59,92,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 26,
    borderTopRightRadius: 26, padding: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: t.ink },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 52 },
  optionLabel: { fontSize: 15, fontWeight: '800', color: t.ink },
});
