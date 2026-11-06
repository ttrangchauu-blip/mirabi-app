// Three fluffy clouds side by side, cut apart afterwards, for the app to drift across its live sky. Lit from the same upper left as the yard.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  if (light === 'night') sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0xbfe2fa, mid: 0xf2f9fd, low: 0xd8ecf8, power: 0.95, sun: { dir: [-0.5, 0.72, 0.62], size: 16, power: 22, color: 0xfff6e8 } });
  const v = village(THREE, scene, { start: 5 });
  const { blob, reseed, between, finish } = v;
  const puff = (r, x, y, z) => blob(r, x, y, z, 0xdbeaf6, 0xffffff, { rough: 0.09 });
  const cloud = (cx, wide, tall, n, start) => {
    reseed(start);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, u = t * 2 - 1, top = Math.sqrt(Math.max(0.02, 1 - u * u));
      const r = (0.13 + 0.17 * top * tall) * between(0.86, 1.14);
      puff(r, cx + u * wide * 0.5, r * 0.75 + between(0, 0.05), between(-0.05, 0.05));
      if (top > 0.45) puff(r * 0.8, cx + u * wide * 0.42 + between(-0.05, 0.05), r * 1.2 + 0.1 * tall * top + 0.06, between(-0.06, 0.03));
    }
  };
  cloud(-1.6, 1.15, 1.0, 9, 11);
  cloud(0, 1.1, 1.25, 8, 17);
  cloud(1.6, 1.05, 0.72, 8, 23);
  finish();
  return flatCamera(4.8, W, H, [0, 0.3, 30], [0, 0.3, 0]);
}
