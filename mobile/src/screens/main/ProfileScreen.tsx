import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, type User } from '../../auth/AuthContext';
import { AVATARS } from '../../avatars';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { petById } from '../../pets';
import { appTheme as t } from '../../theme';
import { Avatar, Card, formatNumber, IconName, SectionHeader } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { request, showError } from './shared';

type Props = { user: User; onBack: () => void };

/** Personal info, opened from the avatar on Home or the profile row in "Tiện ích". */
export function ProfileScreen({ user, onBack }: Props) {
  const { setUser } = useAuth();
  const toast = useToast();
  const pet = petById(user.pet);
  const petName = user.pet_name ?? pet.name;
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function chooseAvatar(id: string) {
    if (saving || id === user.avatar_theme) return;
    setSaving(id);
    try {
      setUser(await request('/api/profile', { method: 'PATCH', body: { avatar_theme: id } }));
      toast('Đã đổi ảnh đại diện');
      setPicking(false);
    } catch (e) { showError('Không đổi được ảnh đại diện', e); }
    finally { setSaving(null); }
  }

  return (
    <>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={22} color={t.ink} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Hồ sơ của bạn</Text>
      </View>

      <Card style={styles.profile}>
        <View style={styles.profileRow}>
          <Pressable onPress={() => setPicking((p) => !p)} accessibilityRole="button" accessibilityLabel="Đổi ảnh đại diện"
            accessibilityState={{ expanded: picking }} style={({ pressed }) => pressed && styles.pressed}>
            <Avatar name={user.display_name} theme={user.avatar_theme} size={56} />
            <View style={styles.editBadge}><Ionicons name="pencil" size={11} color="#FFFFFF" /></View>
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{user.display_name}</Text>
            <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
          </View>
        </View>
        <View style={styles.stats}>
          <Stat icon="trophy" color="#B7791F" value={`Cấp ${user.level}`} label="Cấp độ" />
          <Stat icon="star" color={t.accent} value={`${formatNumber(user.xp)} XP`} label="Kinh nghiệm" />
          <Stat icon="cash" color="#C08A1E" value={formatNumber(user.coins)} label="Xu" />
          <Stat icon="diamond" color="#2E9AD6" value={formatNumber(user.gems)} label="Pha lê" />
        </View>

        {picking ? (
          <View style={styles.picker}>
            <Text style={styles.pickerTitle}>Chọn ảnh đại diện</Text>
            <View style={styles.pickerGrid}>
              {AVATARS.map((a) => {
                const selected = a.id === user.avatar_theme;
                return (
                  <Pressable key={a.id} onPress={() => chooseAvatar(a.id)} disabled={!!saving}
                    accessibilityRole="radio" accessibilityLabel={a.label} accessibilityState={{ checked: selected, busy: saving === a.id }}
                    style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
                    <Avatar name={user.display_name} theme={a.id} size={42} />
                    {saving === a.id ? <View style={styles.optionBusy}><ActivityIndicator color="#FFFFFF" /></View> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Card>

      <SectionHeader title="Bạn đồng hành" />
      <Card style={styles.petCard}>
        <View style={[styles.petArt, { backgroundColor: pet.element.bg }]}><PetArt pet={pet.id} size={64} stage={user.level} /></View>
        <View style={styles.flex}>
          <Text style={styles.petName} numberOfLines={1}>{petName}</Text>
          <Text style={styles.email}>{pet.species[0].toUpperCase() + pet.species.slice(1)} · {pet.tagline}</Text>
        </View>
      </Card>
    </>
  );
}

function Stat({ icon, color, value, label }: { icon: IconName; color: string; value: string; label: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  pressed: { transform: [{ scale: 0.97 }] },
  title: { fontSize: 22, fontWeight: '900', color: t.ink },
  profile: { padding: 14 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: t.accent,
    borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '900', color: t.ink },
  email: { fontSize: 13, color: t.muted, marginTop: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statValue: { fontSize: 12, fontWeight: '800', color: t.ink },
  picker: { borderTopWidth: 1, borderTopColor: t.tint, marginTop: 12, paddingTop: 10 },
  pickerTitle: { fontSize: 13, fontWeight: '800', color: t.muted, marginBottom: 8 },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { padding: 2, borderRadius: 25, borderWidth: 2, borderColor: 'transparent' },
  optionSelected: { borderColor: t.accent },
  optionBusy: { ...StyleSheet.absoluteFillObject, margin: 2, borderRadius: 21, backgroundColor: 'rgba(18,59,92,0.45)', alignItems: 'center', justifyContent: 'center' },
  petCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  petArt: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  petName: { fontSize: 17, fontWeight: '900', color: t.ink },
});
