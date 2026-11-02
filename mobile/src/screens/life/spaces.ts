/** The four places of Cuộc sống Mirabi. Moving between them is the only navigation inside the tab. */
export type LifeSpace = 'home' | 'garden' | 'explore' | 'friends';

export const SPACES: readonly { id: LifeSpace; label: string; title: string }[] = [
  { id: 'home', label: 'Nhà', title: 'Nhà của pet' },
  { id: 'garden', label: 'Vườn', title: 'Vườn nhà' },
  { id: 'explore', label: 'Khám phá', title: 'Khám phá' },
  { id: 'friends', label: 'Bạn bè', title: 'Bạn bè' },
] as const;

/** What the switcher takes under the safe area: every space starts its own content below this. */
export const SWITCHER_HEIGHT = 50;
export const SWITCHER_TOP = 6;
export const lifeTop = (insetTop: number) => insetTop + SWITCHER_TOP + SWITCHER_HEIGHT;
