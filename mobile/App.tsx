import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from './src/components/Typography';
import { NUNITO } from './src/fonts';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { AuthFlow } from './src/screens/AuthFlow';
import { AdoptPetScreen } from './src/screens/AdoptPetScreen';
import { DailyTaskSelectionScreen } from './src/screens/DailyTaskSelectionScreen';
import { WelcomeTour } from './src/screens/WelcomeTour';
import { MainApp } from './src/screens/main/MainApp';
import { MobileViewport } from './src/components/MobileViewport';
import { appTheme } from './src/theme';
import { Button } from './src/ui/kit';
import { ConfirmProvider } from './src/ui/ConfirmDialog';
import { ModalHost } from './src/ui/AppModal';
import { ToastProvider } from './src/ui/Toast';
import { useConfirmLogout } from './src/auth/useConfirmLogout';

export default function App() {
  const [fontsLoaded, fontError] = useFonts(NUNITO);
  // Fonts ship with the app, so this is near-instant; if loading ever fails, fall back to system fonts rather than block.
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <MobileViewport><AuthProvider><ToastProvider><ConfirmProvider><ModalHost><Root /></ModalHost></ConfirmProvider></ToastProvider></AuthProvider></MobileViewport>
    </SafeAreaProvider>
  );
}

function Root() {
  const { status, user, retryRestore } = useAuth();
  const confirmLogout = useConfirmLogout();
  if (status === 'restoring') {
    return (
      <LinearGradient colors={appTheme.backdrop} style={styles.center}>
        <ActivityIndicator size="large" color={appTheme.accent} />
        <Text style={styles.muted}>Đang mở Mirabi…</Text>
      </LinearGradient>
    );
  }
  if (status === 'restoreFailed') {
    return (
      <LinearGradient colors={appTheme.backdrop} style={styles.center}>
        <Text style={styles.title}>Không thể kết nối tới Mirabi</Text>
        <Text style={[styles.muted, styles.centerText]}>Hãy kiểm tra kết nối mạng rồi thử lại.</Text>
        <View style={styles.actions}>
          <Button title="Thử lại" icon="refresh" onPress={retryRestore} />
          <Button title="Đăng xuất" variant="secondary" onPress={() => { void confirmLogout(); }} />
        </View>
      </LinearGradient>
    );
  }
  if (status === 'signedOut') return <AuthFlow />;
  // First sign-in: adopt and name a pet, then the welcome tour, then the app.
  if (user && !user.pet_name) return <AdoptPetScreen />;
  if (user && !user.daily_tasks_selected) return <DailyTaskSelectionScreen />;
  if (user && !user.onboarded) return <WelcomeTour />;
  return <MainApp />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 18, fontWeight: '900', color: appTheme.ink },
  muted: { fontSize: 14, color: appTheme.muted, lineHeight: 21 },
  centerText: { textAlign: 'center' },
  actions: { width: 240 },
});
