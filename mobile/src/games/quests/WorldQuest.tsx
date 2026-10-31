import React from 'react';
import { ForestQuest } from '../ForestQuest';
import { KingdomQuest } from './KingdomQuest';
import { LabQuest } from './LabQuest';
import { MapQuest } from './MapQuest';
import type { QuestProps } from './QuestProps';
import { SpaceQuest } from './SpaceQuest';
import { TimeQuest } from './TimeQuest';
import type { World } from './worlds';

/** The scene of a lesson's world above its game (`kind` is the turn's: Word Forest opens doors for Sắp xếp and frees a
 * creature for the others). One per stage: give it no key, so it carries on from one question to the next. */
export function WorldQuest({ world, kind, ...props }: QuestProps & { world: World; kind: string }) {
  switch (world) {
    case 'kingdom': return <KingdomQuest {...props} />;
    case 'space': return <SpaceQuest {...props} />;
    case 'lab': return <LabQuest {...props} />;
    case 'time': return <TimeQuest {...props} />;
    case 'map': return <MapQuest {...props} />;
    case 'forest': return <ForestQuest quest={kind === 'order_steps' ? 'door' : 'rescue'} {...props} />;
  }
}
