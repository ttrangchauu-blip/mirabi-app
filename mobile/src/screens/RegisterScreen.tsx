import React, { useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../components/Typography';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../auth/messages';
import { validateDisplayName, validateEmail, validateNewPassword, validatePasswordConfirmation } from '../auth/validation';
import { AuthLayout } from '../components/AuthLayout';
import { AuthTextField, FormBanner, GradientButton, TextLink } from '../components/AuthForm';
import { authTheme } from '../theme';

type Props = { email: string; onEmailChange: (email: string) => void; onLogin: () => void; onRegistered: (email: string, password: string) => void };
type Errors = { displayName?: string; email?: string; password?: string; confirm?: string };

export function RegisterScreen({ email, onEmailChange, onLogin, onRegistered }: Props) {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const refs = { displayName: useRef<TextInput>(null), email: useRef<TextInput>(null), password: useRef<TextInput>(null), confirm: useRef<TextInput>(null) };

  const clearError = (key: keyof Errors) => { if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined })); };

  async function submit() {
    if (inFlight.current) return;
    const next: Errors = {
      displayName: validateDisplayName(displayName),
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(next);
    const firstInvalid = (Object.keys(next) as (keyof Errors)[]).find((k) => next[k]);
    if (firstInvalid) { refs[firstInvalid].current?.focus(); return; }
    inFlight.current = true;
    setSubmitting(true);
    setApiError(null);
    Keyboard.dismiss();
    try {
      await register({ email, password, displayName });
      onRegistered(email, password);
    } catch (e) {
      setApiError(errorMessage(e));
      inFlight.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  const locked = submitting;
  return (
    <AuthLayout
      title="Tạo tài khoản mới"
      subtitle="Chỉ vài bước nữa thôi! Đăng nhập xong, bạn sẽ được chọn một người bạn nhỏ để nuôi."
      onBack={onLogin}
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Đã có tài khoản? </Text>
          <TextLink title="Đăng nhập" onPress={onLogin} accessibilityLabel="Đã có tài khoản? Đăng nhập" />
        </View>
      }>
      {apiError ? <FormBanner tone="error" message={apiError} /> : null}
      <AuthTextField ref={refs.displayName} label="Tên của bạn (không bắt buộc)" icon="person-outline" placeholder="Ví dụ: Minh Anh" value={displayName}
        onChangeText={(v) => { setDisplayName(v); clearError('displayName'); }} error={errors.displayName} maxLength={80}
        autoComplete="nickname" textContentType="nickname" returnKeyType="next" submitBehavior="submit"
        onSubmitEditing={() => refs.email.current?.focus()} editable={!locked} testID="register-name" />
      <AuthTextField ref={refs.email} label="Email" icon="mail-outline" placeholder="ban@example.com" value={email}
        onChangeText={(v) => { onEmailChange(v); clearError('email'); }} error={errors.email}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username"
        returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => refs.password.current?.focus()} editable={!locked} testID="register-email" />
      <AuthTextField ref={refs.password} label="Mật khẩu" icon="lock-closed-outline" placeholder="Tạo mật khẩu" password value={password}
        onChangeText={(v) => { setPassword(v); clearError('password'); }} error={errors.password}
        hint="Ít nhất 8 ký tự, gồm cả chữ cái và chữ số." autoCapitalize="none" autoCorrect={false}
        autoComplete="new-password" textContentType="newPassword" passwordRules="minlength: 8; required: lower, upper; required: digit;"
        returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => refs.confirm.current?.focus()} editable={!locked} testID="register-password" />
      <AuthTextField ref={refs.confirm} label="Nhập lại mật khẩu" icon="lock-closed-outline" placeholder="Nhập lại mật khẩu" password value={confirm}
        onChangeText={(v) => { setConfirm(v); clearError('confirm'); }} error={errors.confirm}
        autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
        returnKeyType="go" onSubmitEditing={submit} editable={!locked} testID="register-confirm" />
      <GradientButton title="Tạo tài khoản ✨" onPress={submit} loading={submitting} loadingTitle="Đang tạo tài khoản…" />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  footerText: { color: authTheme.ink, fontSize: 14 },
});
