import React from 'react';
import { render } from '@testing-library/react-native';
import {
  ArenaLayer, CrystalKing, CrystalShield, Drake, Golem, Impact, MagicBolt, MONSTER_ART, MonsterId, Mushroom,
  ShadowSpirit, Slime, Sparkle, Zone,
} from '../src/games/art/mathBattle';

const MOODS = ['idle', 'attack', 'hurt', 'defeated'] as const;
const ZONES: Zone[] = ['forest', 'cave', 'castle', 'boss'];
const LAYERS = ['sky', 'far', 'mid', 'near'] as const;

describe('math battle art', () => {
  const monsters = { Slime, Mushroom, Golem, ShadowSpirit, Drake, CrystalKing };

  it.each(Object.entries(monsters))('draws %s in every mood', (_name, Art) => {
    for (const mood of MOODS) expect(() => render(<Art size={120} mood={mood} />)).not.toThrow();
    expect(() => render(<Art size={64} />)).not.toThrow();
  });

  it('names every monster in Vietnamese and points at its art', () => {
    const ids: MonsterId[] = ['slime', 'mushroom', 'golem', 'shadow', 'drake', 'boss'];
    expect(Object.keys(MONSTER_ART).sort()).toEqual([...ids].sort());
    expect(MONSTER_ART.boss.name).toBe('Vua Pha Lê');
    expect(MONSTER_ART.boss.Art).toBe(CrystalKing);
    for (const id of ids) expect(() => render(React.createElement(MONSTER_ART[id].Art, { size: 90, mood: 'attack' }))).not.toThrow();
  });

  it.each(ZONES)('draws every %s arena layer', (zone) => {
    for (const layer of LAYERS) expect(() => render(<ArenaLayer zone={zone} layer={layer} width={390} height={260} />)).not.toThrow();
  });

  it('keeps every scrolling arena layer light enough for phones', () => {
    type Node = { type: string; children: (Node | string)[] | null };
    const count = (node: Node | string | null): number => !node || typeof node === 'string'
      ? 0 : 1 + (node.children ?? []).reduce((sum: number, child) => sum + count(child), 0);
    const counts: Record<string, number> = {};
    for (const zone of ZONES) for (const layer of LAYERS) {
      counts[`${zone}/${layer}`] = count(render(<ArenaLayer zone={zone} layer={layer} width={390} height={260} />).toJSON() as Node | null);
    }
    for (const n of Object.values(counts)) expect(n).toBeLessThan(80);
  });

  it('draws nothing for a zero-sized arena', () => {
    expect(() => render(<ArenaLayer zone="forest" layer="near" width={0} height={260} />)).not.toThrow();
  });

  it('draws every effect', () => {
    expect(() => render(<MagicBolt size={40} />)).not.toThrow();
    expect(() => render(<MagicBolt size={40} color="#FF9EC4" />)).not.toThrow();
    expect(() => render(<Impact size={40} />)).not.toThrow();
    expect(() => render(<Impact size={40} color="#8FD3FF" />)).not.toThrow();
    expect(() => render(<Sparkle size={24} />)).not.toThrow();
    expect(() => render(<Sparkle size={24} color="#C9C1FF" />)).not.toThrow();
    expect(() => render(<CrystalShield size={120} />)).not.toThrow();
  });
});
