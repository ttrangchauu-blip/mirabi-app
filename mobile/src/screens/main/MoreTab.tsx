import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { useConfirmLogout } from '../../auth/useConfirmLogout';
import { showAlert } from '../../components/dialogs';
import { Text } from '../../components/Typography';
import { petById } from '../../pets';
import { gradeLabel } from '../../studyProfile';
import { appTheme as t } from '../../theme';
import { Avatar, Button, Card, IconCircle, IconName, ScreenHeader, SectionHeader } from '../../ui/kit';
import { ChestArt, ProjectIslandArt } from '../work/workArt';
import { LIFE_MIN_AGE, lifeEligible } from '../../life/access';

const FEATURES: { icon: IconName; title: string; subtitle: string; color: string; bg: string }[] = [
  { icon: 'newspaper-outline', title: 'Bảng tin', subtitle: 'Lan tỏa điều tích cực', color: '#A3326B', bg: '#FCE4F0' },
  { icon: 'bed-outline', title: 'Phòng của tôi', subtitle: 'Trang trí góc nhỏ', color: '#5141A8', bg: '#EEEAFF' },
  { icon: 'leaf-outline', title: 'Vườn nhà', subtitle: 'Trồng và chăm cây', color: '#22703A', bg: '#E3F5E6' },
  { icon: 'storefront-outline', title: 'Cửa hàng', subtitle: 'Đổi xu lấy vật phẩm', color: '#B23A0A', bg: '#FFEBDD' },
  { icon: 'ribbon-outline', title: 'Thành tựu', subtitle: 'Huy hiệu đã đạt', color: '#7A4D00', bg: '#FFF4CC' },
  { icon: 'podium-outline', title: 'Bảng xếp hạng', subtitle: 'Cùng bạn bè tiến bộ', color: '#136FA8', bg: '#DDF0FA' },
  { icon: 'journal-outline', title: 'Nhật ký phản tư', subtitle: 'Nhìn lại hành trình', color: '#22703A', bg: '#E3F5E6' },
  { icon: 'gift-outline', title: 'Mời bạn bè', subtitle: 'Nhận thêm pha lê', color: '#0B6577', bg: '#DFF6FA' },
];
/** Cuộc sống Mirabi (docs/MIRABI_LIFE.md): shown only to users aged 16 and over (life/access.ts). */
export type LifeWorld = 'work' | 'healing' | 'adventure' | 'money' | 'town' | 'career';
const LIFE_WORLDS: { key: LifeWorld; emoji: string; title: string; subtitle: string; colors: readonly [string, string] }[] = [
  { key: 'work', emoji: '📌', title: 'Nhiệm vụ công việc', subtitle: 'Bảng nhiệm vụ, dự án, rương thưởng', colors: ['#BFE6FA', '#FFE9C2'] },
  { key: 'healing', emoji: '🌙', title: 'Góc thư giãn', subtitle: 'Tâm trạng, hít thở, nhật ký', colors: ['#2B2F66', '#7A5FA8'] },
  { key: 'adventure', emoji: '🗺️', title: 'Phiêu lưu cuộc sống', subtitle: 'Hoạt động thật, bản đồ phiêu lưu', colors: ['#FFE6B8', '#FFD08A'] },
  { key: 'money', emoji: '🌳', title: 'Vườn tài chính', subtitle: 'Mục tiêu tiết kiệm thành cây xanh', colors: ['#D9F2D0', '#A8DE98'] },
  { key: 'town', emoji: '🏘️', title: 'Thị trấn Mirabi', subtitle: 'Ghé nhà bạn bè, xây công trình chung', colors: ['#E4E0FF', '#C3B9F5'] },
  { key: 'career', emoji: '🧗', title: 'Hành trình sự nghiệp', subtitle: 'Cây kỹ năng cho nghề của bạn', colors: ['#FFDDE8', '#F7B5CB'] },
];

const SETTINGS: { icon: IconName; label: string }[] = [
  { icon: 'person-outline', label: 'Tài khoản' }, { icon: 'notifications-outline', label: 'Thông báo' },
  { icon: 'shield-checkmark-outline', label: 'Quyền riêng tư' }, { icon: 'language-outline', label: 'Ngôn ngữ' },
  { icon: 'moon-outline', label: 'Chế độ tối' }, { icon: 'help-circle-outline', label: 'Trợ giúp & cộng đồng' },
];

export function MoreTab({ user, onOpenProfile, onOpenRoom, onOpenFeed, onOpenGarden, onOpenStudyProfile, onOpenEducationAdmin, life }: {
  user: User; onOpenProfile: () => void; onOpenRoom?: () => void; onOpenFeed?: () => void; onOpenGarden?: () => void;
  onOpenStudyProfile?: () => void;
  /** Cuộc sống Mirabi's worlds (each opens its screen; Góc thư giãn opens the personal room in its Healing mode). */
  life?: Record<LifeWorld, () => void>;
  /** Administrators only (the backend checks the role again): grades, học lại / lên lớp, the school calendar. */
  onOpenEducationAdmin?: () => void;
}) {
  const confirmLogout = useConfirmLogout();
  const pet = petById(user.pet);
  const studyProfile = user.age != null && user.school_grade ? `${user.age} tuổi · ${gradeLabel(user.school_grade)}` : 'Chưa cập nhật';


  return (
    <>
      <ScreenHeader title="Tiện ích" subtitle="Khám phá thêm tính năng của Mirabi" />
      <Pressable onPress={onOpenProfile} accessibilityRole="button" accessibilityLabel={`Xem hồ sơ của ${user.display_name}`}
        style={({ pressed }) => pressed && styles.pressed}>
        <Card style={styles.profile}>
          <Avatar name={user.display_name} theme={user.avatar_theme} size={48} />
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{user.display_name}</Text>
            <Text style={styles.sub} numberOfLines={1}>Xem hồ sơ & {user.pet_name ?? pet.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Card>
      </Pressable>

      {life && lifeEligible(user) ? <>
        <SectionHeader title="Cuộc sống Mirabi" />
        <View style={styles.lifeGrid}>
          {LIFE_WORLDS.map((w) => (
            <Pressable key={w.key} onPress={life[w.key]} accessibilityRole="button" accessibilityLabel={`${w.title}: ${w.subtitle}`}
              style={({ pressed }) => [styles.lifeCard, pressed && styles.pressed]} testID={`open-${w.key}`}>
              <LinearGradient colors={w.colors} style={styles.lifeArt}>
                {w.key === 'work' ? <><ProjectIslandArt theme="beach" stage={4} lit={false} size={64} />
                  <View style={styles.lifeChest}><ChestArt status="ready" size={28} /></View></> : <Text style={styles.lifeEmoji}>{w.emoji}</Text>}
              </LinearGradient>
              <Text style={styles.lifeTitle} numberOfLines={1}>{w.title}</Text>
              <Text style={styles.lifeSub} numberOfLines={2}>{w.subtitle}</Text>
            </Pressable>
          ))}
        </View>
      </> : life && user.age == null && onOpenStudyProfile ? (
        <Pressable onPress={onOpenStudyProfile} accessibilityRole="button" style={styles.lifeHint}
          accessibilityLabel={`Cập nhật độ tuổi để mở Cuộc sống Mirabi, dành cho người từ ${LIFE_MIN_AGE} tuổi`}>
          <Ionicons name="sparkles-outline" size={16} color={t.accent} />
          <Text style={styles.lifeHintText}>Cập nhật "Độ tuổi & lớp học" để mở Cuộc sống Mirabi (từ {LIFE_MIN_AGE} tuổi).</Text>
        </Pressable>
      ) : null}

      <SectionHeader title="Tính năng khác" />
      <View style={styles.grid}>
        {FEATURES.map((f) => (
          <Pressable key={f.title} onPress={() => f.title === 'Phòng của tôi' && onOpenRoom ? onOpenRoom()
            : f.title === 'Bảng tin' && onOpenFeed ? onOpenFeed()
            : f.title === 'Vườn nhà' && onOpenGarden ? onOpenGarden()
            : showAlert(f.title, 'Tính năng đang được phát triển, sắp ra mắt nhé!')}
            accessibilityRole="button" accessibilityLabel={`${f.title}: ${f.subtitle}`}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
            <IconCircle name={f.icon} color={f.color} bg={f.bg} />
            <Text style={styles.tileTitle}>{f.title}</Text>
            <Text style={styles.tileSub}>{f.subtitle}</Text>
          </Pressable>
        ))}
      </View>

      <SectionHeader title="Cài đặt" />
      <Card style={styles.settings}>
        {user.role === 'admin' && onOpenEducationAdmin ? (
          <Pressable onPress={onOpenEducationAdmin} accessibilityRole="button" accessibilityLabel="Quản trị lớp học" style={styles.setting}>
            <IconCircle name="shield-checkmark-outline" size={36} />
            <View style={styles.flex}>
              <Text style={styles.settingLabel}>Quản trị lớp học</Text>
              <Text style={styles.settingValue} numberOfLines={1}>Lớp học, lên lớp, lịch năm học</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        ) : null}
        {onOpenStudyProfile ? (
          <Pressable onPress={onOpenStudyProfile} accessibilityRole="button" accessibilityLabel={`Độ tuổi & lớp học: ${studyProfile}`}
            style={styles.setting}>
            <IconCircle name="school-outline" size={36} />
            <View style={styles.flex}>
              <Text style={styles.settingLabel}>Độ tuổi & lớp học</Text>
              <Text style={styles.settingValue} numberOfLines={1}>{studyProfile}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        ) : null}
        {SETTINGS.map((s, i) => (
          <Pressable key={s.label} onPress={() => showAlert(s.label, 'Cấu hình chi tiết sẽ được bổ sung theo yêu cầu sản phẩm.')}
            accessibilityRole="button" style={[styles.setting, (i > 0 || !!onOpenStudyProfile) && styles.divider]}>
            <IconCircle name={s.icon} size={36} />
            <Text style={styles.settingLabel}>{s.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        ))}
      </Card>
      <Button title="Đăng xuất" icon="log-out-outline" variant="danger" onPress={() => { void confirmLogout(); }} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  name: { fontSize: 17, fontWeight: '900', color: t.ink },
  sub: { fontSize: 13, color: t.accent, fontWeight: '700', marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  tile: { width: '47.8%', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  pressed: { transform: [{ scale: 0.97 }] },
  tileTitle: { fontSize: 16, fontWeight: '800', color: t.ink, marginTop: 12 },
  tileSub: { fontSize: 13, color: t.muted, marginTop: 2 },
  settings: { paddingVertical: 6 },
  lifeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  lifeHint: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.tint, borderRadius: 16, padding: 12, marginBottom: 14 },
  lifeHintText: { flex: 1, fontSize: 13, fontWeight: '700', color: t.accent },
  lifeCard: { width: '47.8%', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 10,
    shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  lifeArt: { height: 84, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  lifeChest: { position: 'absolute', right: 8, bottom: 6 },
  lifeEmoji: { fontSize: 38 },
  lifeTitle: { fontSize: 15, fontWeight: '900', color: t.ink, marginTop: 8 },
  lifeSub: { fontSize: 12, color: t.muted, marginTop: 1 },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 52 },
  divider: { borderTopWidth: 1, borderTopColor: t.tint },
  settingLabel: { flex: 1, fontSize: 16, fontWeight: '700', color: t.ink },
  settingValue: { fontSize: 13, color: t.muted, marginTop: 1 },
});
