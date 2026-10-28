import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider, useMuteToasts, useToast } from '../src/ui/Toast';

function Harness() {
  const toast = useToast(); const mute = useMuteToasts();
  return <>
    <Pressable accessibilityRole="button" onPress={() => toast('Xin chào')}><Text>show</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => mute(true)}><Text>mute</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => mute(false)}><Text>unmute</Text></Pressable>
  </>;
}

test('muted toasts are dropped and the visible one is hidden until unmuted', () => {
  render(<SafeAreaProvider><ToastProvider><Harness /></ToastProvider></SafeAreaProvider>);
  fireEvent.press(screen.getByText('show'));
  expect(screen.getByRole('alert', { name: 'Xin chào' })).toBeTruthy();
  act(() => { fireEvent.press(screen.getByText('mute')); });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.press(screen.getByText('show'));
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.press(screen.getByText('unmute'));
  fireEvent.press(screen.getByText('show'));
  expect(screen.getByRole('alert', { name: 'Xin chào' })).toBeTruthy();
});
