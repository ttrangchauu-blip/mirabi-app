import React, { useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../components/Typography';
import { ApiError, NetworkError, newIdempotencyKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../auth/messages';
import { validateEmail, validateLoginPassword } from '../auth/validation';
import { AuthLayout } from '../components/AuthLayout';
import { AuthTextField, FormBanner, GradientButton, TextLink } from '../components/AuthForm';
import { authTheme } from '../theme';
import { useToast } from '../ui/Toast';

type Props = { email: string; onEmailChange: (email: string) => void; onRegister: () => void; onForgotPassword: () => void; notice?: string | null; initialPassword?: string };

export function LoginScreen({ email, onEmailChange, onRegister, onForgotPassword, notice: flowNotice, initialPassword = '' }: Props) {
  const { login, notice: authNotice, clearNotice } = useAuth();
  const [password, setPassword] = useState(initialPassword);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  // State updates are async; a ref blocks a second tap that lands before the re-render.
  const inFlight = useRef(false);
  // Kept while a request's outcome is unknown (network failure), so a retry can't lose the day's streak popup.
  const attemptId = useRef<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const notice = authNotice ?? flowNotice;

  async function submit() {
    if (inFlight.current) return;
    const next = { email: validateEmail(email), password: validateLoginPassword(password) };
    setErrors(next);
    if (next.email || next.password) {
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setApiError(null);
    clearNotice();
    Keyboard.dismiss();
    try {
      attemptId.current ??= newIdempotencyKey();
      const { commit, loginStreak } = await login(email, password, attemptId.current);
      attemptId.current = null;
      // The streak itself is shown in the daily popup once the app opens.
      if (loginStreak?.should_show_popup) toast('Đăng nhập thành công!', 'success');
      else toast('Chào mừng bạn trở lại!');
      commit();
    } catch (e) {
      // The server answered, so this attempt is settled; only an unknown outcome is retried with the same id.
      if (!(e instanceof NetworkError)) attemptId.current = null;
      setApiError(errorMessage(e));
      // Keep the email so the user can retry; only clear a password the server rejected.
      if (e instanceof ApiError && e.code === 'invalid_credentials') setPassword('');
      inFlight.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Chào mừng bạn trở lại!"
      subtitle="Mirabi đang chờ cùng bạn khám phá những điều mới mẻ."
      showLogo
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Chưa có tài khoản? </Text>
          <TextLink title="Đăng ký ngay" onPress={onRegister} accessibilityLabel="Chưa có tài khoản? Đăng ký ngay" />
        </View>
      }>
      {notice && !apiError ? <FormBanner tone="info" message={notice} /> : null}
      {apiError ? <FormBanner tone="error" message={apiError} /> : null}
      <AuthTextField
        ref={emailRef}
        label="Email"
        icon="mail-outline"
        placeholder="ban@example.com"
        value={email}
        onChangeText={(v) => { onEmailChange(v); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        editable={!submitting}
        testID="login-email"
      />
      <AuthTextField
        ref={passwordRef}
        label="Mật khẩu"
        icon="lock-closed-outline"
        placeholder="Nhập mật khẩu"
        password
        value={password}
        onChangeText={(v) => { setPassword(v); if (errors.password) setErrors((x) => ({ ...x, password: undefined })); }}
        error={errors.password}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!submitting}
        testID="login-password"
      />
      <GradientButton
        title="Bắt đầu hành trình ✨"
        onPress={submit}
        loading={submitting}
        loadingTitle="Đang đăng nhập…"
      />
      <View style={styles.forgotRow}>
        <TextLink title="Quên mật khẩu?" onPress={onForgotPassword} />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  forgotRow: { marginTop: 6 },
  footerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  footerText: { color: authTheme.ink, fontSize: 14 },
});
