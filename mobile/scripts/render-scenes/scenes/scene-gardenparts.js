// Vườn tài chính's small things. `&part=sign`: the wooden board hanging from a branch (its numbers are live, the app writes them). `&part=bloom`: two clusters of
// flowers for the corners in front. `&part=icons`: a row of little icons, cut apart: target, piggy, coins, flower on, flower off, three butterflies, money bag.
import { kit } from './kit.js';
import { village } from './village.js';
import { light as lightOf, shapes, PITCH_DEG } from './grove-kit.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'sign';
  const night = light === 'night';
  lightOf(sky, night);
  const v = village(THREE, scene, { night, start: 71 });
  const { place, box, ball, cyl, reseed, between, tmp, lumps, finish } = v;
  const torus = (r, t, paint, o) => place(new THREE.TorusGeometry(r, t, 10, 28), paint, o);
  const { tube, blade, cloud, coin, gold } = shapes(THREE, v);
  const shiny = async () => {
    finish();
    if (gold.length) {
      const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
      scene.add(new THREE.Mesh(mergeGeometries(gold, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.45 })));
    }
  };

  if (part === 'sign') {
    // The branch comes in from the left edge of the screen, in world units across 5.2.
    const y0 = 1.2;
    tube([[-2.9, y0 + 0.5, -0.2], [-1.9, y0 + 0.42, -0.1], [-0.7, y0 + 0.5, 0], [0.4, y0 + 0.62, 0.02], [1.34, y0 + 0.86, 0.02]], 0.17, 0.035, undefined, { radial: 22, along: 40, ridges: 0.07 });
    tube([[-1.2, y0 + 0.44, 0], [-1.0, y0 + 0.74, 0], [-0.7, y0 + 0.95, 0.02]], 0.05, 0.016, undefined, { radial: 10, along: 8 });
    tube([[0.55, y0 + 0.66, 0], [0.86, y0 + 0.5, 0.06], [1.05, y0 + 0.46, 0.08]], 0.03, 0.012, undefined, { radial: 8, along: 6 });
    reseed(13);
    const LEAVES = [0x7cc248, 0x9ad653, 0x5fae3e, 0xb5e36c];
    [[-1.65, 0.62], [-0.72, 0.98], [-0.2, 0.74], [0.42, 0.82], [1.06, 0.48], [1.36, 0.92], [0.95, 0.96], [-1.05, 0.78]].forEach(([x, dy]) => { for (let i = 0; i < 7; i++) blade(x, y0 + dy, between(-0.05, 0.14), [between(-1, 1), between(-0.1, 1), between(-0.2, 0.8)], between(0.28, 0.4), between(0.11, 0.15), LEAVES[i % 4]); });
    // The ropes and the board. Its face is where the app writes.
    const BW = 3.5, BH = 1.56, bx = -0.32, by = 0.5;
    [-1.2, 1.2].forEach((dx) => {
      const top = y0 + (dx < 0 ? 0.42 : 0.6);
      torus(0.08, 0.018, 0xc9a26a, { x: bx + dx, y: top, z: 0.02, ry: Math.PI / 2 });
      tube([[bx + dx, top - 0.05, 0.02], [bx + dx + 0.01, (top + by + BH / 2) / 2, 0.02], [bx + dx, by + BH / 2 - 0.02, 0.05]], 0.022, 0.022, (c, X, Y) => c.set(0xb68f58).lerp(tmp.set(0xe1c48c), 0.5 + Math.sin(Y * 90) * 0.4), { radial: 8, along: 16 });
      torus(0.07, 0.022, 0x8e9aa0, { x: bx + dx, y: by + BH / 2 + 0.02, z: 0.06, ry: Math.PI / 2 });
    });
    const PLANKS = 4, ph = BH / PLANKS;
    for (let i = 0; i < PLANKS; i++) {
      const tone = [1.02, 0.96, 1.0, 0.94][i], off = i * 3.1, y = by + BH / 2 - ph * (i + 0.5), w = BW + (i % 2 ? 0.04 : -0.03);
      box(w, ph * 0.965, 0.13, (c, X, Y) => { const g = Math.sin(Y * 74 + Math.sin(X * 2.4 + off) * 3.2) * 0.5 + 0.5; c.set(0xd9a966).lerp(tmp.set(0xf2cf94), 0.25 + g * 0.55).multiplyScalar(tone * (1 + lumps(X * 4, Y * 9, off) * 0.05)); }, { x: bx + (i % 2 ? 0.02 : -0.02), y, r: 0.05 });
    }
    // Battens behind, nail heads, a sprig of leaves at the corners.
    [-1.2, 1.2].forEach((dx) => { box(0.16, BH + 0.1, 0.06, 0xbb8a4c, { x: bx + dx, y: by, z: -0.08, r: 0.02 }); [0.55, 0.18, -0.18, -0.55].forEach((yy) => ball(0.022, 0x8e9aa0, { x: bx + dx, y: by + yy, z: 0.072 })); });
    reseed(29);
    [[bx - BW / 2 + 0.02, by + BH / 2 - 0.02], [bx + BW / 2 - 0.04, by - BH / 2 + 0.02]].forEach(([x, y], k) => { for (let i = 0; i < 9; i++) blade(x, y, 0.1, [(k ? 1 : -1) * between(-0.3, 1), (k ? -1 : 1) * between(-0.3, 1), between(0.1, 0.7)], between(0.22, 0.32), between(0.09, 0.12), LEAVES[i % 4]); });
    await shiny();
    const span = 5.2, tall = (span * H) / W;
    const cam = flatCamera(span, W, H, [-0.3, 0.5 + Math.sin(0.1) * 30, Math.cos(0.1) * 30], [-0.3, 0.5, 0]);
    const at = (x, y) => [+((x + 0.3 + span / 2) / span).toFixed(4), +((tall / 2 - (y - 0.5) * Math.cos(0.1)) / tall).toFixed(4)];
    window.__rect = JSON.stringify({ face: [at(bx - BW / 2, by + BH / 2), at(bx + BW / 2, by - BH / 2)] });
    return cam;
  }

  if (part === 'bloom') {
    const STEM = (c, X, Y) => c.set(0x4f9a35).lerp(tmp.set(0x8fcf48), 0.5 + Math.sin(Y * 11) * 0.3);
    const flower = (x, y, z, r, col, deep, n = 8, heart = 0xf6c438) => {
      tube([[x + between(-0.1, 0.1), 0, z - 0.1], [x + between(-0.04, 0.04), y * 0.5, z - 0.05], [x, y, z]], 0.018, 0.014, STEM, { radial: 7, along: 8 });
      const face = [between(-0.3, 0.3), 0.45, 1];
      const Mq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...face).normalize());
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.2).applyQuaternion(Mq);
        blade(x, y, z, [d.x, d.y, d.z], r, r * 0.36, (c, X, Y, Z) => c.set(deep).lerp(tmp.set(col), Math.min(1, Math.hypot(X - x, Y - y, Z - z) / (r * 0.72))));
      }
      ball(r * 0.2, heart, { x: x + face[0] * r * 0.09, y: y + face[1] * r * 0.09, z: z + r * 0.09 });
    };
    const cluster = (cx, seed, list) => {
      reseed(seed);
      for (let i = 0; i < 60; i++) { const x = cx + between(-1.5, 1.5), len = between(0.45, 0.9); blade(x, 0, between(-0.3, 0.4), [between(-0.55, 0.55), 1, between(-0.1, 0.5)], len, len * 0.24, (c, X, Y) => c.set(0x3f8f2c).lerp(tmp.set(0xa8dd4f), Math.min(1, Y * 1.5 + 0.1))); }
      for (let i = 0; i < 50; i++) { const x = cx + between(-1.4, 1.4), y = between(0.04, 0.3); blade(x, y, between(-0.1, 0.5), [between(-1, 1), between(0.1, 0.8), between(0.1, 0.8)], 0.3, 0.14, [0x5fae3e, 0x7cc248, 0x4c9c2c][i % 3]); }
      list.forEach(([x, y, z, r, col, deep, n, heart]) => flower(cx + x, y, z, r, col, deep, n, heart));
    };
    cluster(-2, 21, [[-0.75, 0.78, 0.1, 0.44, 0xffc4dc, 0xf06a9e], [0.02, 1.14, -0.05, 0.5, 0xffd0e2, 0xf27aa8], [0.68, 0.72, 0.18, 0.42, 0xffc0d8, 0xee6a9a], [-0.2, 0.5, 0.36, 0.3, 0xfffdf4, 0xf0e6c8, 12], [0.34, 0.38, 0.44, 0.22, 0xfff2a8, 0xf6c438, 10, 0xe8912c], [-1.05, 0.34, 0.34, 0.24, 0xfffdf4, 0xf0e6c8, 12], [1.14, 0.4, 0.3, 0.22, 0xffd0e2, 0xf27aa8]]);
    cluster(2, 37, [[0.72, 0.86, 0.1, 0.42, 0xffe27a, 0xf2a62a, 12, 0xe8912c], [-0.06, 1.12, -0.04, 0.5, 0xffc4dc, 0xf06a9e], [-0.8, 0.74, 0.18, 0.42, 0xffd0e2, 0xf27aa8], [0.26, 0.46, 0.38, 0.3, 0xfffdf4, 0xf0e6c8, 12], [-0.34, 0.36, 0.42, 0.24, 0xffe27a, 0xf2a62a, 10, 0xe8912c], [1.14, 0.42, 0.3, 0.24, 0xfffdf4, 0xf0e6c8, 12], [-1.12, 0.36, 0.3, 0.2, 0xffc4dc, 0xf06a9e]]);
    await shiny();
    const pitch = PITCH_DEG * Math.PI / 180, span = 8, tall = (span * H) / W, mid = 0.7;
    return flatCamera(span, W, H, [0, mid + Math.sin(pitch) * 30, Math.cos(pitch) * 30], [0, mid, 0]);
    void tall;
  }

  // ------------------------------------------------------------------- the icons, one to a cell, each about 1.6 across
  const N = 8, cell = 2, X = (i) => (i - (N - 1) / 2) * cell;
  // The target: rings, and a dart in it.
  {
    const x = X(0);
    [[0.78, 0xf26a6a], [0.6, 0xfffdf8], [0.42, 0xf26a6a], [0.24, 0xfffdf8], [0.1, 0xe2483f]].forEach(([r, col], i) => cyl(r, r + 0.01, 0.1 + i * 0.03, col, { x, y: 0, z: i * 0.03, rx: Math.PI / 2, seg: 44 }));
    tube([[x + 0.72, 0.62, 0.42], [x + 0.28, 0.25, 0.26], [x, 0, 0.14]], 0.04, 0.03, 0x3f7fa8, { radial: 10, along: 6 });
    [0, 1, 2].forEach((k) => blade(x + 0.66, 0.56, 0.4, [0.9, 0.5 + k * 0.25, 0.1 + k * 0.3], 0.34, 0.14, 0x5fb0cc));
  }
  // The piggy bank, gold and round.
  {
    const x = X(1), G = 0xf6c23c, D = 0xe39b1f;
    ball(0.66, (c, a, b) => c.set(D).lerp(tmp.set(0xffdc6a), Math.max(0, Math.min(1, 0.55 + b * 0.8))), { x, y: 0.02, sx: 1.08, sy: 0.92, sz: 0.86 });
    [[-0.38, 0.3], [0.38, 0.3], [-0.34, -0.22], [0.34, -0.22]].forEach(([dx, dz]) => cyl(0.13, 0.15, 0.26, D, { x: x + dx, y: -0.6, z: dz }));
    cyl(0.25, 0.27, 0.2, 0xffe08a, { x: x + 0.5, y: -0.02, z: 0.52, rx: 1.2, rz: -0.3, seg: 26 });
    [-0.08, 0.08].forEach((d) => ball(0.04, 0xa9651a, { x: x + 0.54 + d, y: 0.02, z: 0.62 }));
    [[0.14, 0.34], [0.6, 0.34]].forEach(([dx, y]) => ball(0.058, 0x3a2a1a, { x: x + dx, y, z: 0.5 }));
    [0.08, 0.72].forEach((dx) => blade(x + dx, 0.54, 0.26, [dx - 0.4, 1, 0.2], 0.3, 0.14, G));
    box(0.34, 0.03, 0.09, 0x8a5a18, { x: x - 0.06, y: 0.59, z: 0.05, r: 0.012 });
    tube([[x - 0.68, 0.06, -0.1], [x - 0.86, 0.2, -0.1], [x - 0.74, 0.3, -0.06], [x - 0.8, 0.14, -0.08]], 0.03, 0.022, D, { radial: 8, along: 12 });
  }
  // A stack of coins and one against it.
  {
    const x = X(2);
    [[-0.26, 0], [-0.26, 1], [-0.24, 2], [-0.28, 3], [-0.25, 4], [0.34, 0], [0.32, 1], [0.35, 2]].forEach(([dx, n]) => { place(new THREE.CylinderGeometry(0.42, 0.42, 0.15, 36), 0xf6bf2e, { x: x + dx, y: -0.58 + n * 0.17, z: dx < 0 ? -0.1 : 0.1, into: gold }); place(new THREE.TorusGeometry(0.4, 0.028, 8, 36), 0xffd764, { x: x + dx, y: -0.58 + n * 0.17 + 0.074, z: dx < 0 ? -0.1 : 0.1, rx: Math.PI / 2, into: gold }); });
    coin(x + 0.1, -0.2, 0.6, 0.34, 0.2, false);
  }
  // A flower, in full colour and in grey, for a milestone reached and not yet.
  const star = (x, y, z, r, col) => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, R = i % 2 ? 0.46 : 1; if (i) s.lineTo(Math.cos(a) * R, Math.sin(a) * R); else s.moveTo(Math.cos(a) * R, Math.sin(a) * R); } s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }); g.deleteAttribute('uv'); place(g, col, { x, y, z, sx: r, sy: r, sz: r }); };
  [[3, 0xf9a8c8, 0xf0689c, 0xf7c23a], [4, 0xdfe4e8, 0xb9c2c9, 0xf1f3f5]].forEach(([i, lit, deep, heart]) => {
    const x = X(i), n = 5;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / 2, g = new THREE.SphereGeometry(0.44, 22, 16);
      place(g, (c, X2, Y2, Z2) => c.set(deep).lerp(tmp.set(lit), Math.min(1, Math.hypot(X2 - x, Y2) / 0.62 + Z2 * 0.5)), { x: x + Math.cos(a) * 0.42, y: Math.sin(a) * 0.42, sz: 0.46 });
    }
    ball(0.3, heart, { x, y: 0, z: 0.14, sz: 0.56 });
    star(x, -0.01, 0.22, 0.2, i === 3 ? 0xfff2c0 : 0xdfe3e6);
  });
  // Butterflies, seen from above with their wings out.
  [[5, 0xf78fb3, 0xffd3e0], [6, 0x6fb6e8, 0xcdebfb], [7, 0xf6c23c, 0xffeeaa]].forEach(([i, deep, lit]) => {
    const x = X(i);
    [-1, 1].forEach((side) => {
      [[0.46, 0.27, 0.56, 0.4], [0.34, -0.26, 0.42, 0.32]].forEach(([dx, y, rx, ry], wing) => {
        const g = new THREE.SphereGeometry(1, 26, 16);
        place(g, (c, X2, Y2) => c.set(deep).lerp(tmp.set(lit), Math.min(1, Math.hypot(X2 - (x + side * dx), Y2 - y) * 1.5)), { x: x + side * dx, y, z: 0, sx: rx, sy: ry, sz: 0.05, rz: side * (wing ? 0.5 : -0.3) });
        ball(0.075, 0xffffff, { x: x + side * dx * 1.2, y: y * 1.15, z: 0.04, sz: 0.3 });
      });
    });
    place(new THREE.CapsuleGeometry(0.07, 0.54, 6, 14), 0x4a3524, { x, y: 0, z: 0.05 });
    [-1, 1].forEach((side) => tube([[x, 0.3, 0.06], [x + side * 0.1, 0.5, 0.06], [x + side * 0.22, 0.62, 0.06]], 0.014, 0.01, 0x4a3524, { radial: 6, along: 6 }));
  });
  await shiny();
  return flatCamera(N * cell, W, H, [0, 0.4, 14], [0, 0, 0]);
}
