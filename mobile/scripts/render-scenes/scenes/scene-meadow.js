// Vườn tài chính's near lawn, an endless strip the plants stand on and scroll with: grass, small flowers and a trail of flat stones along its front. It repeats exactly
// every SPAN, so it is seen without perspective, and what lies further back is simply made smaller, as a lens would. The app fades its top into the valley behind it.
import { kit } from './kit.js';
import { village } from './village.js';
import { lawnPaint, light as lightOf, PITCH_DEG } from './grove-kit.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const night = light === 'night';
  lightOf(sky, night);
  const v = village(THREE, scene, { night, start: 61 });
  const { reseed, rnd, between, tmp, place, lumps, finish } = v;
  const SPAN = 6.4, TAU = Math.PI * 2, wave = (x, k, ph) => Math.sin((x * TAU * k) / SPAN + ph);
  const pitch = PITCH_DEG * Math.PI / 180, tall = (SPAN * H) / W, depth = tall / Math.sin(pitch);
  const Z0 = -depth / 2, Z1 = depth / 2;
  const nearness = (z) => Math.max(0, Math.min(1, (z - Z0) / depth));
  const paint = lawnPaint(THREE, (x, z) => wave(x, 1, z * 1.7) * 0.14 + wave(x, 3, z * 2.3 + 1) * 0.2 + wave(x, 6, z * 4.3 + 2) * 0.14);
  const Far = new THREE.Color(0x98cc62);
  {
    const g = new THREE.PlaneGeometry(SPAN * 3, depth + 8, 900, 420);
    g.rotateX(-Math.PI / 2);
    place(g, (c, x, y, z) => { paint(c, x, z); c.lerp(Far, Math.max(0, 0.45 - nearness(z) * 0.9)); });
  }
  const each = (fn, id) => [-SPAN, 0, SPAN].forEach((d) => { reseed(id); fn(d); });
  // The flat stones, in a wandering line along the front; each of its own shape, half sunk.
  const trailZ = (x) => Z0 + depth * 0.84 + 0.2 * wave(x, 1, 0.8) + 0.09 * wave(x, 2, 2);
  const stone = new THREE.CylinderGeometry(1, 1.06, 0.1, 24, 2);
  each((d) => {
    for (let i = 0; i < 9; i++) {
      const x = -SPAN / 2 + ((i + 0.5) * SPAN) / 9 + between(-0.06, 0.06), z = trailZ(x) + between(-0.05, 0.05), s = between(0.21, 0.27), tone = between(0.93, 1.03);
      place(stone, (c, X, Y, Z) => c.set(0xecdfbf).lerp(tmp.set(0xc7b793), Y < 0.02 ? 0.7 : 0.1 + Math.max(0, lumps(X * 7, Z * 7, 1)) * 0.3).multiplyScalar(tone), { x: x + d, y: 0.024, z, sx: s * 1.28, sz: s, sy: 0.72, ry: between(-0.3, 0.3) });
    }
  }, 401);
  // Grass and flowers, finer further back.
  const tuft = new THREE.ConeGeometry(0.028, 0.13, 5), dot = new THREE.SphereGeometry(0.03, 8, 6), bladeBall = new THREE.SphereGeometry(0.036, 8, 6);
  each((d) => {
    for (let i = 0; i < 3400; i++) {
      const x = between(-SPAN / 2, SPAN / 2), z = between(Z0, Z1 + 0.3), k = 0.5 + nearness(z) * 0.75;
      if (Math.abs(z - trailZ(x)) < 0.26) continue;
      if (rnd() < 0.05) place(dot, (c) => c.set([0xfffdf2, 0xffc6dc, 0xffe36a, 0xffffff][i % 4]), { x: x + d, y: 0.07 * k, z, sx: k, sy: k, sz: k });
      else place(tuft, (c) => c.set(0x5da232).lerp(tmp.set(0xb6e35a), rnd()), { x: x + d, y: 0.06 * k, z, sx: k, sy: k * between(0.8, 1.4), sz: k, rz: between(-0.32, 0.32), rx: between(-0.2, 0.2) });
    }
    // A few small daisies in tight groups, and a pebble or two by the trail.
    for (let g = 0; g < 7; g++) {
      const gx = between(-SPAN / 2, SPAN / 2), gz = between(Z0 + depth * 0.35, Z1 - 0.2), k = 0.6 + nearness(gz) * 0.7;
      for (let i = 0; i < 5; i++) {
        const x = gx + between(-0.13, 0.13), z = gz + between(-0.1, 0.1);
        for (let p = 0; p < 6; p++) { const a = (p / 6) * TAU; place(bladeBall, g % 2 ? 0xfffdf4 : 0xffc2d8, { x: x + d + Math.cos(a) * 0.036 * k, y: 0.1 * k, z: z + Math.sin(a) * 0.03 * k, sx: 0.66 * k, sy: 0.36 * k, sz: 0.66 * k }); }
        place(bladeBall, 0xf6c438, { x: x + d, y: 0.112 * k, z, sx: 0.46 * k, sy: 0.4 * k, sz: 0.46 * k });
      }
    }
    for (let i = 0; i < 6; i++) { const x = between(-SPAN / 2, SPAN / 2), z = trailZ(x) + (rnd() < 0.5 ? -0.3 : 0.3), s = between(0.05, 0.1); place(new THREE.IcosahedronGeometry(1, 2), (c) => c.set(0xd9d6cb).multiplyScalar(between(0.88, 1.05)), { x: x + d, y: s * 0.32, z, sx: s, sy: s * 0.68, sz: s * 0.85 }); }
  }, 433);
  finish();
  return flatCamera(SPAN, W, H, [0, Math.sin(pitch) * 40, Math.cos(pitch) * 40], [0, 0, 0]);
}
