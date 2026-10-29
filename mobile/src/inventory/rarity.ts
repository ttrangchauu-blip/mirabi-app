/** How each rarity looks: always its name and its colour together, never the colour alone. Text colours keep at
 * least 4.5:1 contrast on their background and on white. */
export type Rarity = 'common' | 'rare' | 'special' | 'legendary';
export const RARITY: Record<string, { label: string; color: string; bg: string; border: string }> = {
  common: { label: 'Thường', color: '#3F6079', bg: '#E5EEF5', border: '#B9CCDB' },
  rare: { label: 'Hiếm', color: '#0B65A3', bg: '#D6ECFA', border: '#7DBBE6' },
  special: { label: 'Đặc biệt', color: '#6A2FB8', bg: '#EDE2FF', border: '#B795EC' },
  legendary: { label: 'Huyền thoại', color: '#A04A00', bg: '#FFE7BF', border: '#F0AE45' },
  // Finds from before the catalog.
  epic: { label: 'Đặc biệt', color: '#6A2FB8', bg: '#EDE2FF', border: '#B795EC' },
};
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'special', 'legendary'];
export const rarityOf = (id: string) => RARITY[id] ?? RARITY.common;
