import type { IconName } from './ui/kit';

// Main menu. Keys are internal ids; labels are what users see (also used by the welcome tour).
// Courses live inside "Học tập".
export const TABS: readonly { key: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: 'Home', label: 'Trang chủ', icon: 'home-outline', iconActive: 'home' },
  { key: 'Study', label: 'Học tập', icon: 'book-outline', iconActive: 'book' },
  // Drawn by RoomTabIcon (a house with a heart), so it never looks like "Trang chủ"; the Ionicons are a fallback.
  { key: 'Room', label: 'Phòng cá nhân', icon: 'home-outline', iconActive: 'home' },
  // "Bạn bè" (friends first, then the post feed); the key stays "Community" internally.
  { key: 'Community', label: 'Bạn bè', icon: 'people-outline', iconActive: 'people' },
  { key: 'More', label: 'Tiện ích', icon: 'grid-outline', iconActive: 'grid' },
] as const;

// "Phòng cá nhân" took the place of "Nghề nghiệp" in the menu; CareerTab and its API are kept, just not in the menu.
export type TabKey = 'Home' | 'Study' | 'Room' | 'Community' | 'More';

export const tabLabel = (key: TabKey) => TABS.find((t) => t.key === key)!.label;
