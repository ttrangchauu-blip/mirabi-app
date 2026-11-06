import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { useConfirmLogout } from '../../auth/useConfirmLogout';
import { Text } from '../../components/Typography';
import { LIFE_MIN_AGE, lifeEligible } from '../../life/access';
import { petById } from '../../pets';
import { useRoomPrefs } from '../../room/prefs';
import { gradeLabel } from '../../studyProfile';
import { appTheme as t } from '../../theme';
import { radius, type as typeScale } from '../../ui/design';
import { Avatar, Button, Card, formatNumber, ScreenHeader, SectionHeader } from '../../ui/kit';
import { useWeather, weatherNote } from '../../world/weather';
import { ToggleRow } from '../together/ui';
import { FeatureGroup, FeatureRow, InfoRow } from './FeatureRow';

/** The tools for adult life (docs/MIRABI_LIFE.md): shown only to users aged 16 and over (life/access.ts). The others of
 * the six worlds live where they belong: Góc thư giãn in the pet's home, Phiêu lưu in Khám phá, Thị trấn in Bạn bè. */
export type LifeTool = 'work' | 'career' | 'money';

type Props = {
  user: User;
  onOpenProfile: () => void; onOpenStudyProfile?: () => void;
  /** Học tập và tập trung. */ onOpenFocus?: () => void; onOpenNotebook?: () => void; onOpenTeamQuests?: () => void;
  /** Kỷ niệm và thành tựu. */ onOpenAlbum?: () => void; onOpenAchievements?: () => void; onOpenStreak?: () => void; onOpenStatistics?: () => void; onOpenArchive?: () => void;
  /** Cá nhân hóa. */ onOpenInvite?: () => void; onOpenSettings?: () => void;
  life?: Record<LifeTool, () => void>;
  /** Nhật ký phản tư is in Góc thư giãn, so it follows the same age rule as `life`. */ onOpenJournal?: () => void;
  /** Administrators only (the backend checks the role again): grades, học lại / lên lớp, the school calendar. */
  onOpenEducationAdmin?: () => void;
};

/**
 * Tiện ích: what isn't a place in the pet's world, in three groups. A row opens a screen that exists, or says plainly
 * that there is nothing yet (InfoRow). The garden, the room and friends aren't here: they are places of Cuộc sống Mirabi.
 */
export function MoreTab({ user, onOpenProfile, onOpenStudyProfile, onOpenFocus, onOpenNotebook, onOpenTeamQuests, onOpenAlbum, onOpenAchievements, onOpenStreak, onOpenStatistics, onOpenArchive, onOpenInvite, onOpenSettings, life, onOpenJournal, onOpenEducationAdmin }: Props) {
  const confirmLogout = useConfirmLogout();
  const pet = petById(user.pet);
  const prefs = useRoomPrefs(user.id);
  const weather = useWeather();
  const studyProfile = user.age != null && user.school_grade ? `${user.age} tuổi · ${gradeLabel(user.school_grade)}` : 'Chưa cập nhật';
  const grown = !!life && lifeEligible(user);
  return (
    <>
      <ScreenHeader title="Tiện ích" subtitle="Công cụ, kỷ niệm và cài đặt của bạn" />
      <Pressable onPress={onOpenProfile} accessibilityRole="button" accessibilityLabel={`Xem hồ sơ của ${user.display_name}`} style={({ pressed }) => pressed && styles.pressed}>
        <Card style={styles.profile}>
          <Avatar name={user.display_name} theme={user.avatar_theme} size={48} />
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{user.display_name}</Text>
            <Text style={styles.sub} numberOfLines={1}>Xem hồ sơ & {user.pet_name ?? pet.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Card>
      </Pressable>

      <SectionHeader title="Học tập và tập trung" />
      <FeatureGroup>
        <FeatureRow first icon="timer" tone="sky" title="Pomodoro" subtitle="Hẹn giờ tập trung, âm thanh, ghi chú" onPress={onOpenFocus} testID="open-focus" />
        <FeatureRow icon="book" tone="sea" title="Sổ tay kiến thức" subtitle="Ghi chú và từ của mọi bài học" onPress={onOpenNotebook} testID="open-notebook" />
        <FeatureRow icon="people" tone="lilac" title="Cùng bạn tiến bộ" subtitle="Nhiệm vụ nhóm, mục tiêu chung" onPress={onOpenTeamQuests} testID="open-team-quests" />
        {grown ? <>
          <FeatureRow icon="clipboard" tone="sun" title="Nhiệm vụ công việc" subtitle="Bảng nhiệm vụ, dự án, rương thưởng" onPress={life!.work} testID="open-work" />
          <FeatureRow icon="trail-sign" tone="rose" title="Hành trình sự nghiệp" subtitle="Cây kỹ năng cho nghề của bạn" onPress={life!.career} testID="open-career" />
          <FeatureRow icon="wallet" tone="leaf" title="Vườn tài chính" subtitle="Mục tiêu tiết kiệm thành cây xanh" onPress={life!.money} testID="open-money" />
        </> : null}
      </FeatureGroup>
      {life && !lifeEligible(user) && user.age == null && onOpenStudyProfile ? (
        <Pressable onPress={onOpenStudyProfile} accessibilityRole="button" style={styles.hint}
          accessibilityLabel={`Cập nhật độ tuổi để mở công cụ của Cuộc sống Mirabi, dành cho người từ ${LIFE_MIN_AGE} tuổi`}>
          <Ionicons name="sparkles-outline" size={16} color={t.accent} />
          <Text style={styles.hintText}>Cập nhật "Độ tuổi & lớp học" để mở thêm công cụ của Cuộc sống Mirabi (từ {LIFE_MIN_AGE} tuổi).</Text>
        </Pressable>
      ) : null}

      <SectionHeader title="Kỷ niệm và thành tựu" />
      <FeatureGroup>
        <FeatureRow first icon="images" tone="rose" title="Album kỷ niệm" subtitle="Ảnh và khoảnh khắc đã lưu" onPress={onOpenAlbum} testID="open-album" />
        <FeatureRow icon="ribbon" tone="sun" title="Thành tựu" subtitle="Huy hiệu ghi nhận hành trình của bạn" onPress={onOpenAchievements} testID="open-achievements" />
        <FeatureRow icon="flame" tone="sun" title="Hành trình đăng nhập" subtitle="Chuỗi ngày và quà đã nhận" onPress={onOpenStreak} testID="open-streak" />
        <FeatureRow icon="stats-chart" tone="sky" title="Thống kê tập trung" subtitle="Thời gian học theo ngày và tuần" onPress={onOpenStatistics} testID="open-statistics" />
        <FeatureRow icon="time" tone="lilac" title="Lịch sử học tập" subtitle="Các năm học đã qua" onPress={onOpenArchive} testID="open-archive" />
        {grown ? <FeatureRow icon="journal" tone="leaf" title="Nhật ký phản tư" subtitle="Nhìn lại ngày của bạn trong Góc thư giãn" onPress={onOpenJournal} testID="open-journal" /> : null}
      </FeatureGroup>

      <SectionHeader title="Cá nhân hóa" />
      <FeatureGroup>
        <FeatureRow first icon="school" tone="sky" title="Độ tuổi & lớp học" subtitle={studyProfile} onPress={onOpenStudyProfile} />
        {user.role === 'admin' ? <FeatureRow icon="shield-checkmark" tone="lilac" title="Quản trị lớp học" subtitle="Lớp học, lên lớp, lịch năm học" onPress={onOpenEducationAdmin} /> : null}
        <InfoRow soon icon="storefront" tone="sun" title="Cửa hàng" subtitle={`Bạn đang có ${formatNumber(user.coins)} xu, ${formatNumber(user.gems)} pha lê`} />
        <FeatureRow icon="gift" tone="sea" title="Mời bạn bè" subtitle="Chia sẻ mã kết bạn của bạn" onPress={onOpenInvite} testID="open-invite" />
        <View style={styles.divider}>
          <ToggleRow label="Âm thanh trong phòng" description="Tiếng động nhỏ khi chơi cùng pet" value={prefs.sound} onChange={prefs.setSound} />
          <ToggleRow label="Hiệu ứng trong phòng" description="Tim bay, đồ ăn, bóng và vòng chỉ đường" value={prefs.effects} onChange={prefs.setEffects} />
          <ToggleRow label="Giảm chuyển động" description="Cảnh đứng yên: không gió, mưa rơi hay pet thở" value={prefs.motion === 'reduced'} onChange={(on) => prefs.setMotion(on ? 'reduced' : 'auto')} />
        </View>
        <View style={[styles.note, styles.divider]} accessible accessibilityLabel={`Thời tiết. ${weatherNote(weather)}`} testID="weather-note">
          <Ionicons name="partly-sunny-outline" size={17} color={t.muted} />
          <Text style={styles.noteText}>{weatherNote(weather)}</Text>
        </View>
        <FeatureRow icon="settings" tone="sky" title="Cài đặt và trợ giúp" subtitle="Tài khoản, thông báo, quyền riêng tư" onPress={onOpenSettings} testID="open-settings" />
      </FeatureGroup>
      <Button title="Đăng xuất" icon="log-out-outline" variant="danger" onPress={() => { void confirmLogout(); }} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.88 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  name: { fontSize: 17, fontWeight: '900', color: t.ink },
  sub: { fontSize: 13, color: t.accent, fontWeight: '700', marginTop: 2 },
  divider: { borderTopWidth: 1, borderTopColor: t.tint },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.tint, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  hintText: { flex: 1, ...typeScale.caption, color: t.accent },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  noteText: { flex: 1, ...typeScale.caption, fontWeight: '600', color: t.muted },
});
