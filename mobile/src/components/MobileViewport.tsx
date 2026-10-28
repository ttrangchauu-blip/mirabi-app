import React, { createContext, useContext } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaFrameContext, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { authTheme } from '../theme';
import { Text } from './Typography';

// iPhone 15 Pro Max: 430x932 pt, Dynamic Island, 59pt top / 34pt bottom safe areas. On a wide browser window
// the app renders inside a frame this size (scaled down if the window is short), so the web preview lays out
// exactly like the phone. Real devices use their own safe areas via SafeAreaProvider in App.tsx.
const PHONE = { width: 430, height: 932 };
const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };
const FRAME_BREAKPOINT = 600;
const BEZEL = 12;

type Size = { width: number; height: number };
const ViewportContext = createContext<Size | null>(null);

/** Size of the area the app actually renders in (the phone frame on desktop web, else the window). */
export function useViewportSize(): Size {
  const window = useWindowDimensions();
  return useContext(ViewportContext) ?? window;
}

function StatusBarMock() {
  return (
    <View style={styles.statusBar} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.clock}>9:41</Text>
      <View style={styles.island} />
      <View style={styles.statusIcons}>
        <Ionicons name="cellular" size={17} color="#0E1A24" />
        <Ionicons name="wifi" size={17} color="#0E1A24" />
        <View style={styles.battery}><View style={styles.batteryLevel} /></View>
      </View>
    </View>
  );
}

export function MobileViewport({ children }: { children: React.ReactNode }) {
  const window = useWindowDimensions();
  if (Platform.OS !== 'web' || window.width < FRAME_BREAKPOINT) return <>{children}</>;

  const outer = { width: PHONE.width + BEZEL * 2, height: PHONE.height + BEZEL * 2 };
  const scale = Math.min(1, (window.height - 32) / outer.height, (window.width - 32) / outer.width);
  return (
    <LinearGradient colors={['#CDEBFA', '#B5DFF5', '#D3F2F5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backdrop}>
      <View style={[styles.bezel, outer, { transform: [{ scale }] }]}>
        <View style={[styles.button, { left: -3, top: 180, height: 32 }]} />
        <View style={[styles.button, { left: -3, top: 236, height: 62 }]} />
        <View style={[styles.button, { left: -3, top: 310, height: 62 }]} />
        <View style={[styles.button, { right: -3, top: 260, height: 100 }]} />
        <View style={[styles.screen, PHONE]}>
          <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, ...PHONE }}>
            <SafeAreaInsetsContext.Provider value={INSETS}>
              <ViewportContext.Provider value={PHONE}>{children}</ViewportContext.Provider>
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
          <StatusBarMock />
          <View style={styles.homeIndicator} pointerEvents="none" />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bezel: { padding: BEZEL, borderRadius: 67, backgroundColor: '#1B2A38',
    shadowColor: '#0E3E5E', shadowOpacity: 0.35, shadowRadius: 40, shadowOffset: { width: 0, height: 20 } },
  button: { position: 'absolute', width: 4, borderRadius: 2, backgroundColor: '#2A3B4B' },
  screen: { borderRadius: 55, overflow: 'hidden', backgroundColor: '#EAF7FD' },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, height: INSETS.top, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 34, paddingTop: 4 },
  clock: { fontSize: 17, fontWeight: '700', color: '#0E1A24', width: 70, textAlign: 'center' },
  island: { position: 'absolute', top: 11, left: (PHONE.width - 126) / 2, width: 126, height: 37, borderRadius: 19, backgroundColor: '#000' },
  statusIcons: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 90, justifyContent: 'flex-end' },
  battery: { width: 27, height: 13, borderRadius: 4, borderWidth: 1.2, borderColor: 'rgba(14,26,36,0.45)', padding: 1.5 },
  batteryLevel: { flex: 1, borderRadius: 2, backgroundColor: '#0E1A24' },
  homeIndicator: { position: 'absolute', bottom: 8, left: (PHONE.width - 140) / 2, width: 140, height: 5, borderRadius: 3,
    backgroundColor: authTheme.ink, opacity: 0.85 },
});
