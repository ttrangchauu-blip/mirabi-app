import type { IconName } from './ui/kit';

// Main menu. Keys are internal ids; labels are what users see (also used by the welcome tour).
// Courses live inside "Học tập"; the pet's home, the garden, exploring and friends are the four places of "Cuộc sống".
export const TABS: readonly { key: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: 'Home', label: 'Trang chủ', icon: 'home-outline', iconActive: 'home' },
  { key: 'Study', label: 'Học tập', icon: 'book-outline', iconActive: 'book' },
  // Drawn by RoomTabIcon (a house with a heart), so it never looks like "Trang chủ"; the Ionicons are a fallback.
  { key: 'Room', label: 'Cuộc sống', icon: 'home-outline', iconActive: 'home' },
  { key: 'More', label: 'Tiện ích', icon: 'grid-outline', iconActive: 'grid' },
] as const;

export type TabKey = 'Home' | 'Study' | 'Room' | 'More';

export const tabLabel = (key: TabKey) => TABS.find((t) => t.key === key)!.label;
