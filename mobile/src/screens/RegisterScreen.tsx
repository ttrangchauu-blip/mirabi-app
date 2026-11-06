import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../components/Typography';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../auth/messages';
import { validateDisplayName, validateEmail, validateNewPassword, validatePasswordConfirmation } from '../auth/validation';
import { AuthLayout } from '../components/AuthLayout';
import { AuthTextField, FormBanner, GradientButton, TextLink } from '../components/AuthForm';
import { StudyProfileFields } from '../components/StudyProfileFields';
import { validateAge, validateGrade, type GradeId } from '../studyProfile';
import { makeStyles } from '../ui/theme';

type Props = { email: string; onEmailChange: (email: string) => void; onLogin: () => void; onRegistered: (email: string, password: string) => void };
type Errors = { displayName?: string; age?: string; grade?: string; email?: string; password?: string; confirm?: string };

export function RegisterScreen({ email, onEmailChange, onLogin, onRegistered }: Props) {
  const styles = useStyles();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState<number | null>(null); // never chosen in advance
  const [grade, setGrade] = useState<GradeId | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  // Which school year the grade is for (backend education.py): the grade is locked once the account exists.
  const [schoolYear, setSchoolYear] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiRequest<{ academic_year_label?: string }>('/api/education/calendar/current')
      .then((body) => { if (alive && typeof body?.academic_year_label === 'string') setSchoolYear(body.academic_year_label); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const refs = { displayName: useRef<TextInput>(null), email: useRef<TextInput>(null), password: useRef<TextInput>(null), confirm: useRef<TextInput>(null) };

  const clearError = (key: keyof Errors) => { if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined })); };

  async function submit() {
    if (inFlight.current) return;
    const next: Errors = {
      displayName: validateDisplayName(displayName),
      age: validateAge(age),
      grade: validateGrade(age, grade),
      email: validateEmail(email),
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(next);
    const firstInvalid = (Object.keys(next) as (keyof Errors)[]).find((k) => next[k]);
    if (firstInvalid) {
      // Age and grade are pickers, not text fields: their message shows under them, right below the name.
      if (firstInvalid === 'age' || firstInvalid === 'grade') Keyboard.dismiss(); else refs[firstInvalid].current?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setApiError(null);
    Keyboard.dismiss();
    try {
      await register({ email, password, displayName, age: age!, schoolGrade: grade! });
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
      <StudyProfileFields age={age} grade={grade} disabled={locked} errors={{ age: errors.age, grade: errors.grade }}
        onChange={(a, g) => { setAge(a); setGrade(g); if (errors.age || errors.grade) setErrors((x) => ({ ...x, age: undefined, grade: undefined })); }} />
      {age !== null ? (
        <Text style={styles.gradeNote} testID="register-grade-note">
          {`Chọn lớp bạn đang học${schoolYear ? ` trong năm học ${schoolYear}` : ' trong năm học hiện tại'}. Sau khi tạo tài khoản, lớp học được giữ cố định và tự lên lớp vào đầu mỗi năm học mới.`}
        </Text>
      ) : null}
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

const useStyles = makeStyles(({ auth }) => StyleSheet.create({
  footerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  footerText: { color: auth.ink, fontSize: 14 },
  gradeNote: { color: auth.muted, fontSize: 12, lineHeight: 17, marginTop: -6, marginBottom: 14, marginLeft: 2 },
}));
