// Hành trình sự nghiệp's land, as a tile that repeats downwards: the things on it wrap around, and light comes only from the sky.
// `&biome=0..5`; `&biome=stones` is the five milestones in a row; `&biome=hedge` is the hedge between two regions.
import { kit } from './kit.js';
const BIOMES = [
  { ground: 0x9ed27f, patch: 0xb2de8c, a: 0x5aa86a, b: 0x74bd78, c: 0x4d9a60, flowers: [0xffffff, 0xffe08a, 0xf7a8bd], rock: 0xb8b4a6, kind: 'round' },
  { ground: 0xbadb86, patch: 0xcbe697, a: 0xf2b3c6, b: 0xf7c9d6, c: 0x7fbb70, flowers: [0xffffff, 0xf7a8bd, 0xfff1a8], rock: 0xc4bdab, kind: 'round' },
  { ground: 0xecd492, patch: 0xf3e0a8, a: 0xe0a956, b: 0xeabf6c, c: 0xc98f43, flowers: [0xffffff, 0xf2914e, 0xf5d35e], rock: 0xc9a988, kind: 'cactus' },
  { ground: 0xb4dbe9, patch: 0xd3ecf3, a: 0x6aa3c0, b: 0x8fbdd2, c: 0xdff1f7, flowers: [0xffffff, 0xd6eef7, 0xbcdcf0], rock: 0xc3d3dc, kind: 'pine' },
  { ground: 0xcdb9e6, patch: 0xdccdee, a: 0x9077c4, b: 0xad97d8, c: 0x7f68b5, flowers: [0xffffff, 0xf1d3f5, 0xffe9a8], rock: 0xb9aecd, kind: 'round' },
  { ground: 0xf0bd96, patch: 0xf5cfaf, a: 0xdc7a4c, b: 0xeb9a5d, c: 0xc65f3c, flowers: [0xffffff, 0xffd97a, 0xf58a5c], rock: 0xcda58c, kind: 'pine' },
];
const SPAN = 4;
export async function build({ THREE, scene, W, H }) {
  const { mat, box, ball, cyl, cone, sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const which = q.get('biome') ?? '0';
  sky({ top: 0xeaf2fa, mid: 0xf8f4ea, low: 0xd8d0c0, power: 0.82, sun: { dir: [-0.5, 0.8, 0.45], size: 16, power: 12, color: 0xffeccf } });
  const flat = (color) => { const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat(color, 0.96)); g.rotation.x = -Math.PI / 2; scene.add(g); return g; };
  const tilt = 0.82; // radians above the horizon
  const from = [0, Math.sin(tilt) * 20, Math.cos(tilt) * 20];

  if (which === 'stones') {
    const floor = flat(0xc9d8b4); floor.userData.noMask = true;
    const tops = [[0xc3c8ca, 0x8f979b], [0xfff0c2, 0xd9ad62], [0xc9e8fb, 0x62a9d4], [0xc4efd2, 0x4fac76], [0xffdf80, 0xcf9022]];
    tops.forEach(([top, side], i) => {
      const x = (i - 2) * 1.3;
      box(0.92, 0.3, 0.92, mat(side, 0.62), { x, y: 0.15, r: 0.2 });
      box(0.84, 0.14, 0.84, mat(top, 0.42), { x, y: 0.3, r: 0.07 });
      // A few pebbles at its foot.
      [[-0.46, 0.4, 0.07], [0.48, 0.36, 0.055], [0.36, 0.5, 0.045]].forEach(([dx, dz, r]) => { const b = ball(r, mat(0xb8b4a6, 0.8), { x: x + dx, y: r * 0.5, z: dz, sy: 0.7 }); return b; });
    });
    return flatCamera(1.3 * 5, W, H, from, [0, 0.15, 0.08]);
  }
  if (which === 'hedge') {
    const floor = flat(0xa8cf8c); floor.userData.noMask = true;
    const a = mat(0x5ba56b, 0.8), b = mat(0x71b878, 0.8), c = mat(0x4d9a60, 0.8);
    let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
    for (let x = -2.3; x <= 2.3; x += 0.17) {
      ball(0.17 + rnd() * 0.05, [a, b, c][Math.floor(rnd() * 3)], { x, y: 0.11 + rnd() * 0.05, z: rnd() * 0.06 - 0.03 });
      if (rnd() > 0.45) ball(0.028, mat([0xffffff, 0xffe08a, 0xf7a8bd][Math.floor(rnd() * 3)], 0.6), { x: x + rnd() * 0.06, y: 0.2 + rnd() * 0.08, z: 0.14 });
    }
    return flatCamera(SPAN, W, H, from, [0, 0.1, 0]);
  }

  const B = BIOMES[+which];
  flat(B.ground);
  const P = SPAN / Math.sin(tilt) * (H / W); // how far down the ground one picture goes
  let seed = 31 + (+which) * 97;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
  /** Draws a thing here and one period up and down, so what crosses an edge comes back at the other. */
  const wrap = (fn, z) => { [-P, 0, P].forEach((d) => fn(z + d)); };
  const a = mat(B.a, 0.78), b = mat(B.b, 0.78), c = mat(B.c, 0.78), bark = mat(0x8a5e3a, 0.85), rock = mat(B.rock, 0.82), patch = mat(B.patch, 0.96);
  // Soft patches on the ground.
  for (let i = 0; i < 26; i++) { const x = -2.1 + rnd() * 4.2, z = rnd() * P - P / 2, r = 0.2 + rnd() * 0.3, sz = 0.5 + rnd() * 0.4; wrap((zz) => ball(r, patch, { x, y: -r * 0.12, z: zz, sy: 0.24, sz }), z); }
  for (let i = 0; i < 60; i++) { const x = -2 + rnd() * 4, z = rnd() * P - P / 2, r = 0.035 + rnd() * 0.04, m = i % 2 ? patch : mat(B.ground, 0.9); wrap((zz) => ball(r, m, { x, y: r * 0.2, z: zz, sy: 0.6 }), z); }
  // Grass tufts and flowers across the middle: low, so the road and the signs stay clear.
  for (let i = 0; i < 26; i++) {
    const x0 = -1.9 + rnd() * 3.8, z0 = rnd() * P - P / 2, col = mat(B.flowers[i % B.flowers.length], 0.55), mid = mat(0xf5c542, 0.55);
    for (let j = 0; j < 5; j++) {
      const x = x0 + (rnd() - 0.5) * 0.24, z = z0 + (rnd() - 0.5) * 0.18, s = 0.026 + rnd() * 0.014;
      wrap((zz) => { ball(s, col, { x, y: 0.05, z: zz, sy: 0.7 }); ball(s * 0.42, mid, { x, y: 0.072, z: zz, sy: 0.7 }); }, z);
    }
  }
  // Trees at the edges of the land.
  const tree = (x, z, s) => {
    const kind = B.kind;
    wrap((zz) => {
      if (kind === 'pine') {
        cyl(0.04 * s, 0.05 * s, 0.14 * s, bark, { x, y: 0.07 * s, z: zz });
        [[0.3, 0.32, 0.26, a], [0.24, 0.3, 0.42, b], [0.17, 0.26, 0.58, c]].forEach(([r, h, y, m]) => cone(r * s, h * s, m, { x, y: y * s, z: zz }));
      } else if (kind === 'cactus') {
        const g = mat(0x7fae66, 0.7), g2 = mat(0x93bf76, 0.7);
        cyl(0.075 * s, 0.085 * s, 0.5 * s, g, { x, y: 0.25 * s, z: zz });
        ball(0.075 * s, g, { x, y: 0.5 * s, z: zz });
        cyl(0.04 * s, 0.04 * s, 0.17 * s, g2, { x: x - 0.13 * s, y: 0.32 * s, z: zz });
        cyl(0.04 * s, 0.04 * s, 0.1 * s, g2, { x: x - 0.075 * s, y: 0.25 * s, z: zz, rz: 1.57 });
        ball(0.04 * s, g2, { x: x - 0.13 * s, y: 0.405 * s, z: zz });
        cyl(0.036 * s, 0.036 * s, 0.14 * s, g2, { x: x + 0.12 * s, y: 0.28 * s, z: zz });
        cyl(0.036 * s, 0.036 * s, 0.09 * s, g2, { x: x + 0.07 * s, y: 0.22 * s, z: zz, rz: 1.57 });
        ball(0.036 * s, g2, { x: x + 0.12 * s, y: 0.35 * s, z: zz });
      } else {
        cyl(0.038 * s, 0.05 * s, 0.22 * s, bark, { x, y: 0.11 * s, z: zz });
        [[0, 0.3, 0.2, a], [-0.13, 0.25, 0.14, b], [0.13, 0.24, 0.15, c], [0.02, 0.42, 0.14, b]].forEach(([dx, y, r, m]) => ball(r * s, m, { x: x + dx * s, y: y * s, z: zz }));
      }
    }, z);
  };
  const edge = (z, side, s) => tree(side * (1.72 + rnd() * 0.22), z, s);
  const n = Math.round(P / 0.62);
  for (let i = 0; i < n; i++) {
    edge((i / n) * P - P / 2 + rnd() * 0.1, i % 2 ? 1 : -1, 0.85 + rnd() * 0.45);
    if (rnd() > 0.5) { const z = rnd() * P - P / 2, x = (i % 2 ? -1 : 1) * (1.82 + rnd() * 0.1), r = 0.08 + rnd() * 0.06; wrap((zz) => ball(r, rock, { x, y: r * 0.5, z: zz, sy: 0.72 }), z); }
  }
  return flatCamera(SPAN, W, H, from, [0, 0, 0]);
}
