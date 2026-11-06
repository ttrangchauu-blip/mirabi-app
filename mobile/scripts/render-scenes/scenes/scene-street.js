// The friends' street as one place: a real camera with perspective, a low sun with real shadows, and six plots along a lane.
// `&lots=none|odd|even|all` says which plots have their house, garden path and letterbox: the app lays a patch of the picture
// with a house over the picture without, so each house keeps the shadow it casts on its own ground. The sky is left out: the app draws it.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { kit } from './kit.js';

export const LOTS = 6, LOT = 1.83;
export async function build({ THREE, scene, W, H, light }) {
  const { mat, glow, sky } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const lots = q.get('lots') || 'all';
  const night = light === 'night';
  const SUN = [-0.62, 0.62, 0.62];
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: SUN, size: 9, power: 46, color: 0xfff0d8 } });

  let seed = 41;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
  const between = (a, b) => a + (b - a) * rnd();
  const lumps = (x, y, z) => Math.sin(x * 2.1 + z * 1.3 + 1.2) * Math.cos(y * 2.4 - x * 0.8) * 0.55 + Math.sin(y * 4.3 + z * 3.7) * Math.cos(x * 3.9 + 0.7) * 0.28 + Math.sin(x * 7.3 + y * 6.1 + z * 5.3) * 0.1;
  const color = new THREE.Color(), tmp = new THREE.Color();

  // Everything matte goes into one mesh, its colour per vertex.
  const solid = [];
  const place = (geo, paint, o = {}) => {
    const g = (geo.index ? geo.toNonIndexed() : geo).clone();
    g.deleteAttribute('uv'); g.deleteAttribute('uv1');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)), new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    if (o.M) m.premultiply(o.M);
    g.applyMatrix4(m);
    const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      if (typeof paint === 'function') paint(color, p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)); else color.set(paint);
      c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    (o.into ?? solid).push(g);
  };
  const box = (w, h, d, paint, o = {}) => place(new RoundedBoxGeometry(w, h, d, 2, Math.min(o.r ?? 0.018, Math.min(w, h, d) * 0.49)), paint, o);
  const cyl = (rt, rb, h, paint, o = {}) => place(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 16), paint, o);
  const ball = (r, paint, o = {}) => place(new THREE.SphereGeometry(r, 16, 12), paint, o);

  /** A soft lump of leaves, dark underneath and lit on top, never quite one colour. */
  const lumpGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    return mergeVertices(g);
  })();
  const blob = (r, x, y, z, dark, lit, o = {}) => {
    const g = lumpGeo.clone(), p = g.attributes.position, off = rnd() * 40, rough = o.rough ?? 0.16;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), k = 1 + lumps(X * 1.5 + off, Y * 1.5, Z * 1.5) * rough;
      p.setXYZ(i, X * k * r, Y * k * r * (o.flat ?? 0.92), Z * k * r);
    }
    g.computeVertexNormals();
    const D = new THREE.Color(dark), L = new THREE.Color(lit);
    place(g, (c, X, Y, Z, nx, ny) => {
      const v = 0.42 + ny * 0.42 + lumps(X * 3 + off, Y * 3, Z * 3) * 0.22;
      c.copy(D).lerp(L, Math.max(0, Math.min(1, v)));
    }, { x, y, z, ...o.place });
  };
  const LEAF = { oak: [0x4f8a4e, 0x9ccb70], lime: [0x6f9c4e, 0xc2d97c], deep: [0x41805c, 0x82b474], pine: [0x3b7564, 0x78ac88], blossom: [0xdc98ac, 0xfbdde2], gold: [0xcfa24a, 0xf4dc90] };
  const roundTree = (x, z, s, kind = 'oak', y = 0) => {
    const [d, l] = LEAF[kind], h = 0.62 * s;
    cyl(0.05 * s, 0.085 * s, h, 0x7a5a42, { x, y: y + h / 2, z });
    cyl(0.03 * s, 0.04 * s, 0.34 * s, 0x7a5a42, { x: x + 0.09 * s, y: y + h * 0.92, z, rz: -0.6 });
    blob(0.42 * s, x, y + h + 0.3 * s, z, d, l);
    const n = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(), r = 0.3 * s * between(0.8, 1.2);
      blob(between(0.22, 0.33) * s, x + Math.cos(a) * r, y + h + between(0.08, 0.5) * s, z + Math.sin(a) * r * 0.9, d, l);
    }
    blob(0.26 * s, x + between(-0.08, 0.08) * s, y + h + 0.68 * s, z, d, l);
  };
  const pine = (x, z, s, y = 0) => {
    cyl(0.04 * s, 0.06 * s, 0.3 * s, 0x6a4c38, { x, y: y + 0.15 * s, z });
    const [d, l] = LEAF.pine;
    [[0.42, 0.34], [0.34, 0.68], [0.25, 0.98], [0.14, 1.24]].forEach(([r, h], i) => {
      const g = new THREE.ConeGeometry(r * s, 0.56 * s, 18, 3);
      place(g, (c, X, Y, Z, nx, ny) => c.copy(new THREE.Color(d)).lerp(new THREE.Color(l), Math.max(0, Math.min(1, 0.25 + ny * 0.5 + i * 0.1 + lumps(X * 6, Y * 6, Z * 6) * 0.2))), { x, y: y + h * s + 0.12 * s, z });
    });
  };
  const bush = (x, z, s, kind = 'deep', y = 0) => {
    const [d, l] = LEAF[kind];
    blob(0.2 * s, x, y + 0.13 * s, z, d, l, { flat: 0.8 });
    blob(0.14 * s, x - 0.17 * s, y + 0.09 * s, z + 0.03, d, l, { flat: 0.8 });
    blob(0.15 * s, x + 0.17 * s, y + 0.1 * s, z - 0.02, d, l, { flat: 0.8 });
  };

  // --- The land: a soft rise behind the plots, which ends in a ridge; the sky begins above it.
  const rise = (x, z) => {
    const t = Math.max(0, Math.min(1, (-z - 1.7) / 5.9));
    return t * t * (0.56 + 0.12 * Math.sin(x * 0.55 + 0.9) + 0.06 * Math.sin(x * 1.3 + 2.4)) + 0.02 * Math.sin(x * 2.2 + z * 1.7) * Math.min(1, t * 4);
  };
  {
    const g = new THREE.PlaneGeometry(26, 12.6, 420, 180);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, -1.3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, rise(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const A = new THREE.Color(0x7fae5c), B = new THREE.Color(0x9cc26c), C = new THREE.Color(0xb3cc7e), Far = new THREE.Color(0x9fbf8a);
    place(g, (c, X, Y, Z) => {
      const n = lumps(X * 0.9, Z * 0.9, X * 0.4) * 0.7 + lumps(X * 2.7, Z * 2.3, 1) * 0.35;
      c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n)));
      if (n > 0.42) c.lerp(C, Math.min(1, (n - 0.42) * 2));
      c.lerp(Far, Math.max(0, Math.min(0.6, (-Z - 2) / 7)));
    });
  }
  /** Far hills, paler with each step away, cut out of the air. */
  const ridge = (z, y0, amp, tint, f, ph) => {
    const n = 200, g = new THREE.PlaneGeometry(90, 12, n, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i); p.setY(i, 0); p.setY(i, y0 + amp * (Math.sin(x * f + ph) * 0.6 + Math.sin(x * f * 2.3 + ph * 2) * 0.28 + Math.sin(x * f * 5.1 + ph) * 0.1)); } else p.setY(i, y0 - 12);
    g.computeVertexNormals();
    place(g, tint, { z });
  };
  ridge(-19, -1.15, 0.3, 0xa9cfae, 0.33, 1);
  ridge(-30, -2.8, 0.5, 0xc4e0d2, 0.2, 2.6);

  // --- The lane: paving and a low kerb in front of the plots, and a lane the colour of the system's mist.
  const FENCE = 1.56;
  for (let x = -13; x < 13; x += 0.31) {
    for (let row = 0; row < 3; row++) {
      const off = row % 2 ? 0.155 : 0;
      const tone = 0xd8d2c4 + (Math.floor(rnd() * 3) * 0x050505);
      box(0.29, 0.03, 0.22, tone, { x: x + off, y: 0.015, z: 1.84 + row * 0.24, r: 0.012 });
    }
  }
  box(26, 0.06, 0.1, 0xc8c5bb, { y: 0.02, z: 2.52, r: 0.02 });
  box(26, 0.05, 3.2, (c, X, Y, Z) => c.set(0xaeb9c0).lerp(tmp.set(0xbcc6cb), 0.5 + lumps(X * 1.5, Z * 1.5, 0) * 0.5), { y: 0.005, z: 4.15, r: 0.01 });
  box(26, 0.012, 0.92, 0xa89f8c, { y: 0.003, z: 2.1, r: 0.005 });

  // --- A low fence along the plots, open at each gate.
  const lotX = (i) => (i - (LOTS - 1) / 2) * LOT;
  const fenceAt = (x0, x1) => {
    const n = Math.max(2, Math.round((x1 - x0) / 0.14));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * (i / n);
      box(0.045, 0.17, 0.02, 0xe9e2d2, { x, y: 0.085, z: FENCE, r: 0.01 });
    }
    box(x1 - x0 + 0.06, 0.024, 0.02, 0xe3dac6, { x: (x0 + x1) / 2, y: 0.125, z: FENCE - 0.02, r: 0.008 });
    box(x1 - x0 + 0.06, 0.024, 0.02, 0xe3dac6, { x: (x0 + x1) / 2, y: 0.055, z: FENCE - 0.02, r: 0.008 });
  };
  const hedgeAt = (x0, x1) => { for (let x = x0; x < x1; x += 0.17) blob(between(0.115, 0.14), x, 0.1, FENCE - 0.01, LEAF.deep[0], LEAF.deep[1], { flat: 0.9 }); };
  const edge = (i, x0, x1) => (i % 2 ? hedgeAt : fenceAt)(x0, x1);
  edge(0, -13, lotX(0) - 0.26);
  for (let i = 0; i < LOTS - 1; i++) edge(i + 1, lotX(i) + 0.26, lotX(i + 1) - 0.26);
  edge(1, lotX(LOTS - 1) + 0.26, 13);
  for (let i = 0; i < LOTS; i++) [-0.26, 0.26].forEach((d) => box(0.06, 0.24, 0.06, 0xe9e2d2, { x: lotX(i) + d, y: 0.12, z: FENCE, r: 0.018 }));

  // --- What stands behind the plots, by hand so nothing looks like a row.
  [[-6.3, -2.6, 0.95, 'oak'], [-4.6, -3.4, 1.05, 'deep'], [-2.74, -2.3, 0.82, 'blossom'], [-0.9, -3.6, 1.05, 'oak'], [0.95, -2.5, 0.85, 'lime'], [2.75, -3.5, 1, 'deep'], [4.55, -2.5, 0.8, 'gold'], [6.3, -3.3, 1, 'oak'], [-7.6, -3.4, 1.05, 'lime'], [7.6, -2.8, 0.9, 'lime']].forEach(([x, z, s, k]) => roundTree(x, z, s, k, rise(x, z)));
  [[-5.5, -4.3, 0.82], [-1.75, -4.6, 0.86], [1.9, -4.2, 0.8], [3.7, -4.8, 0.9], [5.4, -4.1, 0.78]].forEach(([x, z, s]) => pine(x, z, s, rise(x, z)));
  // A far wood along the top of the rise, in clumps with gaps.
  for (let i = 0; i < 30; i++) {
    const x = -11 + i * 0.76 + between(-0.25, 0.25), z = between(-7.3, -6), s = between(0.36, 0.6), y = rise(x, z);
    if (Math.sin(x * 1.1 + 1) < -0.45) continue;
    if (rnd() < 0.34) pine(x, z, s, y); else roundTree(x, z, s, ['oak', 'deep', 'lime'][Math.floor(rnd() * 3)], y);
  }
  // Hedges and bushes between the plots.
  for (let i = 0; i <= LOTS; i++) {
    const x = (i - LOTS / 2) * LOT;
    bush(x, 1.2, 1.15, i % 2 ? 'deep' : 'oak');
    bush(x + between(-0.1, 0.1), -0.55, 1.5, i % 2 ? 'oak' : 'deep');
    bush(x + 0.05, 0.35, 0.8, 'lime');
  }
  // Wild flowers and tufts all over, thinning out towards the lane.
  const tones = [0xf7f3e6, 0xf6c7d4, 0xf4d36a, 0xbcd4f4];
  const dot = new THREE.SphereGeometry(0.024, 8, 6), tuft = new THREE.ConeGeometry(0.03, 0.09, 6);
  for (let i = 0; i < 720; i++) {
    const x = between(-9, 9), z = between(-6.8, 1.35), y = rise(x, z);
    if (rnd() < 0.38) place(dot, tones[Math.floor(rnd() * 4)], { x, y: y + 0.03, z });
    else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: y + 0.04, z, rz: between(-0.25, 0.25) });
  }
  // Street lamps, on the paving.
  const lampLight = night ? glow(0xffdf9a, 7) : mat(0xf7f6ee, 0.25);
  const lamps = [];
  [-1, 1, 3, 5].forEach((i) => {
    const x = (i - LOTS / 2 + 1) * LOT + LOT / 2 * 0;
    cyl(0.018, 0.028, 0.86, 0x4d6074, { x, y: 0.43, z: 1.72 });
    cyl(0.05, 0.06, 0.05, 0x4d6074, { x, y: 0.025, z: 1.72 });
    cyl(0.045, 0.03, 0.03, 0x4d6074, { x, y: 1.03, z: 1.72 });
    cyl(0.012, 0.075, 0.05, 0x4d6074, { x, y: 1.12, z: 1.72 });
    lamps.push(new THREE.Vector3(x, 1.05, 1.72));
  });
  const lampMesh = lamps.map((v) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.044, 16, 12), lampLight); m.position.copy(v); return m; });

  // --- The houses.
  const panes = [], warm = [];
  const profile = (w, h, rh) => new THREE.Shape([[-w / 2, 0], [w / 2, 0], [w / 2, h], [0, h + rh], [-w / 2, h]].map(([x, y]) => new THREE.Vector2(x, y)));
  /** Walls and a roof with real thickness and eaves. Its ridge runs back from the front, or `side`-ways. */
  const shell = (M, { w, d, h, rh, wall, roof, side = false, eave = 0.1, x = 0, z = 0, y = 0, base = true }) => {
    const pw = side ? d : w, pd = side ? w : d;
    const inner = new THREE.Matrix4().makeTranslation(x, y, z);
    if (side) inner.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    const N = M.clone().multiply(inner);
    const body = new THREE.ExtrudeGeometry(profile(pw, h, rh), { depth: pd, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    body.translate(0, 0, -pd / 2);
    place(body, wall, { M: N });
    const a = Math.atan2(rh, pw / 2), L = Math.hypot(pw / 2, rh) + eave, T = 0.065;
    [1, -1].forEach((sgn) => {
      const cx = sgn * (Math.cos(a) * L / 2 + Math.sin(a) * T / 2), cy = h + rh - Math.sin(a) * L / 2 + Math.cos(a) * T / 2;
      box(L, T, pd + eave * 2, tmp.set(roof).multiplyScalar(0.72).getHex(), { x: cx, y: cy, rz: -sgn * a, M: N, r: 0.022 });
      const rows = Math.max(3, Math.round(L / 0.1)), rowL = L / rows;
      for (let r = 0; r < rows; r++) {
        const u = (r + 0.5) * rowL, nx = Math.sin(a), ny = Math.cos(a);
        box(rowL * 1.22, 0.022, pd + eave * 2 - 0.012, tmp.set(roof).multiplyScalar(between(0.93, 1.06)).getHex(), {
          x: sgn * (Math.cos(a) * u + nx * (T + 0.008)), y: h + rh - Math.sin(a) * u + ny * (T + 0.008), rz: -sgn * (a + 0.05), M: N, r: 0.009,
        });
      }
    });
    box(0.06, 0.05, pd + eave * 2 + 0.01, tmp.set(roof).multiplyScalar(0.82).getHex(), { y: h + rh + T * 0.95, M: N, r: 0.02 });
    if (base) box(w + 0.05, 0.08, d + 0.05, 0xb9b4a8, { x, y: 0.04, z, M, r: 0.018 });
  };
  const panel = (w, h, m, o) => { const g = new RoundedBoxGeometry(w, h, 0.012, 2, 0.004); o.into = m === 'glass' ? panes : warm; place(g, 0xffffff, o); };
  const window_ = (M, x, y, z, ww = 0.2, hh = 0.25, frame = 0xfbf8f0, shutters, flowers = true) => {
    box(ww + 0.05, hh + 0.05, 0.022, frame, { x, y, z: z + 0.004, M, r: 0.008 });
    panel(ww, hh, 'glass', { x, y, z: z + 0.016, M });
    box(0.016, hh, 0.012, frame, { x, y, z: z + 0.024, M, r: 0.004 });
    box(ww, 0.016, 0.012, frame, { x, y, z: z + 0.024, M, r: 0.004 });
    if (shutters) [-1, 1].forEach((s) => box(0.075, hh + 0.04, 0.018, shutters, { x: x + s * (ww / 2 + 0.06), y, z: z + 0.008, M, r: 0.006 }));
    if (flowers) {
      box(ww + 0.05, 0.04, 0.06, 0x8e6a4c, { x, y: y - hh / 2 - 0.035, z: z + 0.035, M, r: 0.01 });
      for (let i = 0; i < 5; i++) ball(0.024, [0xef8fa6, 0xfbe08c, 0xf7f3e6, 0x77a65a][i % 4], { x: x - ww / 2 + 0.01 + i * (ww - 0.02) / 4, y: y - hh / 2 - 0.005, z: z + 0.04, M });
    }
  };
  const door = (M, x, z, color, h = 0.36, w = 0.19) => {
    box(w + 0.05, h + 0.03, 0.02, 0xfbf8f0, { x, y: 0.08 + h / 2, z: z + 0.004, M, r: 0.008 });
    box(w, h, 0.03, color, { x, y: 0.08 + h / 2, z: z + 0.014, M, r: 0.012 });
    [0.28, 0.72].forEach((t) => box(w * 0.62, h * 0.27, 0.008, tmp.set(color).multiplyScalar(0.85).getHex(), { x, y: 0.08 + h * t, z: z + 0.03, M, r: 0.003 }));
    ball(0.012, 0xf3cb62, { x: x + w * 0.34, y: 0.08 + h * 0.47, z: z + 0.036, M });
    box(w + 0.14, 0.05, 0.13, 0xcfc9bb, { x, y: 0.025, z: z + 0.07, M, r: 0.012 });
    panel(0.09, 0.09, 'warm', { x, y: 0.08 + h + 0.1, z: z + 0.006, M });
    if (night) warm.at(-1);
  };
  const chimney = (M, x, y, z, h = 0.3, c = 0xc98f72) => {
    box(0.13, h, 0.13, c, { x, y: y + h / 2, z, M, r: 0.012 });
    box(0.16, 0.035, 0.16, tmp.set(c).multiplyScalar(0.82).getHex(), { x, y: y + h, z, M, r: 0.01 });
  };
  const HOUSES = [
    (M) => { // A cottage, its gable to the lane.
      const w = 1.02, d = 0.9, h = 0.62, f = d / 2, roof = 0xcd6d52, walls = 0xf5e6cf;
      chimney(M, 0.27, 0.72, -0.12, 0.42);
      shell(M, { w, d, h, rh: 0.44, wall: walls, roof });
      door(M, 0, f, 0x3f7fa8);
      window_(M, -0.31, 0.38, f, 0.2, 0.24, 0xfbf8f0, 0x3f7fa8); window_(M, 0.31, 0.38, f, 0.2, 0.24, 0xfbf8f0, 0x3f7fa8);
      const round = new THREE.CylinderGeometry(0.09, 0.09, 0.012, 24).rotateX(Math.PI / 2);
      place(new THREE.TorusGeometry(0.095, 0.016, 8, 24), 0xfbf8f0, { y: 0.8, z: f + 0.012, M });
      place(round, 0xffffff, { y: 0.8, z: f + 0.01, M, into: panes });
    },
    (M) => { // Long and low, its ridge along the lane, a dormer in the roof.
      const w = 1.4, d = 0.84, h = 0.58, f = d / 2, roof = 0x4f7596, walls = 0xfaf0e2;
      chimney(M, -0.42, 0.72, -0.1, 0.4, 0xb9a08c);
      shell(M, { w, d, h, rh: 0.42, wall: walls, roof, side: true });
      door(M, 0.1, f, 0xe2a53f);
      window_(M, -0.36, 0.36, f, 0.28, 0.22, 0xfbf8f0); window_(M, 0.46, 0.36, f, 0.2, 0.22, 0xfbf8f0);
      shell(M, { w: 0.32, d: 0.42, h: 0.2, rh: 0.13, wall: walls, roof, x: -0.12, y: 0.7, z: 0.13, eave: 0.045, base: false });
      window_(M, -0.12, 0.81, 0.34, 0.15, 0.1, 0xfbf8f0, null, false);
    },
    (M) => { // Two floors, narrow and tall.
      const w = 0.96, d = 0.84, h = 1.04, f = d / 2, roof = 0x3c8a8a, walls = 0xf3d8bb;
      chimney(M, -0.26, 1.12, -0.1, 0.42, 0xc98f72);
      shell(M, { w, d, h, rh: 0.4, wall: walls, roof });
      door(M, -0.17, f, 0xa94f38);
      window_(M, 0.2, 0.34, f, 0.26, 0.24); window_(M, -0.2, 0.78, f, 0.2, 0.24, 0xfbf8f0, null, false); window_(M, 0.2, 0.78, f, 0.2, 0.24, 0xfbf8f0, null, false);
      box(w + 0.03, 0.03, d + 0.03, tmp.set(walls).multiplyScalar(0.86).getHex(), { y: 0.58, M, r: 0.01 });
    },
    (M) => { // A porch on two posts.
      const w = 1.14, d = 0.9, h = 0.62, f = d / 2, roof = 0x6f8f55, walls = 0xeef2e6;
      chimney(M, -0.3, 0.76, -0.14, 0.36, 0xb9a08c);
      shell(M, { w, d, h, rh: 0.42, wall: walls, roof });
      door(M, 0.17, f, 0x8a5e3a);
      window_(M, -0.3, 0.38, f, 0.28, 0.24, 0xfbf8f0, null);
      box(0.56, 0.05, 0.42, tmp.set(roof).multiplyScalar(0.92).getHex(), { x: 0.17, y: 0.61, z: f + 0.18, rx: 0.2, M, r: 0.016 });
      [-0.09, 0.43].forEach((x) => box(0.04, 0.54, 0.04, 0xfbf8f0, { x, y: 0.3, z: f + 0.3, M, r: 0.012 }));
      box(0.62, 0.05, 0.42, 0xc9b79c, { x: 0.17, y: 0.025, z: f + 0.18, M, r: 0.012 });
    },
    (M) => { // Ridge along the lane and a little shed on its side.
      const w = 1.1, d = 0.84, h = 0.6, f = d / 2, roof = 0xdba23c, walls = 0xe9eedb;
      chimney(M, 0.26, 0.74, -0.12, 0.38);
      shell(M, { w, d, h, rh: 0.4, wall: walls, roof, side: true, x: -0.1 });
      door(M, -0.1, f, 0x3f7d6e);
      shell(M, { w: 0.3, d: 0.42, h: 0.2, rh: 0.12, wall: walls, roof, x: -0.3, y: 0.72, z: 0.13, eave: 0.045, base: false });
      window_(M, -0.3, 0.83, 0.34, 0.14, 0.1, 0xfbf8f0, null, false);
      window_(M, -0.42, 0.36, f, 0.2, 0.22); window_(M, 0.22, 0.36, f, 0.2, 0.22);
      box(0.38, 0.42, 0.6, 0xc99a6a, { x: 0.62, y: 0.21, z: -0.04, M, r: 0.018 });
      box(0.46, 0.05, 0.7, tmp.set(roof).multiplyScalar(0.86).getHex(), { x: 0.62, y: 0.45, z: -0.04, rz: -0.22, M, r: 0.014 });
    },
    (M) => { // A round tower at the corner.
      const w = 0.98, d = 0.86, h = 0.64, f = d / 2, roof = 0x87679f, walls = 0xf4e8e2;
      shell(M, { w, d, h, rh: 0.42, wall: walls, roof, x: 0.12 });
      door(M, 0.24, f, 0x4e7fb8);
      window_(M, 0.02 - 0.03, 0.38, f, 0.16, 0.22, 0xfbf8f0, null, false);
      window_(M, 0.46, 0.38, f, 0.14, 0.22, 0xfbf8f0, null, false);
      cyl(0.25, 0.26, 1.02, walls, { x: -0.46, y: 0.51, z: 0.2, M, seg: 32 });
      place(new THREE.ConeGeometry(0.34, 0.46, 32), roof, { x: -0.46, y: 1.24, z: 0.2, M });
      box(0.14, 0.2, 0.02, 0xfbf8f0, { x: -0.46, y: 0.72, z: 0.45, M, r: 0.008 });
      panel(0.1, 0.16, 'glass', { x: -0.46, y: 0.72, z: 0.462, M });
    },
  ];
  const doors = [];
  const plot = (i) => {
    const x0 = lotX(i), z0 = -0.28, yaw = [-0.22, 0.26, -0.12, 0.2, -0.26, 0.14][i];
    const M = new THREE.Matrix4().makeTranslation(x0, 0, z0).multiply(new THREE.Matrix4().makeRotationY(yaw));
    HOUSES[i](M);
    const doorX = x0, front = z0 + 0.5;
    doors.push(new THREE.Vector3(x0, 0, front + 0.34));
    // The way from the door to the gate: flat stones in the grass.
    const stones = 6;
    for (let s = 0; s < stones; s++) {
      const t = s / (stones - 1), z = front + 0.12 + (FENCE + 0.02 - front - 0.12) * t, wob = Math.sin(t * 4 + i) * 0.03 + between(-0.012, 0.012);
      place(new THREE.CylinderGeometry(0.075, 0.085, 0.022, 14), (c) => c.set(0xcfc8b6).multiplyScalar(between(0.94, 1.02)), { x: doorX + wob, y: 0.012, z, sx: 1.2, sz: 0.85 });
    }
    // A bed of flowers along the front, a bush at the corner, the letterbox at the gate.
    [-1, 1].forEach((side) => {
      const px = x0 + side * 0.44, pz = front + 0.2;
      box(0.46, 0.035, 0.13, 0x6e5240, { x: px, y: 0.018, z: pz, M: null, r: 0.012 });
      for (let f = 0; f < 11; f++) ball(between(0.022, 0.036), tones[Math.floor(rnd() * 4)], { x: px + between(-0.2, 0.2), y: between(0.05, 0.11), z: pz + between(-0.05, 0.05) });
      for (let f = 0; f < 8; f++) ball(0.03, 0x6f9f52, { x: px + between(-0.21, 0.21), y: 0.04, z: pz + between(-0.05, 0.05), sy: 1.4 });
    });
    bush(x0 + 0.7, front + 0.02, 0.85, i % 2 ? 'lime' : 'oak');
    cyl(0.012, 0.016, 0.3, 0x7a5a42, { x: x0 + 0.33, y: 0.15, z: FENCE - 0.1 });
    box(0.11, 0.075, 0.075, [0xe25a4c, 0x3f7fa8, 0xf0b63c, 0x3f8f7c, 0x8a6aa8, 0xef8fa6][i], { x: x0 + 0.33, y: 0.325, z: FENCE - 0.1, r: 0.022 });
  };
  const has = (i) => lots === 'all' || (lots === 'odd' && i % 2 === 1) || (lots === 'even' && i % 2 === 0);
  for (let i = 0; i < LOTS; i++) if (has(i)) plot(i); else doors.push(new THREE.Vector3(lotX(i), 0, 0.56));

  scene.add(new THREE.Mesh(mergeGeometries(solid, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })));
  if (panes.length) {
    const m = night ? new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc877, emissiveIntensity: 2.8 }) : new THREE.MeshStandardMaterial({ color: 0x8fb9d4, roughness: 0.16 });
    scene.add(new THREE.Mesh(mergeGeometries(panes, false), m));
  }
  if (warm.length) {
    const m = night ? new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd892, emissiveIntensity: 5 }) : new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.4 });
    scene.add(new THREE.Mesh(mergeGeometries(warm, false), m));
  }
  lampMesh.forEach((m) => scene.add(m));

  // A long lens, so what is far is smaller without the ends of the street leaning over.
  const dist = 19, target = new THREE.Vector3(0, +(q.get('ty') ?? 0.86), -0.5), span = 11.5;
  const pos = new THREE.Vector3(0, +(q.get('cy') ?? 5.4), dist - 0.5);
  const vfov = 2 * Math.atan((span / 2) * (H / W) / pos.distanceTo(target)) * 180 / Math.PI;
  const cam = new THREE.PerspectiveCamera(vfov, W / H, 0.5, 300);
  cam.position.copy(pos); cam.lookAt(target); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  // Where each plot's door and the ground in front of it fall in the picture, for the app.
  const share = (v) => { const p = v.clone().project(cam); return [+(0.5 + p.x / 2).toFixed(4), +(0.5 - p.y / 2).toFixed(4)]; };
  window.__rect = JSON.stringify({ doors: doors.map(share), gates: doors.map((v) => share(new THREE.Vector3(v.x, 0, 2.05))), lamps: lamps.map(share) });
  return cam;
}
