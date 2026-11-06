// A subject's map in Học tập: a hillside seen from above at an angle, long enough for any number of lessons. The picture is 1170 by 1755: the
// top third has the ridge (the sky is left out), the rest is a tile that repeats going down, trees on both sides and open grass in the middle.
// `&part=stones` instead makes the points of the map on black: the four kinds of platform and two stepping stones in a row.
import { kit } from './kit.js';
import { village } from './village.js';

export const TOP_SHARE = 1 / 3;
export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'land';
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night, start: 61 });
  const { reseed, between, rnd, tmp, place, box, cyl, ball, roundTree, pine, bush, tones, finish } = v;
  const elev = 0.72;

  if (part === 'stones') {
    // Each kind stands in its own cell of a 6-wide row, seen by the same camera as the land.
    const SPAN = 6, cell = SPAN / 6;
    const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40, Math.cos(elev) * 40], [0, 0, 0]);
    const paint = (top, side) => (c, x, y, z, nx, ny) => c.set(ny > 0.6 ? top : side);
    const platform = (i, top, side) => {
      const x = -SPAN / 2 + cell * (i + 0.5), r = 0.36;
      // A low cut stone, on a rougher base, with pebbles at its foot.
      const base = new THREE.LatheGeometry([[0, 0], [r + 0.05, 0], [r + 0.045, 0.05], [r + 0.015, 0.086], [0, 0.086]].map(([a, b]) => new THREE.Vector2(a, b)), 48);
      base.computeVertexNormals();
      place(base, (c, X, Y, Z) => c.set(0xc3bcab).multiplyScalar(0.95 + 0.06 * Math.sin(X * 31 + Z * 37)), { x });
      const body = new THREE.LatheGeometry([[0, 0], [r, 0], [r + 0.012, 0.018], [r + 0.012, 0.09], [r - 0.002, 0.118], [r - 0.03, 0.128], [0, 0.128]].map(([a, b]) => new THREE.Vector2(a, b)), 48);
      body.computeVertexNormals();
      place(body, paint(top, side), { x, y: 0.08 });
      // A lighter ring on the face, so what is drawn on it has somewhere to sit.
      const ring = new THREE.TorusGeometry(r - 0.075, 0.009, 8, 48); ring.rotateX(Math.PI / 2);
      place(ring, tmp.set(top).lerp(new THREE.Color(0xffffff), 0.42).getHex(), { x, y: 0.208 });
      [[-0.34, 0.27, 0.035], [0.37, 0.2, 0.026], [0.3, 0.33, 0.02]].forEach(([dx, dz, s]) => place(new THREE.IcosahedronGeometry(s, 1), 0xcfc8b6, { x: x + dx, y: s * 0.7, z: dz, sy: 0.7 }));
    };
    // Chưa mở, đã mở, đang học, hoàn thành.
    platform(0, 0xc9cfd4, 0x98a2ab); platform(1, 0x4f9fd0, 0x2f77a6); platform(2, 0xf1b24a, 0xc98728); platform(3, 0x4cb889, 0x2d8a62);
    [4, 5].forEach((i) => {
      const x = -SPAN / 2 + cell * (i + 0.5);
      const g = new THREE.LatheGeometry([[0, 0], [0.23, 0], [0.225, 0.03], [0.2, 0.052], [0, 0.056]].map(([a, b]) => new THREE.Vector2(a, b)), 30); g.computeVertexNormals();
      place(g, (c, X, Y, Z) => c.set(0xd6cfbf).multiplyScalar(0.94 + 0.08 * Math.sin(X * 19 + Z * 23)), { x, ry: i, sx: i === 4 ? 1.08 : 0.94, sz: i === 4 ? 0.74 : 0.84 });
    });
    finish();
    window.__rect = JSON.stringify({ cell: 1 / 6 });
    return cam;
  }

  const SPAN = 6, TAU = Math.PI * 2;
  const tall = SPAN * H / W;
  const lift = 0;
  const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 60, Math.cos(elev) * 60], [0, 0, 0]);
  // A picture row on flat ground: its depth. A full tile is SPAN of screen, so PZ of ground.
  const zOfRow = (r) => -(0.5 - r) * tall / Math.sin(elev);
  const PZ = SPAN / Math.sin(elev);
  const wave = (z, k, ph) => Math.sin((z * TAU * k) / PZ + ph);
  const grain = (x, z) => wave(z, 1, x * 0.9) * 0.3 + wave(z, 3, x * 1.7 + 1) * 0.24 + wave(z, 7, x * 3.1 + 2) * 0.16 + Math.sin(x * 2.3 + 0.4) * 0.16;
  // The ground starts to rise a little above where the tile begins, up to a ridge near the top of the picture.
  const Z0 = zOfRow(0.27), Z1 = zOfRow(0.135);
  const hillY = (x, z) => { const t = Math.max(0, Math.min(1, (Z0 - z) / (Z0 - Z1))); return t * t * (0.72 + 0.1 * Math.sin(x * 1.1 + 0.8) + 0.04 * Math.sin(x * 2.7 + 2)); };
  const zNear = zOfRow(1.05), zFar = Z1;
  {
    const g = new THREE.PlaneGeometry(SPAN * 1.3, zNear - zFar, 300, 620);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, (zNear + zFar) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, hillY(x, z) + 0.016 * wave(z, 4, x * 2)); }
    g.computeVertexNormals();
    const A = new THREE.Color(0x7fae5c), B = new THREE.Color(0x9cc26c), C = new THREE.Color(0xb3cc7e), Far = new THREE.Color(0x9fbf8a);
    place(g, (c, x, y, z) => {
      const n = grain(x, z);
      c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n)));
      if (n > 0.3) c.lerp(C, Math.min(1, (n - 0.3) * 1.6));
      c.lerp(Far, Math.max(0, Math.min(0.7, (Z0 - z) / 5)));
    });
  }
  // Hills beyond the ridge, cut by the mask: walls standing back that the ortho camera sees as bands.
  const wall = (z, r, amp, ph, colour) => {
    const y0 = (0.5 - r) * tall / Math.cos(elev) + z * Math.tan(elev);
    const g = new THREE.PlaneGeometry(SPAN * 3, 60, 200, 1), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) { const x = pos.getX(i); pos.setY(i, y0 + amp * (Math.sin(x * 1.1 + ph) * 0.6 + Math.sin(x * 2.3 + ph * 2) * 0.3)); } else pos.setY(i, y0 - 60);
    g.computeVertexNormals();
    place(g, colour, { z });
  };
  wall(zFar - 2, 0.05, 0.1, 1, night ? 0x7f9cb4 : 0xa9cfae);
  wall(zFar - 5, 0.025, 0.12, 2.6, night ? 0x8fa8c8 : 0xc4e0d2);

  // Everything of the tile comes three times, a period apart, so the bottom of the picture runs into its own top.
  const FIRST = zOfRow(1 / 3);
  let count = 0;
  const each = (fn) => { const id = 1200 + (count++) * 41; [-PZ, 0, PZ].forEach((d) => { reseed(id); fn(d); }); };
  // [x, share of the tile going down, size, kind]: on both sides, leaving the middle to the lessons.
  [[-2.72, 0.04, 1.08, 'oak'], [2.78, 0.1, 1.1, 'lime'], [-2.86, 0.3, 0.92, 'deep'], [2.74, 0.36, 1.02, 'oak'], [-2.68, 0.55, 1.12, 'lime'], [2.88, 0.6, 0.94, 'deep'], [-2.8, 0.8, 0.98, 'blossom'], [2.72, 0.84, 1.08, 'lime']].forEach(([x, t, s, k]) =>
    each((d) => { const z = FIRST + t * PZ + d; if (z > zFar) roundTree(x, z, s, k, hillY(x, z)); }));
  [[-2.5, 0.2, 0.86], [2.52, 0.26, 0.8], [-2.46, 0.68, 0.84], [2.56, 0.74, 0.88]].forEach(([x, t, s]) => each((d) => { const z = FIRST + t * PZ + d; if (z > zFar) pine(x, z, s, hillY(x, z)); }));
  [[-2.1, 0.13, 0.95, 'deep'], [2.14, 0.46, 1, 'oak'], [-2.2, 0.46, 0.85, 'lime'], [2.1, 0.92, 0.9, 'deep'], [-2.06, 0.9, 0.85, 'oak'], [2.2, 0.16, 0.85, 'deep']].forEach(([x, t, s, k]) => each((d) => { const z = FIRST + t * PZ + d; if (z > zFar) bush(x, z, s, k, hillY(x, z)); }));
  // Rocks and clumps of flowers, low enough to pass under a lesson's name.
  const rock = new THREE.IcosahedronGeometry(1, 2);
  [[-1.74, 0.23, 0.09], [1.78, 0.58, 0.1], [-1.66, 0.73, 0.075], [1.7, 0.05, 0.08], [1.45, 0.33, 0.05]].forEach(([x, t, s]) => each((d) => place(rock, (c, X, Y, Z) => c.set(0xbdb7a8).multiplyScalar(0.92 + 0.1 * Math.sin(X * 37 + Z * 29)), { x, y: hillY(x, FIRST + t * PZ + d) + s * 0.45, z: FIRST + t * PZ + d, sx: s * 1.2, sy: s * 0.8, sz: s })));
  each((d) => {
    const dot = new THREE.SphereGeometry(0.024, 8, 6), tuft = new THREE.ConeGeometry(0.03, 0.1, 6);
    for (let i = 0; i < 640; i++) {
      const x = between(-3.1, 3.1), z = FIRST + rnd() * PZ + d;
      if (z < zFar) continue;
      if (rnd() < 0.34) place(dot, tones[Math.floor(rnd() * 4)], { x, y: hillY(x, z) + 0.03, z });
      else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: hillY(x, z) + 0.05, z, rz: between(-0.25, 0.25) });
    }
  });
  // On the slope above the tile: smaller trees getting further away.
  reseed(90);
  [[-1.5, 0.17, 0.62, 'oak'], [-0.55, 0.15, 0.52, 'deep'], [0.45, 0.16, 0.6, 'lime'], [1.4, 0.18, 0.54, 'oak']].forEach(([x, r, s, k]) => { const z = zOfRow(r); roundTree(x, z, s, k, hillY(x, z)); });
  [[-1.05, 0.16, 0.6], [0.95, 0.165, 0.62], [-0.05, 0.19, 0.5]].forEach(([x, r, s]) => { const z = zOfRow(r); pine(x, z, s, hillY(x, z)); });
  finish();
  window.__rect = JSON.stringify({ top: TOP_SHARE, PZ });
  return cam;
}
