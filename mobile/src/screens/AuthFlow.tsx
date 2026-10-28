import React, { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import { useToast } from '../ui/Toast';

type Screen = 'login' | 'register' | 'forgot';

export const REGISTERED_MESSAGE = 'Tạo tài khoản thành công!';

/** Signed-out navigation. The email draft is shared so it survives moving between screens. */
export function AuthFlow() {
  const [screen, setScreen] = useState<Screen>('login');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const toast = useToast();
  // Only set right after registering, so the login form arrives pre-filled. Kept in memory, never stored.
  const [prefillPassword, setPrefillPassword] = useState('');

  useEffect(() => {
    if (screen === 'login') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setScreen('login'); return true; });
    return () => sub.remove();
  }, [screen]);

  if (screen === 'register') {
    return <RegisterScreen email={email} onEmailChange={setEmail} onLogin={() => setScreen('login')}
      onRegistered={(registeredEmail, password) => {
        setEmail(registeredEmail.trim()); setPrefillPassword(password); setNotice(null); setScreen('login'); toast(REGISTERED_MESSAGE);
      }} />;
  }
  if (screen === 'forgot') {
    return <ForgotPasswordScreen email={email} onEmailChange={setEmail}
      onBackToLogin={(message) => { setNotice(null); setScreen('login'); if (message) toast(message); }} />;
  }
  return <LoginScreen email={email} onEmailChange={setEmail} notice={notice} initialPassword={prefillPassword}
    onRegister={() => { setNotice(null); setPrefillPassword(''); setScreen('register'); }}
    onForgotPassword={() => { setNotice(null); setPrefillPassword(''); setScreen('forgot'); }} />;
}
