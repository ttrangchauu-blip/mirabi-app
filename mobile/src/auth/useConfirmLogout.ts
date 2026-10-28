import { useConfirm } from '../ui/ConfirmDialog';
import { useAuth } from './AuthContext';

/** Logout behind the in-app confirmation dialog. */
export function useConfirmLogout() {
  const { logout, user } = useAuth();
  const confirm = useConfirm();
  return async () => {
    const ok = await confirm({
      title: 'Đăng xuất?',
      message: `Bạn có chắc muốn đăng xuất khỏi Mirabi?${user?.pet_name ? ` ${user.pet_name} sẽ chờ bạn quay lại nhé!` : ''}`,
      confirmLabel: 'Đăng xuất',
      icon: 'log-out-outline',
      destructive: true,
    });
    if (ok) await logout();
  };
}
