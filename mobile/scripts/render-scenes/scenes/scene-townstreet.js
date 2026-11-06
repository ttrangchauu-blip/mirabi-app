// Thị trấn Mirabi as one long street, seen through a long lens: the fountain square, the community garden, the event plaza, the
// gift shop, the hall, then twelve friends' plots. `&fountain=0..4`, `&garden=0..4`, `&lots=none|<one plot>` say what is built; the
// app lays patches of the picture over the street as they are. `&crop=x,y,w,h` renders part of the FULL picture. The sky is left out.
import { kit } from './kit.js';
import { village } from './village.js';

export const FULL_W = 6000, FULL_H = 720, SPAN = 37, LOT = 1.83;
export const AT = { fountain: 1.95, garden: 5.2, plaza: 8.2, shop: 10.8, hall: 13.45, houses: 15.65 };
export async function build({ THREE, scene, W, H, light }) {
  const { mat, glow, sky, lathe } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const night = light === 'night';
  const fountain = +(q.get('fountain') ?? 0), gardenStage = +(q.get('garden') ?? 0), lots = q.get('lots') ?? 'none';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });

  const v = village(THREE, scene, { night, start: 77 });
  const { reseed, rnd, between, lumps, tmp, place, box, cyl, ball, blob, LEAF, roundTree, pine, bush, shell, window_, door, chimney, fenceAt, hedgeAt, tones, plot, finish, panes } = v;
  const X = (u) => u - SPAN / 2;
  const FENCE = 1.56;

  // A long lens: the camera, and what its picture rows are worth.
  const dist = 38, pitch = 13.4 * Math.PI / 180;
  const target = new THREE.Vector3(0, +(q.get('ty') ?? 1.28), -0.5);
  const pos = new THREE.Vector3(0, target.y + Math.tan(pitch) * dist, dist - 0.5);
  const vfov = 2 * Math.atan((SPAN / 2) * (FULL_H / FULL_W) / pos.distanceTo(target));
  const rowAt = (row, z) => pos.y + Math.tan(-pitch + (0.5 - row) * vfov) * (pos.z - z);

  // --- The land.
  const RIM = -8.6, RISE = Math.max(0.3, rowAt(0.205, RIM));
  const rise = (x, z) => {
    const t = Math.max(0, Math.min(1, (-z - 1.7) / (-RIM - 1.7)));
    return t * t * (RISE * 0.86 + 0.13 * RISE * Math.sin(x * 0.42 + 0.9) + 0.06 * RISE * Math.sin(x * 1.1 + 2.4)) + 0.02 * Math.sin(x * 2.2 + z * 1.7) * Math.min(1, t * 4);
  };
  {
    const g = new THREE.PlaneGeometry(70, 15.6, 1200, 170);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, rise(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const A = new THREE.Color(0x7fae5c), B = new THREE.Color(0x9cc26c), C = new THREE.Color(0xb3cc7e), Far = new THREE.Color(0x9fbf8a);
    place(g, (c, x, y, z) => {
      const n = lumps(x * 0.9, z * 0.9, x * 0.4) * 0.7 + lumps(x * 2.7, z * 2.3, 1) * 0.35;
      c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n)));
      if (n > 0.42) c.lerp(C, Math.min(1, (n - 0.42) * 2));
      c.lerp(Far, Math.max(0, Math.min(0.6, (-z - 2) / 7)));
    });
  }
  const ridge = (z, y0, amp, tint, f, ph) => {
    const g = new THREE.PlaneGeometry(160, 40, 400, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i); p.setY(i, y0 + amp * (Math.sin(x * f + ph) * 0.6 + Math.sin(x * f * 2.3 + ph * 2) * 0.28 + Math.sin(x * f * 5.1 + ph) * 0.1)); } else p.setY(i, y0 - 40);
    g.computeVertexNormals();
    place(g, tint, { z });
  };
  ridge(-20, rowAt(0.17, -20), 0.32, 0xa9cfae, 0.26, 1);
  ridge(-34, rowAt(0.125, -34), 0.5, 0xc4e0d2, 0.15, 2.6);

  // --- The lane.
  for (let x = -21; x < 21; x += 0.31) for (let row = 0; row < 3; row++) {
    box(0.29, 0.03, 0.22, 0xd8d2c4 + Math.floor(rnd() * 3) * 0x050505, { x: x + (row % 2 ? 0.155 : 0), y: 0.015, z: 1.84 + row * 0.24, r: 0.012 });
  }
  box(44, 0.06, 0.1, 0xc8c5bb, { y: 0.02, z: 2.52, r: 0.02 });
  box(44, 0.05, 3.2, (c, x, y, z) => c.set(0xaeb9c0).lerp(tmp.set(0xbcc6cb), 0.5 + lumps(x * 1.5, z * 1.5, 0) * 0.5), { y: 0.005, z: 4.15, r: 0.01 });
  box(44, 0.012, 0.92, 0xa89f8c, { y: 0.003, z: 2.1, r: 0.005 });

  // --- What stands behind, here and there along the whole street.
  const kinds = ['oak', 'deep', 'lime', 'oak', 'blossom', 'deep', 'lime', 'oak', 'gold'];
  for (let i = 0; i < 26; i++) { const u = -1 + i * 1.58 + between(-0.4, 0.4), z = between(-3.6, -2.3), s = between(0.74, 1.02); roundTree(X(u), z, s, kinds[i % kinds.length], rise(X(u), z)); }
  for (let i = 0; i < 20; i++) { const u = 0 + i * 2.03 + between(-0.5, 0.5), z = between(-5.2, -4), s = between(0.68, 0.86); pine(X(u), z, s, rise(X(u), z)); }
  for (let i = 0; i < 74; i++) {
    const u = -2 + i * 0.56 + between(-0.2, 0.2), x = X(u), z = between(RIM + 1.3, RIM + 0.2), s = between(0.34, 0.56);
    if (Math.sin(x * 0.9 + 1) < -0.45) continue;
    if (rnd() < 0.34) pine(x, z, s, rise(x, z)); else roundTree(x, z, s, ['oak', 'deep', 'lime'][Math.floor(rnd() * 3)], rise(x, z));
  }
  const dot = new THREE.SphereGeometry(0.024, 8, 6), tuft = new THREE.ConeGeometry(0.03, 0.09, 6);
  for (let i = 0; i < 1500; i++) {
    const x = between(-20, 20), z = between(-7.5, 1.35), y = rise(x, z);
    if (rnd() < 0.38) place(dot, tones[Math.floor(rnd() * 4)], { x, y: y + 0.03, z });
    else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: y + 0.04, z, rz: between(-0.25, 0.25) });
  }

  // --- A lamp every other plot.
  const lampLight = night ? glow(0xffdf9a, 7) : mat(0xf7f6ee, 0.25);
  const lampAt = [];
  [3.62, 6.85, 9.55, 12.15, 14.72, 16.56, 20.22, 23.88, 27.54, 31.2, 34.86].forEach((u) => {
    const x = X(u);
    cyl(0.018, 0.028, 0.86, 0x4d6074, { x, y: 0.43, z: 1.72 });
    cyl(0.05, 0.06, 0.05, 0x4d6074, { x, y: 0.025, z: 1.72 });
    cyl(0.045, 0.03, 0.03, 0x4d6074, { x, y: 1.03, z: 1.72 });
    cyl(0.012, 0.075, 0.05, 0x4d6074, { x, y: 1.12, z: 1.72 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.044, 16, 12), lampLight); m.position.set(x, 1.05, 1.72); scene.add(m);
    lampAt.push(new THREE.Vector3(x, 1.05, 1.72));
  });

  reseed(101);
  // --- The square: rings of paving; the fountain grows on it, stage by stage.
  const stone = 0xdfe6ea, stoneD = 0xc2ccd3, wood = 0xc9a077;
  const FX = X(AT.fountain), FZ = 0.1;
  [[1.5, 0xd4cfc2, 0.012], [1.2, 0xe0dbcf, 0.018], [0.92, 0xd4cfc2, 0.024]].forEach(([r, c, y]) => cyl(r, r, 0.02, c, { x: FX, y, z: FZ, sz: 0.74, seg: 64 }));
  // A path to the paving, through the fence line.
  box(0.9, 0.012, 1.2, 0xd4cfc2, { x: FX, y: 0.014, z: 1.25, r: 0.005 });
  [[-1.32, 0.42], [1.32, 0.42]].forEach(([dx, dz]) => { // Benches and tubs of flowers.
    box(0.5, 0.03, 0.14, wood, { x: FX + dx, y: 0.14, z: FZ + dz, r: 0.01 });
    box(0.5, 0.11, 0.025, wood, { x: FX + dx, y: 0.23, z: FZ + dz - 0.08, r: 0.008 });
    [-0.2, 0.2].forEach((d) => box(0.03, 0.14, 0.13, 0x6a7a88, { x: FX + dx + d, y: 0.07, z: FZ + dz, r: 0.008 }));
  });
  [[-1.3, -0.45], [1.3, -0.45]].forEach(([dx, dz]) => {
    cyl(0.17, 0.13, 0.18, 0xc98f72, { x: FX + dx, y: 0.09, z: FZ + dz });
    for (let i = 0; i < 12; i++) ball(between(0.035, 0.06), tones[i % 4], { x: FX + dx + between(-0.13, 0.13), y: 0.2 + between(0, 0.08), z: FZ + dz + between(-0.1, 0.1) });
    bush(FX + dx, FZ + dz - 0.04, 0.5, 'lime', 0.15);
  });
  const water = mat(0x8fd6f2, 0.1);
  if (fountain === 0) {
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; box(0.2, 0.09, 0.13, stone, { x: FX + Math.cos(a) * 0.72, y: 0.07, z: FZ + Math.sin(a) * 0.54, ry: -a + Math.PI / 2, r: 0.03 }); }
    [-0.5, 0.5].forEach((d) => { cyl(0.012, 0.012, 0.3, wood, { x: FX + d, y: 0.15, z: FZ + 0.72 }); });
    box(1, 0.012, 0.012, 0xe8d9a8, { x: FX, y: 0.25, z: FZ + 0.72, r: 0.004 });
  } else {
    const S = 1.7, r = (fountain === 1 ? 0.42 : 0.56) * S;
    lathe([[0.001, 0], [r, 0], [r + 0.05, 0.08], [r + 0.05, 0.25], [r - 0.08, 0.27], [r - 0.08, 0.17], [0.001, 0.17]], { color: new THREE.Color(stone), roughness: 0.75 }, { x: FX, y: 0.03, z: FZ });
    if (fountain >= 1) cyl(r - 0.08, r - 0.08, 0.012, 0x8fd6f2, { x: FX, y: 0.215, z: FZ });
    if (fountain >= 2) {
      const h = fountain === 2 ? 0.34 : 0.78;
      cyl(0.13, 0.17, h, stoneD, { x: FX, y: 0.2 + h / 2, z: FZ });
    }
    if (fountain >= 3) {
      lathe([[0.001, 0], [0.48, 0.03], [0.53, 0.12], [0.46, 0.15], [0.44, 0.08], [0.001, 0.08]], { color: new THREE.Color(stone), roughness: 0.75 }, { x: FX, y: 0.95, z: FZ });
      cyl(0.44, 0.44, 0.012, 0x8fd6f2, { x: FX, y: 1.07, z: FZ });
    }
    if (fountain === 4) {
      cyl(0.07, 0.1, 0.34, stoneD, { x: FX, y: 1.22, z: FZ });
      lathe([[0.001, 0], [0.22, 0.025], [0.26, 0.085], [0.2, 0.1], [0.001, 0.06]], { color: new THREE.Color(stone), roughness: 0.75 }, { x: FX, y: 1.39, z: FZ });
      ball(0.08, 0xf3cb62, { x: FX, y: 1.56, z: FZ });
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ball(0.05, tones[i % 4], { x: FX + Math.cos(a) * 1.08, y: 0.08, z: FZ + Math.sin(a) * 0.82 }); ball(0.06, 0x6f9f52, { x: FX + Math.cos(a + 0.2) * 1.08, y: 0.05, z: FZ + Math.sin(a + 0.2) * 0.82, sy: 0.8 }); }
    }
  }
  hedgeAt(FX - 2.05, FX - 0.5); hedgeAt(FX + 0.5, FX + 1.5);

  reseed(202);
  // --- The community garden: a fenced plot, three beds that fill up.
  const GX = X(AT.garden), GZ = -0.15;
  box(2.7, 0.012, 2.3, 0x8fb565, { x: GX, y: 0.006, z: GZ + 0.2, r: 0.005 });
  fenceAt(GX - 1.4, GX - 0.26); fenceAt(GX + 0.26, GX + 1.4);
  [-1.4, 1.4].forEach((d) => { for (let z = -0.9; z < FENCE; z += 0.14) box(0.02, 0.17, 0.045, 0xe9e2d2, { x: GX + d, y: 0.085, z, r: 0.01 }); box(0.02, 0.024, 2.5, 0xe3dac6, { x: GX + d, y: 0.125, z: 0.33, r: 0.008 }); });
  for (let s = 0; s < 5; s++) place(new THREE.CylinderGeometry(0.075, 0.085, 0.022, 14), 0xcfc8b6, { x: GX + between(-0.03, 0.03), y: 0.012, z: 0.72 + s * 0.2, sx: 1.2, sz: 0.85 });
  // A signpost and pegs for what is to come.
  cyl(0.02, 0.022, 0.42, wood, { x: GX - 1.1, y: 0.21, z: 1.1 });
  box(0.34, 0.2, 0.025, 0xe8d9a8, { x: GX - 1.1, y: 0.42, z: 1.11, r: 0.012 });
  const beds = [[-0.72, -0.28], [0.72, -0.28], [0, 0.32]];
  if (gardenStage === 0) beds.forEach(([dx, dz]) => { [[-0.5, -0.2], [0.5, -0.2], [-0.5, 0.2], [0.5, 0.2]].forEach(([a, b]) => cyl(0.012, 0.012, 0.16, wood, { x: GX + dx + a, y: 0.08, z: GZ + dz + b })); });
  if (gardenStage >= 1) beds.forEach(([dx, dz]) => {
    box(1.16, 0.14, 0.5, wood, { x: GX + dx, y: 0.07, z: GZ + dz, r: 0.022 });
    box(1.06, 0.03, 0.4, 0x6e5240, { x: GX + dx, y: 0.135, z: GZ + dz, r: 0.012 });
    const n = [0, 7, 16, 26, 34][gardenStage];
    for (let i = 0; i < n; i++) {
      const px = GX + dx + between(-0.48, 0.48), pz = GZ + dz + between(-0.16, 0.16), h = between(0.06, 0.1) + gardenStage * 0.022;
      cyl(0.008, 0.012, h, 0x5f9a50, { x: px, y: 0.15 + h / 2, z: pz, seg: 6 });
      ball(gardenStage === 1 ? 0.024 : between(0.03, 0.045), gardenStage === 1 ? 0x7fb45f : 0x6f9f52, { x: px, y: 0.15 + h * 0.6, z: pz, sy: 0.7 });
      if (gardenStage >= 2 && i % 2 === 0) ball(between(0.034, 0.05), [0xf7a8bd, 0xffd76a, 0xc9b4ee, 0xfbf8f0, 0xf58a5c][i % 5], { x: px, y: 0.17 + h, z: pz, sy: 0.75 });
    }
  });
  if (gardenStage >= 3) { // A rain barrel and a little scarecrow's friend, a birdhouse.
    cyl(0.12, 0.11, 0.26, 0x8a6a4c, { x: GX + 1.12, y: 0.13, z: GZ + 0.6 });
    cyl(0.11, 0.11, 0.01, 0x8fd6f2, { x: GX + 1.12, y: 0.25, z: GZ + 0.6 });
    cyl(0.012, 0.014, 0.55, wood, { x: GX - 1.1, y: 0.27, z: GZ - 0.72 });
    box(0.14, 0.13, 0.12, 0xf3cb62, { x: GX - 1.1, y: 0.6, z: GZ - 0.72, r: 0.02 });
    box(0.17, 0.03, 0.16, 0xc96f5a, { x: GX - 1.1, y: 0.68, z: GZ - 0.72, r: 0.01 });
  }
  if (gardenStage === 4) { // An arch of roses at the gate, and an apple tree.
    place(new THREE.TorusGeometry(0.33, 0.018, 10, 28, Math.PI), 0xf7f3e6, { x: GX, y: 0.42, z: 1.5 });
    [-0.33, 0.33].forEach((d) => cyl(0.018, 0.018, 0.42, 0xf7f3e6, { x: GX + d, y: 0.21, z: 1.5 }));
    for (let i = 0; i < 22; i++) { const a = (i / 21) * Math.PI; ball(between(0.035, 0.05), i % 3 ? 0x6f9f52 : 0xef8fa6, { x: GX + Math.cos(a) * 0.33, y: 0.42 + Math.sin(a) * 0.33, z: 1.5 + between(-0.02, 0.02) }); }
    roundTree(GX + 1.0, GZ - 0.75, 0.62, 'oak');
    for (let i = 0; i < 12; i++) ball(0.028, 0xe25a4c, { x: GX + 1 + between(-0.22, 0.22), y: 0.62 + between(0, 0.4), z: GZ - 0.48 });
  }

  reseed(303);
  // --- The event plaza: a low stage under a striped awning; the app hangs the running event's name over it.
  const PX = X(AT.plaza), PZ = -0.2;
  box(2.3, 0.012, 2, 0xd4cfc2, { x: PX, y: 0.012, z: PZ + 0.5, r: 0.005 });
  box(1.9, 0.2, 0.95, wood, { x: PX, y: 0.1, z: PZ, r: 0.024 });
  box(1.8, 0.03, 0.85, 0xe3cba8, { x: PX, y: 0.21, z: PZ, r: 0.012 });
  [[-0.86, -0.38], [0.86, -0.38], [-0.86, 0.38], [0.86, 0.38]].forEach(([dx, dz]) => cyl(0.03, 0.035, 0.86, 0xf7f3e6, { x: PX + dx, y: 0.64, z: PZ + dz }));
  for (let i = 0; i < 9; i++) box(0.222, 0.05, 1.08, i % 2 ? 0xfbfdff : 0x5aa7d4, { x: PX - 0.888 + i * 0.222, y: 1.09 + (0.5 - Math.abs(i - 4) / 8) * 0.12, z: PZ, rz: (i - 4) * -0.03, r: 0.02 });
  ball(0.06, 0xf3cb62, { x: PX, y: 1.26, z: PZ });
  for (let i = 0; i < 13; i++) { const t = i / 12, sag = Math.sin(t * Math.PI) * 0.12; place(new THREE.ConeGeometry(0.04, 0.08, 3).rotateX(Math.PI), [0xef8fa6, 0xf4d36a, 0x5aa7d4, 0x7fc08c][i % 4], { x: PX - 0.86 + t * 1.72, y: 1.0 - sag, z: PZ + 0.4 }); }
  [[-0.62, 0.72], [0.62, 0.72], [-0.62, 1.1], [0.62, 1.1]].forEach(([dx, z]) => { box(0.4, 0.028, 0.12, wood, { x: PX + dx, y: 0.12, z: PZ + z, r: 0.01 }); [-0.15, 0.15].forEach((d) => box(0.025, 0.12, 0.1, 0x6a7a88, { x: PX + dx + d, y: 0.06, z: PZ + z, r: 0.006 })); });
  hedgeAt(PX - 1.35, PX - 0.7); hedgeAt(PX + 0.7, PX + 1.35);

  reseed(404);
  // --- The gift shop: a striped awning, gifts in its window.
  const SX = X(AT.shop), SZ = -0.25;
  {
    const M = new THREE.Matrix4().makeTranslation(SX, 0, SZ).multiply(new THREE.Matrix4().makeRotationY(-0.1));
    const w = 1.6, d = 1, f = d / 2, roof = 0xdd8fa6, walls = 0xfdf3ea;
    chimney(M, 0.46, 0.92, -0.14, 0.34);
    shell(M, { w, d, h: 0.86, rh: 0.5, wall: walls, roof, eave: 0.11 });
    door(M, 0, f, 0x4f7596, 0.42, 0.24);
    [-0.5, 0.5].forEach((x) => {
      box(0.46, 0.4, 0.02, 0xfbf8f0, { x, y: 0.36, z: f + 0.004, M, r: 0.008 });
      v.panel(0.4, 0.34, 'glass', { x, y: 0.36, z: f + 0.016, M });
      [-0.1, 0.08].forEach((dx, i) => { box(0.11, 0.11, 0.05, i ? 0x5aa7d4 : 0xef8fa6, { x: x + dx, y: 0.25, z: f + 0.04, M, r: 0.012 }); box(0.02, 0.115, 0.054, 0xf3cb62, { x: x + dx, y: 0.25, z: f + 0.04, M, r: 0.004 }); });
    });
    for (let i = 0; i < 11; i++) box(0.15, 0.03, 0.34, i % 2 ? 0xfbfdff : 0xdd8fa6, { x: -0.75 + i * 0.15, y: 0.72, z: f + 0.15, rx: 0.42, M, r: 0.01 });
    box(0.7, 0.16, 0.03, 0xfbf8f0, { y: 1.02, z: f + 0.012, M, r: 0.02 });
    box(0.14, 0.11, 0.035, 0xef8fa6, { y: 1.02, z: f + 0.03, M, r: 0.016 });
    box(0.025, 0.12, 0.04, 0xf3cb62, { y: 1.02, z: f + 0.03, M, r: 0.006 });
    [[-0.68, 0.72, 0.15, 0x5aa7d4], [-0.46, 0.74, 0.1, 0xf4d36a], [0.66, 0.74, 0.14, 0xef8fa6]].forEach(([x, z, s, c]) => { box(s, s, s, c, { x, y: s / 2, z, M, r: 0.018 }); box(s * 0.2, s + 0.004, s + 0.004, 0xfbf8f0, { x, y: s / 2, z, M, r: 0.004 }); });
  }
  box(0.5, 0.012, 1.4, 0xcfc8b6, { x: SX, y: 0.012, z: 1, r: 0.005 });
  hedgeAt(SX - 1.05, SX - 0.32); fenceAt(SX + 0.32, SX + 1.05);
  bush(SX - 0.98, 0.4, 0.9, 'deep'); bush(SX + 0.98, 0.45, 0.8, 'lime');

  reseed(505);
  // --- The hall: steps, columns, a pediment, a flag.
  const HX = X(AT.hall), HZ = -0.3;
  {
    const M = new THREE.Matrix4().makeTranslation(HX, 0, HZ);
    box(2.1, 0.08, 1.4, stoneD, { y: 0.04, M, r: 0.02 });
    box(1.98, 0.08, 1.26, stone, { y: 0.12, M, r: 0.02 });
    box(1.86, 0.08, 1.12, 0xeef1f3, { y: 0.2, M, r: 0.02 });
    box(1.5, 0.84, 0.7, 0xf6efe0, { y: 0.66, z: -0.12, M, r: 0.012 });
    [-0.74, -0.25, 0.25, 0.74].forEach((x) => { cyl(0.065, 0.078, 0.84, 0xfbfdff, { x, y: 0.66, z: 0.42, M }); box(0.18, 0.04, 0.18, 0xfbfdff, { x, y: 1.09, z: 0.42, M, r: 0.008 }); box(0.18, 0.04, 0.18, 0xfbfdff, { x, y: 0.26, z: 0.42, M, r: 0.008 }); });
    box(1.86, 0.11, 1.06, 0xfbfdff, { y: 1.16, z: 0.02, M, r: 0.018 });
    shell(M, { w: 1.82, d: 1.04, h: 0.03, rh: 0.36, wall: 0xf4f6f7, roof: 0x4f94bd, y: 1.2, z: 0.02, eave: 0.06, base: false });
    place(new THREE.TorusGeometry(0.075, 0.016, 8, 24), 0xf3cb62, { y: 1.34, z: 0.55, M });
    box(0.3, 0.52, 0.03, 0xa9774e, { y: 0.5, z: 0.235, M, r: 0.012 });
    ball(0.016, 0xf3cb62, { x: 0.09, y: 0.48, z: 0.256, M });
    [-0.45, 0.45].forEach((x) => { box(0.22, 0.36, 0.02, 0xfbf8f0, { x, y: 0.62, z: 0.232, M, r: 0.008 }); v.panel(0.17, 0.3, 'glass', { x, y: 0.62, z: 0.244, M }); });
    cyl(0.012, 0.016, 0.62, 0x8a9aa8, { y: 1.82, z: 0.02, M });
    box(0.28, 0.16, 0.012, 0xe25a4c, { x: 0.15, y: 2.02, z: 0.02, M, r: 0.004, ry: 0.1 });
  }
  box(0.9, 0.012, 1.2, 0xcfc8b6, { x: HX, y: 0.012, z: 1.05, r: 0.005 });
  fenceAt(HX - 1.15, HX - 0.5); fenceAt(HX + 0.5, HX + 1.15);
  [-1.12, 1.12].forEach((d) => bush(HX + d, 0.3, 1, 'deep'));

  reseed(606);
  // --- The friends' plots.
  const doors = [];
  const lotU = (i) => AT.houses + i * LOT;
  for (let i = 0; i < 12; i++) {
    const x = X(lotU(i));
    (i % 2 ? hedgeAt : fenceAt)(x + 0.26, x + LOT - 0.26);
    [-0.26, 0.26].forEach((d) => box(0.06, 0.24, 0.06, 0xe9e2d2, { x: x + d, y: 0.12, z: FENCE, r: 0.018 }));
    bush(x + LOT / 2, 1.2, 1.1, i % 2 ? 'deep' : 'oak');
    bush(x + LOT / 2 + between(-0.1, 0.1), -0.6, 1.4, i % 2 ? 'oak' : 'deep');
    bush(x + LOT / 2 + 0.05, 0.35, 0.8, 'lime');
    doors.push(new THREE.Vector3(x, 0, 0.56));
  }
  (() => { const x = X(lotU(11)); hedgeAt(x + LOT - 0.1, x + LOT + 5); })();
  (() => { hedgeAt(X(-6), X(0)); })();
  if (lots === 'all') for (let i = 0; i < 12; i++) { reseed(700 + i); plot(i, X(lotU(i))); }
  else if (lots !== 'none') { reseed(700 + +lots); plot(+lots, X(lotU(+lots))); }

  finish();
  const cam = new THREE.PerspectiveCamera(vfov * 180 / Math.PI, FULL_W / FULL_H, 0.5, 400);
  cam.position.copy(pos); cam.lookAt(target);
  const crop = (q.get('crop') || '').split(',').map(Number);
  if (crop.length === 4) cam.setViewOffset(FULL_W, FULL_H, crop[0], crop[1], crop[2], crop[3]);
  else cam.setViewOffset(FULL_W, FULL_H, 0, 0, FULL_W, FULL_H);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const share = (p) => { const c = new THREE.PerspectiveCamera(vfov * 180 / Math.PI, FULL_W / FULL_H, 0.5, 400); c.position.copy(pos); c.lookAt(target); c.updateProjectionMatrix(); c.updateMatrixWorld(true); const n = p.clone().project(c); return [+(0.5 + n.x / 2).toFixed(4), +(0.5 - n.y / 2).toFixed(4)]; };
  const ground = (u, z = 0) => share(new THREE.Vector3(X(u), 0, z));
  window.__rect = JSON.stringify({
    doors: doors.map(share), gates: doors.map((d) => share(new THREE.Vector3(d.x, 0, 2.05))), lamps: lampAt.map(share),
    places: { fountain: ground(AT.fountain, 2.05), garden: ground(AT.garden, 2.05), plaza: ground(AT.plaza, 2.05), shop: ground(AT.shop, 2.05), hall: ground(AT.hall, 2.05) },
    spray: [0.62, 1.12, 1.66].map((y) => share(new THREE.Vector3(FX, y, FZ))), banner: share(new THREE.Vector3(PX, 1.02, PZ + 0.45)),
  });
  return cam;
}
