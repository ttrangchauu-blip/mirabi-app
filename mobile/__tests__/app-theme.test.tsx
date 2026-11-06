import React from 'react';
import * as RN from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../src/components/Typography';
import { LanguageProvider } from '../src/i18n';
import { AppearanceScreen } from '../src/screens/main/AppSettingsScreens';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { Card } from '../src/ui/kit';
import { makeStyles, resolveScheme, THEME_KEY, ThemeProvider, themes, useTheme } from '../src/ui/theme';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer } from '../test/mockServer';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
let systemScheme: 'light' | 'dark' | null = 'light';
jest.spyOn(RN, 'useColorScheme').mockImplementation(() => systemScheme);

beforeEach(async () => { await AsyncStorage.clear(); systemScheme = 'light'; });

function Probe() {
  const theme = useTheme();
  return <Text testID="probe">{`${theme.mode}:${theme.scheme}`}</Text>;
}
const app = (node: React.ReactNode) => <ThemeProvider><LanguageProvider><ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider></LanguageProvider></ThemeProvider>;

describe('the light and dark interface', () => {
  it('"Theo thiết bị" by default, and it follows the device as it changes while the app is open', async () => {
    const view = render(app(<Probe />));
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('system:light');
    systemScheme = 'dark';
    view.rerender(app(<Probe />));
    expect(screen.getByTestId('probe')).toHaveTextContent('system:dark');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('Giao diện: the choice applies at once, is kept on the device and in the account, and is back after a restart', async () => {
    const server = mockServer({
      'GET /api/world/preferences': { status: 200, body: { version: 1, settings: {} } },
      'PUT /api/world/preferences': (req) => ({ status: 200, body: { version: req.body.version + 1, settings: req.body.settings } }),
    });
    const view = render(app(<><AppearanceScreen userId={61} onBack={() => {}} /><Probe /></>));
    await flush();
    expect(screen.getByTestId('appearance-system').props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('appearance-dark'));
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:dark');
    await flush();
    expect(await AsyncStorage.getItem(THEME_KEY)).toBe('dark');
    expect(server.callsTo('PUT /api/world/preferences').slice(-1)[0].body.settings.theme).toBe('dark');
    view.unmount();
    // Restart, offline: the device's copy is enough.
    mockServer({ 'GET /api/world/preferences': new TypeError('Network request failed') });
    render(app(<Probe />));
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:dark');
  });

  it('a dark screen has no white card and no black text', async () => {
    await AsyncStorage.setItem(THEME_KEY, 'dark');
    const Screen = () => <Card><Text testID="plain">Xin chào</Text><Text testID="outer" style={{ color: '#FF0000' }}>a <Text testID="inner">b</Text></Text></Card>;
    render(app(<Screen />));
    await flush();
    const flat = (id: string) => RN.StyleSheet.flatten(screen.getByTestId(id).props.style);
    expect(flat('plain').color).toBe(themes.dark.t.ink);
    expect(flat('outer').color).toBe('#FF0000');
    expect(flat('inner').color).toBeUndefined(); // a nested Text inherits its parent's colour
    const card = screen.UNSAFE_getAllByType(RN.View).map((v) => RN.StyleSheet.flatten(v.props.style)).find((st) => st?.borderRadius === 22);
    expect(card?.backgroundColor).toBe(themes.dark.t.card);
  });

  it('styles are made once per scheme and follow a change', async () => {
    const factory = jest.fn(({ t }) => RN.StyleSheet.create({ box: { backgroundColor: t.card } }));
    const useStyles = makeStyles(factory);
    let seen = '';
    const Box = () => { seen = useStyles().box.backgroundColor as string; return null; };
    const Switcher = () => { const { setMode } = useTheme(); return <Text testID="go" onPress={() => setMode('dark')}>go</Text>; };
    render(app(<><Box /><Box /><Switcher /></>));
    await flush();
    expect(seen).toBe(themes.light.t.card);
    fireEvent.press(screen.getByTestId('go'));
    expect(seen).toBe(themes.dark.t.card);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('dark text keeps enough contrast on its surfaces', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const { t, tones } = themes.dark;
    for (const surface of [t.bg, t.card, t.surfaceSecondary, t.tint]) {
      expect(ratio(t.ink, surface)).toBeGreaterThanOrEqual(7);
      expect(ratio(t.muted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.accent, surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const [fg, bg] of [[t.danger, t.dangerBg], [t.success, t.successBg], [t.warning, t.warningBg], [t.info, t.infoBg]]) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    for (const tone of Object.values(tones)) expect(ratio(tone.ink, tone.to)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.onPrimary, t.primary[0])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.onPrimary, t.accentFill)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.onPrimary, t.dangerFill)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(themes.light.t.onPrimary, themes.light.t.accentFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('the world keeps its own clock: nothing that decides day, night or weather reads the theme', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', 'src');
    // What decides how the world looks: the hour's light, the sky, the weather, the mood of a room. (diorama.tsx and
    // living.tsx also hold the panels floating over the scenes, which are interface and do follow the theme.)
    const deciding = ['world/atmosphere.ts', 'world/sky.tsx', 'world/liveSky.tsx', 'world/weather.tsx', 'world/GlassSky.tsx', 'world/budget.ts',
      'world/motion.ts', 'world/petMachine.ts', 'components/daylight.ts', 'components/useDayPeriod.ts'];
    for (const file of deciding) expect([file, /ui\/theme|useTheme|makeStyles/.test(fs.readFileSync(path.join(root, file), 'utf8'))]).toEqual([file, false]);
  });
});
