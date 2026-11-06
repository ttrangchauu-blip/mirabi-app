// The worlds of the learning games. `&world=forest|cave|castle|boss` with `&layer=far|mid|near`, and `&world=space` with `&layer=far|near`, are strips
// that repeat sideways, for the games' parallax; the app keeps drawing their skies. `&world=stone|bronze|feudal|modern` are the four eras, `&world=map` is
// the treasure map, `&world=lab` the laboratory and `&world=field` the night field under the falling words: whole pictures.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera, glow, mat } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const world = q.get('world') || 'forest', layer = q.get('layer') || 'far';
  const dark = world === 'cave' || world === 'boss' || world === 'field' || world === 'space';
  const dusk = world === 'castle';
  if (dark) sky({ top: 0x5b6ab0, mid: 0x8a8fd0, low: 0x4c4e80, power: world === 'field' ? 1.1 : 1.9, sun: { dir: [-0.5, 0.7, 0.55], size: 13, power: world === 'space' ? 34 : 26, color: world === 'boss' ? 0xffc9a0 : 0xd0dcff } });
  else if (dusk) sky({ top: 0x6d78b8, mid: 0xe8b8a8, low: 0x6b6470, power: 0.8, sun: { dir: [-0.62, 0.42, 0.62], size: 10, power: 34, color: 0xffd0a0 } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night: false, start: 47 });
  const { reseed, between, rnd, tmp, place, box, cyl, ball, blob, roundTree, pine, bush, shell, window_, tones, LEAF, finish, panel } = v;
  const SPAN = 6, TAU = Math.PI * 2;
  const wave = (x, k, ph) => Math.sin(x * TAU * k / SPAN + ph);
  const grain = (x, z) => wave(x, 1, z * 0.9) * 0.34 + wave(x, 3, z * 1.7 + 1) * 0.26 + wave(x, 7, z * 3.1 + 2) * 0.16 + Math.sin(z * 2.3 + 0.4) * 0.14;
  const elev = world === 'map' ? 1.02 : 0.24;
  const lift = world === 'map' ? 0 : 0.9;
  const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40 + lift, Math.cos(elev) * 40], [0, lift, 0]);
  const tall = SPAN * H / W;
  const reach = (r, z) => (0.5 - r) * tall / Math.cos(elev) + lift + z * Math.tan(elev);
  const zAt = (r) => -(0.5 - r) * tall / Math.sin(elev) - lift / Math.tan(elev);
  let count = 0;
  const each = (fn) => { const id = 900 + (count++) * 31; [-SPAN, 0, SPAN].forEach((d) => { reseed(id); fn(d); }); };
  const extra = [];
  const glowing = (geo, color, power, o = {}) => { const m = new THREE.Mesh(geo, glow(color, power)); m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); if (o.rz) m.rotation.z = o.rz; if (o.sy) m.scale.y = o.sy; scene.add(m); extra.push(m); };

  /** Ground from `row` (where it meets what is behind it) down past the bottom of the picture. */
  const groundFrom = (row, colourAt, depth = 12) => {
    const z0 = zAt(row);
    const g = new THREE.PlaneGeometry(SPAN * 3, depth, 800, 200);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, z0 + depth / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, 0.012 * wave(p.getX(i), 4, p.getZ(i) * 2));
    g.computeVertexNormals();
    place(g, colourAt);
    return z0;
  };
  const wall = (z, r, amp, ph, colour, k = 1) => {
    const y0 = reach(r, z);
    const g = new THREE.PlaneGeometry(SPAN * 4, 60, 480, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i); p.setY(i, y0 + amp * (wave(x, 1 * k, ph) * 0.6 + wave(x, 2 * k, ph * 2) * 0.28 + wave(x, 5 * k, ph) * 0.1)); } else p.setY(i, y0 - 60);
    g.computeVertexNormals();
    place(g, colour, { z });
  };
  const two = (a, b, c = null) => { const A = new THREE.Color(a), B = new THREE.Color(b), C = c === null ? null : new THREE.Color(c); return (col, x, y, z) => { const n = grain(x, z); col.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n))); if (C && n > 0.3) col.lerp(C, Math.min(1, (n - 0.3) * 1.6)); }; };
  const rock = new THREE.IcosahedronGeometry(1, 2);
  const stone = (x, y, z, s, colour, sy = 0.7) => place(rock, (c, X, Y, Z) => c.set(colour).multiplyScalar(0.9 + 0.14 * Math.sin(X * 23 + Z * 19)), { x, y, z, sx: s, sy: s * sy, sz: s * 0.9 });
  const tufts = (n, z0, z1, colour = 0x6f9f52, dots = tones) => {
    const dot = new THREE.SphereGeometry(0.028, 8, 6), tuft = new THREE.ConeGeometry(0.03, 0.11, 6);
    each((d) => { for (let i = 0; i < n; i++) { const x = between(-3, 3), z = between(z0, z1); if (dots && rnd() < 0.3) place(dot, dots[Math.floor(rnd() * dots.length)], { x: x + d, y: 0.034, z }); else place(tuft, colour, { x: x + d, y: 0.055, z, rz: between(-0.25, 0.25) }); } });
  };
  const mushroom = (x, z, s, cap, y = 0, glows = false) => {
    cyl(0.05 * s, 0.07 * s, 0.3 * s, 0xf4efe2, { x, y: y + 0.15 * s, z });
    const g = new THREE.SphereGeometry(0.2 * s, 18, 10, 0, TAU, 0, Math.PI / 2);
    if (glows) glowing(g, cap, 1.6, { x, y: y + 0.28 * s, z }); else place(g, cap, { x, y: y + 0.28 * s, z, sy: 0.9 });
    for (let i = 0; i < 5; i++) ball(0.022 * s, 0xfff6e6, { x: x + between(-0.13, 0.13) * s, y: y + 0.28 * s + between(0.08, 0.17) * s, z: z + 0.1 * s });
  };
  const crystal = (x, z, s, colour, power = 0.9, y = 0, tilt = 0) => {
    const g = new THREE.ConeGeometry(0.1 * s, 0.56 * s, 6);
    glowing(g, colour, power, { x, y: y + 0.28 * s, z, rz: tilt });
    const b = new THREE.CylinderGeometry(0.1 * s, 0.12 * s, 0.1 * s, 6);
    glowing(b, colour, power * 0.7, { x, y: y + 0.04 * s, z, rz: tilt });
  };
  const opaqueSky = (top, bottom) => {
    const g = new THREE.PlaneGeometry(SPAN * 4, 60, 1, 40);
    const T = new THREE.Color(top), B = new THREE.Color(bottom);
    const z = -60;
    const yTop = reach(0, z), yBot = reach(1, z);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
    const c = new Float32Array(g.attributes.position.count * 3), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = Math.max(0, Math.min(1, (p.getY(i) * ((yTop - yBot) / 60) + (yTop + yBot) / 2 - yBot) / (yTop - yBot))); const col = B.clone().lerp(T, t); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    m.position.set(0, (yTop + yBot) / 2, z); m.scale.y = (yTop - yBot) / 60;
    scene.add(m);
  };

  // ------------------------------------------------------------------------------ Rừng phép thuật
  if (world === 'forest') {
    if (layer === 'far') {
      wall(-32, 0.22, 0.32, 2.6, 0xc4e0d2);
      wall(-24, 0.33, 0.28, 1, 0xa9cfae);
      groundFrom(0.58, two(0x9fc08a, 0xb4cd9a));
      const z = zAt(0.56);
      [[-2.6, 0.5, 'deep'], [-1.5, 0.62, 'oak'], [-0.5, 0.48, 'lime'], [0.55, 0.6, 'deep'], [1.6, 0.46, 'oak'], [2.5, 0.58, 'lime']].forEach(([x, s, k]) => each((d) => roundTree(x + d, z, s, k)));
      [[-2.05, 0.5], [0.05, 0.56], [2.05, 0.48]].forEach(([x, s]) => each((d) => pine(x + d, z - 0.1, s)));
    } else if (layer === 'mid') {
      const z0 = groundFrom(0.66, two(0x7fae5c, 0x9cc26c, 0xb3cc7e));
      [[-1.95, 1.05, 'oak'], [0.95, 0.9, 'blossom'], [2.55, 1.0, 'lime']].forEach(([x, s, k]) => each((d) => roundTree(x + d, z0 + 0.35, s, k)));
      [[-0.55, 0.9]].forEach(([x, s]) => each((d) => pine(x + d, z0 + 0.3, s)));
      [[-1.05, 0xef8fa6, 0.9], [0.3, 0xb994ff, 1.1], [1.72, 0xf4c95a, 0.8], [-2.75, 0x5cc8c8, 1]].forEach(([x, cap, s]) => each((d) => mushroom(x + d, z0 + 0.5, s, cap)));
      tufts(240, z0 + 0.1, z0 + 2.2);
    } else {
      const z0 = groundFrom(0.74, two(0x6ea14f, 0x8ab85f, 0xa7c872));
      // A worn path across the front.
      const path = new THREE.PlaneGeometry(SPAN * 3, 1.2, 400, 8); path.rotateX(-Math.PI / 2); path.translate(0, 0.016, zAt(0.88));
      place(path, (c, x, y, z) => c.set(0xc9b28a).lerp(tmp.set(0xdccaa6), 0.5 + 0.5 * wave(x, 5, z * 3)));
      [[-2.3, -0.32], [-1.2, 0.3], [-0.1, -0.28], [1.1, 0.3], [2.2, -0.3]].forEach(([x, dz]) => each((d) => stone(x + d, 0.03, zAt(0.88) + dz, 0.05, 0xc3b8a2)));
      [[-2.6, 0.8, 'deep'], [-0.85, 0.7, 'oak'], [0.8, 0.8, 'lime'], [2.3, 0.75, 'deep']].forEach(([x, s, k]) => each((d) => bush(x + d, z0 + 0.2, s, k)));
      [[-1.7, 0xef8fa6, 0.42], [1.5, 0xb994ff, 0.46]].forEach(([x, cap, s]) => each((d) => mushroom(x + d, z0 + 0.5, s, cap)));
      tufts(320, z0 + 0.1, zAt(0.81));
      tufts(220, zAt(0.95), zAt(1.05));
    }
  }
  // ------------------------------------------------------------------------------ Hang pha lê
  if (world === 'cave') {
    const ROCK = 0x7a74b0;
    const spire = (x, z, s, c = 0x8f8ac4) => { const g = new THREE.ConeGeometry(0.2 * s, 0.9 * s, 7, 3); place(g, (col, X, Y) => col.set(c).multiplyScalar(0.8 + 0.3 * Math.min(1, Y / (0.9 * s)) + 0.08 * Math.sin(X * 31)), { x, y: 0.45 * s, z }); };
    if (layer === 'far') {
      wall(-26, 0, 0, 1, 0x4e4a86);
      groundFrom(0.6, two(0x625da0, 0x6e69ac));
      const z = zAt(0.58);
      for (let i = 0; i < 12; i++) { const x = -3 + i * 0.5 + 0.2, s = 0.5 + (i * 7 % 5) * 0.14; each((d) => { const g = new THREE.ConeGeometry(0.22 * s, 1.5 * s, 7); place(g, (c, X, Y) => c.set(0x6660a8).lerp(tmp.set(0x9c98d8), Math.min(1, Y / 1.4)), { x: x + d, y: 0.75 * s, z }); }); }
      for (let i = 0; i < 7; i++) { const x = -2.8 + i * 0.86, s = 0.4 + (i * 3 % 4) * 0.12; each((d) => { const g = new THREE.ConeGeometry(0.2 * s, 1.4 * s, 7); g.rotateX(Math.PI); place(g, 0x5c56a0, { x: x + d, y: reach(0.06, z) - 0.7 * s, z }); }); }
      [[-2.2, 0x7ad8ff], [0.6, 0xc69bff], [2.1, 0x7ad8ff]].forEach(([x, col]) => each((d) => crystal(x + d, z + 0.3, 0.8, col, 0.8)));
    } else if (layer === 'mid') {
      const z0 = groundFrom(0.68, two(ROCK, 0x8f8ac4));
      [[-2.3, 1, 0x7ad8ff, 0.2], [-0.5, 1.25, 0xc69bff, -0.25], [1.05, 1.0, 0x7ad8ff, 0.18], [2.55, 1.3, 0xff9ad2, -0.15]].forEach(([x, s, col, t]) => each((d) => { stone(x + d, 0.06, z0 + 0.4, 0.26, ROCK, 0.4); crystal(x + d, z0 + 0.4, s, col, 1.1, 0.04, t); crystal(x + d + 0.16, z0 + 0.46, s * 0.6, col, 1.1, 0.02, t - 0.4); crystal(x + d - 0.15, z0 + 0.44, s * 0.55, col, 1.1, 0.02, t + 0.4); }));
      [[-1.4, 1.1], [-1.15, 0.7], [0.3, 0.95], [0.52, 0.6], [1.8, 1.2], [2.02, 0.74]].forEach(([x, s]) => each((d) => spire(x + d, z0 + 0.3, s)));
    } else {
      const z0 = groundFrom(0.74, two(0x6e68aa, 0x827cc0, 0x938ed0));
      [[-2.6, 0.2], [-1.1, 0.26], [0.6, 0.18], [2, 0.24]].forEach(([x, s]) => each((d) => stone(x + d, s * 0.3, z0 + 0.3, s, 0x8f8ac4)));
      [[-1.8, 0x7ad8ff, 0.5], [-1.62, 0x7ad8ff, 0.3], [0.05, 0xc69bff, 0.46], [0.22, 0xc69bff, 0.28], [1.3, 0xff9ad2, 0.42], [2.75, 0x7ad8ff, 0.48]].forEach(([x, col, s]) => each((d) => crystal(x + d, z0 + 0.5, s, col, 1.2)));
      each((d) => { for (let i = 0; i < 60; i++) stone(between(-3, 3) + d, 0.012, between(z0 + 0.3, zAt(1.05)), between(0.012, 0.034), 0xa09cd4); });
    }
  }
  // ------------------------------------------------------------------------------ Lâu đài quái vật
  if (world === 'castle') {
    const WALL = 0x8e88a0, WALL2 = 0x75708c;
    const tower = (x, z, r, h, roof, y = 0) => {
      cyl(r, r * 1.08, h, (c, X, Y) => c.set(WALL).multiplyScalar(0.92 + 0.1 * Math.sin(Y * 11 + X * 17)), { x, y: y + h / 2, z, seg: 18 });
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; box(r * 0.34, r * 0.3, r * 0.3, WALL2, { x: x + Math.cos(a) * r, y: y + h + r * 0.08, z: z + Math.sin(a) * r, r: 0.01 }); }
      if (roof) place(new THREE.ConeGeometry(r * 1.22, r * 2.2, 18), roof, { x, y: y + h + r * 1.2, z });
      for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.5, 0.01), glow(0xffc877, 1.6)); m.position.set(x, y + h * (0.48 + i * 0.26), z + r + 0.015); scene.add(m); }
    };
    if (layer === 'far') {
      wall(-30, 0.36, 0.3, 2.6, 0x8c8cb8);
      wall(-22, 0.48, 0.24, 1, 0x6d6c98);
      groundFrom(0.62, two(0x5f6f6a, 0x6e7e72));
      const z = zAt(0.6), y = 0;
      [-1.6, 1.5].forEach((x, i) => each((d) => { tower(x + d - 0.42, z, 0.17, 1.15, 0x7a4f96, y); tower(x + d + 0.42, z, 0.17, 1.15, 0x7a4f96, y); tower(x + d, z - 0.1, 0.22, 1.75, 0x934f7c, y); box(0.8, 0.62, 0.2, WALL2, { x: x + d, y: y + 0.31, z, r: 0.01 }); }));
    } else if (layer === 'mid') {
      const z0 = groundFrom(0.7, two(0x6a6a7c, 0x7a7a8c));
      // The castle's wall itself, with battlements, arched gates and banners.
      each((d) => {
        box(SPAN + 0.02, 0.92, 0.3, (c, X, Y) => c.set(WALL).multiplyScalar(0.92 + 0.08 * Math.sin(Y * 14 + X * 9)), { x: d, y: 0.46, z: z0 - 0.02, r: 0.005 });
        for (let i = 0; i < 18; i++) box(0.17, 0.15, 0.3, WALL, { x: -3 + (i + 0.5) * SPAN / 18 + d, y: 0.98, z: z0 - 0.02, r: 0.01 });
      });
      for (const x of [-2.25, 0, 2.25]) each((d) => { tower(x + d, z0 + 0.04, 0.2, 1.2, null); });
      for (const x of [-1.12, 1.12]) each((d) => {
        box(0.42, 0.56, 0.02, 0x3e3a4e, { x: x + d, y: 0.28, z: z0 + 0.135, r: 0.01 });
        cyl(0.21, 0.21, 0.02, 0x3e3a4e, { x: x + d, y: 0.56, z: z0 + 0.135, rx: Math.PI / 2 });
        [-0.32, 0.32].forEach((dx) => box(0.13, 0.42, 0.012, 0xb4476a, { x: x + d + dx, y: 0.62, z: z0 + 0.14, r: 0.003 }));
      });
    } else {
      const z0 = groundFrom(0.74, two(0x6e6e80, 0x7e7e92));
      each((d) => { for (let x = -3; x < 3; x += 0.36) for (let r = 0; r < 7; r++) { const zz = z0 + 0.2 + r * 0.42; box(0.34, 0.03, 0.4, tmp.set(0x8b8a9c).multiplyScalar(0.9 + ((Math.floor(x * 13) + r * 7) % 5) * 0.04).getHex(), { x: x + 0.18 + (r % 2 ? 0.18 : 0) + d, y: 0.02, z: zz, r: 0.012 }); } });
      [-2.1, 0.1, 2.3].forEach((x) => each((d) => {
        cyl(0.03, 0.04, 0.5, 0x5a4a44, { x: x + d, y: 0.25, z: z0 + 0.3 });
        glowing(new THREE.ConeGeometry(0.05, 0.14, 8), 0xffb040, 2.6, { x: x + d, y: 0.57, z: z0 + 0.3 });
      }));
    }
  }
  // ------------------------------------------------------------------------------ Đấu trường trùm
  if (world === 'boss') {
    const OB = 0x564a72, OB2 = 0x6a5c8a;
    if (layer === 'far') {
      wall(-30, 0.4, 0.42, 2.6, 0x77639c, 2);
      wall(-22, 0.52, 0.34, 1, 0x62508a, 2);
      groundFrom(0.64, two(0x54486e, 0x625480));
      const z = zAt(0.62);
      [[-2.4, 1.2], [-0.7, 1.7], [1.1, 1.3], [2.5, 1.5]].forEach(([x, s]) => each((d) => { const g = new THREE.ConeGeometry(0.46 * s, 1.4 * s, 7); place(g, (c, X, Y) => c.set(OB).lerp(tmp.set(0x6a4f7c), Math.min(1, Y / 1.2)), { x: x + d, y: 0.7 * s, z }); glowing(new THREE.SphereGeometry(0.09 * s, 10, 8), 0xff6a3c, 2, { x: x + d, y: 1.38 * s, z }); }));
    } else if (layer === 'mid') {
      const z0 = groundFrom(0.7, two(OB, OB2));
      [[-2.4, 1.1, 0.1], [-0.85, 0.75, -0.14], [0.85, 1.25, 0.05], [2.45, 0.8, -0.1]].forEach(([x, s, t]) => each((d) => {
        cyl(0.14, 0.17, 1.1 * s, (c, X, Y) => c.set(0x6e6488).multiplyScalar(0.9 + 0.1 * Math.sin(Y * 15)), { x: x + d, y: 0.55 * s, z: z0 + 0.3, rz: t, seg: 12 });
        box(0.42, 0.1, 0.42, 0x7a7094, { x: x + d, y: 0.05, z: z0 + 0.3, r: 0.02 });
      }));
      [[-1.65, 0xff5a7a, 0.8], [0, 0xff9a3c, 0.95], [1.65, 0xc08aff, 0.8]].forEach(([x, col, s]) => each((d) => crystal(x + d, z0 + 0.55, s, col, 1.3)));
    } else {
      const z0 = groundFrom(0.74, two(0x5c5078, 0x6c5e8c, 0x7a6c9a));
      // Cracks of light in the arena's floor.
      [[-2.2, 0.5, 0.2], [-0.6, 1.1, -0.2], [1.1, 0.7, 0.14], [2.4, 1.3, -0.3]].forEach(([x, dz, t]) => each((d) => {
        for (let i = 0; i < 6; i++) glowing(new THREE.BoxGeometry(0.26, 0.012, 0.022 + 0.012 * (i % 2)), 0xff7a3c, 2.6, { x: x + d + i * 0.2 * Math.cos(t), y: 0.012, z: z0 + dz + i * 0.07 * (i % 2 ? 1 : -0.4) });
      }));
      [[-2.7, 0.18], [-1.3, 0.22], [0.4, 0.16], [1.9, 0.24]].forEach(([x, s]) => each((d) => stone(x + d, s * 0.3, z0 + 0.25, s, 0x7a6c9a)));
    }
  }
  // ------------------------------------------------------------------------------ Space Adventure
  if (world === 'space') {
    const planet = (x, y, z, r, a, b, ring) => {
      const g = new THREE.SphereGeometry(r, 36, 24);
      place(g, (c, X, Y) => c.set(a).lerp(tmp.set(b), 0.5 + 0.5 * Math.sin(Y / r * 7 + Math.sin(X / r * 3))), { x, y, z });
      if (ring) { const t = new THREE.TorusGeometry(r * 1.55, r * 0.07, 6, 48); t.rotateX(Math.PI / 2 - 0.3); t.rotateZ(0.26); place(t, ring, { x, y, z, sy: 0.55 }); }
    };
    if (layer === 'far') {
      const z = -6;
      [[-2.1, 0.3, 0.42, 0xef8fa6, 0xf7c4a0, null], [0.4, 0.2, 0.22, 0x7ad8ff, 0xc2ecff, null], [1.9, 0.62, 0.58, 0xf4c95a, 0xe0935a, 0xe8d6a8]].forEach(([x, r, s, a, b, ring]) => each((d) => planet(x + d, reach(r, z), z, s, a, b, ring)));
      const dot = new THREE.SphereGeometry(1, 6, 5);
      each((d) => { for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(dot, glow(0xffffff, 3)); const s = between(0.006, 0.016); m.scale.setScalar(s); m.position.set(between(-3, 3) + d, reach(between(0, 1), z - 3), z - 3); scene.add(m); extra.push(m); } });
    } else {
      const z = 0;
      [[-2.5, 0.3, 0.16], [-1.3, 0.75, 0.24], [-0.2, 0.2, 0.12], [0.9, 0.62, 0.2], [2.2, 0.34, 0.26], [2.8, 0.85, 0.14]].forEach(([x, r, s]) => each((d) => {
        const y = reach(r, z);
        stone(x + d, y, z, s, 0x8a7e98, 0.82);
        for (let i = 0; i < 4; i++) { const a = between(0, TAU); stone(x + d + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.5, z + s * 0.72, s * between(0.14, 0.24), 0x665c78, 0.7); }
      }));
    }
  }
  // ------------------------------------------------------------------------------ Bốn thời đại
  const eraGround = (row = 0.8, a = 0x7fae5c, b = 0x9cc26c, c = 0xb3cc7e) => groundFrom(row, two(a, b, c));
  if (world === 'stone') {
    opaqueSky(0xa8c8e8, 0xf0dcc0);
    wall(-30, 0.42, 0.26, 2.6, 0xb4b8c8);
    // A volcano far off, smoke rising.
    const vz = -20, vy = reach(0.72, vz);
    place(new THREE.ConeGeometry(1.5, 1.7, 22), (c, X, Y) => c.set(0x7a6a68).lerp(tmp.set(0x96867c), 0.5 + 0.5 * Math.sin(X * 8)), { x: 1.6, y: vy + 0.85, z: vz });
    glowing(new THREE.SphereGeometry(0.12, 12, 8), 0xff7a3c, 3, { x: 1.6, y: vy + 1.68, z: vz, sy: 0.5 });
    [[0, 0.3], [0.1, 0.55], [0.26, 0.82]].forEach(([dx, h], i) => blob(0.16 + i * 0.06, 1.6 + dx, vy + 1.72 + h * 0.6, vz, 0x8c8c94, 0xc4c4cc));
    const gz = zAt(0.78);
    wall(gz - 8, 0.66, 0.14, 1, 0x93a278);
    eraGround(0.76, 0x8a9e58, 0xa4b268, 0xbcc07a);
    // The cave in its cliff, on the left.
    const cz = gz - 0.5;
    blob(1.1, -2.5, 0.7, cz, 0x7a6e60, 0xb0a48e, { flat: 0.9, rough: 0.2 });
    blob(0.8, -1.6, 0.42, cz + 0.1, 0x7a6e60, 0xb0a48e, { flat: 0.8, rough: 0.2 });
    blob(0.42, -2.25, 0.3, cz + 1.0, 0x241c1c, 0x352a28, { flat: 1.05, rough: 0.05, place: { sz: 0.4 } });
    // A fire, ferns, big stones.
    cyl(0.14, 0.17, 0.05, 0x8a8074, { x: -0.72, y: 0.03, z: gz + 0.9 });
    glowing(new THREE.ConeGeometry(0.08, 0.26, 10), 0xff9a3c, 3, { x: -0.72, y: 0.18, z: gz + 0.9 });
    [[0.4, 0.2], [2.5, 0.28], [-1.3, 0.14]].forEach(([x, s]) => stone(x, s * 0.35, gz + 0.55, s, 0xa89c88));
    [[-0.1, 0.8], [1, 0.9], [2.1, 1], [2.8, 0.8]].forEach(([x, s], i) => { const n = 7; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI - Math.PI / 2; const g = new THREE.SphereGeometry(0.1 * s, 8, 6); place(g, i % 2 ? 0x5e9048 : 0x6ea854, { x: x + Math.sin(a) * 0.17 * s, y: 0.12 * s + Math.cos(a) * 0.08 * s, z: gz + 0.2, sx: 2.2, sy: 0.4, rz: -a }); } });
    tufts(120, gz + 0.4, gz + 8);
  }
  if (world === 'bronze') {
    opaqueSky(0x9cc8ee, 0xeaf2e4);
    wall(-30, 0.42, 0.28, 2.6, 0xb6d4c4);
    wall(-22, 0.52, 0.24, 1, 0x9cc4a2);
    eraGround(0.76, 0x7fae5c, 0x9cc26c, 0xb3cc7e);
    const gz = zAt(0.74);
    // Stilt houses with long curved thatched roofs.
    const stilt = (x, z, s) => {
      [[-0.32, -0.16], [0.32, -0.16], [-0.32, 0.16], [0.32, 0.16], [0, 0.16], [0, -0.16]].forEach(([dx, dz]) => cyl(0.018 * s, 0.022 * s, 0.34 * s, 0x6a4c38, { x: x + dx * s, y: 0.17 * s, z: z + dz * s }));
      box(0.84 * s, 0.03 * s, 0.46 * s, 0x8e6a4c, { x, y: 0.35 * s, z, r: 0.006 });
      box(0.66 * s, 0.24 * s, 0.34 * s, 0xc9a877, { x, y: 0.48 * s, z, r: 0.01 });
      const M = new THREE.Matrix4().makeTranslation(x, 0.6 * s, z);
      const roofShape = new THREE.Shape(); roofShape.moveTo(-0.62 * s, 0); roofShape.quadraticCurveTo(0, 0.1 * s, 0, 0.42 * s); roofShape.quadraticCurveTo(0, 0.1 * s, 0.62 * s, 0); roofShape.closePath();
      const r = new THREE.ExtrudeGeometry(roofShape, { depth: 0.54 * s, bevelEnabled: false }); r.translate(0, 0, -0.27 * s);
      place(r, (c, X, Y) => c.set(0xb7924e).multiplyScalar(0.88 + 0.14 * Math.sin(X * 60)), { M });
      box(0.14 * s, 0.2 * s, 0.012, 0x4c3324, { x, y: 0.46 * s, z: z + 0.176 * s, r: 0.004 });
    };
    stilt(-2.3, gz - 0.4, 1); stilt(-1.05, gz - 0.8, 0.8); stilt(2.2, gz - 0.5, 1.05);
    // A bronze drum on its stand.
    cyl(0.22, 0.18, 0.3, (c, X, Y) => c.set(0xa8743c).lerp(tmp.set(0xd0a050), 0.5 + 0.5 * Math.sin(Y * 40)), { x: 0.75, y: 0.27, z: gz + 0.55, seg: 28 });
    cyl(0.24, 0.24, 0.025, 0xd0a050, { x: 0.75, y: 0.43, z: gz + 0.55, seg: 28 });
    cyl(0.12, 0.16, 0.12, 0x7a5a42, { x: 0.75, y: 0.06, z: gz + 0.55 });
    // Rice in rows and a stream, and trees behind.
    for (let i = 0; i < 40; i++) for (let k = 0; k < 2; k++) place(new THREE.ConeGeometry(0.02, 0.1, 5), 0xa4c95c, { x: -0.9 + i * 0.03 + k * 0.012, y: 0.05, z: gz + 0.2 + k * 0.08 });
    [[-0.1, 0.8, 'oak'], [1.25, 0.9, 'deep'], [-2.85, 0.84, 'lime'], [2.9, 0.84, 'oak']].forEach(([x, s, k]) => roundTree(x, gz - 1.5, s, k));
    tufts(120, gz + 0.6, gz + 8);
  }
  if (world === 'feudal') {
    opaqueSky(0x9cc8ee, 0xf4e8dc);
    wall(-30, 0.42, 0.26, 2.6, 0xc4dcd0);
    eraGround(0.76, 0x7fae5c, 0x9cc26c, 0xb3cc7e);
    const gz = zAt(0.74);
    const RED = 0xb4453c, TILE = 0x5a7a88, WALLC = 0xeee3cc;
    const curved = (x, y, z, w, d, h) => {
      const g = new THREE.BoxGeometry(w, h, d, 18, 3, 4), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const X = p.getX(i) / (w / 2), Y = p.getY(i) / h + 0.5; p.setX(i, p.getX(i) * (1 - 0.48 * Y)); p.setZ(i, p.getZ(i) * (1 - 0.6 * Y)); p.setY(i, p.getY(i) + 0.3 * h * X * X * (1 - Y) + 0.12 * h * X * X); }
      g.computeVertexNormals();
      place(g, (c, X, Y) => c.set(TILE).multiplyScalar(0.9 + 0.12 * Math.sin(X * 40)), { x, y, z });
    };
    // A two-tier gate tower in the back, on a stone base.
    const X0 = -1.5, Z0 = gz - 0.8;
    box(1.8, 0.56, 0.7, 0xb8ae9c, { x: X0, y: 0.28, z: Z0, r: 0.012 });
    box(0.5, 0.42, 0.04, 0x3e3430, { x: X0, y: 0.21, z: Z0 + 0.35, r: 0.01 });
    cyl(0.25, 0.25, 0.04, 0x3e3430, { x: X0, y: 0.42, z: Z0 + 0.35, rx: Math.PI / 2 });
    [-0.6, -0.2, 0.2, 0.6].forEach((dx) => cyl(0.03, 0.03, 0.32, RED, { x: X0 + dx, y: 0.72, z: Z0 + 0.22 }));
    box(1.38, 0.28, 0.42, WALLC, { x: X0, y: 0.72, z: Z0, r: 0.01 });
    curved(X0, 1, Z0, 1.86, 0.84, 0.26);
    box(0.72, 0.22, 0.3, WALLC, { x: X0, y: 1.22, z: Z0, r: 0.01 });
    curved(X0, 1.42, Z0, 1.16, 0.6, 0.22);
    // A stilted pavilion on the water, on the right, with lotus.
    const px = 1.75, pz = gz - 0.1;
    const pond = new THREE.CylinderGeometry(1.1, 1.14, 0.02, 40); place(pond, 0x62b9d9, { x: px, y: 0.008, z: pz + 0.3, sz: 0.62 });
    [-0.3, 0.3].forEach((dx) => [-0.2, 0.2].forEach((dz) => cyl(0.022, 0.022, 0.42, RED, { x: px + dx, y: 0.21, z: pz + dz })));
    box(0.72, 0.03, 0.52, 0x8e6a4c, { x: px, y: 0.19, z: pz, r: 0.008 });
    curved(px, 0.46, pz, 1.05, 0.72, 0.22);
    [[0.75, 0.4], [1, 0.7], [2.55, 0.46], [2.8, 0.66], [1.55, 0.72], [2.1, 0.78]].forEach(([x, dz]) => { cyl(0.05, 0.06, 0.01, 0x4c8a54, { x, y: 0.024, z: pz + dz }); ball(0.024, 0xef8fa6, { x, y: 0.045, z: pz + dz }); });
    [[-2.9, 0.92, 'oak'], [-0.1, 0.8, 'deep'], [0.7, 0.84, 'blossom'], [2.95, 0.86, 'lime']].forEach(([x, s, k]) => roundTree(x, gz - 1.6, s, k));
    tufts(100, gz + 1.2, gz + 8);
  }
  if (world === 'modern') {
    opaqueSky(0x9cc8ee, 0xe8f2f6);
    const gz = zAt(0.74);
    // A skyline, far to near, windows in rows.
    const block = (x, z, w, h, colour) => {
      box(w, h, 0.5, colour, { x, y: h / 2, z, r: 0.012 });
      const cols = Math.max(2, Math.round(w / 0.14)), rows = Math.max(2, Math.round(h / 0.2));
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) panel(w / cols * 0.62, h / rows * 0.56, 'glass', { x: x - w / 2 + (c + 0.5) * w / cols, y: (r + 0.5) * h / rows, z: z + 0.256 });
    };
    [[-2.6, 0.7, 1.6, 0xc4d0dc], [-1.8, 0.56, 2.1, 0xb0c4d8], [-1.05, 0.66, 1.4, 0xd0d8e0], [-0.3, 0.5, 2.5, 0xa8bed4], [0.4, 0.6, 1.7, 0xc8d4de], [1.2, 0.7, 2.2, 0xb4c8da], [2, 0.54, 1.5, 0xccd6e0], [2.7, 0.62, 2, 0xb8cadc]].forEach(([x, w, h, c]) => block(x, gz - 3, w, h, c));
    [[-2.2, 0.8, 0.96, 0xf0dcc0], [-1.2, 0.62, 0.74, 0xf6c7a0], [1.4, 0.8, 0.88, 0xbcdce0], [2.45, 0.72, 1.1, 0xf4d4b0]].forEach(([x, w, h, c]) => block(x, gz - 1.4, w, h, c));
    eraGround(0.76, 0x7fae5c, 0x9cc26c, 0xb3cc7e);
    // The street, a kerb, lamps and young trees.
    box(14, 0.02, 0.9, 0xa8b2bd, { y: 0.01, z: gz + 0.5 });
    for (let x = -3; x < 3; x += 0.6) box(0.28, 0.006, 0.03, 0xf4f4ee, { x: x + 0.14, y: 0.024, z: gz + 0.5 });
    box(14, 0.03, 0.2, 0xd8d2c4, { y: 0.015, z: gz + 1.02, r: 0.008 });
    [-2.5, -0.4, 1.9].forEach((x) => { cyl(0.012, 0.016, 0.6, 0x4f6a88, { x, y: 0.3, z: gz + 1.02 }); glowing(new THREE.SphereGeometry(0.035, 10, 8), 0xfff0c4, 1.5, { x, y: 0.62, z: gz + 1.02 }); });
    [[-1.6, 0.5, 'oak'], [0.5, 0.56, 'lime'], [2.7, 0.5, 'deep']].forEach(([x, s, k]) => roundTree(x, gz + 0.02, s, k));
    tufts(60, gz + 1.2, gz + 8);
  }
  // ------------------------------------------------------------------------------ Bản đồ kho báu
  if (world === 'map') {
    const toX = (u) => (u - 0.5) * SPAN;
    const toZ = (r) => (r - 0.5) * tall / Math.sin(elev);
    const bez = (p0, p1, p2, p3, t) => { const m = 1 - t; return [m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]]; };
    // The river, the same curve as the drawn trail's bridge expects.
    const riverPts = [];
    for (let t = 0; t <= 1.001; t += 0.04) riverPts.push(bez([0.34, -0.02], [0.3, 0.2], [0.52, 0.3], [0.46, 0.48], t));
    for (let t = 0; t <= 1.001; t += 0.04) riverPts.push(bez([0.46, 0.48], [0.4, 0.66], [0.6, 0.74], [0.72, 0.8], t));
    const riverD = (u, r) => { let m = 9; for (const [a, b] of riverPts) { const d = Math.hypot((u - a) * SPAN, (r - b) * tall); if (d < m) m = d; } return m; };
    // The sea: bottom right; the shore runs through these points.
    const shore = (u) => (u < 0.58 ? 1.2 : u < 0.8 ? 1 - (u - 0.58) / 0.22 * 0.34 : u < 0.92 ? 0.66 - (u - 0.8) / 0.12 * 0.18 : 0.48 - (u - 0.92) / 0.08 * 0.06);
    const heightAt = (u, r) => {
      const sea = r - shore(u) + 0.03 * Math.sin(u * 30) * 0.5;
      const isle = Math.hypot((u - 0.9) * SPAN, (r - 0.8) * tall);
      const land = sea < 0 ? Math.min(1, -sea * 14) : 0;
      const islandH = Math.max(0, 1 - isle / 0.36);
      let y = -0.05 + 0.12 * Math.max(land, Math.min(1, islandH * 2.4));
      const rd = riverD(u, r);
      if (rd < 0.1 && land > 0) y = Math.min(y, -0.05 + 0.12 * Math.max(0, (rd - 0.05) / 0.05));
      return y + 0.012 * Math.sin(u * 40 + r * 24) * (land > 0.5 ? 1 : 0);
    };
    const g = new THREE.PlaneGeometry(SPAN * 1.04, tall / Math.sin(elev) * 1.04, 640, 360);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const uOf = (x) => x / SPAN + 0.5, rOf = (z) => z * Math.sin(elev) / tall + 0.5;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(uOf(p.getX(i)), rOf(p.getZ(i))));
    g.computeVertexNormals();
    const A = new THREE.Color(0x8fbc62), B = new THREE.Color(0xa8cc72), SAND = new THREE.Color(0xeed9a4), W1 = new THREE.Color(0x4fa6cc), W2 = new THREE.Color(0x8ad0e8);
    place(g, (c, x, y, z) => {
      if (y < -0.02) c.copy(W1).lerp(W2, Math.max(0, Math.min(1, (y + 0.05) / 0.03)));
      else if (y < 0.018) c.copy(SAND);
      else { const n = grain(x, z); c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n))); }
    });
    const yAt = (u, r) => Math.max(0, heightAt(u, r));
    // Mountains with snow around the stop at (0.24, 0.3).
    [[0.25, 0.25, 0.46, 0.95], [0.16, 0.3, 0.36, 0.72], [0.34, 0.22, 0.3, 0.64], [0.1, 0.18, 0.28, 0.6]].forEach(([u, r, s, h]) => {
      const m = new THREE.ConeGeometry(s, h, 18, 6);
      place(m, (c, X, Y, Z) => c.set(Y > h * 0.5 + yAt(u, r) ? 0xf6f8fa : 0x8e8a82).multiplyScalar(0.92 + 0.1 * Math.sin(X * 17 + Z * 11)), { x: toX(u), y: h / 2 + 0.03, z: toZ(r) });
    });
    // A village at (0.18, 0.6).
    const hut = (u, r, s, c) => { const M = new THREE.Matrix4().makeTranslation(toX(u), 0.07, toZ(r)).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeRotationY(0.3 * s)); shell(M, { w: 0.5, d: 0.44, h: 0.3, rh: 0.2, wall: 0xf8f1e0, roof: c, eave: 0.06, base: false }); };
    hut(0.14, 0.56, 0.34, 0xe25a4c); hut(0.2, 0.52, 0.28, 0x3f7fa8); hut(0.23, 0.6, 0.3, 0xf0b63c); hut(0.1, 0.62, 0.28, 0x3f8f7c);
    // A bridge at (0.45, 0.48).
    { const x = toX(0.46), z = toZ(0.48); for (let i = 0; i < 7; i++) box(0.09, 0.016, 0.26, i % 2 ? 0xb98a60 : 0xa8784e, { x: x - 0.3 + i * 0.1, y: 0.07 + 0.05 * Math.sin((i / 6) * Math.PI), z, r: 0.004 }); [-1, 1].forEach((s) => { for (let i = 0; i < 4; i++) cyl(0.008, 0.008, 0.08, 0x6a4c38, { x: x - 0.3 + i * 0.2, y: 0.13 + 0.05 * Math.sin((i / 3) * Math.PI), z: z + s * 0.12 }); }); }
    // A forest around (0.64, 0.24).
    reseed(55);
    for (let i = 0; i < 26; i++) { const u = between(0.54, 0.76), r = between(0.1, 0.36); if (riverD(u, r) < 0.16) continue; if (rnd() < 0.5) pine(toX(u), toZ(r), between(0.26, 0.36), 0.05); else roundTree(toX(u), toZ(r), between(0.26, 0.36), ['oak', 'deep', 'lime'][i % 3], 0.05); }
    for (let i = 0; i < 18; i++) { const u = between(0.02, 0.98), r = between(0.03, 0.52); if (u > 0.52 && u < 0.78) continue; if (riverD(u, r) < 0.2 || (u < 0.38 && r < 0.36)) continue; roundTree(toX(u), toZ(r), between(0.14, 0.22), 'oak', 0.05); }
    // A lighthouse at (0.74, 0.62).
    { const x = toX(0.75), z = toZ(0.58), base = 0.07; cyl(0.05, 0.075, 0.42, (c, X, Y) => c.set(Math.floor((Y - base) * 16) % 2 ? 0xfbf8f0 : 0xe25a4c), { x, y: base + 0.21, z, seg: 18 }); cyl(0.058, 0.058, 0.02, 0x4f6a88, { x, y: base + 0.43, z }); glowing(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12), 0xffe9a8, 2.4, { x, y: base + 0.47, z }); place(new THREE.ConeGeometry(0.056, 0.06, 14), 0xe25a4c, { x, y: base + 0.53, z }); }
    // The treasure island at (0.9, 0.8): palms and a chest.
    { const x = toX(0.9), z = toZ(0.78); [[-0.1, -0.02], [0.14, -0.06]].forEach(([dx, dz], i) => { cyl(0.012, 0.018, 0.22, 0x8e6a4c, { x: x + dx, y: 0.17, z: z + dz, rz: i ? -0.18 : 0.18 }); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; place(new THREE.SphereGeometry(0.05, 8, 6), 0x5da84e, { x: x + dx + Math.cos(a) * 0.07 + (i ? 0.03 : -0.03), y: 0.28, z: z + dz + Math.sin(a) * 0.07, sy: 0.3, sx: 1.6, ry: -a }); } }); box(0.08, 0.05, 0.06, 0xc47a3d, { x: x + 0.02, y: 0.1, z: z + 0.06, r: 0.012 }); box(0.085, 0.012, 0.065, 0xf6c945, { x: x + 0.02, y: 0.11, z: z + 0.06, r: 0.003 }); }
    // The start: a small dock at (0.07, 0.84).
    { const x = toX(0.07), z = toZ(0.86); for (let i = 0; i < 4; i++) box(0.2, 0.012, 0.05, 0xb98a60, { x, y: 0.08, z: z + i * 0.06, r: 0.003 }); }
    // Waves.
    reseed(7);
    for (let i = 0; i < 40; i++) { const u = between(0.56, 1), r = between(0.44, 1); if (r < shore(u) + 0.04 || Math.hypot((u - 0.9) * SPAN, (r - 0.8) * tall) < 0.46) continue; const t = new THREE.TorusGeometry(0.05, 0.005, 5, 12, 1.5); t.rotateX(Math.PI / 2); place(t, 0xdff4fb, { x: toX(u), y: -0.03, z: toZ(r) }); }
  }
  // ------------------------------------------------------------------------------ Phòng thí nghiệm
  if (world === 'brook') {
    // The brook Ghép chữ's bridge crosses: water in a soft-edged bed with a sandy bank, then grass that meets the forest's ground and covers its road.
    const z0 = zAt(0.06), z1 = zAt(0.99), cz = (z0 + z1) / 2, rz = (z1 - z0) / 2, rx = SPAN * 0.47;
    const wob = (t) => 1 + 0.035 * Math.sin(t * 2 + 0.7) + 0.022 * Math.sin(t * 3 + 2) + 0.012 * Math.sin(t * 7 + 1);
    const WATER = 0.8, BANK = 0.9;
    const shape = (t, r) => [rx * r * wob(t) * Math.cos(t), cz + rz * r * wob(t + 1.1) * Math.sin(t)];
    const swell = (x, z) => Math.sin(z * 2.3 + 1.1 * Math.sin(x * 1.4 + 0.5) + 0.4 * Math.sin(x * 3.1));
    const ring = (r0, r1, height, colour, rows) => {
      const g = new THREE.PlaneGeometry(1, 1, 720, rows), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getX(i) + 0.5) * TAU - Math.PI / 2, f = p.getY(i) + 0.5, [x, z] = shape(t, r0 + (r1 - r0) * f);
        p.setXYZ(i, x, height(f, x, z), z);
      }
      g.computeVertexNormals();
      place(g, colour);
    };
    const deep = new THREE.Color(0x3e97be), mid = new THREE.Color(0x62b9d9), pale = new THREE.Color(0xa6e2f2), sand = new THREE.Color(0xd9c294), sand2 = new THREE.Color(0xccb486), grass = new THREE.Color(0x7dbb66), grass2 = new THREE.Color(0x72b05c);
    ring(0, WATER * 1.05, (f, x, z) => -0.05 + 0.012 * swell(x, z), (c, x, y, z) => {
      const u = swell(x, z);
      c.copy(deep).lerp(mid, Math.max(0, Math.min(1, 0.55 + u * 0.32)));
      c.lerp(pale, Math.max(0, Math.min(1, (u - 0.72) * 4)) * Math.max(0, Math.sin(x * 2.1 + z * 0.7)) * 0.8);
    }, 60);
    ring(WATER, BANK, (f) => -0.05 + 0.16 * Math.sin(f * Math.PI / 2), (c, x, y, z) => c.copy(sand).lerp(sand2, 0.5 + 0.25 * Math.sin(x * 5 + z * 2) + 0.25 * Math.sin(x * 17 - z * 9)), 40);
    ring(BANK, 1, (f) => 0.11 - 0.09 * f * f, (c, x, y, z) => c.copy(grass).lerp(grass2, 0.5 + 0.25 * Math.sin(x * 7 + z * 3) + 0.25 * Math.sin(x * 21 - z * 11)), 30);
    const stones = [[-1.45, 0.52, 0.2], [-0.25, 0.3, 0.16], [0.95, 0.62, 0.22], [1.75, 0.34, 0.15], [-0.75, 0.74, 0.14]];
    stones.forEach(([x, f, r]) => { const z = cz - rz * 0.62 + rz * 1.3 * f; stone(x, 0.0, z, r, 0xb9b3cb, 0.55); });
    reseed(61);
    for (let i = 0; i < 26; i++) {
      const t = between(0, TAU), [x, z] = shape(t, between(0.9, 0.98));
      stone(x, 0.11, z, between(0.03, 0.075), 0xc9b890, 0.6);
    }
    finish();
    window.__rect = '{}';
    return cam;
  }

  if (world === 'lab') {
    const zBack = -1.6, rowTop = 0.66;
    // The back wall: it reaches past the top of the picture.
    const wallY = reach(rowTop, zAt(rowTop)) ;
    const wz = zAt(rowTop) - 0.55;
    const yRow = (r) => reach(r, wz);
    box(SPAN * 1.4, yRow(0) - yRow(1) + 2, 0.04, (c, X, Y) => c.set(0xf1f6f8).lerp(tmp.set(0xe2edf2), 0.5 + 0.5 * Math.sin(X * 10.5)), { y: (yRow(0) + yRow(1)) / 2, z: wz - 0.02, r: 0.004 });
    // The counter: its top from row 0.66, its front edge and cupboards down to the bottom.
    const tz = zAt(rowTop);
    const topDepth = 1.5;
    box(SPAN * 1.4, 0.05, topDepth, (c, X, Y, Z) => c.set(0xd9b48a).lerp(tmp.set(0xeccb9e), 0.5 + 0.5 * Math.sin(Z * 13 + X * 1.3)), { y: 0, z: tz + topDepth / 2 - 0.3, r: 0.008 });
    const frontZ = tz + topDepth - 0.3;
    box(SPAN * 1.4, 1.8, 0.04, 0xb88a5e, { y: -0.92, z: frontZ, r: 0.004 });
    for (let i = -4; i < 4; i++) { box(1.3, 0.92, 0.03, 0xc8996c, { x: i * 1.5 + 0.75, y: -0.62, z: frontZ + 0.03, r: 0.012 }); ball(0.03, 0xf3cb62, { x: i * 1.5 + 0.75 + 0.5, y: -0.3, z: frontZ + 0.06 }); }
    // A window with the day outside.
    const wx = -1.75, wy = yRow(0.32), ww = 1.5, wh = 1.05;
    box(ww + 0.1, wh + 0.1, 0.03, 0xfbf8f0, { x: wx, y: wy, z: wz + 0.01, r: 0.012 });
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ color: 0xbfe3f5 })); m.position.set(wx, wy, wz + 0.03); scene.add(m); }
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh * 0.3), new THREE.MeshBasicMaterial({ color: 0xa8d68c })); m.position.set(wx, wy - wh * 0.35, wz + 0.032); scene.add(m); }
    box(0.03, wh, 0.02, 0xfbf8f0, { x: wx, y: wy, z: wz + 0.045 }); box(ww, 0.03, 0.02, 0xfbf8f0, { x: wx, y: wy, z: wz + 0.045 });
    // Two shelves with jars and books.
    const shelf = (x0, x1, r) => { const y = yRow(r); box(x1 - x0, 0.045, 0.3, 0xc8996c, { x: (x0 + x1) / 2, y, z: wz + 0.15, r: 0.008 }); return y + 0.022; };
    const y1 = shelf(0.1, 2.9, 0.28), y2 = shelf(0.1, 2.9, 0.52);
    const jar = (x, y, s, liquid) => { cyl(0.09 * s, 0.09 * s, 0.28 * s, 0xe8f4f8, { x, y: y + 0.14 * s, z: wz + 0.15, seg: 18 }); cyl(0.082 * s, 0.082 * s, 0.17 * s, liquid, { x, y: y + 0.09 * s, z: wz + 0.17, seg: 18 }); cyl(0.05 * s, 0.05 * s, 0.05 * s, 0xb98a60, { x, y: y + 0.3 * s, z: wz + 0.15 }); };
    [[0.4, 1, 0x7ad8ff], [0.72, 0.8, 0xef8fa6], [1.05, 1.1, 0xa8d68c], [2.5, 0.9, 0xf4c95a]].forEach(([x, s, c]) => jar(x, y1, s, c));
    [[1.5, 0x4f94bd], [1.62, 0xe25a4c], [1.74, 0xf0b63c], [1.86, 0x3f8f7c], [1.98, 0x8a6aa8]].forEach(([x, c], i) => box(0.1, 0.3 + (i % 3) * 0.05, 0.22, c, { x, y: y1 + 0.17, z: wz + 0.15, r: 0.01 }));
    [[0.4, 0.9, 0xc69bff], [1.1, 1, 0x7ad8ff], [1.62, 0.8, 0xf7ae72], [2.5, 1.1, 0xa8d68c], [2.15, 0.85, 0xef8fa6]].forEach(([x, s, c]) => jar(x, y2, s, c));
    // A pot with a plant on the bench's far end, a clock.
    cyl(0.1, 0.075, 0.14, 0xc98e5a, { x: 2.72, y: 0.1, z: tz + 0.12 });
    bush(2.72, tz + 0.12, 0.62, 'oak', 0.14);
    cyl(0.17, 0.17, 0.02, 0xfbfdff, { x: 0, y: yRow(0.12), z: wz + 0.02, rx: Math.PI / 2, seg: 30 }); place(new THREE.TorusGeometry(0.17, 0.016, 8, 30), 0x4f94bd, { x: 0, y: yRow(0.12), z: wz + 0.03 });
    box(0.012, 0.11, 0.006, 0x2b3a55, { x: 0, y: yRow(0.12) + 0.05, z: wz + 0.036, r: 0.002 }); box(0.08, 0.012, 0.006, 0x2b3a55, { x: 0.035, y: yRow(0.12), z: wz + 0.036, r: 0.002 });
  }
  // ------------------------------------------------------------------------------ Bầu trời từ vựng
  if (world === 'field') {
    wall(-28, 0.34, 0.26, 2.6, 0x3a4a78);
    wall(-20, 0.5, 0.22, 1, 0x2f4464);
    const z0 = groundFrom(0.68, two(0x36584a, 0x466a54));
    [[-2.6, 0.7, 'deep'], [-1.1, 0.56, 'oak'], [0.8, 0.66, 'deep'], [2.5, 0.6, 'oak']].forEach(([x, s, k]) => roundTree(x, z0 + 0.1, s, k));
    [[-1.85, 0.66], [0.05, 0.56], [1.7, 0.7]].forEach(([x, s]) => pine(x, z0 + 0.05, s));
    const front = groundFrom(0.86, two(0x3e5f45, 0x4e7354));
    tufts(180, front + 0.1, front + 3, 0x54805c, null);
  }
  finish();
  window.__rect = '{}';
  return cam;
}
