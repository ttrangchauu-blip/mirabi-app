// Nhiệm vụ công việc: what's on the project map and the reward shelf. `&part=isles&theme=meadow` is a row of six islands of one theme, stage 0 to 5,
// on black, for cut-outs. `&part=sea` is the water they float on, a tile that repeats sideways. `&part=chests` is a row of three chests: locked, ready, opened.
import { kit } from './kit.js';
import { village } from './village.js';

const THEMES = {
  meadow: { ground: 0x93c965, edge: 0xc9b98a, roof: 0xe25a4c, tree: 'oak', wall: 0xf8f1e0 },
  forest: { ground: 0x6aa35a, edge: 0xb5a57c, roof: 0x8e6a4c, tree: 'deep', wall: 0xf1e6cf },
  beach: { ground: 0xf0dfae, edge: 0xe0cb92, roof: 0x4f9fd0, tree: 'lime', wall: 0xfbf4e2 },
  snow: { ground: 0xeef6fb, edge: 0xb8ccda, roof: 0x5c8fd6, tree: 'pine', wall: 0xf4f6f7 },
  desert: { ground: 0xf0c987, edge: 0xc99a5a, roof: 0x9b5de5, tree: 'gold', wall: 0xf6ead0 },
  sky: { ground: 0xd6e4ff, edge: 0xa3b8e8, roof: 0xf27baa, tree: 'blossom', wall: 0xfbf8f0 },
};

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'isles';
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night, start: 83 });
  const { reseed, between, rnd, tmp, place, box, cyl, ball, blob, roundTree, pine, bush, shell, window_, tones, finish } = v;
  const elev = 0.62;

  if (part === 'sea') {
    const SPAN = 6, TAU = Math.PI * 2;
    const wave = (x, k, ph) => Math.sin(x * TAU * k / SPAN + ph);
    const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40, Math.cos(elev) * 40], [0, 0, 0]);
    const g = new THREE.PlaneGeometry(SPAN * 3, 14, 1400, 700);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    // Long swells that run across the view and wander a little, like the sea in a clay model. Each breaks into lengths of pale crest.
    const swell = (x, z) => Math.sin(z * 6.5 + 1.15 * wave(x, 2, 0.5) + 0.55 * wave(x, 5, z * 0.5));
    const small = (x, z) => Math.sin(z * 14 + 1.4 * wave(x, 3, 2));
    const height = (x, z) => 0.034 * swell(x, z) + 0.009 * small(x, z);
    for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const deep = new THREE.Color(0x3e97be), mid = new THREE.Color(0x62b9d9), pale = new THREE.Color(0xa6e2f2);
    place(g, (c, x, y, z) => {
      const u = swell(x, z);
      c.copy(deep).lerp(mid, Math.max(0, Math.min(1, 0.52 + 0.2 * wave(x, 1, z * 0.8) + u * 0.34)));
      const lengths = 0.5 + 0.5 * wave(x, 3, z * 1.9 + 1) * 0.6 + 0.5 * wave(x, 8, -z * 2.3) * 0.4;
      c.lerp(pale, Math.max(0, Math.min(1, (u - 0.8) * 5)) * Math.max(0, Math.min(1, (lengths - 0.42) * 4)) * 0.85);
    });
    finish();
    window.__rect = '{}';
    return cam;
  }

  if (part === 'chests') {
    // One chest (`&state=0..2`: locked, ready, opened), seen from a corner, so the lid shows its curve.
    const YAW = 0.55, SPAN = 1.16, state = +(q.get('state') ?? 0);
    const dir = [Math.sin(YAW) * Math.cos(0.5), Math.sin(0.5), Math.cos(YAW) * Math.cos(0.5)];
    const cam = flatCamera(SPAN, W, H, [dir[0] * 30, dir[1] * 30 + 0.3, dir[2] * 30], [0, 0.3, 0]);
    const chest = (i, body, lidColor, band, open) => {
      const x = 0, w = 0.56, h = 0.24, d = 0.36;
      box(w, h, d, body, { x, y: h / 2 + 0.01, r: 0.03 });
      box(w + 0.012, 0.04, d + 0.012, band, { x, y: h * 0.72, r: 0.012 });
      [-0.22, 0.22].forEach((dx) => box(0.05, h + 0.012, d + 0.014, band, { x: x + dx, y: h / 2 + 0.012, r: 0.01 }));
      // Inside, seen when it is open.
      if (open) {
        box(w - 0.06, 0.012, d - 0.06, 0x4c3324, { x, y: h + 0.012, r: 0.003 });
        for (let k = 0; k < 16; k++) ball(between(0.03, 0.05), k % 3 ? 0xf6c945 : 0xfff0a8, { x: x + between(-0.22, 0.22), y: h + between(0.02, 0.07), z: between(-0.1, 0.1) });
      }
      // The lid: half a barrel, tipped back when open.
      const M = new THREE.Matrix4().makeTranslation(x, h + 0.01, -d / 2).multiply(new THREE.Matrix4().makeRotationX(open ? -1.8 : 0)).multiply(new THREE.Matrix4().makeTranslation(0, 0, d / 2));
      const shape = new THREE.CylinderGeometry(d / 2, d / 2, w, 24, 1, false, 0, Math.PI);
      shape.rotateZ(Math.PI / 2); shape.scale(1, 0.72, 1);
      place(shape, lidColor, { M });
      box(w - 0.02, 0.012, d - 0.02, 0x5a3c28, { y: 0.008, M, r: 0.003 });
      [-0.22, 0.22].forEach((dx) => { const b = new THREE.CylinderGeometry(d / 2 + 0.006, d / 2 + 0.006, 0.05, 24, 1, false, 0, Math.PI); b.rotateZ(Math.PI / 2); b.scale(1, 0.72, 1); place(b, band, { x: dx, M }); });
      if (!open) { box(0.09, 0.11, 0.03, band, { x, y: h * 0.78, z: d / 2 + 0.012, r: 0.012 }); ball(0.018, 0x5a6470, { x, y: h * 0.78, z: d / 2 + 0.03 }); }
    };
    if (state === 0) chest(0, 0xa7b4c0, 0x8f9ca8, 0x7f8c99, false);
    else chest(state, 0xc47a3d, 0xa9632f, 0xf6c945, state === 2);
    finish();
    window.__rect = '{}';
    return cam;
  }

  // Six islands in a row, one per stage of the project.
  const c = THEMES[q.get('theme') || 'meadow'] ?? THEMES.meadow;
  const SPAN = 6, cell = 1;
  const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40 + 0.32, Math.cos(elev) * 40], [0, 0.32, 0]);
  const shore = new THREE.Color(c.edge), top = new THREE.Color(c.ground), lit = new THREE.Color(c.ground).lerp(new THREE.Color(0xffffff), 0.14);
  const treeAt = (x, z, s, y) => {
    if (c.tree === 'pine') pine(x, z, s * 0.86, y);
    else roundTree(x, z, s * 0.7, c.tree, y);
  };
  const island = (i, stage) => {
    reseed(100 + i);
    const x0 = -SPAN / 2 + cell * (i + 0.5), Y = 0.1, r = 0.46;
    // A soft mound: rock at the waterline, grass on top.
    const pts = [[0, -0.06], [r + 0.02, -0.06], [r, 0], [r - 0.03, 0.05], [r - 0.09, Y], [r - 0.16, Y + 0.02], [0, Y + 0.03]].map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(pts, 48);
    g.computeVertexNormals();
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const a = Math.atan2(p.getZ(k), p.getX(k)), bump = 1 + 0.04 * Math.sin(a * 3 + i) + 0.025 * Math.sin(a * 7 + i * 2); p.setX(k, p.getX(k) * bump); p.setZ(k, p.getZ(k) * bump * 0.82); }
    g.computeVertexNormals();
    place(g, (col, X, y2) => col.copy(y2 < 0.055 ? shore : top).lerp(lit, y2 > 0.055 ? 0.5 + 0.5 * Math.sin(X * 19) * Math.cos(y2 * 31) : 0), { x: x0 });
    // Grass tufts and flowers, whatever the stage.
    for (let k = 0; k < 16; k++) {
      const a = between(0, 6.28), rr = between(0.08, 0.3), X = x0 + Math.cos(a) * rr, Z = Math.sin(a) * rr * 0.8;
      if (rnd() < 0.45) ball(0.014, tones[Math.floor(rnd() * 4)], { x: X, y: Y + 0.035, z: Z });
      else place(new THREE.ConeGeometry(0.014, 0.05, 5), (col) => col.copy(top).multiplyScalar(0.78), { x: X, y: Y + 0.05, z: Z });
    }
    // Stage 1: a wooden sign and the stones of a path.
    if (stage >= 1) {
      cyl(0.008, 0.01, 0.13, 0x8e5a34, { x: x0 - 0.27, y: Y + 0.08, z: 0.05 });
      box(0.12, 0.06, 0.012, 0xc98e5a, { x: x0 - 0.27, y: Y + 0.15, z: 0.058, r: 0.004 });
      for (let k = 0; k < 5; k++) place(new THREE.CylinderGeometry(0.022, 0.026, 0.008, 10), 0xe7d3a8, { x: x0 - 0.2 + k * 0.1, y: Y + 0.034, z: 0.18 - k * 0.012 + Math.sin(k) * 0.012 });
    }
    // Stage 2: a hut.
    if (stage >= 2) {
      const M = new THREE.Matrix4().makeTranslation(x0 + 0.24, Y + 0.03, -0.02).multiply(new THREE.Matrix4().makeRotationY(-0.3));
      const K = new THREE.Matrix4().makeScale(0.42, 0.42, 0.42);
      M.multiply(K);
      shell(M, { w: 0.46, d: 0.42, h: 0.34, rh: 0.2, wall: c.wall, roof: c.roof, eave: 0.06, base: false });
      box(0.11, 0.2, 0.012, 0x8e5a34, { y: 0.1, z: 0.218, M, r: 0.004 });
    }
    // Stage 3: a tree.
    if (stage >= 3) treeAt(x0 - 0.2, -0.12, 0.42, Y + 0.02);
    // Stage 4: the house.
    if (stage >= 4) {
      const M = new THREE.Matrix4().makeTranslation(x0 + 0.01, Y + 0.03, -0.1).multiply(new THREE.Matrix4().makeRotationY(0.16)).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5));
      shell(M, { w: 0.54, d: 0.5, h: 0.46, rh: 0.26, wall: c.wall, roof: c.roof, eave: 0.07, base: false });
      box(0.11, 0.22, 0.012, 0x8e5a34, { y: 0.11, z: 0.256, M, r: 0.004 });
      window_(M, -0.16, 0.3, 0.25, 0.1, 0.1, 0xfbf8f0, null, false);
      window_(M, 0.16, 0.3, 0.25, 0.1, 0.1, 0xfbf8f0, null, false);
    }
    // Stage 5: a flag and a second tree.
    if (stage >= 5) {
      cyl(0.006, 0.008, 0.3, 0x8a9aa8, { x: x0 + 0.01, y: Y + 0.5, z: -0.1 });
      box(0.11, 0.065, 0.006, 0xf6c945, { x: x0 + 0.07, y: Y + 0.61, z: -0.1, r: 0.002 });
      treeAt(x0 + 0.3, 0.1, 0.3, Y + 0.02);
    }
  };
  for (let i = 0; i < 6; i++) island(i, i);
  finish();
  window.__rect = '{}';
  return cam;
}
