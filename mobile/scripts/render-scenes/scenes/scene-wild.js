// Khám phá: an open valley with few trees, seen from far back through one real camera, that never ends. Everything is laid out by the picture's own columns `u`
// and by depth, and everything repeats with `u`: its noise, its road and its hills. A picture's right edge therefore meets the left edge of any other picture of the same layer,
// and the app slides them past at speeds that follow their depth. `&part=` far (mountains), mid (hills, the few trees, a stream), land (road and meadow), near (flowers close by).
// `&seg=0..2` which stretch of road and meadow, `&hill=0..1` which hills, `&front=0..1` which flowers. The sky is left out: the app draws the real one.
// `&still=1` mid without what sways; `&only=name` one of them alone for its mask. `&crop=x,y,w,h&fw=&fh=` a piece of the full picture.
import { kit } from './kit.js';
import { village } from './village.js';

const WIDE = 2.2;      // the picture's width over its height
const FOCAL = 2;       // the lens, in picture heights
const HORIZON = 0.24;  // the row of the horizon
const EYE = 1.44;      // the camera's height over the ground
const TAU = Math.PI * 2;
// The road's row across each stretch. Flat at both ends, on the same row: any stretch can follow any other.
const BEND = [[0.032, 1, 0, 0], [-0.024, 2, 0.012, 3], [0.03, 1, -0.018, 2]];
const ROAD_ROW = 0.425;
const roadRow = (u, seg) => { const [a, k, b, m] = BEND[seg], bump = (kk) => (1 - Math.cos(TAU * kk * u)) / 2; return ROAD_ROW + a * bump(k) + (m ? b * bump(m) : 0); };

export async function build({ THREE, scene, W, H, light }) {
  const { sky } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'all', only = q.get('only'), still = q.has('still');
  const seg = +(q.get('seg') || 0), hill = +(q.get('hill') || 0), front = +(q.get('front') || 0);
  const has = (p) => !only && (part === 'all' || part === p);
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.45], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0xa6d8fa, mid: 0xeaf6fc, low: 0xa8c47a, power: 0.86, sun: { dir: [-0.56, 0.7, 0.36], size: 9, power: 40, color: 0xfff2dc } });
  const v = village(THREE, scene, { night, start: 83 + seg * 7 + hill * 11 + front * 13 });
  const { reseed, rnd, between, lumps, tmp, place, cyl, blob, LEAF, roundTree, finish } = v;
  LEAF.vivid = [0x4c9a2c, 0xc6e650]; LEAF.bright = [0x3f8f34, 0xa9dc4e]; LEAF.pink = [0xe58bb4, 0xffd9e8]; LEAF.far = [0x2f7f4e, 0x74b862]; LEAF.pine = [0x276e52, 0x6fb587]; LEAF.leafy = [0x37893a, 0x8fce52]; LEAF.gold = [0xd2a64a, 0xf6dd8c];

  const depthAt = (r) => (EYE * FOCAL) / (r - HORIZON);
  // A picture's column goes by the depth along the camera's axis, not along the ground: the pitch makes them differ, most of all near the camera. With this one, a column means the same at every depth, and pictures meet.
  const PITCH = Math.atan((0.5 - HORIZON) / FOCAL), axis = (d, y) => d * Math.cos(PITCH) + (EYE - y) * Math.sin(PITCH);
  const xAt = (u, d, y = 0) => (u - 0.5) * WIDE * axis(d, y) / FOCAL;
  const uAt = (x, d, y = 0) => x * FOCAL / (WIDE * axis(d, y)) + 0.5;
  const heightFor = (r, d) => EYE - (r - HORIZON) * d / FOCAL;
  const wave = (u, k, p = 0) => Math.sin(TAU * k * u + p);

  /** Noise that repeats with `u` and keeps its size on the ground however far away it is: each whole number of waves across the picture counts where it has about the size asked for. */
  const OCTAVES = [2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];
  const grain = (u, d, f, seed) => {
    let sum = 0, weight = 0;
    const want = f * (WIDE / FOCAL) * d;
    for (let i = 0; i < OCTAVES.length; i++) {
      const k = OCTAVES[i], far = Math.log2(k / want), w = Math.exp(-far * far * 1.4);
      if (w < 0.02) continue;
      sum += w * Math.sin(TAU * k * u + d * f * 2.3 * (1 + i * 0.13) + seed * 2.1 + i * 1.7 + 1.5 * Math.sin(TAU * OCTAVES[Math.max(0, i - 2)] * u + d * f * 1.1 + seed + i) + 0.9 * Math.sin(TAU * OCTAVES[Math.max(0, i - 3)] * u - d * f * 0.7 + i * 2.3));
      weight += w;
    }
    return weight ? sum / weight : 0;
  };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /** Back to zero towards the picture's edges: what belongs to one stretch only never reaches the next. */
  const inside = (u, m = 0.1) => smooth(0, m, u) * (1 - smooth(1 - m, 1, u));

  const roadD = (u) => depthAt(roadRow(((u % 1) + 1) % 1, seg));
  const ROAD_HALF = 1.15;
  const fromRoad = (u, d) => Math.abs(d - roadD(u));
  const clearOfRoad = (u, d, pad = 0) => fromRoad(u, d) > ROAD_HALF + pad;
  // A little rolling near the road, then a soft swell behind it: the meadow ends against the hills in a natural line.
  const SWELL = 21;
  const landY = (u, d) => 0.035 * wave(u, 5, d * 0.3) + smooth(SWELL, SWELL + 5, d) * (0.26 + 0.1 * wave(u, 3, 0.4) + 0.05 * wave(u, 8, 1.1)) - smooth(SWELL + 7, SWELL + 13, d) * 1.2;
  // The hills behind climb to crests far away, one rise behind another.
  const hillY = (u, d) => { const t = smooth(26, 92, d), own = inside(u, 0.14), roll = 0.9 + 0.3 * wave(u, 3, 0.6) + own * (0.62 * wave(u, 2, 0.6 + hill * 2) + 0.3 * wave(u, 5, 2 + hill) + 0.12 * wave(u, 11, hill)); return t * (2.9 + roll * 1.25) + 0.22 * smooth(26, 50, d) * (0.5 * wave(u, 2, d * 0.09) + own * 0.5 * wave(u, 4, d * 0.09 + hill)); };
  // The stream: comes down from the hills, runs behind the meadow, and goes back up into them, so it never reaches the picture's edge.
  const streamD = (u) => 27.5 + 84 * Math.pow(Math.abs(Math.cos(Math.PI * u)), 1.5) + 2.2 * wave(u, 4, 1) + 1.1 * wave(u, 9, 2);
  const hasStream = hill === 0;

  const A = new THREE.Color(0x76b652), B = new THREE.Color(0x8ac45c), C = new THREE.Color(0xa4d26c), Dry = new THREE.Color(0xc4dc72), Deep = new THREE.Color(0x4f9c3c), Far = new THREE.Color(0x96cf7a), Sand = new THREE.Color(0xddc99c), Sand2 = new THREE.Color(0xeadbb4), Wet = new THREE.Color(0xbba77c), Water = new THREE.Color(night ? 0x5f8fd0 : 0x74cdee), Shine = new THREE.Color(night ? 0x93b6e8 : 0xc6eef9), Bank = new THREE.Color(0xc9d596);
  // Where the second stretch has its flower field and the third its long dry grass, tinting the ground under them.
  const fieldAt = (u, d) => (seg !== 1 ? 0 : inside(u, 0.16) * smooth(5.5, 7.5, d) * (1 - smooth(11.5, 12.8, d)) * (0.72 + grain(u, d, 0.9, 8) * 0.5));
  const dryAt = (u, d) => (seg !== 2 ? 0 : inside(u, 0.2) * (1 - smooth(10, 12, d)) * Math.max(0, 0.5 + grain(u, d, 0.22, 9) * 0.8));
  const paintGround = (c, u, d) => {
    const n = grain(u, d, 0.34, 1) * 0.62 + grain(u, d, 1.1, 2) * 0.3 + grain(u, d, 4.2, 3) * 0.13 + grain(u, d, 17, 4) * 0.05 + grain(u, d, 41, 5) * 0.03;
    c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.46 + n)));
    if (n > 0.2) c.lerp(C, Math.min(0.9, (n - 0.2) * 1.7));
    if (n < -0.22) c.lerp(Deep, Math.min(0.55, (-0.22 - n) * 1.2));
    if (n > 0.48) c.lerp(Dry, Math.min(0.4, (n - 0.48) * 1.5));
    c.lerp(Far, Math.max(0, Math.min(0.72, (d - 22) / 50)));
    const dry = dryAt(u, d); if (dry > 0) c.lerp(Dry, Math.min(0.5, dry * 0.7));
    const field = fieldAt(u, d); if (field > 0) c.lerp(tmp.set(0xb7dc74), Math.min(0.55, field * 0.6));
    if (hasStream && d > 24 && inside(u, 0.05) > 0) {
      const e = Math.abs(d - streamD(((u % 1) + 1) % 1)) + grain(u, d, 2.4, 6) * 0.18, half = 0.5 + d * 0.012;
      if (e < half + 0.7) c.lerp(Bank, smooth(half + 0.7, half, e) * 0.8 * inside(u, 0.05));
      if (e < half + 0.14) { tmp.copy(Water).lerp(Shine, Math.max(0, Math.min(1, 0.32 + grain(u, d, 5, 7) * 0.9))); c.lerp(tmp, smooth(half + 0.14, half - 0.06, e) * inside(u, 0.05)); }
    }
    // The road, worn into the grass, darker along its edges and lighter along the middle.
    const road = fromRoad(u, d) + grain(u, d, 2.3, 7) * 0.13 + grain(u, d, 7.5, 8) * 0.05;
    const on = Math.max(0, Math.min(1, (ROAD_HALF + 0.13 - road) / 0.26));
    if (on > 0) {
      tmp.copy(Sand).lerp(Sand2, Math.max(0, Math.min(1, 0.5 + grain(u, d, 3.6, 9) * 0.8)));
      if (road > ROAD_HALF * 0.72) tmp.lerp(Wet, 0.24 * Math.min(1, (road - ROAD_HALF * 0.72) * 3));
      c.lerp(tmp, on * on * (3 - 2 * on));
    }
  };
  /** Ground laid out by the picture's rows and columns, so its detail is even on the screen. */
  const ground = (r0, r1, cols, rows, y) => {
    const g = new THREE.PlaneGeometry(1, 1, cols, rows), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = -0.1 + (p.getX(i) + 0.5) * 1.2, r = r0 + (0.5 - p.getY(i)) * (r1 - r0), d = depthAt(r), h = y(u, d); p.setXYZ(i, xAt(u, d, h), h, -d); }
    g.computeVertexNormals();
    place(g, (c, X, Y, Z) => paintGround(c, uAt(X, -Z, Y), -Z));
  };

  // Grass: thin blades bending away from each other, the colour of the ground under them.
  const bentBlade = (lean, tall, wide) => {
    const g = new THREE.ConeGeometry(wide, tall, 3, 3, false); g.translate(0, tall / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / tall; p.setX(i, p.getX(i) + lean * t * t * tall); }
    g.computeVertexNormals();
    return g;
  };
  const BLADES = [-0.7, -0.35, 0.05, 0.4, 0.8].map((lean, i) => { const g = bentBlade(lean, 1 - Math.abs(i - 2) * 0.16, 0.05); g.translate((i - 2) * 0.05, 0, (i % 2) * 0.05 - 0.02); return g; });
  const groundColor = new THREE.Color(), tipColor = new THREE.Color();
  const tuftOnce = (u, d, tall, y, deep, tip, count) => {
    const x = xAt(u, d, y);
    paintGround(groundColor, u, d);
    const base = groundColor.clone().multiplyScalar(deep), top = groundColor.clone().lerp(tipColor.set(tip), 0.55), turn = rnd() * 6.3;
    for (let i = 0; i < count; i++) place(BLADES[i], (c, X, Y) => c.copy(base).lerp(top, Math.max(0, Math.min(1, (Y - y) / tall))), { x, y, z: -d, sx: tall, sy: tall * between(0.8, 1.15), sz: tall, ry: turn });
  };
  /** What is small may cross the picture's edge: it stands on both sides of it. */
  const bothSides = (u, fn, m = 0.016) => { fn(u); if (u < m) fn(u + 1); else if (u > 1 - m) fn(u - 1); };
  const tuftAt = (u, d, tall, y = 0, deep = 0.72, tip = 0xbfe072, count = 5) => bothSides(u, (w) => tuftOnce(w, d, tall, y, deep, tip, count));
  const disc = new THREE.CylinderGeometry(1, 0.9, 0.2, 7), heart = new THREE.SphereGeometry(1, 6, 4);
  const floret = (u, d, y, r, colour) => bothSides(u, (w) => { const x = xAt(w, d, y); place(disc, colour, { x, y, z: -d, rx: 0.62, sx: r, sy: r, sz: r }); place(heart, 0xf2c23a, { x, y: y + r * 0.2, z: -d + r * 0.15, sx: r * 0.42, sy: r * 0.3, sz: r * 0.42 }); });

  // ---------------------------------------------------------------- far
  // A range of mountains: real peaks and shoulders, paler towards the foot, where the air is thickest. Seen through a wedge, so it repeats with `u`.
  const ridge = (d, row, amp, tint, ph, pale = 0xd6edf6) => {
    const y0 = heightFor(row, d), g = new THREE.PlaneGeometry(1, 400, 1000, 60), v3 = g.attributes.position, span = amp * d;
    const peaks = (u) => { const sharp = (k, p) => 1 - Math.abs(Math.sin(Math.PI * k * u + p)); return sharp(3, ph) * 0.62 + sharp(7, ph * 2) * 0.3 + sharp(17, ph * 3) * 0.13 + sharp(37, ph) * 0.05 - 0.55; };
    for (let i = 0; i < v3.count; i++) { const u = -0.2 + (v3.getX(i) + 0.5) * 1.4, t = (v3.getY(i) + 200) / 400, y = y0 - 400 + t * (400 + span * peaks(u)); v3.setXYZ(i, xAt(u, d, y), y, 0); }
    g.computeVertexNormals();
    const top = new THREE.Color(night ? new THREE.Color(tint).multiplyScalar(0.8).getHex() : tint), foot = new THREE.Color(night ? new THREE.Color(pale).multiplyScalar(0.42).getHex() : pale);
    place(g, (c, X, Y) => c.copy(top).lerp(foot, Math.max(0, Math.min(0.62, (y0 + span * 0.5 - Y) / (span * 1.6)))), { z: -d });
  };
  if (has('far')) {
    ridge(600, 0.112, 0.062, 0x9ccdec, 1.1);
    ridge(430, 0.15, 0.05, 0x7cb9e0, 3.4);
    ridge(320, 0.183, 0.03, 0x62b0bf, 0.2, 0xbfe4dc);
    ridge(240, 0.205, 0.012, 0x62b796, 2.1, 0xb0dfc4);
  }

  // ---------------------------------------------------------------- mid
  // The few trees of each hill picture, far from each other and of different kinds. The first few sway. Nothing tall is near the picture's edge.
  const SWAYS = hill === 0
    ? { t1: { u: 0.17, d: 29, s: 2.05, k: 'vivid' }, t2: { u: 0.62, d: 31, s: 1.65, k: 'pink' }, t3: { u: 0.86, d: 30, s: 1.85, k: 'leafy' } }
    : { t1: { u: 0.1, d: 31, s: 1.6, k: 'pink' }, t2: { u: 0.43, d: 29, s: 2.15, k: 'bright' }, t3: { u: 0.76, d: 30, s: 1.75, k: 'vivid' } };
  const tree = (name) => { const t = SWAYS[name], x = xAt(t.u, t.d); reseed(100 + hill * 50 + name.charCodeAt(1) * 7); roundTree(x, -t.d, t.s, t.k, hillY(t.u, t.d) - 0.02); };
  if (has('mid')) {
    ground(0.262, 0.5, 700, 190, hillY); // From the row of a depth far past the crests: above the horizon a row has no ground.
    // Far off, a tree is a few pixels: few triangles.
    const puff = new THREE.IcosahedronGeometry(1, 1), spire = new THREE.ConeGeometry(1, 1, 7);
    const shade = (dark, lit) => { const D = new THREE.Color(dark), L = new THREE.Color(lit); return (c, X, Y, Z, nx, ny) => c.copy(D).lerp(L, Math.max(0, Math.min(1, 0.45 + ny * 0.45 + lumps(X * 2, Y * 2, Z * 2) * 0.16))); };
    const smallRound = (x, d, s, kind, y) => { const [D, L] = LEAF[kind], paint = shade(D, L); cyl(0.07 * s, 0.1 * s, 0.7 * s, 0x7a5a42, { x, y: y + 0.35 * s, z: -d, seg: 5 }); [[0, 1.0, 0.52], [-0.34, 0.8, 0.36], [0.34, 0.84, 0.38], [0.02, 1.42, 0.36]].forEach(([dx, dy, r]) => place(puff, paint, { x: x + dx * s, y: y + dy * s, z: -d, sx: r * s, sy: r * s * 0.92, sz: r * s })); };
    const smallPine = (x, d, s, y) => { const [D, L] = LEAF.pine, paint = shade(D, L); cyl(0.05 * s, 0.07 * s, 0.3 * s, 0x6a4c38, { x, y: y + 0.15 * s, z: -d, seg: 5 }); [[0.42, 0.52, 0.7], [0.32, 0.92, 0.62], [0.2, 1.28, 0.54]].forEach(([r, h, t]) => place(spire, paint, { x, y: y + h * s, z: -d, sx: r * s, sy: t * s, sz: r * s })); };
    // A small group: [u, depth, how many, spread, size, kinds], with room between it and the next one.
    const groups = hill === 0
      ? [[0.32, 58, 4, 0.03, 1.5, ['far', 'pine', 'leafy']], [0.46, 42, 3, 0.02, 1.35, ['pine', 'gold']], [0.74, 62, 3, 0.022, 1.5, ['far', 'pine']], [0.08, 70, 3, 0.024, 1.6, ['far', 'bright']]]
      : [[0.25, 44, 3, 0.02, 1.4, ['leafy', 'pine']], [0.6, 62, 5, 0.035, 1.5, ['far', 'pine', 'pink']], [0.92, 52, 3, 0.02, 1.35, ['gold', 'far']], [0.36, 74, 3, 0.022, 1.6, ['far', 'pine']]];
    reseed(29 + hill);
    groups.forEach(([u0, d0, n, spread, size, kinds]) => {
      for (let i = 0; i < n; i++) {
        const u = u0 + between(-spread, spread), d = d0 + between(-3.5, 3.5), x = xAt(u, d), s = size * between(0.75, 1.2), y = hillY(u, d) - 0.03, kind = kinds[Math.floor(rnd() * kinds.length)];
        if (kind === 'pine') smallPine(x, d, s * 1.3, y); else smallRound(x, d, s, kind, y);
      }
    });
    if (!still) Object.keys(SWAYS).forEach(tree);
    reseed(53 + hill);
    for (let i = 0; i < 2100; i++) {
      const u = rnd(), d = between(24, 46), y = hillY(u, d);
      if (hasStream && Math.abs(d - streamD(u)) < 1.2) continue;
      if (rnd() < 0.2) floret(u, d, y + 0.1, 0.06, [0xfffdf2, 0xffc6dc, 0xffe36a, 0xffffff][Math.floor(rnd() * 4)]);
      else tuftAt(u, d, d * 0.0115 * between(0.8, 1.3), y, 0.76, 0xbfe072, 3);
    }
  }
  if (only) { const f = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x000000 })); f.rotation.x = -Math.PI / 2; f.position.y = -0.05; f.userData.noMask = true; scene.add(f); tree(only); }

  // ---------------------------------------------------------------- land
  const stone = (u, d, s, y = 0, grey = 0xd9d6cb) => place(new THREE.IcosahedronGeometry(1, 3), (c, X, Y, Z) => c.set(grey).multiplyScalar(0.86 + lumps(X * 7, Y * 7, Z * 7) * 0.14 + between(0, 0.05)), { x: xAt(u, d), y: y + s * 0.3, z: -d, sx: s * 1.15, sy: s * 0.72, sz: s * 0.9, ry: rnd() * 3 });
  const petal = new THREE.SphereGeometry(1, 10, 8);
  const bloom = (u, d, h, r, color, y = 0) => {
    const x = xAt(u, d);
    cyl(0.012 * (r / 0.1), 0.017 * (r / 0.1), h, 0x4f9a35, { x, y: y + h / 2, z: -d, seg: 6 });
    for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; place(petal, color, { x: x + Math.cos(a) * r * 0.62, y: y + h + Math.sin(a) * r * 0.46, z: -d + 0.01, sx: r * 0.44, sy: r * 0.3, sz: r * 0.13, rz: a }); }
    place(petal, 0xf6c438, { x, y: y + h, z: -d + 0.03, sx: r * 0.32, sy: r * 0.28, sz: r * 0.2 });
  };
  const bushy = (u, d, s, kind, y = 0) => { const x = xAt(u, d), [D, L] = LEAF[kind]; blob(0.42 * s, x, y + 0.26 * s, -d, D, L, { flat: 0.74 }); blob(0.3 * s, x - 0.42 * s, y + 0.17 * s, -d + 0.08, D, L, { flat: 0.74 }); blob(0.32 * s, x + 0.42 * s, y + 0.19 * s, -d - 0.05, D, L, { flat: 0.74 }); };
  if (has('land')) {
    ground(0.3, 1.06, 880, 330, landY);
    // The meadow's grass, in soft drifts: thin in the bare patches, none on the road. The third stretch is the long grass.
    reseed(73 + seg);
    for (let n = 0; n < 9500; n++) {
      const u = rnd(), r = 0.32 + Math.pow(rnd(), 1.15) * 0.7, d = depthAt(r);
      if (!clearOfRoad(u, d, 0.03)) continue;
      const dry = dryAt(u, d);
      if (grain(u, d, 0.34, 1) < 0.02 && dry < 0.2 && rnd() < 0.55) continue;
      tuftAt(u, d, Math.max(0.1, d * 0.0115) * between(0.8, 1.3) * (1 + dry * 0.9), landY(u, d), rnd() < 0.3 ? 0.62 : 0.76, dry > 0.2 ? 0xdde07a : 0xbfe072, rnd() < 0.5 ? 5 : 3);
    }
    // Little groups of flowers everywhere; a whole field of them on the second stretch.
    reseed(79 + seg);
    const colours = [0xfffdf2, 0xffc6dc, 0xffe36a, 0xffffff, 0xfff3a0];
    const little = (u, d, col) => { const k = Math.max(0.9, Math.min(2, d / 9)), y = landY(u, d); cyl(0.004 * k, 0.005 * k, 0.05 * k, 0x4f9a35, { x: xAt(u, d), y: y + 0.025 * k, z: -d, seg: 5 }); floret(u, d, y + 0.055 * k, 0.019 * k, col); };
    for (let g = 0; g < (seg === 1 ? 70 : 95); g++) {
      const u0 = rnd(), r = 0.335 + Math.pow(rnd(), 1.05) * 0.56, d0 = depthAt(r), col = colours[Math.floor(rnd() * 5)], many = 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < many; i++) { const u = (u0 + between(-0.004, 0.004) * Math.min(2, 9 / d0 + 0.6) + 1) % 1, d = d0 + between(-0.3, 0.3) * Math.max(0.9, d0 / 9); if (clearOfRoad(u, d, 0.06)) little(u, d, col); }
    }
    if (seg === 1) {
      for (let n = 0; n < 2400; n++) { const u = rnd(), d = between(5.5, 12.8); if (rnd() < fieldAt(u, d) && clearOfRoad(u, d, 0.06)) little(u, d, [0xffc6dc, 0xffffff, 0xffe36a, 0xf9a8c8, 0xc9b6f2][Math.floor(rnd() * 5)]); }
    }
    // A few stones and low bushes, far apart, none near the picture's edge.
    reseed(89 + seg);
    const props = [
      [[0.14, 0.545, 0.2], [0.42, 0.51, 0.14], [0.73, 0.575, 0.22]],
      [[0.09, 0.5, 0.13], [0.88, 0.53, 0.18]],
      [[0.26, 0.57, 0.2], [0.6, 0.5, 0.13], [0.84, 0.56, 0.21]],
    ][seg];
    props.forEach(([u, r, s]) => { const d = depthAt(r); stone(u, d, s); for (let i = 0; i < 4; i++) tuftAt(u + between(0.003, 0.012), d + between(-0.2, 0.2), 0.15, 0); });
    const bushes = [[[0.3, 0.378, 0.62, 'leafy'], [0.82, 0.385, 0.5, 'bright']], [[0.55, 0.38, 0.6, 'vivid']], [[0.12, 0.382, 0.55, 'bright'], [0.5, 0.376, 0.66, 'leafy'], [0.91, 0.386, 0.5, 'vivid']]][seg];
    bushes.forEach(([u, r, s, kind]) => bushy(u, depthAt(r), s, kind, landY(u, depthAt(r))));
    for (let i = 0; i < 24; i++) { const u = between(0.03, 0.97), r = between(0.5, 0.74), d = depthAt(r); if (clearOfRoad(u, d, 0.2)) bloom(u, d, between(0.08, 0.15), between(0.028, 0.044), [0xfffdf4, 0xffc7dd, 0xffe36a][Math.floor(rnd() * 3)]); }
    // Small pebbles at the road's edge.
    reseed(91 + seg);
    for (let i = 0; i < 22; i++) { const u = between(0.02, 0.98), side = rnd() < 0.5 ? -1 : 1, d = roadD(u) + side * (ROAD_HALF + between(0.03, 0.26)); stone(u, d, between(0.03, 0.06), 0, 0xcfc7b4); }
  }

  // ---------------------------------------------------------------- near
  if (has('near')) {
    // A few stones and big flowers close to the camera, far apart along the bottom of the picture. The app blurs this layer a little and slides it fastest, so they read as near.
    reseed(97 + front);
    const near = front === 0
      ? [[0.1, 0.9, 'daisy'], [0.3, 0.94, 'stone'], [0.53, 0.9, 'pink'], [0.77, 0.94, 'daisy']]
      : [[0.18, 0.94, 'pink'], [0.42, 0.9, 'daisy'], [0.66, 0.95, 'stone'], [0.88, 0.91, 'pink']];
    near.forEach(([u, r, kind]) => {
      const d = depthAt(r);
      for (let i = 0; i < 44; i++) tuftOnce(u + between(-0.026, 0.026), d + between(-0.16, 0.16), 0.115 * between(0.7, 1.15), 0, 0.8, 0xbfe072, 5);
      if (kind === 'stone') stone(u, d, between(0.11, 0.15), 0, 0xc9c7bd);
      else for (let i = 0; i < (kind === 'daisy' ? 5 : 4); i++) bloom(u + between(-0.016, 0.016), d + between(-0.08, 0.08), between(0.14, 0.26), kind === 'daisy' ? between(0.05, 0.07) : between(0.044, 0.066), kind === 'daisy' ? (rnd() < 0.8 ? 0xfffdf4 : 0xffe892) : (rnd() < 0.72 ? 0xf98fb8 : 0xffc2d8));
    });
  }
  finish();
  const pitch = Math.atan((0.5 - HORIZON) / FOCAL);
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(0.5 / FOCAL) * 180 / Math.PI, W / H, 0.2, 2000);
  cam.position.set(0, EYE, 0);
  cam.rotation.set(-pitch, 0, 0);
  const crop = (q.get('crop') || '').split(',').map(Number);
  if (crop.length === 4) { const fw = +(q.get('fw') || 3080), fh = +(q.get('fh') || 1400); cam.aspect = fw / fh; cam.setViewOffset(fw, fh, crop[0], crop[1], crop[2], crop[3]); }
  else cam.aspect = W / H;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  // The road as the camera sees it, for the pet's feet: [column, row, how many picture heights one unit stands there].
  const road = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40, d = depthAt(roadRow(u, seg)), p = new THREE.Vector3(xAt(u, d), 0, -d).project(cam), up = new THREE.Vector3(xAt(u, d), 1, -d).project(cam);
    road.push([+u.toFixed(4), +(0.5 - p.y * 0.5).toFixed(4), +((p.y - up.y) * -0.5).toFixed(4)]);
  }
  window.__rect = JSON.stringify({ road });
  return cam;
}
