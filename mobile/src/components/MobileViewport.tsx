import React, { createContext, useContext } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaFrameContext, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Text } from './Typography';

// Samsung Galaxy S23 Ultra: 384x824 dp (1440x3088 px at 3.75x), centred punch-hole camera, One UI status bar
// (32dp) and the default three-button navigation bar (48dp). On a wide browser window the app renders inside a
// frame this size (scaled down if the window is short), so the web preview lays out exactly like the phone.
// Real devices use their own safe areas via SafeAreaProvider in App.tsx.
const PHONE = { width: 384, height: 824 };
const INSETS = { top: 32, bottom: 48, left: 0, right: 0 };
const FRAME_BREAKPOINT = 600;
const BEZEL = 7;
const ICON = '#1F2328';

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
      <Text style={styles.clock}>12:45</Text>
      <View style={styles.punchHole}><View style={styles.lens} /></View>
      <View style={styles.statusIcons}>
        <Ionicons name="wifi" size={14} color={ICON} />
        <Ionicons name="cellular" size={13} color={ICON} />
        <Text style={styles.batteryText}>85%</Text>
        <View style={styles.battery}><View style={styles.batteryLevel} /></View>
      </View>
    </View>
  );
}

/** One UI default navigation bar: Recents, Home, Back. */
function NavBarMock() {
  return (
    <View style={styles.navBar} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.recents}>{[0, 1, 2].map((i) => <View key={i} style={styles.recentsBar} />)}</View>
      <View style={styles.home} />
      <Ionicons name="chevron-back" size={22} color={ICON} />
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
        <View style={[styles.button, { right: -3, top: 150, height: 74 }]} />
        <View style={[styles.button, { right: -3, top: 246, height: 40 }]} />
        <View style={[styles.screen, PHONE]}>
          <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, ...PHONE }}>
            <SafeAreaInsetsContext.Provider value={INSETS}>
              <ViewportContext.Provider value={PHONE}>{children}</ViewportContext.Provider>
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
          <StatusBarMock />
          <NavBarMock />
          {/* Light falloff on the edges suggests the S23 Ultra's curved display. */}
          <LinearGradient colors={['rgba(0,0,0,0.14)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[styles.edge, { left: 0 }]} pointerEvents="none" />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.14)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[styles.edge, { right: 0 }]} pointerEvents="none" />
        </View>
        <View style={styles.sPen} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bezel: { padding: BEZEL, borderRadius: 26, backgroundColor: '#1E2124', borderWidth: 1.5, borderColor: '#3A3F44',
    shadowColor: '#0E3E5E', shadowOpacity: 0.35, shadowRadius: 40, shadowOffset: { width: 0, height: 20 } },
  button: { position: 'absolute', width: 4, borderRadius: 2, backgroundColor: '#3A3F44' },
  sPen: { position: 'absolute', bottom: -2, left: 54, width: 26, height: 3, borderRadius: 2, backgroundColor: '#4A5056' },
  screen: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#EAF7FD' },
  edge: { position: 'absolute', top: 0, bottom: 0, width: 7 },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, height: INSETS.top, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 18 },
  clock: { fontSize: 13, fontWeight: '700', color: ICON },
  punchHole: { position: 'absolute', top: 9, left: (PHONE.width - 13) / 2, width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#05070A', alignItems: 'center', justifyContent: 'center' },
  lens: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#1C2533' },
  statusIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  batteryText: { fontSize: 12, fontWeight: '700', color: ICON, marginLeft: 2 },
  battery: { width: 20, height: 10, borderRadius: 3, borderWidth: 1.2, borderColor: 'rgba(31,35,40,0.5)', padding: 1.2 },
  batteryLevel: { width: '85%', height: '100%', borderRadius: 1.5, backgroundColor: ICON },
  navBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: INSETS.bottom, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-around', paddingHorizontal: 28, backgroundColor: 'rgba(255,255,255,0.72)' },
  recents: { flexDirection: 'row', gap: 4, width: 22, justifyContent: 'center' },
  recentsBar: { width: 2, height: 14, borderRadius: 1, backgroundColor: ICON },
  home: { width: 17, height: 17, borderRadius: 6, borderWidth: 2, borderColor: ICON },
});
