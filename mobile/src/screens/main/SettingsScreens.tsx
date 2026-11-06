import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { Text } from '../../components/Typography';
import { languageName, useLanguage } from '../../i18n';
import { useNotificationPermission } from '../../notifications/permission';
import { useAccountSettings } from '../../settings/accountSettings';
import { makeStyles, useTheme } from '../../ui/theme';
import { togetherApi } from '../../studyTogether/api';
import type { PublicUser, SocialSettings } from '../../studyTogether/types';
import { type as typeScale } from '../../ui/design';
import { Card, SectionHeader } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { FriendCode, SocialToggles } from '../together/friendsUi';
import { BackHeader, EmptyState, ErrorState, LoadingState, PersonRow, SmallButton } from '../together/ui';
import { modeLabel, notificationSummary } from './AppSettingsScreens';
import { FeatureGroup, FeatureRow, InfoRow } from './FeatureRow';
import { showError } from './shared';

/**
 * Cài đặt và trợ giúp, one level under Tiện ích: every row opens what it says, or says plainly that there is nothing yet.
 * The lines under Thông báo and Ngôn ngữ say what is really set (the account's choice and the device's permission).
 */
export function SettingsScreen({ user, onBack, onOpenProfile, onChangePassword, onOpenNotifications, onOpenNotificationSettings, onOpenLanguage, onOpenAppearance, onOpenPrivacy, onOpenHelp }: {
  user: User; onBack: () => void; onOpenProfile: () => void; onChangePassword: () => void; onOpenNotifications: () => void;
  onOpenNotificationSettings: () => void; onOpenLanguage: () => void; onOpenAppearance: () => void; onOpenPrivacy: () => void; onOpenHelp: () => void;
}) {
  const { t: tr, choice, language } = useLanguage();
  const { settings } = useAccountSettings(user.id);
  const { permission } = useNotificationPermission();
  const { mode } = useTheme();
  const languageLine = choice === null ? `${tr('settings.language.device')} · ${languageName(language)}` : languageName(language);
  return (
    <>
      <BackHeader title={tr('settings.title')} onBack={onBack} />
      <SectionHeader title={tr('settings.account')} />
      <FeatureGroup>
        <FeatureRow first icon="person" tone="sky" title={tr('settings.profile')} subtitle={user.email} onPress={onOpenProfile} testID="open-profile" />
        <FeatureRow icon="key" tone="sun" title={tr('settings.password')} subtitle={tr('settings.passwordHint')} onPress={onChangePassword} testID="open-password" />
      </FeatureGroup>
      <SectionHeader title={tr('settings.notificationsAndPrivacy')} />
      <FeatureGroup>
        <FeatureRow first icon="notifications" tone="rose" title={tr('settings.notifications.title')} subtitle={notificationSummary(settings.notifications, permission, tr)}
          onPress={onOpenNotificationSettings} testID="open-notification-settings" />
        <FeatureRow icon="mail" tone="sky" title={tr('settings.inbox')} subtitle={tr('settings.inboxHint')} onPress={onOpenNotifications} testID="open-notifications" />
        <FeatureRow icon="shield-checkmark" tone="leaf" title={tr('settings.privacy')} subtitle={tr('settings.privacyHint')} onPress={onOpenPrivacy} testID="open-privacy" />
      </FeatureGroup>
      <SectionHeader title={tr('settings.display')} />
      <FeatureGroup>
        <FeatureRow first icon="language" tone="sea" title={tr('settings.language.title')} subtitle={languageLine} onPress={onOpenLanguage} testID="open-language" />
        <FeatureRow icon="contrast" tone="lilac" title={tr('settings.appearance.title')} subtitle={tr(modeLabel(mode))} onPress={onOpenAppearance} testID="open-appearance" />
      </FeatureGroup>
      <SectionHeader title={tr('settings.help')} />
      <FeatureGroup>
        <FeatureRow first icon="help-buoy" tone="sky" title={tr('settings.helpRow')} subtitle={tr('settings.helpHint')} onPress={onOpenHelp} testID="open-help" />
      </FeatureGroup>
    </>
  );
}

/** Quyền riêng tư: the same settings as the gear in Bạn bè, and the one place to take back a block. */
export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTheme();
  const s = useStyles();
  const toast = useToast();
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [blocked, setBlocked] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [mine, list] = await Promise.all([togetherApi.socialSettings(), togetherApi.blocks()]);
      setSettings(mine); setBlocked(list.items);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function update(patch: Parameters<typeof togetherApi.updateSocialSettings>[0]) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    try { setSettings(await togetherApi.updateSocialSettings(patch)); } catch (e) { setSettings(settings); showError('Không lưu được cài đặt', e); }
  }
  async function unblock(person: PublicUser) {
    setBusy(person.id);
    try {
      await togetherApi.unblock(person.id);
      setBlocked((list) => list?.filter((p) => p.id !== person.id) ?? null);
      toast(`Đã bỏ chặn ${person.display_name}.`, 'success');
    } catch (e) { showError('Không thể bỏ chặn', e); } finally { setBusy(null); }
  }

  return (
    <>
      <BackHeader title="Quyền riêng tư" onBack={onBack} />
      {error ? <ErrorState error={error} onRetry={() => { void load(); }} /> : !settings || !blocked ? <LoadingState /> : <>
        <Card style={s.group}><SocialToggles settings={settings} onChange={(patch) => { void update(patch); }} /></Card>
        <SectionHeader title="Vị trí" />
        <Card style={s.note}>
          <Ionicons name="location-outline" size={18} color={t.muted} />
          <Text style={s.noteText}>Vị trí gần đúng chỉ dùng để lấy thời tiết cho cảnh trong Cuộc sống: làm tròn khoảng 11 km và không lưu cùng tài khoản của bạn. Bạn có thể tắt quyền này trong cài đặt của máy.</Text>
        </Card>
        <SectionHeader title={`Người đã chặn (${blocked.length})`} />
        {blocked.length === 0 ? <EmptyState icon="happy-outline" title="Bạn chưa chặn ai" />
          : <Card style={s.group}>{blocked.map((person) => <PersonRow key={person.id} user={person}
              right={<SmallButton title="Bỏ chặn" loading={busy === person.id} disabled={busy !== null} onPress={() => { void unblock(person); }} />} />)}</Card>}
      </>}
    </>
  );
}

/** Mời bạn bè: the friend code to send or show. Being friends is the whole of it; an invitation pays no reward. */
export function InviteScreen({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setCode((await togetherApi.socialSettings()).public_code); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <BackHeader title="Mời bạn bè" subtitle="Gửi mã để cùng học và ghé thăm nhà của nhau" onBack={onBack} />
      {error ? <ErrorState error={error} onRetry={() => { void load(); }} /> : code ? <FriendCode code={code} /> : <LoadingState />}
    </>
  );
}

const QUESTIONS = [
  { q: 'Kết bạn thế nào?', a: 'Vào Cuộc sống, chọn Bạn bè, rồi nhập mã kết bạn hoặc quét mã QR của bạn ấy. Mã của bạn nằm ở Tiện ích, mục Mời bạn bè.' },
  { q: 'Đồ pet mang về nằm ở đâu?', a: 'Trong Kho đồ. Đồ trang trí đặt được vào phòng, hạt giống trồng được trong Vườn nhà, huy hiệu và kỷ vật nằm ở tab Kỷ vật.' },
  { q: 'Vì sao cảnh không có mưa hay nắng?', a: 'Thời tiết chỉ hiện khi bạn cho phép dùng vị trí và có dữ liệu. Nếu không, cảnh chỉ đổi theo giờ trong ngày.' },
  { q: 'Muốn chặn hoặc báo cáo ai đó?', a: 'Trong danh sách bạn bè, mở menu của bạn ấy rồi chọn Chặn hoặc Báo cáo. Bỏ chặn ở Quyền riêng tư.' },
  { q: 'Vì sao mình không thấy một số công cụ?', a: 'Nhiệm vụ công việc, Hành trình sự nghiệp, Vườn tài chính, Góc thư giãn, Nhật ký phản tư, Phiêu lưu và Thị trấn dành cho người từ 16 tuổi. Hãy kiểm tra Độ tuổi và lớp học.' },
];

export function HelpScreen({ onBack, onReplayTour, onOpenFeed }: { onBack: () => void; onReplayTour: () => void; onOpenFeed: () => void }) {
  const s = useStyles();
  return (
    <>
      <BackHeader title="Trợ giúp và cộng đồng" onBack={onBack} />
      <FeatureGroup>
        <FeatureRow first icon="play-circle" tone="sky" title="Xem lại giới thiệu" subtitle="Một vòng qua các mục của Mirabi" onPress={onReplayTour} testID="replay-tour" />
        <FeatureRow icon="newspaper" tone="rose" title="Bảng tin" subtitle="Chia sẻ cùng cộng đồng Mirabi" onPress={onOpenFeed} testID="help-feed" />
      </FeatureGroup>
      <SectionHeader title="Câu hỏi thường gặp" />
      <View style={s.questions}>
        {QUESTIONS.map(({ q, a }) => (
          <Card key={q}>
            <Text style={s.q} accessibilityRole="header">{q}</Text>
            <Text style={s.a}>{a}</Text>
          </Card>
        ))}
      </View>
    </>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  group: { paddingVertical: 4, paddingHorizontal: 14 },
  note: { flexDirection: 'row', gap: 10 },
  noteText: { flex: 1, ...typeScale.caption, fontWeight: '600', color: t.muted },
  questions: { gap: 10 },
  q: { ...typeScale.label, color: t.ink },
  a: { ...typeScale.body, color: t.muted, marginTop: 4 },
}));
