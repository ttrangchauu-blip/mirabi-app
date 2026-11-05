// The plants of Vườn tài chính: one species in a row, stage 0 to 5, each in its ring of stones on the lawn, cut apart afterwards.
// `&plant=sakura|oak|sunflower|bamboo|maple|lotus`; `&pass=none` the lawn alone; `&pass=soil|water` the rings alone; `&light=mask` only the plants, white.
import { kit } from './kit.js';
import { village } from './village.js';
import { PITCH_DEG, lawnPaint, light as lightOf, ring, shapes, SOIL_Y } from './grove-kit.js';

export const CELL = 4.2;
export async function build({ THREE, scene, W, H, light }) {
  const { sky } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const pass = q.get('pass'), plant = q.get('plant') || 'sakura';
  lightOf(sky, light === 'night');
  const groundV = village(THREE, scene, { start: 17 }), v = village(THREE, scene, { start: 41 });
  const CX = (s) => (s - 2.5) * CELL;
  const waterParts = [];

  // The lawn, all of it the same in every pass.
  const wave = (x, z) => Math.sin(x * 1.3 + z * 1.7) * 0.14 + Math.sin(x * 2.9 - z * 2.3 + 1) * 0.2 + Math.sin(x * 6.1 + z * 4.3 + 2) * 0.16;
  const paint = lawnPaint(THREE, wave);
  {
    const g = new THREE.PlaneGeometry(40, 40, 700, 500);
    g.rotateX(-Math.PI / 2);
    groundV.place(g, (c, x, y, z) => paint(c, x, z));
    groundV.reseed(77);
    const tuft = new THREE.ConeGeometry(0.022, 0.09, 5), dot = new THREE.SphereGeometry(0.024, 8, 6);
    for (let i = 0; i < 3800; i++) {
      const x = groundV.between(-15, 15), z = groundV.between(-6, 3);
      if (groundV.rnd() < 0.04) groundV.place(dot, [0xfffdf2, 0xffc6dc, 0xffe36a][Math.floor(groundV.rnd() * 3)], { x, y: 0.05, z });
      else groundV.place(tuft, (c) => c.set(0x4f9f2c).lerp(groundV.tmp.set(0xb6e35a), groundV.rnd()), { x, y: 0.045, z, rz: groundV.between(-0.3, 0.3), rx: groundV.between(-0.2, 0.2) });
    }
  }
  if (pass !== 'none') for (let s = 0; s < 6; s++) ring(THREE, groundV, CX(s), pass === 'water' || (!pass && plant === 'lotus'), waterParts);

  const { tube, blade, cloud, tmp } = shapes(THREE, v);
  const { rnd, between, ball, cyl, reseed, place } = v;
  const TONES = {
    sakura: { young: { dark: 0x4f9a3c, lit: 0xa6dc5a, coat: [0x7cc248, 0x9ad653, 0x5fae3e, 0xb5e36c] }, mixed: { dark: 0x7fae56, lit: 0xf0bfd0, coat: [0xffc4d8, 0x8acb4f, 0xffa9c6, 0xa4d95a, 0xffdbe6] }, full: { dark: 0xd8689a, lit: 0xfbb6ce, coat: [0xffc4d8, 0xffa9c6, 0xffe0ea, 0xf78fb3, 0xffd3e0] } },
    oak: { young: { dark: 0x2f7f35, lit: 0x8ccf4c, coat: [0x4c9f3c, 0x6fb846, 0x3a8d38, 0x8ccb4e] }, mixed: { dark: 0x2f7f35, lit: 0x8ccf4c, coat: [0x4c9f3c, 0x6fb846, 0x3a8d38, 0x8ccb4e] }, full: { dark: 0x2c7a34, lit: 0x9ad64e, coat: [0x56a83e, 0x7cc048, 0x3f9238, 0x9ad653, 0xf2d15a] } },
    maple: { young: { dark: 0x7a9a3c, lit: 0xd8cf58, coat: [0xa8c348, 0xd9c84e, 0x88ad42, 0xedb94e] }, mixed: { dark: 0xc26a2c, lit: 0xf6b24e, coat: [0xf09a3c, 0xf7be4f, 0xe97a38, 0xc8c24a] }, full: { dark: 0xb93a26, lit: 0xf4894a, coat: [0xe9593a, 0xf07a3c, 0xf7a048, 0xd9432f, 0xfbc35c] } },
  };

  // ------------------------------------------------------------------- the first stages, the same way for every species that grows from soil
  const seed = (cx) => {
    ball(0.11, (c, x, y) => c.set(0x9b6a3a).lerp(tmp.set(0xd8a766), Math.max(0, Math.min(1, (y - SOIL_Y) * 7))), { x: cx, y: SOIL_Y + 0.055, z: 0.12, sy: 0.72, sx: 0.86, rz: 0.3 });
    tube([[cx + 0.02, SOIL_Y + 0.11, 0.12], [cx + 0.045, SOIL_Y + 0.19, 0.12], [cx + 0.1, SOIL_Y + 0.25, 0.13]], 0.016, 0.012, 0x7cc248, { radial: 7, along: 6 });
    blade(cx + 0.1, SOIL_Y + 0.25, 0.13, [0.8, 0.5, 0.1], 0.13, 0.05, 0x9ad653);
  };
  const sprout = (cx, tint) => {
    tube([[cx, SOIL_Y, 0], [cx + 0.01, SOIL_Y + 0.2, 0], [cx - 0.01, SOIL_Y + 0.42, 0.01]], 0.03, 0.02, 0x6fb846, { radial: 8, along: 8 });
    [[-1, 0.36, 0.3], [1, 0.42, 0.34], [-0.2, 0.44, 0.22]].forEach(([side, yy, len]) => blade(cx, SOIL_Y + yy, 0.015, [side, 0.72, 0.28], len, len * 0.42, tint));
  };
  const sapling = (cx, tints) => {
    reseed(19 + Math.abs(Math.round(cx * 7)));
    const top = SOIL_Y + 0.86;
    tube([[cx, SOIL_Y - 0.02, 0], [cx + 0.03, SOIL_Y + 0.34, 0], [cx - 0.02, top, 0.01]], 0.052, 0.018, undefined, { radial: 12, along: 12, flare: 0.5, ridges: 0.05 });
    [[0.42, -1], [0.54, 1], [0.66, -0.8], [0.76, 0.85]].forEach(([k, side]) => { const y = SOIL_Y + 0.86 * k; tube([[cx, y, 0], [cx + side * 0.14, y + 0.09, 0.02], [cx + side * 0.25, y + 0.15, 0.04]], 0.013, 0.007, undefined, { radial: 6, along: 5 }); });
    const spots = [[-0.27, 0.56], [0.27, 0.62], [-0.22, 0.72], [0.24, 0.8], [-0.08, 0.86], [0.08, 0.88], [0, 0.96], [-0.15, 0.66], [0.15, 0.7]];
    spots.forEach(([dx, k], i) => { for (let n = 0; n < 3; n++) blade(cx + dx, SOIL_Y + 0.86 * k, 0.03 + between(-0.05, 0.05), [dx * 2.6 + between(-0.5, 0.5), 0.75 + between(-0.2, 0.4), between(-0.1, 0.7)], between(0.18, 0.25), between(0.075, 0.1), tints[(i + n) % tints.length]); });
  };

  // Soft-stemmed species don't get bark while they are small.
  const greenShoot = (cx) => {
    reseed(23);
    tube([[cx, SOIL_Y, 0], [cx + 0.02, SOIL_Y + 0.34, 0], [cx - 0.01, SOIL_Y + 0.74, 0.01]], 0.036, 0.022, 0x6fb846, { radial: 10, along: 10 });
    [[0.2, -1], [0.3, 1], [0.44, -1], [0.54, 1], [0.66, -1], [0.74, 1]].forEach(([h, side], i) => blade(cx, SOIL_Y + h, 0.02, [side, 0.42 + i * 0.06, 0.3], 0.34 - i * 0.022, 0.15 - i * 0.008, i % 2 ? 0x7cc248 : 0x9ad653));
  };
  const bambooShoot = (cx, s) => {
    reseed(31 + s);
    const cone = (x, z, h, r) => place(new THREE.ConeGeometry(r, h, 14), (c, X, Y) => c.set(0x6fae3c).lerp(tmp.set(0xd2e78c), Math.min(1, (Y - SOIL_Y) / h)), { x, y: SOIL_Y + h / 2 - 0.02, z });
    if (s === 1) { cone(cx, 0.06, 0.36, 0.075); cone(cx + 0.2, 0.2, 0.2, 0.05); return; }
    const h = 0.86, segs = 4;
    for (let i = 0; i < segs; i++) {
      const Y = SOIL_Y - 0.02 + (h / segs) * i;
      tube([[cx, Y, 0], [cx, Y + h / segs / 2, 0], [cx, Y + h / segs - 0.008, 0]], 0.05 - i * 0.004, 0.047 - i * 0.004, (c, X, YY, Z, nx) => c.set(0x6fae3c).lerp(tmp.set(0xc4e36a), 0.42 + nx * 0.45), { radial: 12, along: 3 });
      cyl(0.058 - i * 0.004, 0.058 - i * 0.004, 0.02, 0x5c9a3a, { x: cx, y: Y + h / segs, z: 0 });
    }
    [[0.5, -1], [0.64, 1], [0.78, -1], [0.88, 1]].forEach(([k, side]) => { for (let n = 0; n < 3; n++) blade(cx + side * 0.03, SOIL_Y + h * k, 0.02, [side * between(0.6, 1), between(-0.15, 0.3), between(-0.3, 0.6)], between(0.26, 0.34), 0.055, [0x6fb846, 0x9ad653, 0x54a03e][n]); });
    cone(cx + 0.26, 0.24, 0.22, 0.055); cone(cx - 0.28, 0.2, 0.16, 0.045);
  };

  // ------------------------------------------------------------------- trees: bark, a fork, limbs, and a crown of separate leaves
  const tree = (cx, s, kind) => {
    reseed(100 + s * 13 + kind.length * 7);
    const P = { 3: { h: 0.56, r: 0.085, top: 0.34, n: 110, spread: 0.44, lift: 0.5, len: 0.11, wid: 0.05 }, 4: { h: 0.82, r: 0.115, top: 0.46, n: 190, spread: 0.72, lift: 0.72, len: 0.125, wid: 0.056 }, 5: { h: 1.04, r: 0.15, top: 0.58, n: 300, spread: 1.0, lift: 0.94, len: 0.13, wid: 0.062 } }[s];
    const T = TONES[kind][s === 3 ? 'young' : s === 4 ? 'mixed' : 'full'];
    const foot = [cx, SOIL_Y - 0.04, 0], lean = kind === 'oak' ? 0.03 : 0.07;
    const fork = [cx + lean, SOIL_Y + P.h, 0.02];
    tube([foot, [cx + lean * 0.2, SOIL_Y + P.h * 0.42, 0], fork], P.r, P.r * 0.68, undefined, { radial: 30, along: 20, flare: 1.15, ridges: 0.075 });
    // Where the crown's masses sit: to the sides and above, and none straight in front, so the limbs show between them.
    const masses = s === 3
      ? [[-0.82, 0.55, -0.15, 0.82], [0.85, 0.72, -0.1, 0.8], [0.05, 1.08, -0.15, 1]]
      : s === 4
        ? [[-1, 0.38, 0, 0.82], [1, 0.46, 0.06, 0.84], [-0.46, 0.98, -0.16, 0.92], [0.58, 1.04, -0.12, 0.96], [0.04, 0.6, -0.42, 0.9]]
        : [[-1.02, 0.28, 0.08, 0.76], [1.02, 0.34, 0.02, 0.8], [-0.62, 0.82, 0.12, 0.92], [0.66, 0.88, 0.14, 0.92], [-0.16, 1.22, -0.05, 1], [0.04, 0.5, -0.5, 1.02], [0.5, 1.28, -0.3, 0.72]];
    const ends = masses.map(([mx, my, mz, ms]) => ({ x: fork[0] + mx * P.spread, y: fork[1] + my * P.lift, z: fork[2] + mz * P.spread * 0.9, r: P.top * ms }));
    ends.forEach((e) => {
      const mid = [(fork[0] * 0.62 + e.x * 0.38), fork[1] + (e.y - fork[1]) * 0.28, fork[2] * 0.5 + e.z * 0.5];
      tube([fork, mid, [e.x, e.y - e.r * 0.25, e.z]], P.r * 0.52, P.r * 0.2, undefined, { radial: 14, along: 12, ridges: 0.05 });
      // A smaller branch off each limb.
      tube([mid, [mid[0] + (e.x - fork[0]) * 0.26, mid[1] + P.lift * 0.3, e.z + 0.12], [mid[0] + (e.x - fork[0]) * 0.46, mid[1] + P.lift * 0.46, e.z + 0.2]], P.r * 0.22, P.r * 0.08, undefined, { radial: 8, along: 6 });
    });
    ends.forEach((e) => cloud(e.x, e.y, e.z, e.r, { ...T, n: Math.round(P.n * (e.r / P.top)), len: P.len, wid: P.wid, flat: 0.84 }));
    if (kind === 'oak' && s === 5) ends.forEach((e) => { for (let i = 0; i < 9; i++) { const a = rnd() * 6.28, b = between(-0.2, 1); ball(0.046, 0xf2c94e, { x: e.x + Math.cos(a) * e.r * Math.cos(b), y: e.y + Math.sin(b) * e.r * 0.86, z: e.z + Math.sin(a) * e.r * Math.cos(b) * 0.9 + 0.03, sy: 1.15 }); } });
  };

  // ------------------------------------------------------------------- sunflowers: thick stalks, big leaves, a head of ray petals round a dark disc
  const headOf = (x, y, z, r, tilt = 0.25, yaw = 0) => {
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const disc = new THREE.SphereGeometry(r * 0.5, 22, 14);
    place(disc, (c, X, Y) => { const k = Math.sin(Math.atan2(Y - y, X - x) * 21 + Math.hypot(X - x, Y - y) * 60); c.set(0x4a2a12).lerp(tmp.set(0x8c5a28), 0.45 + k * 0.4); }, { M, sz: 0.34 });
    for (let layer = 0; layer < 2; layer++) {
      const n = layer ? 15 : 17;
      for (let i = 0; i < n; i++) {
        const a = ((i + layer * 0.5) / n) * Math.PI * 2, Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12 - layer * 0.14, 0, a - Math.PI / 2));
        const m = M.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, 0.012 - layer * 0.02), Q, new THREE.Vector3(r * 0.2, r * 0.42, r * 0.2)));
        place(new THREE.SphereGeometry(1, 8, 6).translate(0, 1, 0), [0xffd93f, 0xfbc42e, 0xffe567][(i + layer) % 3], { M: m, sz: 0.16 });
      }
    }
  };
  const sunflowerAt = (cx, s) => {
    reseed(200 + s);
    const heads = s === 3 ? [[0, 1.05, 0.2, 0]] : s === 4 ? [[-0.16, 1.5, 0.27, -0.1], [0.3, 1.02, 0.18, 0.15]] : [[-0.34, 1.86, 0.34, -0.16], [0.36, 1.58, 0.32, 0.18], [0, 1.18, 0.27, 0]];
    heads.forEach(([dx, h, r, yaw], i) => {
      const x = cx + dx * 0.9, top = SOIL_Y + h, zz = 0.02 + i * 0.1;
      tube([[cx + dx * 0.25, SOIL_Y - 0.02, zz - 0.04], [cx + dx * 0.55, SOIL_Y + h * 0.5, zz - 0.02], [x, top - r * 0.2, zz]], 0.036 + s * 0.005, 0.022, (c, X, Y, Z, nx, ny, nz) => c.set(0x4f9a35).lerp(tmp.set(0x9ad653), 0.5 + 0.4 * Math.sin(Math.atan2(nz, nx) * 5)), { radial: 12, along: 12 });
      headOf(x, top, zz + 0.05, r, 0.22, yaw);
      const leaves = Math.max(3, Math.round(h * 5));
      for (let k = 0; k < leaves; k++) {
        const t = 0.2 + (k / leaves) * 0.68, side = k % 2 ? 1 : -1, Y = SOIL_Y + h * t, X = cx + dx * (0.25 + 0.65 * t), len = between(0.3, 0.46) * (1.1 - t * 0.5);
        blade(X, Y, zz, [side, 0.42 - t * 0.2, 0.32 + between(-0.2, 0.2)], len, len * 0.46, (c, px, py) => c.set(0x4c9c2c).lerp(tmp.set(0xa6dd50), Math.max(0, Math.min(1, 0.45 + Math.sin(px * 46) * 0.2 + (py - Y) * 2))));
      }
    });
  };

  // ------------------------------------------------------------------- bamboo: jointed canes and sprays of narrow leaves
  const bambooAt = (cx, s) => {
    reseed(300 + s);
    const canes = s === 3 ? [[-0.1, 1.05, 0], [0.16, 0.8, 0.12]] : s === 4 ? [[-0.3, 1.45, -0.05], [0.04, 1.75, 0.08], [0.32, 1.25, -0.02], [-0.06, 0.95, 0.3]] : [[-0.5, 1.8, -0.1], [-0.2, 2.35, 0.02], [0.1, 2.6, -0.12], [0.42, 2.1, 0.05], [0.62, 1.55, -0.1], [-0.28, 1.25, 0.34], [0.24, 1.35, 0.34]];
    canes.forEach(([dx, h, zz], j) => {
      const x = cx + dx, segs = Math.max(4, Math.round(h / 0.27)), seg = h / segs, r = 0.042 + s * 0.008, bow = between(-0.04, 0.04);
      const at = (t) => x + bow * t * t;
      for (let i = 0; i < segs; i++) {
        const Y = SOIL_Y - 0.02 + seg * i, t = i / segs;
        tube([[at(t), Y, zz], [at(t + 0.5 / segs), Y + seg * 0.5, zz], [at(t + 1 / segs), Y + seg - 0.008, zz]], r * (1 - t * 0.25), r * (1 - t * 0.25) * 0.94, (c, X, YY, Z, nx) => c.set(0x6fae3c).lerp(tmp.set(0xc4e36a), 0.42 + nx * 0.45), { radial: 12, along: 3 });
        cyl(r * (1.18 - t * 0.28), r * (1.18 - t * 0.28), 0.022, 0x5c9a3a, { x: at(t + 1 / segs), y: Y + seg, z: zz });
      }
      const sprays = Math.round(h * 2.6);
      for (let k = 0; k < sprays; k++) {
        const t = 0.42 + (k / sprays) * 0.6, Y = SOIL_Y + h * t, side = k % 2 ? 1 : -1, X = at(t), len = 0.28 + (1 - t) * 0.1;
        tube([[X, Y, zz], [X + side * len * 0.5, Y + 0.05, zz + 0.04], [X + side * len, Y + 0.02, zz + 0.09]], 0.009, 0.005, 0x6fae3c, { radial: 5, along: 4 });
        for (let n = 0; n < 5; n++) blade(X + side * len * (0.3 + n * 0.18), Y + 0.02 + (n % 2) * 0.02, zz + 0.05, [side * between(0.5, 1), between(-0.6, 0.12), between(-0.3, 0.6)], between(0.2, 0.3), between(0.04, 0.055), [0x6fb846, 0x9ad653, 0x54a03e, 0xb8e368][(n + k) % 4]);
      }
    });
    // A shoot or two at the foot.
    for (let i = 0; i < s; i++) place(new THREE.ConeGeometry(0.06, 0.26, 12), (c, X, Y) => c.set(0x6fae3c).lerp(tmp.set(0xd2e78c), Math.min(1, (Y - SOIL_Y) * 3)), { x: cx - 0.5 + i * 0.26, y: SOIL_Y + 0.11, z: 0.42 });
  };

  // ------------------------------------------------------------------- lotus: pads on the water, buds, and an open flower
  const padAt = (x, z, r) => {
    const g = new THREE.CircleGeometry(r, 26);
    g.rotateX(-Math.PI / 2);
    place(g, (c, X, Y, Z) => { const a = Math.atan2(Z - z, X - x); c.set(0x3f9c5e).lerp(tmp.set(0x8fd66a), 0.42 + Math.sin(a * 13) * 0.24); }, { x, y: SOIL_Y + 0.016, z });
    place(new THREE.TorusGeometry(r, 0.012, 6, 26), 0x7cc36a, { x, y: SOIL_Y + 0.016, z, rx: Math.PI / 2 });
  };
  const lotusFlower = (x, y, z, r) => {
    const rows = [[11, 1.0, 1.28, 0xf28ab2], [10, 0.88, 0.86, 0xf6a4c4], [8, 0.72, 0.46, 0xfdc8dc]];
    rows.forEach(([n, l, lean, col], row) => { for (let i = 0; i < n; i++) { const a = ((i + row * 0.5) / n) * Math.PI * 2; blade(x + Math.cos(a) * r * 0.1, y, z + Math.sin(a) * r * 0.1, [Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)], r * l, r * l * 0.36, (c, X, Y) => c.set(col).lerp(tmp.set(0xffeef4), Math.max(0, Math.min(0.7, (Y - y) / (r * 1.1)))), rnd() * 0.5); } });
    ball(r * 0.2, 0xf6cc4e, { x, y: y + r * 0.2, z, sy: 0.6 });
  };
  const lotusAt = (cx, s) => {
    reseed(400 + s);
    const pads = [[-0.42, 0.22, 0.2], [0.38, 0.28, 0.17], [0.1, -0.32, 0.2], [-0.2, -0.28, 0.14], [0.5, -0.12, 0.15], [-0.56, -0.08, 0.13]].slice(0, s + 1);
    pads.forEach(([dx, z, r]) => padAt(cx + dx, z, r));
    if (s === 0) ball(0.075, 0xe6d3a6, { x: cx + 0.1, y: SOIL_Y + 0.02, z: 0.2, sy: 0.6 });
    const stems = s < 2 ? [] : s === 2 ? [[0.02, 0.12, 0.3, 'bud', 0.17]] : s === 3 ? [[-0.05, 0.05, 0.56, 'bud', 0.24]] : s === 4 ? [[0.06, 0, 0.72, 'open', 0.36], [-0.34, 0.12, 0.34, 'bud', 0.2]] : [[0.02, 0, 1.0, 'open', 0.6], [-0.42, 0.12, 0.56, 'open', 0.36], [0.44, 0.1, 0.48, 'bud', 0.26]];
    stems.forEach(([dx, z, h, what, r]) => {
      const x = cx + dx, top = SOIL_Y + h;
      tube([[x, SOIL_Y, z], [x + 0.02, SOIL_Y + h * 0.5, z], [x, top, z]], 0.024, 0.018, 0x4f9a55, { radial: 8, along: 8 });
      if (what === 'open') lotusFlower(x, top, z, r);
      else for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; blade(x, top - r * 0.08, z, [Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2], r * 1.3, r * 0.5, i % 2 ? 0xf28ab2 : 0xf9b4ce, a); }
    });
  };

  if (!pass) for (let s = 0; s < 6; s++) {
    const cx = CX(s);
    if (plant === 'lotus') lotusAt(cx, s);
    else if (s === 0) seed(cx);
    else if (plant === 'bamboo' && s < 3) bambooShoot(cx, s);
    else if (s === 1) sprout(cx, plant === 'maple' ? 0xb5cf52 : 0x8acb4f);
    else if (plant === 'sunflower' && s === 2) greenShoot(cx);
    else if (plant === 'sunflower' && s >= 3) sunflowerAt(cx, s);
    else if (plant === 'bamboo' && s >= 3) bambooAt(cx, s);
    else if (s === 2) sapling(cx, plant === 'maple' ? [0xe9933c, 0xd9c84e, 0xf07a3c] : plant === 'sakura' ? [0x8acb4f, 0xb5e36c, 0xffb5cc] : [0x5fae3e, 0x8acb4f]);
    else tree(cx, s, plant);
  }
  groundV.finish();
  scene.children[scene.children.length - 1].userData.noMask = true;
  waterParts.forEach((m) => { m.userData.noMask = true; scene.add(m); });
  if (v.solid.length) v.finish();
  // A long lens from far away: every cell sees the plant the same way. The picture runs from 1.7 left of the first plant to 2.5 right of the last.
  // `&fw&fh&ox`: this page is one tile of a picture that size, from column ox.
  const FW = +(q.get('fw') || W), FH = +(q.get('fh') || H), OX = +(q.get('ox') || 0);
  const span = CELL * 6, pitch = PITCH_DEG * Math.PI / 180, dist = 130, tall = span * FH / FW;
  const centerX = 0.4, midY = (0.34 * tall) / Math.cos(pitch);
  const cam = new THREE.PerspectiveCamera(2 * Math.atan((tall / 2) / dist) * 180 / Math.PI, FW / FH, 1, 400);
  cam.position.set(centerX, midY + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  cam.lookAt(centerX, midY, 0);
  if (FW !== W || FH !== H) cam.setViewOffset(FW, FH, OX, 0, W, H);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  window.__rect = JSON.stringify({ tris: scene.children.reduce((n, m) => n + (m.geometry ? m.geometry.attributes.position.count / 3 : 0), 0) });
  return cam;
}
