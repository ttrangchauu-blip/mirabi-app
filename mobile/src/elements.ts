// Pet elements. Color/icon values are used across the pet cards and picker.
export type ElementId = 'water' | 'fire' | 'grass' | 'ice' | 'electric' | 'mist';
export type Element = { id: ElementId; label: string; icon: string; color: string; bg: string; halo: readonly [string, string, string] };

export const ELEMENTS: Record<ElementId, Element> = {
  water: { id: 'water', label: 'N\u01b0\u1edbc', icon: '\u{1F4A7}', color: '#1559A8', bg: '#E2F1FD', halo: ['#CDEBFF', '#93CDF5', '#DAF2FF'] },
  fire: { id: 'fire', label: 'L\u1eeda', icon: '\u{1F525}', color: '#B23A0A', bg: '#FFEBDD', halo: ['#FFE3CC', '#FFC596', '#FFEEDD'] },
  grass: { id: 'grass', label: 'C\u1ecf', icon: '\u{1F33F}', color: '#22703A', bg: '#E3F5E6', halo: ['#D9F2D3', '#A8DE9E', '#E8F8E3'] },
  ice: { id: 'ice', label: 'B\u0103ng', icon: '\u2744\uFE0F', color: '#0B6577', bg: '#DFF6FA', halo: ['#DFF7FC', '#A6E2F0', '#EEFBFE'] },
  electric: { id: 'electric', label: '\u0110i\u1ec7n', icon: '\u26A1', color: '#7A4D00', bg: '#FFF4CC', halo: ['#FFF3C4', '#FFDF85', '#FFF8DD'] },
  mist: { id: 'mist', label: 'S\u01b0\u01a1ng', icon: '\u{1F32B}\uFE0F', color: '#5141A8', bg: '#EEEAFF', halo: ['#ECE8FC', '#CFC7F3', '#F5F2FE'] },
};
