import React, { memo } from 'react';
import type { Light } from '../components/daylight';
import { CloudDeck } from './living';
import { SkyBodies, Stars } from './sky';

/** The live sky, by the clock and the weather; a rendered land whose ridge is at `ridge` stands in front of it. */
export const LiveSky = memo(function LiveSky({ id, width, ridge, hours, c, cover }: { id: string; width: number; ridge: number; hours: number; c: Light; cover: number }) {
  return <>
    {c.stars > 0 ? <Stars width={width} height={ridge} opacity={c.stars} scale={ridge / 50} /> : null}
    <SkyBodies width={width} hours={hours} c={c} horizon={ridge + 8} zenith={14} clip={ridge + 24} body={56} idPrefix={id} />
    {/* More than the weather's own share, so the wider sky is never empty. */}
    <CloudDeck width={width} top={12} color={c.cloud} opacity={c.cloudOpacity} cover={Math.max(cover, 0.5)} scale={0.8} />
  </>;
});
