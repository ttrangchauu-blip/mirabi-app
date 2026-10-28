import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Modal, ModalProps, StyleSheet, View } from 'react-native';

// react-dom comes with react-native-web; its type package is not installed.
const { createPortal } = require('react-dom') as { createPortal: (children: React.ReactNode, container: Element) => React.ReactPortal };

const HostContext = createContext<HTMLElement | null>(null);
// Open modals, newest last: Escape closes only the top one.
const openModals: object[] = [];

/**
 * Web: react-native-web's Modal portals to <body>, so it would cover the whole browser window instead of the
 * phone frame. Modals render into this layer instead, which sits over the app inside its own view.
 */
export function ModalHost({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <HostContext.Provider value={host}>
      <View style={styles.fill}>
        {children}
        <View ref={setHost as unknown as React.Ref<View>} pointerEvents="box-none" style={StyleSheet.absoluteFill} />
      </View>
    </HostContext.Provider>
  );
}

export function AppModal({ visible = true, transparent, onRequestClose, children }: ModalProps) {
  const host = useContext(HostContext);
  const onClose = useRef(onRequestClose);
  onClose.current = onRequestClose;
  useEffect(() => {
    if (!visible) return;
    const token = {};
    openModals.push(token);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openModals[openModals.length - 1] === token) onClose.current?.(event as never);
    };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); openModals.splice(openModals.indexOf(token), 1); };
  }, [visible]);
  if (!visible) return null;
  if (!host) return <Modal visible transparent={transparent} onRequestClose={onRequestClose}>{children}</Modal>;
  return createPortal(
    <View style={[StyleSheet.absoluteFill, !transparent && styles.opaque]} accessibilityViewIsModal>{children}</View>, host);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  opaque: { backgroundColor: '#FFFFFF' },
});
