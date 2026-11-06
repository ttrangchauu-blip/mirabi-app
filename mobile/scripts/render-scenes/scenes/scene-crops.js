// What grows in Vườn nhà's plots (backend/app/data/garden_plants.json, the `art` of each plant): `&plant=<art>` builds that plant at its
// five stages side by side (seed, sprout, young, grown, ready to harvest), cut apart afterwards by cut-crops.mjs. Same slant, sun and
// cell as the plants of scene-beds.js, so a plant stands on its plot as they did. A stage sits on the lawn, its foot at the cell's
// middle; the plot's soil is the app's own picture under it. What glows (crystal, embers, light) glows more at night.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const K = kit(THREE, scene);
  const { mat, leaf, sky, flatCamera } = K;
  const night = light === 'night';
  const q = new URLSearchParams(location.search);
  const plant = q.get('plant') || 'carrot';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 12, power: 30, color: 0xfff0d8 } });
  const v = village(THREE, scene, { start: 7 });
  const { reseed, rnd, between, cyl, place, blob, finish } = v;
  const ball = v.ball;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0x7cc048, 0.9));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.userData.noMask = true; scene.add(floor);

  // ------------------------------------------------------------------------------------------------ pieces
  const green = mat(0x5f9f58, 0.72), greenL = mat(0x86c26e, 0.72), greenD = mat(0x477f4a, 0.75);
  const M = (c, r = 0.6, extra = {}) => mat(c, r, extra);
  /** Something that glows: a little by day, more at night. */
  const glowM = (c, day = 0.6, dark = 2.4) => mat(c, 0.35, { emissive: c, emissiveIntensity: night ? dark : day });
  const add = (geo, m, o = {}) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.order ?? 'XYZ');
    mesh.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    scene.add(mesh);
    return mesh;
  };
  const sphere = (r, m, o) => add(new THREE.SphereGeometry(r, 20, 14), m, o);
  const stem = (x, z, h, r = 0.012, lean = 0, color = 0x5f9a50) => { cyl(r * 0.8, r, h, color, { x: x + lean * h / 2, y: h / 2, z, rz: -lean, seg: 8 }); };
  /** `n` leaves round a point, rising at `rise` from flat. */
  const leaves = (x, z, y, n, len, wid, m = green, rise = 0.95, turn = 0.5) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + turn; const l = leaf(len, wid, m, { x, y, z }); l.rotation.set(0, -a, rise, 'YXZ'); } };
  const petals = (x, y, z, n, len, wid, m, tilt = 1.25, dir = 0.2) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const l = leaf(len, wid, m, { x, y, z }); l.rotation.set(dir, -a, tilt, 'YXZ'); } };
  /** A flower's petals, flat ovals in a disc tilted towards the camera. */
  const disc = (x, y, z, n, R, len, wid, color, tilt = -0.5) => {
    const up = new THREE.Vector3(0, Math.cos(tilt), Math.sin(-tilt));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
      place(new THREE.SphereGeometry(1, 12, 10), color, { x: x + c * R, y: y + s2 * R * up.y, z: z + s2 * R * up.z, rx: -tilt * -1, rz: a - Math.PI / 2, sx: wid, sy: len, sz: 0.012 });
    }
  };
  const sprout = (x, s = 1, m = greenL, sm = 0x5f9a50) => { stem(x, 0, 0.16 * s, 0.012, 0, sm); [-0.85, 0.85].forEach((rz) => leaf(0.13 * s, 0.075 * s, m, { x, y: 0.15 * s, rz, rx: 0.2 })); };
  const trunk = (x, h, r = 0.04, color = 0x7a5a42) => cyl(r * 0.7, r, h, color, { x, y: h / 2 });
  /** A crown of soft lumps round (x, y), `r` across. */
  const crown = (x, y, r, dark, lit, n = 5, flat = 0.85) => {
    blob(r * 0.62, x, y, 0, dark, lit, { flat });
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.4; blob(r * between(0.36, 0.46), x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.32, Math.sin(a) * 0.08 + 0.05, dark, lit, { flat }); }
  };
  /** Small things hung over the front of a crown: fruit, blossoms, lights. */
  const dots = (x, y, r, n, make) => { for (let i = 0; i < n; i++) { const a = i * 2.39996 + 0.3, u = Math.sqrt((i + 0.5) / n); make(x + Math.cos(a) * r * u, y + Math.sin(a) * r * u * 0.72, r * 0.62 * Math.sqrt(Math.max(0.08, 1 - u * u)) + 0.08, i); } };
  const star = (() => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.42 : 1, a = (i / 10) * Math.PI * 2 + Math.PI / 2; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 }); })();
  const gem = (r, m, o) => add(new THREE.OctahedronGeometry(r, 0), m, o);
  const prism = (r, h, m, o) => add(new THREE.CylinderGeometry(r * 0.25, r, h, 6), m, o);

  // ------------------------------------------------------------------------------------------------ the first two stages, common to all
  // A seed half sunk in a little heap of earth, its own colour and shape, and a sprout in the plant's own green.
  const earth = (x) => { blob(0.1, x, 0.012, 0.02, 0x5a3a22, 0x8a5a35, { flat: 0.3, rough: 0.25 }); };
  const seedOf = (x, { color = 0xc99c6a, shape = 'oval', size = 1, shine = false }) => {
    earth(x);
    const m = shine ? glowM(color, 0.35, 1.6) : M(color, 0.55);
    if (shape === 'flat') sphere(0.036 * size, m, { x, y: 0.045, z: 0.05, sy: 0.35, sz: 0.7, rz: 0.4 });
    else if (shape === 'gem') gem(0.04 * size, m, { x, y: 0.06, z: 0.05, sy: 1.3, ry: 0.5 });
    else if (shape === 'bulb') { sphere(0.04 * size, m, { x, y: 0.05, z: 0.05 }); add(new THREE.ConeGeometry(0.018 * size, 0.05 * size, 10), m, { x, y: 0.1, z: 0.05 }); }
    else if (shape === 'tuber') sphere(0.045 * size, m, { x, y: 0.045, z: 0.05, sx: 1.2, sy: 0.8 });
    else if (shape === 'star') add(star, m, { x, y: 0.06, z: 0.04, sx: 0.04 * size, sy: 0.04 * size, sz: 0.04 * size, rx: -0.6 });
    else sphere(0.03 * size, m, { x, y: 0.048, z: 0.05, sy: 0.7, sx: 1.25, rz: 0.5 });
  };
  const sprouted = (x, look) => { earth(x); sprout(x, 1.05, look.leaf ? M(look.leaf, 0.6) : greenL, look.stem ?? 0x5f9a50); };

  // ------------------------------------------------------------------------------------------------ the plants
  // Each: how its seed and sprout look, then young, grown and ready.
  const P = {};
  // Thường
  // Feathery fronds: a thin stalk with small narrow leaflets along it, and the orange shoulder of the root showing at the soil.
  const carrotTop = (x, n, h, open = 1) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.2, lean = Math.cos(a) * 0.36 * open, hh = h * between(0.8, 1.05), zz = Math.sin(a) * 0.035; stem(x + Math.cos(a) * 0.012, zz, hh, 0.006, lean, 0x6aa84f); for (let k = 0; k < 7; k++) { const t = 0.35 + k * 0.1, px = x + lean * hh * t, py = hh * t; leaf(0.055, 0.016, k % 2 ? greenL : green, { x: px, y: py, z: zz + 0.01, rz: (k % 2 ? 1 : -1) * 1.0 + lean * 0.8, rx: 0.25 }); } } };
  const carrotRoot = (x, z, s) => { add(new THREE.ConeGeometry(0.055 * s, 0.09 * s, 20), M(0xf08a2c, 0.5), { x, y: 0.0, z, rx: Math.PI }); sphere(0.056 * s, M(0xf3913a, 0.5), { x, y: 0.035 * s, z, sy: 0.6 }); };
  P.carrot = { seed: { color: 0x9a7350 }, young: (x) => carrotTop(x, 5, 0.22, 0.7), grown: (x) => { carrotTop(x, 7, 0.34); carrotRoot(x, 0.04, 0.9); }, ready: (x) => { carrotTop(x, 9, 0.42); carrotRoot(x, 0.04, 1.45); carrotRoot(x + 0.19, 0.1, 1.05); carrotRoot(x - 0.18, 0.08, 0.95); } };
  const lettuceHead = (x, s, rings) => { const tones = [M(0x5f9e40, 0.7), M(0x82bd52, 0.68), M(0xa8d468, 0.64), M(0xc8e68a, 0.6)]; for (let r = 0; r < rings; r++) { const n = 9 - r, len = (0.17 - r * 0.025) * s, tilt = 1.3 - r * 0.3; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r * 0.5; const l = leaf(len, len * 0.9, tones[Math.min(3, r)], { x, y: 0.015 + r * 0.028 * s, z: 0 }); l.rotation.set(tilt, -a, 0, 'YXZ'); } } if (rings >= 3) blob(0.07 * s, x, 0.09 * s, 0, 0xa8d468, 0xe2f2a8, { flat: 0.85 }); };
  P.lettuce = { seed: { color: 0xb5a27a, size: 0.8 }, young: (x) => lettuceHead(x, 1.0, 2), grown: (x) => lettuceHead(x, 1.3, 3), ready: (x) => lettuceHead(x, 1.6, 4) };
  const tomatoPlant = (x, h, fruit, flowers) => { stem(x, 0, h, 0.016, 0, 0x5f9a50); cyl(0.008, 0.01, h + 0.08, 0xc9a36a, { x: x + 0.07, y: (h + 0.08) / 2, z: -0.03 }); const n = Math.round(h / 0.1); for (let i = 0; i < n; i++) { const y = 0.1 + (i / n) * h, sd = i % 2 ? 1 : -1; leaf(0.17, 0.08, i % 2 ? green : greenL, { x, y, rz: sd * 1.05, rx: 0.25 }); leaf(0.12, 0.06, greenD, { x, y: y + 0.03, z: 0.03, rz: -sd * 0.8, rx: 0.4 }); } blob(0.1, x, h * 0.85, 0.01, 0x477f4a, 0x86c26e, { flat: 0.8 }); if (flowers) [[-0.08, 0.6], [0.09, 0.75]].forEach(([d, k]) => { petals(x + d, h * k, 0.1, 5, 0.03, 0.016, M(0xf7d33c, 0.5), 1.35, 0.8); }); fruit.forEach(([d, k, r, c]) => sphere(r, M(c, 0.32), { x: x + d, y: h * k, z: 0.09 + Math.abs(d) * 0.2 })); };
  P.tomato = { seed: { color: 0xe8d6a3, shape: 'flat', size: 0.7 }, young: (x) => tomatoPlant(x, 0.26, [], false), grown: (x) => tomatoPlant(x, 0.42, [[-0.07, 0.55, 0.035, 0x8cc25a], [0.08, 0.65, 0.03, 0x9ccb5f]], true),
    ready: (x) => tomatoPlant(x, 0.52, [[-0.1, 0.5, 0.055, 0xe53b2f], [0.09, 0.6, 0.06, 0xd9342a], [-0.02, 0.38, 0.05, 0xef5a3a], [0.12, 0.36, 0.045, 0xf07a3c], [-0.12, 0.72, 0.045, 0xe0402f]], false) };
  const potatoBush = (x, s, flowers) => { blob(0.17 * s, x, 0.12 * s, 0, 0x477f4a, 0x86c26e, { flat: 0.7 }); blob(0.12 * s, x - 0.13 * s, 0.09 * s, 0.03, 0x4f8a4e, 0x9ccb70, { flat: 0.7 }); blob(0.12 * s, x + 0.14 * s, 0.1 * s, 0.02, 0x4f8a4e, 0x9ccb70, { flat: 0.7 }); leaves(x, 0, 0.03, 9, 0.2 * s, 0.09 * s, green, 1.15); if (flowers) [[-0.06, 0.25], [0.07, 0.27], [0.15, 0.2]].forEach(([d, y]) => { petals(x + d * s, y * s, 0.12, 5, 0.032, 0.02, M(0xf4f0fa, 0.5), 1.3, 0.8); sphere(0.01, M(0xf2c73a, 0.5), { x: x + d * s, y: y * s, z: 0.13 }); }); };
  const potatoes = (x) => [[-0.2, 0.14, 1], [0.21, 0.12, 0.85], [0.04, 0.2, 0.75]].forEach(([d, z, s]) => blob(0.06 * s, x + d, 0.035, z, 0xa77a48, 0xe0b67a, { flat: 0.7, rough: 0.2 }));
  P.potato = { seed: { color: 0xc59a5a, shape: 'tuber' }, young: (x) => potatoBush(x, 0.65, false), grown: (x) => potatoBush(x, 0.9, true), ready: (x) => { potatoBush(x, 1, true); potatoes(x); } };
  // The daisy, sunflower, succulent and seedling of before, given a grown stage between.
  const daisy = (x, z, h, s = 1) => { stem(x, z, h); disc(x, h, z, 12, 0.082 * s, 0.05 * s, 0.021 * s, 0xfaf6ec, 0.9); place(new THREE.SphereGeometry(0.042 * s, 14, 10), 0xf0b93a, { x, y: h + 0.008, z: z + 0.012, rx: 0.9, sz: 0.5 }); };
  const daisyBud = (x, z, h) => { stem(x, z, h); ball(0.035, 0x8fc267, { x, y: h + 0.01, z, sy: 1.15 }); };
  P.daisy = { seed: { color: 0x8b6b48, size: 0.7 }, young: (x) => { stem(x, 0, 0.3); leaves(x, 0, 0.05, 6, 0.2, 0.05); ball(0.045, 0x8fc267, { x, y: 0.32, sy: 1.1 }); },
    grown: (x) => { leaves(x, 0, 0.04, 8, 0.25, 0.055); daisyBud(x - 0.15, 0.03, 0.4); daisyBud(x + 0.13, 0.05, 0.5); daisyBud(x, -0.08, 0.6); daisy(x + 0.24, -0.04, 0.33, 0.8); },
    ready: (x) => { leaves(x, 0, 0.04, 9, 0.28, 0.06); daisy(x - 0.17, 0.03, 0.42); daisy(x + 0.15, 0.06, 0.54, 1.1); daisy(x, -0.08, 0.68, 1.15); daisy(x + 0.26, -0.06, 0.34, 0.85); daisy(x - 0.3, -0.05, 0.3, 0.85); } };
  const sunLeaves = (x, ys) => ys.forEach((y, i) => { const l = leaf(0.28, 0.12, green, { x, y }); l.rotation.set(0.1, i * 2.4, 1.1, 'YXZ'); });
  P.sunflower = { seed: { color: 0x3b3a36, size: 0.9 }, young: (x) => { stem(x, 0, 0.5, 0.02); sunLeaves(x, [0.16, 0.3, 0.42]); petals(x, 0.51, 0, 10, 0.07, 0.035, greenL, 0.5, 0.2); ball(0.05, 0x7e9c48, { x, y: 0.53 }); },
    grown: (x) => { stem(x, 0, 0.92, 0.026); sunLeaves(x, [0.22, 0.42, 0.6, 0.76]); petals(x, 0.92, 0.02, 12, 0.1, 0.045, greenL, 0.6, 0.2); disc(x, 0.95, 0.04, 12, 0.08, 0.05, 0.03, 0xf3c23a, 0.3); ball(0.08, 0x6e8a3e, { x, y: 0.96, z: 0.03, sz: 0.6 }); },
    ready: (x) => { stem(x, 0, 1.14, 0.03); sunLeaves(x, [0.26, 0.5, 0.74, 0.92]); const fy = 1.2, fz = 0.04; disc(x, fy, fz, 11, 0.21, 0.11, 0.05, 0xf0b52c, 0.45); disc(x, fy, fz + 0.012, 16, 0.2, 0.105, 0.042, 0xf7cf4a, 0.45); place(new THREE.SphereGeometry(0.135, 20, 14), 0x6e4a2c, { x, y: fy, z: fz + 0.03, rx: 0.45, sz: 0.34 }); } };
  const rosette = (x, rings) => rings.forEach(([c, len, tilt, m], r) => { for (let i = 0; i < c; i++) { const l = leaf(len, 0.075, m, { x, y: 0.03 + r * 0.022 }); l.rotation.set(0, (i / c) * 6.28 + r * 0.4, tilt, 'YXZ'); } });
  P.succulent = { seed: { color: 0x8fc2a4, shape: 'bulb', size: 0.8 }, young: (x) => rosette(x, [[7, 0.15, 1.1, M(0x8fc2a4, 0.5)], [5, 0.1, 0.6, M(0xa9d6b8, 0.5)]]),
    grown: (x) => rosette(x, [[9, 0.23, 1.15, M(0x7fb699, 0.5)], [8, 0.18, 0.85, M(0x8fc2a4, 0.5)], [6, 0.12, 0.5, M(0xa9d6b8, 0.5)]]),
    ready: (x) => { rosette(x, [[10, 0.28, 1.2, M(0x7fb699, 0.5)], [9, 0.22, 0.9, M(0x7fb699, 0.5)], [7, 0.16, 0.55, M(0xa9d6b8, 0.5)], [5, 0.1, 0.28, M(0xe8a3ac, 0.5)]]); stem(x + 0.05, 0, 0.5, 0.009, 0.1, 0x9cb26c); [0, 1, 2].forEach((k) => ball(0.032, 0xf1b0b9, { x: x + 0.1 + k * 0.012, y: 0.46 + k * 0.03, z: k * 0.02 })); } };
  P.seedling = { seed: { color: 0xa98a5e }, young: (x) => { stem(x, 0, 0.3, 0.016); [[0.12, -1], [0.2, 1], [0.27, -1], [0.33, 1]].forEach(([y, sgn]) => leaf(0.16, 0.08, green, { x, y, rz: sgn * 0.95, rx: 0.15 })); },
    grown: (x) => { trunk(x, 0.3, 0.026); blob(0.16, x, 0.4, 0, 0x4f8a4e, 0x9ccb70); blob(0.11, x - 0.12, 0.34, 0.03, 0x4f8a4e, 0x9ccb70); blob(0.11, x + 0.12, 0.35, 0, 0x4f8a4e, 0x9ccb70); },
    ready: (x) => { trunk(x, 0.34, 0.034); blob(0.2, x, 0.46, 0, 0x4f8a4e, 0x9ccb70); blob(0.15, x - 0.16, 0.38, 0.03, 0x4f8a4e, 0x9ccb70); blob(0.15, x + 0.16, 0.39, 0, 0x4f8a4e, 0x9ccb70); blob(0.12, x, 0.62, 0, 0x4f8a4e, 0x9ccb70); [[-0.12, 0.5], [0.1, 0.56], [0.17, 0.42], [-0.04, 0.4]].forEach(([d, y]) => ball(0.026, 0xf6a3b4, { x: x + d, y, z: 0.2 })); } };

  // Không phổ biến
  const berryBush = (x, s) => { blob(0.27 * s, x, 0.16 * s, 0, 0x4f8a4e, 0x8cc070, { flat: 0.68 }); for (let i = 0; i < 13; i++) { const l = leaf(0.28 * s, 0.12 * s, green, { x, y: 0.05 }); l.rotation.set(0, (i / 13) * 6.28, 1.02, 'YXZ'); } };
  const strawberries = (x, ripe) => [[-0.2, 0.18, 0.22], [0.03, 0.12, 0.27], [0.22, 0.16, 0.2], [-0.05, 0.3, 0.2], [0.14, 0.32, 0.14], [-0.26, 0.05, 0.14]].forEach(([d, y, z], i) => { if (!ripe && i > 2) return; place(new THREE.SphereGeometry(0.052, 14, 10), ripe ? 0xdf3f44 : 0xc9df8a, { x: x + d, y, z, sy: 1.25 }); ball(0.03, 0x6fa353, { x: x + d, y: y + 0.058, z, sy: 0.5 }); for (let k = 0; k < 5; k++) ball(0.0055, 0xf7dc7c, { x: x + d + Math.cos(k * 2.3) * 0.03, y: y - 0.01 + Math.sin(k * 1.7) * 0.03, z: z + 0.045 }); });
  P.strawberry = { seed: { color: 0xe2b85a, size: 0.6 }, young: (x) => { berryBush(x, 0.62); },
    grown: (x) => { berryBush(x, 0.85); [[0.06, 0.2], [-0.08, 0.17], [0.15, 0.12]].forEach(([d, y]) => { petals(x + d, y, 0.18, 5, 0.04, 0.025, M(0xfaf6ec, 0.6), 1.35, 0.8); ball(0.014, 0xf4d36a, { x: x + d, y, z: 0.19 }); }); strawberries(x, false); },
    ready: (x) => { berryBush(x, 1); strawberries(x, true); } };
  const tulip = (x, z, h, m, open = 1) => { stem(x, z, h, 0.013); const f = (a) => { const l = leaf(0.2 * (0.8 + open * 0.2), 0.075, m, { x, y: h - 0.03, z }); l.rotation.set(0.1, -a, 0.14 + open * 0.06, 'YXZ'); }; [0, 1.05, 2.1, 3.15, 4.2, 5.25].forEach(f); };
  const tulipLeaves = (x) => [-0.5, 0.5, -0.2, 0.25].forEach((rz, i) => leaf(0.42, 0.08, green, { x: x + (i - 1.5) * 0.08, y: 0.02, rz, rx: i > 1 ? -0.4 : 0.1 }));
  P.tulip = { seed: { color: 0xb88a5a, shape: 'bulb' }, young: (x) => { [-0.45, 0.45, 0].forEach((rz, i) => leaf(0.34, 0.07, green, { x, y: 0.02, rz, rx: i === 2 ? -0.4 : 0 })); stem(x, 0, 0.32); ball(0.05, 0x9ccb70, { x, y: 0.36, sy: 1.4 }); },
    grown: (x) => { tulipLeaves(x); tulip(x - 0.16, 0.02, 0.38, M(0xb9d47a, 0.55), 0); tulip(x + 0.17, 0, 0.42, M(0xd9c27a, 0.55), 0); tulip(x, -0.08, 0.52, M(0xc9cf7a, 0.55), 0); },
    ready: (x) => { tulipLeaves(x); tulip(x - 0.16, 0.02, 0.42, M(0xe2604c, 0.55)); tulip(x + 0.17, 0, 0.46, M(0xf09ab4, 0.6)); tulip(x, -0.08, 0.58, M(0xf4c63c, 0.55)); } };
  const lavender = (x, n, purple) => { blob(0.22, x, 0.1, 0, 0x4f8559, 0x8db887, { flat: 0.55 }); blob(0.14, x - 0.17, 0.07, 0.04, 0x4f8559, 0x8db887, { flat: 0.6 }); blob(0.14, x + 0.17, 0.07, 0.03, 0x4f8559, 0x8db887, { flat: 0.6 }); for (let i = 0; i < n; i++) { const a = i * 0.72, lean = Math.cos(a) * (0.1 + (i % 4) * 0.08), h = between(0.42, 0.64), zz = Math.sin(a) * 0.08; stem(x, zz, h, 0.008, lean, 0x7ea97a); const tx = x + lean * h; for (let k = 0; k < 7; k++) ball(0.032 - k * 0.002, purple ? (k % 2 ? 0x9d82d4 : 0x8768c2) : (k % 2 ? 0x93b58a : 0x7fa679), { x: tx + lean * k * 0.022, y: h + k * 0.028 - 0.02, z: zz, sy: 1.1 }); } };
  P.lavender = { seed: { color: 0x4a3b2e, size: 0.6 }, young: (x) => { for (let i = 0; i < 12; i++) { const a = i * 0.9; stem(x, 0, between(0.24, 0.36), 0.008, Math.cos(a) * 0.3, 0x7ea97a); } blob(0.15, x, 0.08, 0, 0x4f8559, 0x8db887, { flat: 0.6 }); },
    grown: (x) => lavender(x, 12, false), ready: (x) => lavender(x, 16, true) };
  const blueBush = (x, s) => { trunk(x, 0.12 * s, 0.025, 0x7a5a42); blob(0.2 * s, x, 0.26 * s, 0, 0x3f7a55, 0x7fb07a); blob(0.15 * s, x - 0.15 * s, 0.2 * s, 0.03, 0x3f7a55, 0x7fb07a); blob(0.15 * s, x + 0.15 * s, 0.21 * s, 0.02, 0x3f7a55, 0x7fb07a); blob(0.12 * s, x, 0.38 * s, 0.02, 0x3f7a55, 0x86b981); };
  const blueberries = (x, ripe) => dots(x, 0.3, 0.28, ripe ? 9 : 6, (px, py, pz, i) => { const n = ripe ? 4 : 3; for (let k = 0; k < n; k++) { const c = ripe ? (k % 2 ? 0x4a5fa8 : 0x3d4f93) : 0xd8e8f0; ball(ripe ? 0.026 : 0.018, c, { x: px + Math.cos(k * 2.1) * 0.026, y: py - k * 0.018, z: pz + Math.sin(k * 2.1) * 0.01 }); if (ripe) ball(0.006, 0x2b3466, { x: px + Math.cos(k * 2.1) * 0.026, y: py - k * 0.018, z: pz + 0.026 }); } });
  P.blueberry = { seed: { color: 0x5a4a68, size: 0.55 }, young: (x) => blueBush(x, 0.6), grown: (x) => { blueBush(x, 0.9); blueberries(x * 1, false); }, ready: (x) => { blueBush(x, 1); blueberries(x, true); } };
  const vinePost = (x, h) => { cyl(0.018, 0.022, h, 0x9a7048, { x: x - 0.2, y: h / 2, z: -0.06 }); cyl(0.018, 0.022, h, 0x9a7048, { x: x + 0.2, y: h / 2, z: -0.06 }); cyl(0.014, 0.014, 0.48, 0x9a7048, { x, y: h - 0.03, z: -0.06, rz: Math.PI / 2 }); };
  const vineLeaves = (x, h, n) => { stem(x - 0.04, -0.04, h * 0.9, 0.016, 0.08, 0x7a6a3a); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, px = x - 0.26 + t * 0.52, py = h - 0.02 - (i % 3) * 0.06 - Math.sin(t * Math.PI) * 0.02; const l = leaf(0.15, 0.14, [green, greenL, greenD][i % 3], { x: px, y: py, z: 0.02 + (i % 2) * 0.03 }); l.rotation.set(-0.9, (i % 2 ? 0.4 : -0.4), (i % 2 ? 1 : -1) * 0.5); } blob(0.1, x - 0.12, h - 0.04, -0.04, 0x477f4a, 0x86c26e, { flat: 0.6 }); blob(0.1, x + 0.12, h - 0.03, -0.04, 0x477f4a, 0x86c26e, { flat: 0.6 }); };
  const grapes = (x, y, z, c, s = 1) => { for (let r = 0; r < 4; r++) for (let k = 0; k <= 3 - r; k++) ball(0.024 * s, (r + k) % 2 ? c : c - 0x101008, { x: x + (k - (3 - r) / 2) * 0.042 * s, y: y - r * 0.038 * s, z: z + (r % 2) * 0.01 }); };
  P.grape = { seed: { color: 0x6b4a3a, size: 0.6 }, young: (x) => { cyl(0.012, 0.016, 0.32, 0x9a7048, { x: x + 0.06, y: 0.16, z: -0.04 }); stem(x, 0, 0.28, 0.012, 0.1, 0x7a6a3a); [[0.1, -1], [0.18, 1], [0.26, -1]].forEach(([y, s]) => leaf(0.13, 0.1, green, { x: x + 0.02, y, rz: s * 1.0, rx: 0.3 })); },
    grown: (x) => { vinePost(x, 0.56); vineLeaves(x, 0.56, 10); grapes(x - 0.08, 0.42, 0.1, 0x9ccb6a, 0.85); },
    ready: (x) => { vinePost(x, 0.6); vineLeaves(x, 0.6, 12); grapes(x - 0.12, 0.46, 0.1, 0x6a3f8f, 1.15); grapes(x + 0.12, 0.44, 0.1, 0x7a4a9c, 1.05); grapes(x, 0.4, 0.12, 0x6a3f8f, 0.9); } };
  const pumpkinLeaves = (x, n, s) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.3; const l = leaf(0.22 * s, 0.2 * s, i % 2 ? green : greenD, { x, y: 0.03 + (i % 2) * 0.03, z: -0.03 }); l.rotation.set(1.25 - (i % 2) * 0.2, -a, 0, 'YXZ'); } };
  const pumpkin = (x, z, s, c) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; sphere(0.075 * s, M(c, 0.5), { x: x + Math.cos(a) * 0.045 * s, y: 0.075 * s, z: z + Math.sin(a) * 0.045 * s, sx: 0.75, sy: 0.95, ry: -a }); } cyl(0.014 * s, 0.02 * s, 0.07 * s, 0x6f7a3a, { x, y: 0.16 * s, z, rz: 0.3 }); };
  P.pumpkin = { seed: { color: 0xf1e3bd, shape: 'flat' }, young: (x) => pumpkinLeaves(x, 5, 0.75),
    grown: (x) => { pumpkinLeaves(x, 7, 1); pumpkin(x + 0.06, 0.12, 0.55, 0x9cc35a); petals(x - 0.14, 0.16, 0.1, 5, 0.05, 0.03, M(0xf5c13a, 0.5), 1.0, 0.6); },
    ready: (x) => { pumpkinLeaves(x, 8, 1.1); pumpkin(x + 0.02, 0.1, 1.25, 0xef8a26); } };

  // Hiếm
  const tree = (x, h, r, dark, lit, bark = 0x7a5a42, thick = 0.045) => { trunk(x, h, thick, bark); cyl(0.012, 0.02, h * 0.42, bark, { x: x - 0.06, y: h * 0.78, rz: 0.62 }); cyl(0.012, 0.02, h * 0.42, bark, { x: x + 0.06, y: h * 0.82, rz: -0.62 }); crown(x, h + r * 0.45, r, dark, lit); return h + r * 0.45; };
  const youngTree = (x, h, dark, lit, bark = 0x7a5a42) => { trunk(x, h, 0.022, bark); blob(0.1, x, h + 0.04, 0, dark, lit); blob(0.07, x - 0.08, h - 0.03, 0.02, dark, lit); blob(0.07, x + 0.08, h - 0.01, 0, dark, lit); };
  P.cherry_blossom = { seed: { color: 0x8a4a3a, size: 0.8 }, young: (x) => youngTree(x, 0.3, 0x4f8a4e, 0x9ccb70, 0x6e4a3a),
    grown: (x) => { const y = tree(x, 0.42, 0.34, 0x4f8a4e, 0x9ccb70, 0x6e4a3a); dots(x, y, 0.34, 14, (px, py, pz) => ball(0.022, 0xf2b6c6, { x: px, y: py, z: pz })); },
    ready: (x) => { const y = tree(x, 0.46, 0.4, 0xdc98ac, 0xfbdde2, 0x6e4a3a); dots(x, y, 0.4, 22, (px, py, pz, i) => { petals(px, py, pz, 5, 0.026, 0.018, M(i % 3 ? 0xfbd3de : 0xf6a8bd, 0.6), 1.45, 0.9); }); } };
  P.golden_apple = { seed: { color: 0xc89a3a, size: 0.8 }, young: (x) => youngTree(x, 0.3, 0x4f8a4e, 0x9ccb70),
    grown: (x) => { const y = tree(x, 0.42, 0.34, 0x4f8a4e, 0x9ccb70); dots(x, y, 0.34, 7, (px, py, pz) => ball(0.026, 0xb9cf6a, { x: px, y: py, z: pz })); },
    ready: (x) => { const y = tree(x, 0.46, 0.4, 0x4a8448, 0x96c86a); const gold = mat(0xf2c037, 0.28, { metalness: 0.35 }); dots(x, y, 0.4, 10, (px, py, pz) => { sphere(0.042, gold, { x: px, y: py, z: pz, sy: 0.9 }); cyl(0.004, 0.005, 0.03, 0x6e4a2c, { x: px, y: py + 0.045, z: pz }); }); } };
  const crystalM = () => mat(0x8fe3f0, 0.12, { emissive: 0x6fd6ee, emissiveIntensity: night ? 1.2 : 0.18 });
  /** A cluster of hexagonal crystals with pointed tips, leaning out from (x, y). */
  const crystals = (x, y, z, s, n = 3) => { for (let i = 0; i < n; i++) { const lean = (i - (n - 1) / 2) * 0.45, h = 0.12 * s * (1 - Math.abs(lean) * 0.4), r = 0.026 * s, g = new THREE.Group(); g.position.set(x + lean * 0.05 * s, y, z); g.rotation.set(0.15, 0, -lean); scene.add(g); const m = crystalM(); const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), m); body.position.y = h / 2; g.add(body); const tip = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.45, 6), m); tip.position.y = h + h * 0.225; g.add(tip); } };
  P.crystal_tree = { seed: { color: 0x8fe3f0, shape: 'gem', shine: true }, sprout: { leaf: 0xa6dfe6 }, young: (x) => { trunk(x, 0.2, 0.024, 0xbfd6e2); crystals(x, 0.2, 0.02, 0.8, 3); leaves(x, 0, 0.03, 4, 0.1, 0.04, M(0xa6dfe6, 0.4), 1.1); },
    grown: (x) => { trunk(x, 0.32, 0.045, 0xbfd6e2); crown(x, 0.46, 0.32, 0x6fb3c4, 0xc8eef4); crystals(x - 0.14, 0.4, 0.2, 0.8, 2); crystals(x + 0.12, 0.48, 0.2, 0.7, 2); },
    ready: (x) => { trunk(x, 0.34, 0.05, 0xbfd6e2); crown(x, 0.5, 0.38, 0x6fb3c4, 0xc8eef4); dots(x, 0.5, 0.38, 6, (px, py, pz) => crystals(px, py - 0.04, pz, 1, 3)); crystals(x + 0.16, 0.0, 0.16, 0.9, 3); } };
  const rose = (x, y, z, c, s = 1, open = 1) => { const light = M(c, 0.5), dark = M(c - 0x141008, 0.55), deep = M(c - 0x282014, 0.6); sphere(0.034 * s, deep, { x, y: y + 0.01 * s, z, sy: 1.05 }); const rings = open ? [[5, 0.06, 0.9, light], [6, 0.075, 1.25, dark], [7, 0.085, 1.55, light]] : [[4, 0.05, 0.35, dark]]; rings.forEach(([n, len, tilt, m], r) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r * 0.45; const l = leaf(len * s, len * 0.85 * s, m, { x, y: y - 0.006 * s, z }); l.rotation.set(-0.55, -a, tilt, 'YXZ'); } }); };
  const roseBush = (x, s) => { blob(0.2 * s, x, 0.16 * s, 0, 0x3a6e44, 0x76a86a, { flat: 0.8 }); blob(0.14 * s, x - 0.15 * s, 0.12 * s, 0.04, 0x3a6e44, 0x76a86a); blob(0.14 * s, x + 0.15 * s, 0.13 * s, 0.02, 0x3a6e44, 0x76a86a); blob(0.12 * s, x, 0.32 * s, 0.02, 0x3a6e44, 0x7fb070); };
  P.blue_rose = { seed: { color: 0x4a5a7a, size: 0.7 }, young: (x) => roseBush(x, 0.6),
    grown: (x) => { roseBush(x, 0.9); [[-0.12, 0.3], [0.11, 0.33], [0.0, 0.42]].forEach(([d, y]) => rose(x + d, y, 0.17, 0x7aa0d8, 1.1, 0)); },
    ready: (x) => { roseBush(x, 1.05); [[-0.15, 0.3, 1.25], [0.15, 0.33, 1.3], [0.0, 0.46, 1.45], [0.03, 0.18, 1.1]].forEach(([d, y, s]) => rose(x + d, y, 0.22, 0x3f6fd6, s)); } };
  const moonFlower = (x, y, z, s, open) => { if (!open) { sphere(0.03 * s, M(0xe6efe0, 0.5), { x, y, z, sy: 1.6, rz: 0.3 }); return; } const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = 0.7; scene.add(g); const white = glowM(0xf6f4ff, 0.22, 1.0); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const l = leaf(0.085 * s, 0.075 * s, white, { parent: g }); l.rotation.set(1.3, -a, 0, 'YXZ'); } sphere(0.02 * s, glowM(0xfff2b0, 0.5, 2.2), { x, y: y + 0.012, z: z + 0.012 }); };
  P.moonflower = { seed: { color: 0xd9dbe6, shine: true }, young: (x) => { stem(x, 0, 0.28, 0.012, 0.05, 0x6f9a74); [[0.1, -1], [0.18, 1], [0.25, -1]].forEach(([y, s]) => leaf(0.14, 0.09, M(0x86b48a, 0.6), { x, y, rz: s, rx: 0.2 })); },
    grown: (x) => { blob(0.2, x, 0.16, 0, 0x3f6e5a, 0x86b48a, { flat: 0.8 }); blob(0.13, x - 0.15, 0.12, 0.04, 0x3f6e5a, 0x86b48a); blob(0.13, x + 0.15, 0.12, 0.03, 0x3f6e5a, 0x86b48a); [[-0.1, 0.32], [0.1, 0.3], [0.02, 0.4]].forEach(([d, y]) => moonFlower(x + d, y, 0.15, 1, false)); },
    ready: (x) => { blob(0.22, x, 0.17, 0, 0x3f6e5a, 0x86b48a, { flat: 0.8 }); blob(0.15, x - 0.17, 0.12, 0.04, 0x3f6e5a, 0x86b48a); blob(0.15, x + 0.17, 0.13, 0.03, 0x3f6e5a, 0x86b48a); [[-0.14, 0.32], [0.14, 0.3], [0.0, 0.42], [-0.22, 0.18], [0.24, 0.18]].forEach(([d, y]) => moonFlower(x + d, y, 0.2, 1.1, true)); } };

  // Sử thi
  P.mist_tree = { seed: { color: 0xb8ccd2, shine: true }, sprout: { leaf: 0xa9cfc8 }, young: (x) => youngTree(x, 0.3, 0x7fa9a2, 0xd6ece6, 0x8c8a86),
    grown: (x) => { const y = tree(x, 0.42, 0.34, 0x7fa9a2, 0xd6ece6, 0x8c8a86); dots(x, y, 0.34, 4, (px, py, pz) => sphere(0.022, glowM(0xe9fbff, 0.3, 1.2), { x: px, y: py, z: pz })); },
    ready: (x) => { const y = tree(x, 0.46, 0.4, 0x86b3ac, 0xe4f3ef, 0x8c8a86); dots(x, y, 0.4, 8, (px, py, pz) => sphere(0.028, glowM(0xe9fbff, 0.4, 1.6), { x: px, y: py, z: pz })); } };
  const pineTiers = (x, h, r, n, snow) => { trunk(x, h * 0.2, 0.035, 0x6e5440); for (let i = 0; i < n; i++) { const t = i / n, y = h * 0.16 + t * h * 0.72, rr = r * (1 - t * 0.7); place(new THREE.ConeGeometry(rr, h * 0.34, 18, 2), (c, X, Y, Z, nx, ny) => c.set(0x3b7564).lerp(v.tmp.set(0x78ac88), Math.max(0, ny * 0.6 + 0.2)), { x, y: y + h * 0.17, z: 0 }); if (snow) place(new THREE.ConeGeometry(rr * 0.75, h * 0.12, 18, 1), 0xf4f9ff, { x, y: y + h * 0.29, z: 0.01 }); } };
  P.frost_tree = { seed: { color: 0xcfe9ff, shape: 'gem', shine: true }, sprout: { leaf: 0xbfe0ea }, young: (x) => pineTiers(x, 0.34, 0.14, 2, true),
    grown: (x) => pineTiers(x, 0.7, 0.26, 3, true),
    ready: (x) => { pineTiers(x, 0.86, 0.32, 4, true); const ice = mat(0xbfeaff, 0.1, { emissive: 0x9fdcff, emissiveIntensity: night ? 1 : 0.15 }); [[-0.2, 0.3], [0.19, 0.34], [-0.1, 0.55], [0.11, 0.6], [0.0, 0.42], [0.24, 0.18], [-0.24, 0.16]].forEach(([d, y]) => gem(0.032, ice, { x: x + d, y, z: 0.2 - Math.abs(d) * 0.3, sy: 1.6 })); } };
  const flameLeaves = (x, y, r, n, s = 1) => { const tones = [0xe2402a, 0xf2752e, 0xf7b23a, 0xd8341f]; for (let i = 0; i < n; i++) { const a = i * 2.39996, u = Math.sqrt((i + 0.5) / n), px = x + Math.cos(a) * r * u, py = y + Math.sin(a) * r * u * 0.75; add(new THREE.ConeGeometry(0.05 * s, 0.16 * s, 12), M(tones[i % 4], 0.5), { x: px, y: py, z: r * 0.5 * Math.sqrt(Math.max(0.1, 1 - u * u)), rz: Math.cos(a) * -0.25 }); } };
  P.fire_tree = { seed: { color: 0xe2502a, shine: true }, sprout: { leaf: 0xe8743a, stem: 0x8a4a2a }, young: (x) => { trunk(x, 0.24, 0.022, 0x5a3a2a); flameLeaves(x, 0.3, 0.12, 7, 0.7); },
    grown: (x) => { trunk(x, 0.4, 0.04, 0x5a3a2a); crown(x, 0.55, 0.3, 0xb8361f, 0xf08a3a, 4); flameLeaves(x, 0.58, 0.28, 12); },
    ready: (x) => { trunk(x, 0.44, 0.045, 0x5a3a2a); crown(x, 0.6, 0.36, 0xb8361f, 0xf08a3a, 5); flameLeaves(x, 0.64, 0.34, 16, 1.1); dots(x, 0.6, 0.36, 7, (px, py, pz) => sphere(0.03, glowM(0xffb03a, 0.8, 2.6), { x: px, y: py - 0.03, z: pz + 0.03 })); } };
  const RAINBOW = [0xe9483f, 0xf28a2e, 0xf6cf3a, 0x5cbf5a, 0x3fa0e0, 0x5a6fd6, 0xa060d0];
  const rainbowFlower = (x, y, z, s, n = 7) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = 0.75; scene.add(g); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const l = leaf(0.11 * s, 0.07 * s, M(RAINBOW[i % 7], 0.5), { parent: g }); l.rotation.set(1.35, -a, 0, 'YXZ'); } sphere(0.03 * s, M(0xfff3c4, 0.5), { x, y: y + 0.01, z: z + 0.012 }); };
  P.rainbow_flower = { seed: { color: 0xd86ac0, shine: true }, sprout: { leaf: 0x9fd07a }, young: (x) => { leaves(x, 0, 0.04, 6, 0.2, 0.06); stem(x, 0, 0.3); ball(0.04, 0xe0b0e0, { x, y: 0.32, sy: 1.2 }); },
    grown: (x) => { leaves(x, 0, 0.04, 8, 0.26, 0.07); [[-0.14, 0.4, 0xf28a2e], [0.13, 0.46, 0x3fa0e0], [0, 0.56, 0xa060d0]].forEach(([d, h, c]) => { stem(x + d, 0, h, 0.012); ball(0.045, c, { x: x + d, y: h + 0.02, sy: 1.25 }); }); },
    ready: (x) => { leaves(x, 0, 0.04, 9, 0.28, 0.07); [[-0.18, 0.4, 1.2], [0.18, 0.46, 1.25], [0, 0.6, 1.5], [-0.3, 0.24, 0.9], [0.3, 0.26, 0.9]].forEach(([d, h, s]) => { stem(x + d, 0.02, h, 0.013); rainbowFlower(x + d, h, 0.04, s); }); } };
  const starFruit = (px, py, pz, s = 1) => add(star, glowM(0xffd84a, 0.6, 2.4), { x: px, y: py, z: pz, sx: 0.035 * s, sy: 0.035 * s, sz: 0.035 * s, rx: -0.3 });
  P.starlight_tree = { seed: { color: 0xffd84a, shape: 'star', shine: true }, sprout: { leaf: 0x5a8aa0 }, young: (x) => { youngTree(x, 0.3, 0x2f5a6e, 0x6fa0b4, 0x5a4a5a); starFruit(x, 0.42, 0.06, 0.7); },
    grown: (x) => { const y = tree(x, 0.42, 0.34, 0x2f5a6e, 0x6fa0b4, 0x5a4a5a); dots(x, y, 0.34, 4, (px, py, pz) => starFruit(px, py, pz, 0.8)); },
    ready: (x) => { const y = tree(x, 0.46, 0.4, 0x2a5268, 0x6898b0, 0x5a4a5a); dots(x, y, 0.4, 9, (px, py, pz) => starFruit(px, py, pz, 1.1)); } };

  // Huyền thoại
  const orb = (px, py, pz, c, s = 1, day = 0.7, dark = 2.6) => sphere(0.034 * s, glowM(c, day, dark), { x: px, y: py, z: pz });
  P.light_tree = { seed: { color: 0xfff1c4, shine: true }, sprout: { leaf: 0xe8e2b0, stem: 0xd8cfa8 }, young: (x) => { youngTree(x, 0.32, 0xd9c98a, 0xfff4cf, 0xe8e0cc); orb(x, 0.48, 0.05, 0xfff0b0, 0.7); },
    grown: (x) => { const y = tree(x, 0.44, 0.36, 0xd9c98a, 0xfff4cf, 0xe8e0cc, 0.05); dots(x, y, 0.36, 5, (px, py, pz) => orb(px, py, pz, 0xfff0b0, 0.8)); },
    ready: (x) => { const y = tree(x, 0.5, 0.42, 0xe0cf8a, 0xfff6d6, 0xeee6d2, 0.055); dots(x, y, 0.42, 11, (px, py, pz) => orb(px, py, pz, 0xffe9a0, 1.05, 1, 3.2)); } };
  const twisted = (x, h, r, color) => { const n = Math.round(h / 0.06); for (let i = 0; i < n; i++) { const t = i / n; cyl(r * (1 - t * 0.4), r * (1 - t * 0.35), 0.075, color, { x: x + Math.sin(t * 7) * 0.03, y: 0.04 + t * h, rz: Math.cos(t * 7) * 0.25 }); } };
  const hourglass = (px, py, pz, s = 1) => { const gold = mat(0xd8a43a, 0.3, { metalness: 0.4 }), glass = glowM(0xbfe6ff, 0.3, 1.4); add(new THREE.ConeGeometry(0.03 * s, 0.04 * s, 14), glass, { x: px, y: py + 0.02 * s, z: pz, rx: Math.PI }); add(new THREE.ConeGeometry(0.03 * s, 0.04 * s, 14), glass, { x: px, y: py - 0.02 * s, z: pz }); cyl(0.034 * s, 0.034 * s, 0.008 * s, 0xd8a43a, { x: px, y: py + 0.042 * s, z: pz }); cyl(0.034 * s, 0.034 * s, 0.008 * s, 0xd8a43a, { x: px, y: py - 0.042 * s, z: pz }); return gold; };
  P.time_tree = { seed: { color: 0xc89a4a, shape: 'gem', shine: true }, sprout: { leaf: 0x9fb06a }, young: (x) => { twisted(x, 0.28, 0.028, 0x8a6a4a); blob(0.1, x, 0.36, 0, 0x6f8a4a, 0xbac97a); },
    grown: (x) => { twisted(x, 0.44, 0.045, 0x8a6a4a); crown(x, 0.6, 0.34, 0x6f8a4a, 0xbac97a); dots(x, 0.6, 0.34, 3, (px, py, pz) => hourglass(px, py, pz, 0.8)); },
    ready: (x) => { twisted(x, 0.5, 0.05, 0x8a6a4a); crown(x, 0.66, 0.4, 0x6a8448, 0xc2cf80); dots(x, 0.66, 0.4, 8, (px, py, pz) => hourglass(px, py, pz, 1.05)); } };
  const pearls = (x, y, r, n, s = 1) => dots(x, y, r, n, (px, py, pz, i) => sphere(0.03 * s, mat([0xf4e9ff, 0x7ee0d0, 0xf6a8d8][i % 3], 0.15, { emissive: [0xf4e9ff, 0x7ee0d0, 0xf6a8d8][i % 3], emissiveIntensity: night ? 1.4 : 0.2 }), { x: px, y: py, z: pz }));
  P.myth_tree = { seed: { color: 0x2fae8a, shape: 'gem', shine: true }, sprout: { leaf: 0x3fae7a }, young: (x) => youngTree(x, 0.32, 0x1f7a5a, 0x5fc49a, 0x6e5a4a),
    grown: (x) => { twisted(x, 0.42, 0.045, 0x6e5a4a); crown(x, 0.58, 0.36, 0x1f7a5a, 0x5fc49a); pearls(x, 0.58, 0.36, 4, 0.8); },
    ready: (x) => { twisted(x, 0.48, 0.055, 0x6e5a4a); crown(x, 0.66, 0.42, 0x1a7254, 0x5ccaa0, 6); pearls(x, 0.66, 0.42, 10, 1.05); } };
  const twinkles = (x, y, r, n) => dots(x, y, r, n, (px, py, pz) => sphere(0.009, glowM(0xffffff, 1.2, 4), { x: px, y: py, z: pz + 0.02 }));
  P.galaxy_tree = { seed: { color: 0x6a4ac0, shape: 'star', shine: true }, sprout: { leaf: 0x7a6ac8 }, young: (x) => { youngTree(x, 0.32, 0x5a4aa8, 0xa894e6, 0x4a3a5a); twinkles(x, 0.36, 0.12, 4); },
    grown: (x) => { const y = tree(x, 0.42, 0.36, 0x5a4aa8, 0xa894e6, 0x4a3a5a); twinkles(x, y, 0.36, 12); },
    ready: (x) => { const y = tree(x, 0.48, 0.42, 0x5444a4, 0xa08ae2, 0x4a3a5a); twinkles(x, y, 0.42, 20); dots(x, y, 0.42, 6, (px, py, pz, i) => orb(px, py, pz, i % 2 ? 0xb08aff : 0x7ab8ff, 0.9)); } };
  const roots = (x, s) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; cyl(0.012 * s, 0.03 * s, 0.2 * s, 0x6a4e36, { x: x + Math.cos(a) * 0.08 * s, y: 0.02, z: Math.sin(a) * 0.06 * s, rz: Math.cos(a) * 1.25, rx: -Math.sin(a) * 1.25 }); } };
  const motes = (x, y, r, n) => dots(x, y, r, n, (px, py, pz) => sphere(0.014, glowM(0x9dffb0, 0.9, 3.4), { x: px, y: py, z: pz + 0.02 }));
  P.ancient_tree = { seed: { color: 0x7a5a3a, shape: 'tuber', shine: false }, sprout: { leaf: 0x4f9a5a }, young: (x) => { blob(0.08, x + 0.06, 0.04, 0.06, 0x8a8a80, 0xc8c6bc, { flat: 0.6 }); youngTree(x, 0.3, 0x2f6e44, 0x6fb070, 0x6a4e36); },
    grown: (x) => { blob(0.11, x + 0.1, 0.05, 0.08, 0x8a8a80, 0xc8c6bc, { flat: 0.6 }); roots(x, 0.8); trunk(x, 0.4, 0.065, 0x6a4e36); crown(x, 0.56, 0.38, 0x2f6e44, 0x6fb070, 6); motes(x, 0.56, 0.38, 4); },
    ready: (x) => { blob(0.13, x + 0.12, 0.05, 0.1, 0x8a8a80, 0xc8c6bc, { flat: 0.6 }); roots(x, 1); trunk(x, 0.44, 0.08, 0x6a4e36); cyl(0.02, 0.035, 0.24, 0x6a4e36, { x: x - 0.1, y: 0.4, rz: 0.8 }); cyl(0.02, 0.035, 0.24, 0x6a4e36, { x: x + 0.1, y: 0.42, rz: -0.8 }); crown(x, 0.64, 0.46, 0x285f3c, 0x6cae6a, 7); motes(x, 0.64, 0.46, 12); } };

  const spec = P[plant];
  if (!spec) throw new Error(`unknown plant ${plant}`);
  const CELL = 1.25;
  const builders = [(x) => seedOf(x, spec.seed), (x) => sprouted(x, spec.sprout ?? {}), spec.young, spec.grown, spec.ready];
  for (let s = 0; s < 5; s++) {
    const x = (s - 2) * CELL;
    const before = scene.children.length;
    // A stage builds at the origin and is moved to its cell afterwards: its dice don't depend on the others.
    reseed(100 + s);
    const count = v.solid.length;
    builders[s](0);
    for (let g = count; g < v.solid.length; g++) v.solid[g].translate(x, 0, 0);
    for (let c = before; c < scene.children.length; c++) scene.children[c].position.x += x;
  }
  finish();
  const elev = 24 * Math.PI / 180, midY = 0.56;
  return flatCamera(CELL * 5, W, H, [0, midY + Math.sin(elev) * 30, Math.cos(elev) * 30], [0, midY, 0]);
}
