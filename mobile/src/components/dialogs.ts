import { Alert, AlertButton, Platform } from 'react-native';
import { confirmInApp } from '../ui/ConfirmDialog';

/**
 * Alert.alert on native; on web (where react-native-web's Alert is a no-op) the app's own dialog, so messages and
 * confirmations stay inside the app instead of opening the browser's alert/confirm.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const action = buttons?.find((b) => b.style !== 'cancel');
  const cancel = buttons?.find((b) => b.style === 'cancel');
  const shown = confirmInApp({
    title, message: message ?? '',
    confirmLabel: action?.text ?? 'Đã hiểu',
    cancelLabel: cancel ? cancel.text ?? 'Hủy' : null,
    icon: cancel ? 'help-circle-outline' : 'information-circle-outline',
    destructive: action?.style === 'destructive',
  });
  if (shown) {
    // A notice has nothing to cancel: closing it either way counts as acknowledging it.
    void shown.then((ok) => (ok || !cancel ? action?.onPress?.() : cancel.onPress?.()));
    return;
  }
  // No app mounted yet: the browser dialog is the only way to tell the user.
  const text = [title, message].filter(Boolean).join('\n\n');
  if (!cancel) {
    window.alert(text);
    action?.onPress?.();
  } else if (window.confirm(text)) {
    action?.onPress?.();
  } else {
    cancel.onPress?.();
  }
}
