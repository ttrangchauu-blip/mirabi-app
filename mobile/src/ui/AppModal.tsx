import React from 'react';
import { Modal, ModalProps } from 'react-native';

/** Native: the system Modal already covers exactly the app. The web build (AppModal.web.tsx) keeps modals inside the app's view. */
export function ModalHost({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function AppModal(props: ModalProps) {
  return <Modal {...props} />;
}
