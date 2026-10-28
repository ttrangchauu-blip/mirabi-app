import React, { useRef, useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../auth/messages';
import { validateEmail, validateNewPassword, validatePasswordConfirmation } from '../auth/validation';
import { AuthLayout } from '../components/AuthLayout';
import { AuthTextField, FormBanner, GradientButton, TextLink } from '../components/AuthForm';

type Props = { email: string; onEmailChange: (email: string) => void; onBackToLogin: (notice?: string) => void };

const SENT_MESSAGE = 'Nếu email này đã đăng ký, Mirabi đã gửi mã đặt lại mật khẩu. Hãy kiểm tra hộp thư (kể cả mục Spam).';
export const RESET_DONE_MESSAGE = 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới nhé!';

export function ForgotPasswordScreen({ email, onEmailChange, onBackToLogin }: Props) {
  const { requestPasswordReset, resetPassword } = useAuth();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setApiError(null);
    Keyboard.dismiss();
    try { await task(); }
    catch (e) { setApiError(errorMessage(e)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  function sendCode() {
    const emailError = validateEmail(email);
    setErrors({ email: emailError });
    if (emailError) return;
    void run(async () => { await requestPasswordReset(email); setSent(true); });
  }

  function submitReset() {
    const next = {
      code: code.trim() ? undefined : 'Vui lòng nhập mã từ email.',
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(next);
    if (next.code || next.password || next.confirm) return;
    void run(async () => { await resetPassword(code, password); onBackToLogin(RESET_DONE_MESSAGE); });
  }

  if (step === 'request') {
    return (
      <AuthLayout title="Quên mật khẩu?" subtitle="Nhập email bạn đã đăng ký, Mirabi sẽ gửi mã để bạn đặt lại mật khẩu." onBack={() => onBackToLogin()}>
        {apiError ? <FormBanner tone="error" message={apiError} /> : null}
        {sent ? <FormBanner tone="success" message={SENT_MESSAGE} /> : null}
        <AuthTextField label="Email" icon="mail-outline" placeholder="ban@example.com" value={email}
          onChangeText={(v) => { onEmailChange(v); setErrors({}); }} error={errors.email}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username"
          returnKeyType="send" onSubmitEditing={sendCode} editable={!submitting} testID="forgot-email" />
        <GradientButton title={sent ? 'Gửi lại mã' : 'Gửi mã đặt lại'} onPress={sendCode} loading={submitting} loadingTitle="Đang gửi…" />
        <TextLink title="Tôi đã có mã" onPress={() => { setApiError(null); setErrors({}); setStep('reset'); }} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Đặt lại mật khẩu" subtitle="Dán mã trong email và chọn mật khẩu mới cho tài khoản của bạn." onBack={() => onBackToLogin()}>
      {apiError ? <FormBanner tone="error" message={apiError} /> : null}
      <AuthTextField label="Mã đặt lại" icon="key-outline" placeholder="Dán mã từ email" value={code}
        onChangeText={(v) => { setCode(v); setErrors((x) => ({ ...x, code: undefined })); }} error={errors.code}
        autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode"
        returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} editable={!submitting} testID="reset-code" />
      <AuthTextField ref={passwordRef} label="Mật khẩu mới" icon="lock-closed-outline" placeholder="Tạo mật khẩu mới" password value={password}
        onChangeText={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }} error={errors.password}
        hint="Ít nhất 8 ký tự, gồm cả chữ cái và chữ số." autoCapitalize="none" autoCorrect={false}
        autoComplete="new-password" textContentType="newPassword" returnKeyType="next" submitBehavior="submit"
        onSubmitEditing={() => confirmRef.current?.focus()} editable={!submitting} testID="reset-password" />
      <AuthTextField ref={confirmRef} label="Nhập lại mật khẩu mới" icon="lock-closed-outline" placeholder="Nhập lại mật khẩu" password value={confirm}
        onChangeText={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }} error={errors.confirm}
        autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
        returnKeyType="go" onSubmitEditing={submitReset} editable={!submitting} testID="reset-confirm" />
      <GradientButton title="Đặt lại mật khẩu" onPress={submitReset} loading={submitting} loadingTitle="Đang cập nhật…" />
      <TextLink title="Chưa nhận được mã? Gửi lại" onPress={() => { setApiError(null); setErrors({}); setStep('request'); }} />
    </AuthLayout>
  );
}
