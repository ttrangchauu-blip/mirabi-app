import React from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { LANGUAGES, type LanguageChoice, type Translate, type TranslationKey, languageName, resolveLanguage, useLanguage } from '../../i18n';
import { NOTIFICATIONS_SUPPORTED, type NoticeKind, type Permission, useNotificationPermission } from '../../notifications/permission';
import { type NotificationSettings, type ThemeMode, useAccountSettings } from '../../settings/accountSettings';
import { radius, type as typeScale } from '../../ui/design';
import { Button, Card, SectionHeader } from '../../ui/kit';
import { makeStyles, useTheme } from '../../ui/theme';
import { useToast } from '../../ui/Toast';
import { BackHeader, ToggleRow } from '../together/ui';
import { FeatureGroup, InfoRow } from './FeatureRow';

/** The device can't show Mirabi's notifications: the user said no, or turned them off in the device's settings. */
const blocked = (p: Permission | null) => NOTIFICATIONS_SUPPORTED && p?.status === 'denied';
const undecided = (p: Permission | null) => NOTIFICATIONS_SUPPORTED && p?.status === 'undetermined';

/** The line under "Thông báo" in Cài đặt: what is really the case, the user's choice and the device's together. */
export function notificationSummary(prefs: NotificationSettings, permission: Permission | null, tr: Translate) {
  if (!prefs.enabled) return tr('settings.notifications.summaryOff');
  if (blocked(permission)) return tr('settings.notifications.summaryBlocked');
  if (undecided(permission)) return tr('settings.notifications.summaryAsk');
  return tr('settings.notifications.summaryOn');
}

type Kind = { kind: NoticeKind; group: Parameters<Translate>[0]; label: Parameters<Translate>[0]; hint: Parameters<Translate>[0]; device: boolean };
/** Only what Mirabi really sends: every kind here is wired to an event of the app (see notifications/). */
const KINDS: Kind[] = [
  { kind: 'focus', group: 'settings.notifications.groupFocus', label: 'settings.notifications.focus', hint: 'settings.notifications.focusHint', device: true },
  { kind: 'pet', group: 'settings.notifications.groupPet', label: 'settings.notifications.pet', hint: 'settings.notifications.petHint', device: true },
  { kind: 'achievements', group: 'settings.notifications.groupAchievements', label: 'settings.notifications.achievements', hint: 'settings.notifications.achievementsHint', device: false },
  { kind: 'friends', group: 'settings.notifications.groupFriends', label: 'settings.notifications.friends', hint: 'settings.notifications.friendsHint', device: false },
];

/**
 * Cài đặt > Thông báo. "Cho phép thông báo" is the master switch: off, every kind below is greyed out and keeps its
 * choice. Turning it on asks the device the first time; if the device says no, it stays off rather than look on.
 * The device's permission is shown on its own, with the way to the device's settings when Mirabi may not ask again.
 */
export function NotificationSettingsScreen({ userId, onBack }: { userId: number; onBack: () => void }) {
  const { t: tr } = useLanguage();
  const { t } = useTheme();
  const s = useStyles();
  const toast = useToast();
  const { settings, save, unsent } = useAccountSettings(userId);
  const prefs = settings.notifications;
  const { permission, ask, openSettings } = useNotificationPermission();
  const isBlocked = blocked(permission);

  async function setMaster(on: boolean) {
    if (on && NOTIFICATIONS_SUPPORTED) {
      const answer = await ask();
      if (answer.status !== 'granted') { toast(tr('settings.notifications.deniedToast')); return; }
    }
    save((current) => ({ notifications: { ...current.notifications, enabled: on } }));
  }
  const setKind = (kind: NoticeKind, on: boolean) => save((current) => ({ notifications: { ...current.notifications, [kind]: on } }));

  return (
    <>
      <BackHeader title={tr('settings.notifications.title')} subtitle={tr('settings.notifications.subtitle')} onBack={onBack} />
      {isBlocked ? (
        <Card style={s.banner}>
          <View style={s.bannerHead}>
            <Ionicons name="notifications-off" size={20} color={t.danger} />
            <Text style={s.bannerTitle} testID="notifications-blocked">{tr('settings.notifications.blockedTitle')}</Text>
          </View>
          <Text style={s.bannerBody}>{tr('settings.notifications.blockedBody')}</Text>
          {permission?.canAskAgain
            ? <Button title={tr('settings.notifications.allow')} icon="notifications" onPress={() => { void ask(); }} />
            : <Button title={tr('settings.notifications.openSettings')} icon="settings" variant="secondary" onPress={openSettings} />}
        </Card>
      ) : prefs.enabled && undecided(permission) ? (
        <Card style={s.banner}>
          <View style={s.bannerHead}>
            <Ionicons name="notifications-outline" size={20} color={t.accent} />
            <Text style={s.bannerTitle}>{tr('settings.notifications.askTitle')}</Text>
          </View>
          <Text style={s.bannerBody}>{tr('settings.notifications.askBody')}</Text>
          <Button title={tr('settings.notifications.allow')} icon="notifications" onPress={() => { void ask(); }} />
        </Card>
      ) : null}
      <Card style={s.group}>
        <ToggleRow label={tr('settings.notifications.master')} description={tr('settings.notifications.masterHint')}
          value={prefs.enabled} onChange={(on) => { void setMaster(on); }} testID="notifications-master" />
      </Card>
      {KINDS.map(({ kind, group, label, hint, device }) => (
        <React.Fragment key={kind}>
          <SectionHeader title={tr(group)} />
          <Card style={s.group}>
            <ToggleRow label={tr(label)} description={tr(hint)} value={prefs[kind]} disabled={!prefs.enabled}
              onChange={(on) => setKind(kind, on)} testID={`notifications-${kind}`}
              note={!prefs.enabled ? undefined : device && !NOTIFICATIONS_SUPPORTED ? tr('settings.notifications.needsPhone')
                : device && isBlocked ? tr('settings.notifications.needsDevice') : undefined} />
          </Card>
        </React.Fragment>
      ))}
      <SectionHeader title={tr('settings.notifications.groupLater')} />
      <FeatureGroup>
        <InfoRow first soon icon="checkbox" tone="leaf" title={tr('settings.notifications.tasks')} subtitle={tr('settings.notifications.tasksHint')} />
        <InfoRow soon icon="book" tone="sky" title={tr('settings.notifications.learning')} subtitle={tr('settings.notifications.learningHint')} />
      </FeatureGroup>
      <Text style={s.footnote}>{NOTIFICATIONS_SUPPORTED ? tr('settings.notifications.deviceNote') : tr('settings.notifications.webNote')}</Text>
      {unsent ? <Text style={s.footnote} testID="settings-unsent">{tr('settings.notifications.unsent')}</Text> : null}
    </>
  );
}

/**
 * Cài đặt > Ngôn ngữ. Only a language Mirabi is fully written in can be chosen; one still being translated is listed
 * as coming. The choice applies at once, stays on this device for before sign-in and offline, and follows the account.
 */
export function LanguageScreen({ userId, onBack }: { userId: number; onBack: () => void }) {
  const { t: tr, choice, device, setChoice } = useLanguage();
  const s = useStyles();
  const toast = useToast();
  const { save, unsent } = useAccountSettings(userId);
  const choose = (next: LanguageChoice) => {
    if (next === choice) return;
    setChoice(next);
    save({ language: next });
    toast(tr('settings.language.changed'), 'success');
  };
  return (
    <>
      <BackHeader title={tr('settings.language.title')} subtitle={tr('settings.language.subtitle')} onBack={onBack} />
      <Card style={s.group}>
        <Choice first label={tr('settings.language.device')} hint={tr('settings.language.deviceHint', { language: languageName(resolveLanguage(null, device)) })}
          selected={choice === null} onPress={() => choose(null)} testID="language-device" />
        {LANGUAGES.map((l) => (
          <Choice key={l.code} label={l.name} hint={l.ready ? undefined : tr('settings.language.notReady')} soon={!l.ready ? tr('common.soon') : undefined}
            selected={choice === l.code} onPress={l.ready ? () => choose(l.code as LanguageChoice) : undefined} testID={`language-${l.code}`} />
        ))}
      </Card>
      {unsent ? <Text style={s.footnote} testID="settings-unsent">{tr('settings.notifications.unsent')}</Text> : null}
    </>
  );
}

const MODES: { mode: ThemeMode; label: TranslationKey; hint: TranslationKey }[] = [
  { mode: 'system', label: 'settings.appearance.system', hint: 'settings.appearance.systemHint' },
  { mode: 'light', label: 'settings.appearance.light', hint: 'settings.appearance.lightHint' },
  { mode: 'dark', label: 'settings.appearance.dark', hint: 'settings.appearance.darkHint' },
];
export const modeLabel = (mode: ThemeMode): TranslationKey => MODES.find((m) => m.mode === mode)!.label;

/**
 * Cài đặt > Giao diện: the device's light or dark (the default), or always light, or always dark. Applies at once,
 * stays on this device for before sign-in and offline, and follows the account. The scenes are not touched.
 */
export function AppearanceScreen({ userId, onBack }: { userId: number; onBack: () => void }) {
  const { t: tr } = useLanguage();
  const { mode, setMode } = useTheme();
  const system = useColorScheme();
  const { save, unsent } = useAccountSettings(userId);
  const s = useStyles();
  const choose = (next: ThemeMode) => {
    if (next === mode) return;
    setMode(next);
    save({ theme: next });
  };
  const scheme = tr(system === 'dark' ? 'settings.appearance.schemeDark' : 'settings.appearance.schemeLight');
  return (
    <>
      <BackHeader title={tr('settings.appearance.title')} subtitle={tr('settings.appearance.subtitle')} onBack={onBack} />
      <Card style={s.group}>
        {MODES.map((m, i) => (
          <Choice key={m.mode} first={i === 0} label={tr(m.label)} hint={tr(m.hint, { scheme })} selected={mode === m.mode}
            onPress={() => choose(m.mode)} testID={`appearance-${m.mode}`} />
        ))}
      </Card>
      <Text style={s.footnote}>{tr('settings.appearance.worldNote')}</Text>
      {unsent ? <Text style={s.footnote} testID="settings-unsent">{tr('settings.notifications.unsent')}</Text> : null}
    </>
  );
}

/** One option of a list where only one is chosen. Without `onPress` it is shown and can't be chosen. */
function Choice({ label, hint, selected, onPress, soon, first, testID }: { label: string; hint?: string; selected: boolean; onPress?: () => void; soon?: string; first?: boolean; testID?: string }) {
  const { t } = useTheme();
  const s = useStyles();
  const disabled = !onPress;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={[label, hint, soon].filter(Boolean).join('. ')} testID={testID}
      style={({ pressed }) => [s.choice, !first && s.divider, pressed && s.pressed, disabled && s.dim]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? t.accent : t.muted} />
      <View style={s.flex}>
        <Text style={s.choiceLabel} numberOfLines={2}>{label}</Text>
        {hint ? <Text style={s.choiceHint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      {soon ? <View style={s.pill}><Text style={s.pillText}>{soon}</Text></View> : null}
    </Pressable>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  group: { paddingVertical: 4, paddingHorizontal: 14 },
  banner: { gap: 6 },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerTitle: { flex: 1, ...typeScale.label, color: t.ink },
  bannerBody: { ...typeScale.body, color: t.muted },
  footnote: { ...typeScale.caption, fontWeight: '600', color: t.muted, marginTop: 4, marginBottom: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: t.tint },
  pressed: { opacity: 0.88 },
  dim: { opacity: 0.6 },
  choiceLabel: { ...typeScale.label, color: t.ink },
  choiceHint: { ...typeScale.caption, fontWeight: '600', color: t.muted },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: t.tint },
  pillText: { ...typeScale.micro, color: t.accent },
}));
