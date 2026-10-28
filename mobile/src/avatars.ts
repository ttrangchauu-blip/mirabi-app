// Preset profile pictures. Ids are stored in users.avatar_theme; keep in sync with AvatarId in backend/app/schemas.py.
// Presets without an emoji show the user's initial in white, so their gradients stay dark enough for white text.
export type AvatarPreset = { id: string; label: string; colors: readonly [string, string]; emoji?: string };

export const AVATARS: readonly AvatarPreset[] = [
  { id: 'aqua', label: 'Biển xanh', colors: ['#7CC8EE', '#1A7BBF'] },
  { id: 'sunset', label: 'Hoàng hôn', colors: ['#F59E7A', '#C2416B'] },
  { id: 'forest', label: 'Rừng xanh', colors: ['#6CC08E', '#22703A'] },
  { id: 'lavender', label: 'Oải hương', colors: ['#A897F0', '#5141A8'] },
  { id: 'fox', label: 'Cáo nhỏ', emoji: '🦊', colors: ['#FFEEDD', '#FFC596'] },
  { id: 'cat', label: 'Mèo con', emoji: '🐱', colors: ['#F5F2FE', '#CFC7F3'] },
  { id: 'bunny', label: 'Thỏ con', emoji: '🐰', colors: ['#FFF8DD', '#FFDF85'] },
  { id: 'penguin', label: 'Cánh cụt', emoji: '🐧', colors: ['#EEFBFE', '#A6E2F0'] },
  { id: 'dolphin', label: 'Cá heo', emoji: '🐬', colors: ['#DAF2FF', '#93CDF5'] },
  { id: 'turtle', label: 'Rùa nhỏ', emoji: '🐢', colors: ['#E8F8E3', '#A8DE9E'] },
  { id: 'star', label: 'Ngôi sao', emoji: '⭐', colors: ['#FFF3C4', '#FFC94D'] },
  { id: 'flower', label: 'Hoa anh đào', emoji: '🌸', colors: ['#FFEAF2', '#FFB3CF'] },
];

/** Unknown ids (e.g. a newer server) fall back to the default rather than breaking the UI. */
export const avatarById = (id?: string | null): AvatarPreset => AVATARS.find((a) => a.id === id) ?? AVATARS[0];
