// The home garden's plots and what grows in them. `&bed=dry|wet`: the raised bed. `&plant=daisy|sunflower|tulip|lavender|succulent|strawberry|seedling`:
// that plant at its three stages side by side, cut apart afterwards. Seen from the same slant as the yard, with the same sun.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const { mat, leaf, sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const bed = q.get('bed'), plant = q.get('plant');
  if (light === 'night') sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 12, power: 30, color: 0xfff0d8 } });
  const v = village(THREE, scene, { start: 7 });
  const { reseed, rnd, between, box, ball, cyl, place, blob, finish, tmp } = v;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0x7cc048, 0.9));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.userData.noMask = true; scene.add(floor);

  const elev = 24 * Math.PI / 180;
  const camera = (span, midY) => flatCamera(span, W, H, [0, midY + Math.sin(elev) * 30, Math.cos(elev) * 30], [0, midY, 0]);
  if (bed) {
    // A plot let into the lawn: a soft mound of soil, a ring of pale stones half sunk round it, and grass growing up against them. It is seen a bit
    // steeper than the plants, the way the plots lie on the ground of the yard.
    const wet = bed === 'wet';
    const RX = 0.9, RZ = 0.62, N = 2.7;
    const edge = (a) => Math.pow(Math.pow(Math.abs(Math.cos(a)), N) + Math.pow(Math.abs(Math.sin(a)), N), -1 / N) * (1 + 0.025 * Math.sin(a * 5 + 1) + 0.018 * Math.sin(a * 9));
    const dark = new THREE.Color(wet ? 0x4d2f1c : 0x8f5a2e), lit = new THREE.Color(wet ? 0x68432a : 0xb9783d);
    const mound = (scale, height, paint) => {
      const rings = 40, around = 120, pos = [], idx = [];
      for (let r = 0; r <= rings; r++) for (let i = 0; i < around; i++) {
        const k = r / rings, a = (i / around) * Math.PI * 2, e = edge(a) * k * scale, x = Math.cos(a) * e * RX, z = Math.sin(a) * e * RZ;
        pos.push(x, height * (1 - Math.pow(k, 4)) + 0.008 * Math.sin(x * 19 + z * 7) * Math.sin(z * 23) + 0.012 * v.lumps(x * 6, z * 6, 1), z);
      }
      for (let r = 0; r < rings; r++) for (let i = 0; i < around; i++) { const a = r * around + i, b2 = r * around + (i + 1) % around, c = a + around, d = b2 + around; idx.push(a, b2, c, b2, d, c); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      place(g, paint);
    };
    // The turf the plot lies in, so its outline is soft against the lawn.
    mound(1.17, 0.012, (c, x, y, z) => c.set(0x78bd42).lerp(tmp.set(0x96d052), Math.max(0, Math.min(1, 0.5 + v.lumps(x * 5, z * 5, 0) * 0.5))));
    mound(0.99, 0.055, (c, x, y, z) => c.copy(dark).lerp(lit, Math.max(0, Math.min(1, 0.5 + v.lumps(x * 7, z * 7, 2) * 0.55 + Math.sin(z * 26 + Math.sin(x * 4) * 0.8) * 0.16))));
    reseed(21);
    for (let i = 0; i < 58; i++) {
      const a = (i / 58) * Math.PI * 2 + between(-0.02, 0.02), e = edge(a), s = between(0.036, 0.06) * (i % 9 === 0 ? 1.45 : 1);
      place(new THREE.IcosahedronGeometry(1, 2), (c) => c.set(0xdccb9f).multiplyScalar(between(0.88, 1.04)), { x: Math.cos(a) * e * RX * 1.03, y: 0.022, z: Math.sin(a) * e * RZ * 1.04, sx: s * 1.3, sy: s * 0.78, sz: s, ry: -a });
    }
    for (let i = 0; i < 300; i++) {
      const a = between(0, Math.PI * 2), e = edge(a) * between(1.09, 1.24), h = between(0.05, 0.12);
      place(new THREE.ConeGeometry(0.017, h, 5), (c) => c.set(0x54a52e).lerp(tmp.set(0xb8e45e), rnd()), { x: Math.cos(a) * e * RX, y: h / 2, z: Math.sin(a) * e * RZ, rz: between(-0.32, 0.32), rx: between(-0.2, 0.2) });
    }
    finish();
    const steep = 32 * Math.PI / 180;
    return flatCamera(2.42, W, H, [0, 0.05 + Math.sin(steep) * 30, Math.cos(steep) * 30], [0, 0.05, 0]);
  }

  const CELL = 1.25;
  const green = mat(0x5f9f58, 0.72), greenL = mat(0x86c26e, 0.72), greenD = mat(0x477f4a, 0.75);
  const stem = (x, z, h, r = 0.012, lean = 0, color = 0x5f9a50) => { cyl(r * 0.8, r, h, color, { x: x + lean * h / 2, y: h / 2, z, rz: -lean, seg: 8 }); };
  const leaves = (x, z, y, n, len, wid, m = green, rise = 0.95) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.5; const l = leaf(len, wid, m, { x, y, z }); l.rotation.set(0, -a, rise, 'YXZ'); } };
  const sprout = (x, s = 1) => { stem(x, 0, 0.16 * s); [-0.85, 0.85].forEach((rz) => leaf(0.13 * s, 0.075 * s, greenL, { x, y: 0.15 * s, rz, rx: 0.2 })); };
  const petals = (x, y, z, n, len, wid, m, tilt = 1.25, dir = 0.2) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const l = leaf(len, wid, m, { x, y, z }); l.rotation.set(dir, -a, tilt, 'YXZ'); } };
  const white = mat(0xfaf6ec, 0.6), pinkP = mat(0xf09ab4, 0.6), redP = mat(0xe2604c, 0.55), goldP = mat(0xf4c63c, 0.55), yellow = mat(0xf7d65a, 0.55);
  const daisy = (x, z, h, s = 1) => { stem(x, z, h); disc(x, h, z, 12, 0.082 * s, 0.05 * s, 0.021 * s, 0xfaf6ec, 0.9); place(new THREE.SphereGeometry(0.042 * s, 14, 10), 0xf0b93a, { x, y: h + 0.008, z: z + 0.012, rx: 0.9, sz: 0.5 }); };
  const tulip = (x, z, h, m) => { stem(x, z, h, 0.013); const f = (a) => { const l = leaf(0.2, 0.075, m, { x, y: h - 0.03, z }); l.rotation.set(0.1, -a, 0.14, 'YXZ'); }; [0, 1.05, 2.1, 3.15, 4.2, 5.25].forEach(f); };
  /** A flower's petals, flat ovals in a disc tilted towards the camera. */
  const disc = (x, y, z, n, R, len, wid, color, tilt = -0.5) => {
    const up = new THREE.Vector3(0, Math.cos(tilt), Math.sin(-tilt));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
      place(new THREE.SphereGeometry(1, 12, 10), color, { x: x + c * R, y: y + s2 * R * up.y, z: z + s2 * R * up.z, rx: -tilt * -1, rz: a - Math.PI / 2, sx: wid, sy: len, sz: 0.012 });
    }
  };
  const STAGES = {
    daisy: [() => sprout(0), (x) => { stem(x, 0, 0.3); leaves(x, 0, 0.05, 6, 0.2, 0.05); ball(0.045, 0x8fc267, { x, y: 0.32, sy: 1.1 }); }, (x) => { leaves(x, 0, 0.04, 9, 0.28, 0.06); daisy(x - 0.17, 0.03, 0.42); daisy(x + 0.15, 0.06, 0.54, 1.1); daisy(x, -0.08, 0.68, 1.15); daisy(x + 0.26, -0.06, 0.34, 0.85); daisy(x - 0.3, -0.05, 0.3, 0.85); }],
    sunflower: [() => sprout(0, 1.2), (x) => { stem(x, 0, 0.62, 0.022); [0.18, 0.34, 0.48].forEach((y, i) => { const l = leaf(0.24, 0.1, green, { x, y }); l.rotation.set(0.1, i * 2.4, 1.05, 'YXZ'); }); petals(x, 0.63, 0, 10, 0.08, 0.04, greenL, 0.5, 0.2); ball(0.055, 0x7e9c48, { x, y: 0.65 }); },
      (x) => { stem(x, 0, 1.14, 0.03); [0.26, 0.5, 0.74, 0.92].forEach((y, i) => { const l = leaf(0.3, 0.13, green, { x, y }); l.rotation.set(0.1, i * 2.4, 1.1, 'YXZ'); }); const fy = 1.2, fz = 0.04; disc(x, fy, fz, 11, 0.21, 0.11, 0.05, 0xf0b52c, 0.45); disc(x, fy, fz + 0.012, 16, 0.2, 0.105, 0.042, 0xf7cf4a, 0.45); place(new THREE.SphereGeometry(0.135, 20, 14), 0x6e4a2c, { x, y: fy, z: fz + 0.03, rx: 0.45, sz: 0.34 }); }],
    tulip: [() => { [-0.8, 0.8].forEach((rz) => leaf(0.17, 0.055, greenL, { x: 0, y: 0.02, rz })); }, (x) => { [-0.45, 0.45, 0].forEach((rz, i) => leaf(0.34, 0.07, green, { x, y: 0.02, rz, rx: i === 2 ? -0.4 : 0 })); stem(x, 0, 0.32); ball(0.05, 0x9ccb70, { x, y: 0.36, sy: 1.4 }); },
      (x) => { [-0.5, 0.5, -0.2, 0.25].forEach((rz, i) => leaf(0.42, 0.08, green, { x: x + (i - 1.5) * 0.08, y: 0.02, rz, rx: i > 1 ? -0.4 : 0.1 })); tulip(x - 0.16, 0.02, 0.42, redP); tulip(x + 0.17, 0, 0.46, pinkP); tulip(x, -0.08, 0.58, goldP); }],
    lavender: [() => sprout(0, 0.9), (x) => { for (let i = 0; i < 12; i++) { const a = i * 0.9; const h = between(0.24, 0.36); stem(x, 0, h, 0.008, Math.cos(a) * 0.3, 0x7ea97a); } blob(0.15, x, 0.08, 0, 0x4f8559, 0x8db887, { flat: 0.6 }); },
      (x) => { blob(0.22, x, 0.1, 0, 0x4f8559, 0x8db887, { flat: 0.55 }); blob(0.14, x - 0.17, 0.07, 0.04, 0x4f8559, 0x8db887, { flat: 0.6 }); blob(0.14, x + 0.17, 0.07, 0.03, 0x4f8559, 0x8db887, { flat: 0.6 }); for (let i = 0; i < 16; i++) { const a = i * 0.72, lean = Math.cos(a) * (0.1 + (i % 4) * 0.08), h = between(0.42, 0.64), zz = Math.sin(a) * 0.08; stem(x, zz, h, 0.008, lean, 0x7ea97a); const tx = x + lean * h; for (let k = 0; k < 7; k++) ball(0.032 - k * 0.002, k % 2 ? 0x9d82d4 : 0x8768c2, { x: tx + lean * k * 0.022, y: h + k * 0.028 - 0.02, z: zz, sy: 1.1 }); } }],
    succulent: [(x) => { const m = mat(0x8fc2a4, 0.5); for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) { const l = leaf(0.1 - r * 0.03, 0.04, m, { x: 0, y: 0.03 }); l.rotation.set(0, (i / 5) * 6.28 + r * 0.6, 1.05 - r * 0.4, 'YXZ'); } }, (x) => { const m = mat(0x8fc2a4, 0.5), n = mat(0xa9d6b8, 0.5); [[8, 0.2, 1.15, m], [7, 0.15, 0.8, n], [5, 0.1, 0.45, n]].forEach(([c, len, tilt, mm], r) => { for (let i = 0; i < c; i++) { const l = leaf(len, 0.065, mm, { x, y: 0.03 + r * 0.02 }); l.rotation.set(0, (i / c) * 6.28 + r * 0.4, tilt, 'YXZ'); } }); },
      (x) => { const m = mat(0x7fb699, 0.5), n = mat(0xa9d6b8, 0.5), t = mat(0xe8a3ac, 0.5); [[10, 0.28, 1.2, m], [9, 0.22, 0.9, m], [7, 0.16, 0.55, n], [5, 0.1, 0.28, t]].forEach(([c, len, tilt, mm], r) => { for (let i = 0; i < c; i++) { const l = leaf(len, 0.085, mm, { x, y: 0.03 + r * 0.025 }); l.rotation.set(0, (i / c) * 6.28 + r * 0.33, tilt, 'YXZ'); } }); stem(x + 0.05, 0, 0.5, 0.009, 0.1, 0x9cb26c); [0, 1, 2].forEach((k) => ball(0.032, 0xf1b0b9, { x: x + 0.1 + k * 0.012, y: 0.46 + k * 0.03, z: k * 0.02 })); }],
    strawberry: [() => sprout(0), (x) => { blob(0.18, x, 0.11, 0, 0x4f8a4e, 0x8cc070, { flat: 0.65 }); for (let i = 0; i < 9; i++) { const l = leaf(0.2, 0.09, green, { x, y: 0.04 }); l.rotation.set(0, (i / 9) * 6.28, 1, 'YXZ'); } [[0.06, 0.2], [-0.08, 0.17]].forEach(([d, y]) => { petals(x + d, y, 0.14, 5, 0.04, 0.025, white, 1.35, 0.8); ball(0.014, 0xf4d36a, { x: x + d, y, z: 0.15 }); }); },
      (x) => { blob(0.27, x, 0.16, 0, 0x4f8a4e, 0x8cc070, { flat: 0.68 }); for (let i = 0; i < 13; i++) { const l = leaf(0.28, 0.12, green, { x, y: 0.05 }); l.rotation.set(0, (i / 13) * 6.28, 1.02, 'YXZ'); } [[-0.2, 0.18, 0.22], [0.03, 0.12, 0.27], [0.22, 0.16, 0.2], [-0.05, 0.3, 0.2], [0.14, 0.32, 0.14], [-0.26, 0.05, 0.14]].forEach(([d, y, z]) => { place(new THREE.SphereGeometry(0.052, 14, 10), 0xdf3f44, { x: x + d, y, z, sy: 1.25 }); ball(0.03, 0x6fa353, { x: x + d, y: y + 0.058, z, sy: 0.5 }); for (let k = 0; k < 5; k++) ball(0.0055, 0xf7dc7c, { x: x + d + Math.cos(k * 2.3) * 0.03, y: y - 0.01 + Math.sin(k * 1.7) * 0.03, z: z + 0.045 }); }); }],
    seedling: [() => sprout(0), (x) => { stem(x, 0, 0.3, 0.016); [[0.12, -1], [0.2, 1], [0.27, -1], [0.33, 1]].forEach(([y, sgn]) => leaf(0.16, 0.08, green, { x, y, rz: sgn * 0.95, rx: 0.15 })); }, (x) => { cyl(0.022, 0.034, 0.34, 0x7a5a42, { x, y: 0.17 }); blob(0.2, x, 0.46, 0, 0x4f8a4e, 0x9ccb70); blob(0.15, x - 0.16, 0.38, 0.03, 0x4f8a4e, 0x9ccb70); blob(0.15, x + 0.16, 0.39, 0, 0x4f8a4e, 0x9ccb70); blob(0.12, x, 0.62, 0, 0x4f8a4e, 0x9ccb70); }],
  };
  const list = STAGES[plant];
  for (let s = 0; s < 3; s++) {
    const x = (s - 1) * CELL;
    const before = scene.children.length;
    // A stage builds at its own x: what is drawn at the origin is moved there.
    reseed(100 + s);
    const count = v.solid.length;
    list[s](0);
    for (let g = count; g < v.solid.length; g++) v.solid[g].translate(x, 0, 0);
    for (let c = before; c < scene.children.length; c++) scene.children[c].position.x += x;
  }
  finish();
  return camera(CELL * 3, 0.56);
}
