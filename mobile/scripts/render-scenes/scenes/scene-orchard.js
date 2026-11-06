// Vườn tài chính: the garden's land, an endless strip the plants stand on and scroll with: hills, a rise with trees, a picket fence, and a lawn in
// front with room for the plants. The sky is left out: the app draws the real one.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night, start: 37 });
  const { reseed, between, rnd, tmp, place, box, cyl, roundTree, pine, bush, tones, finish } = v;

  const SPAN = 6, TAU = Math.PI * 2;
  const wave = (x, k, ph) => Math.sin(x * TAU * k / SPAN + ph);
  const grain = (x, z) => wave(x, 1, z * 0.9) * 0.34 + wave(x, 3, z * 1.7 + 1) * 0.26 + wave(x, 7, z * 3.1 + 2) * 0.16 + Math.sin(z * 2.3 + 0.4) * 0.14;
  let count = 0;
  const each = (fn) => { const id = 700 + (count++) * 37; [-SPAN, 0, SPAN].forEach((d) => { reseed(id); fn(d); }); };
  const elev = 0.34, lift = 0.7;
  const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40 + lift, Math.cos(elev) * 40], [0, lift, 0]);
  const tall = SPAN * H / W;
  const reach = (r, z) => (0.5 - r) * tall / Math.cos(elev) + lift + z * Math.tan(elev);
  // The fence's depth: whatever falls on this row at ground height.
  const FENCE_ROW = 0.6;
  const fenceZ = -(0.5 - FENCE_ROW) * tall / Math.sin(elev) - lift / Math.tan(elev);
  const zb = fenceZ - 9, y1 = reach(0.255, zb);
  const rise = (x, z) => { const t = Math.max(0, Math.min(1, (z - (fenceZ - 0.6)) / (zb - (fenceZ - 0.6)))); return t * t * (y1 + 0.16 * wave(x, 1, 0.9) + 0.07 * wave(x, 2, 2.4)); };
  {
    const g = new THREE.PlaneGeometry(SPAN * 3, fenceZ + 8 - zb, 900, 340);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, (zb + fenceZ + 8) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, rise(p.getX(i), p.getZ(i)) + 0.012 * wave(p.getX(i), 4, p.getZ(i) * 2));
    g.computeVertexNormals();
    const A = new THREE.Color(0x7fae5c), B = new THREE.Color(0x9cc26c), C = new THREE.Color(0xb3cc7e), Far = new THREE.Color(0xa6c88e);
    place(g, (c, x, y, z) => {
      const n = grain(x, z);
      c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n)));
      if (n > 0.3) c.lerp(C, Math.min(1, (n - 0.3) * 1.6));
      c.lerp(Far, Math.max(0, Math.min(0.7, (fenceZ - 1 - z) / 8)));
    });
  }
  const wall = (z, r, amp, ph, colour) => {
    const y0 = reach(r, z);
    const g = new THREE.PlaneGeometry(SPAN * 4, 40, 480, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i); p.setY(i, y0 + amp * (wave(x, 1, ph) * 0.6 + wave(x, 2, ph * 2) * 0.28 + wave(x, 5, ph) * 0.1)); } else p.setY(i, y0 - 40);
    g.computeVertexNormals();
    place(g, colour, { z });
  };
  wall(zb - 12, 0.11, 0.26, 2.6, night ? 0x8fa8c8 : 0xc4e0d2);
  wall(zb - 6, 0.17, 0.22, 1, night ? 0x7f9cb4 : 0xa9cfae);

  // The rise: trees and pines, smaller as they go up it.
  [[-2.35, fenceZ - 2.4, 1.05, 'oak'], [-0.6, fenceZ - 3.2, 0.9, 'blossom'], [1.15, fenceZ - 2.2, 1.1, 'lime'], [2.5, fenceZ - 3.5, 0.84, 'deep'], [-1.5, fenceZ - 5.2, 0.7, 'lime'], [0.35, fenceZ - 5.6, 0.66, 'oak'], [1.85, fenceZ - 6, 0.62, 'deep'], [-2.8, fenceZ - 6.4, 0.6, 'deep']].forEach(([x, z, s, k]) => each((d) => roundTree(x + d, z, s * 0.74, k, rise(x, z))));
  [[-1.45, fenceZ - 2.9, 0.92], [0.28, fenceZ - 2.5, 0.82], [2.05, fenceZ - 2.7, 0.9], [-0.55, fenceZ - 6, 0.6], [1.0, fenceZ - 4.6, 0.72], [-2.4, fenceZ - 4.5, 0.72]].forEach(([x, z, s]) => each((d) => pine(x + d, z, s * 0.74, rise(x, z))));

  // The picket fence along the whole garden, with a gate's pair of posts, and bushes tied to it.
  const WOOD = 0xf4efe2, WOOD2 = 0xe7e0cf;
  each((d) => {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const x = -SPAN / 2 + (i + 0.5) * SPAN / n + d;
      if (Math.abs(x - d - 1.2) < 0.2) continue;
      box(0.07, 0.3, 0.018, between(0, 1) < 0.5 ? WOOD : WOOD2, { x, y: 0.15, z: fenceZ, r: 0.008 });
      place(new THREE.ConeGeometry(0.05, 0.05, 4), WOOD, { x, y: 0.32, z: fenceZ, ry: Math.PI / 4 });
    }
  });
  each((d) => {
    box(SPAN + 0.02, 0.035, 0.016, WOOD2, { x: d, y: 0.2, z: fenceZ - 0.016, r: 0.005 });
    box(SPAN + 0.02, 0.035, 0.016, WOOD2, { x: d, y: 0.09, z: fenceZ - 0.016, r: 0.005 });
    [0.98, 1.42].forEach((x) => box(0.09, 0.4, 0.09, WOOD, { x: x + d, y: 0.2, z: fenceZ, r: 0.02 }));
  });
  [[-2.5, -0.18, 1.05, 'deep'], [-1.72, -0.16, 0.85, 'oak'], [-0.9, -0.2, 1.1, 'lime'], [0.08, -0.18, 0.95, 'deep'], [2.1, -0.2, 1.15, 'oak'], [2.8, -0.16, 0.9, 'lime']].forEach(([x, dz, s, k]) => each((d) => bush(x + d, fenceZ + dz, s, k)));
  // Stones from the gate down into the lawn; a little wheelbarrow path.
  each((d) => {
    for (let i = 0; i < 6; i++) {
      const z = fenceZ + 0.22 + i * 0.42, x = 1.2 + Math.sin(i * 0.9) * 0.08;
      place(new THREE.CylinderGeometry(0.1, 0.115, 0.02, 14), (c) => c.set(0xcfc8b6).multiplyScalar(between(0.94, 1.02)), { x: x + d, y: 0.012, z, sx: 1.3, sz: 0.74 });
    }
  });
  // Low flowers along the fence and all over the lawn; tufts of grass; a few pebbles. The plants stand on this.
  const flower = new THREE.SphereGeometry(0.03, 8, 6), leaf = new THREE.SphereGeometry(0.035, 8, 6), tuft = new THREE.ConeGeometry(0.024, 0.08, 6), dot = new THREE.SphereGeometry(0.024, 8, 6);
  each((d) => {
    for (let i = 0; i < 90; i++) {
      const x = between(-3, 3), z = fenceZ + between(0.08, 0.3);
      if (Math.abs(x - 1.2) < 0.26) continue;
      place(rnd() < 0.55 ? flower : leaf, (c) => c.set(rnd() < 0.5 ? tones[Math.floor(rnd() * 4)] : 0x6f9f52), { x: x + d, y: between(0.04, 0.09), z });
    }
    for (let i = 0; i < 620; i++) {
      const x = between(-3, 3), z = rnd() < 0.3 ? between(fenceZ - 1.8, fenceZ - 0.2) : between(fenceZ + 0.34, fenceZ + 7.5);
      if (rnd() < 0.28) place(dot, tones[Math.floor(rnd() * 4)], { x: x + d, y: rise(x, z) + 0.03, z });
      else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x: x + d, y: rise(x, z) + 0.055, z, rz: between(-0.25, 0.25) });
    }
  });
  finish();
  window.__rect = JSON.stringify({ fence: FENCE_ROW });
  return cam;
}
