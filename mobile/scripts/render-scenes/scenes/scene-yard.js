// The home garden, looked down on from the path: a real camera, a real sun. Far blue mountains, a white picket fence with a gate, a stone-edged pond on
// the left and a paved path running from the gate to the right. The plots are not in it: the app stands them on it wherever the screen has room. The
// sky is left out. What sways in the wind can be left out (&still) or built alone for its mask (&only=name), so the app can move it over the land.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const only = q.get('only'), still = q.has('still');
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0xa6d8fa, mid: 0xeaf6fc, low: 0xa8c47a, power: 0.86, sun: { dir: [-0.62, 0.66, 0.62], size: 9, power: 40, color: 0xfff2dc } });
  const v = village(THREE, scene, { night, start: 53, fence: -6 });
  const { reseed, rnd, between, lumps, tmp, place, box, cyl, ball, blob, LEAF, roundTree, pine, bush, finish } = v;
  LEAF.vivid = [0x4c9a2c, 0xc6e650]; LEAF.bright = [0x3f8f34, 0xa9dc4e]; LEAF.pink = [0xe58bb4, 0xffd9e8]; LEAF.far = [0x2f7f4e, 0x74b862];

  const pitch = 24 * Math.PI / 180, dist = 22;
  const target = new THREE.Vector3(0, 0, 0);
  const pos = new THREE.Vector3(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  const halfTan = 0.139 * H / W;
  const below = (row) => pitch - Math.atan((0.5 - row) * 2 * halfTan);
  const zAt = (row) => pos.z - pos.y / Math.tan(below(row));
  const yAt = (row, z) => pos.y - (pos.z - z) * Math.tan(below(row));
  const R = (px) => (px + 70) / 1500; // rows given in points of a picture 1000 wide, under the room left for the mountains

  const ZF = zAt(R(232)), RIM = ZF - 3.2;
  const RISE = Math.max(0.2, yAt(R(186), RIM));
  // The lawn climbs from the fence to a crest and falls away behind it, so the mountains show over it.
  const rise = (x, z) => { if (z < RIM) return RISE - (RIM - z) * 0.9; const t = Math.max(0, Math.min(1, (ZF - 0.2 - z) / (ZF - 0.2 - RIM))); return t * t * (RISE * 0.94 + 0.06 * RISE * Math.sin(x * 0.6 + 0.9)); };
  const PZ0 = zAt(R(254)), PZ1 = zAt(R(312)), PX = -2.72, PRX = 1.45;
  const PZ = (PZ0 + PZ1) / 2, PRZ = (PZ1 - PZ0) / 2;
  const pondAt = (x, z) => Math.hypot((x - PX) / PRX, (z - PZ) / PRZ);
  const GATE = 0.34;
  // The path, from the gate to the right edge.
  const pathEnd = zAt(R(360));
  const pathX = (z) => { const t = Math.max(0, Math.min(1, (z - ZF) / (pathEnd - ZF))); return GATE + 5.1 * Math.pow(t, 1.45); };

  const floorGeo = () => {
    const g = new THREE.PlaneGeometry(40, 60, 640, 760);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, -14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = pondAt(x, z);
      const hollow = d < 1.08 ? -0.1 * Math.min(1, (1.08 - d) * 7) : 0;
      p.setY(i, rise(x, z) + hollow + 0.01 * Math.sin(x * 1.7 + z * 1.3));
    }
    g.computeVertexNormals();
    return g;
  };
  if (only) {
    const floor = new THREE.Mesh(floorGeo(), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    floor.userData.noMask = true; scene.add(floor);
  } else {
    const A = new THREE.Color(0x70b842), B = new THREE.Color(0x86c84c), C = new THREE.Color(0x9cd45c), Far = new THREE.Color(0x8ccb66), Sand = new THREE.Color(0xe2cf9d), Bank = new THREE.Color(0xc9c08c);
    place(floorGeo(), (c, x, y, z) => {
      const n = lumps(x * 0.7, z * 0.7, x * 0.3) * 0.42 + lumps(x * 2.1, z * 1.9, 1) * 0.22;
      c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.55 + n)));
      if (n > 0.35) c.lerp(C, Math.min(1, (n - 0.35) * 1.6));
      c.lerp(Far, Math.max(0, Math.min(0.7, (ZF - z) / 5)));
      if (z > ZF - 0.1 && z < pathEnd + 1) { const e = Math.abs(x - pathX(z)) - 0.22 - (z - ZF) * 0.012 + lumps(x * 5, z * 5, 2) * 0.03; if (e < 0.1) c.lerp(Sand, Math.min(1, (0.1 - e) * 8) * 0.8); }
      const d = pondAt(x, z);
      if (d < 1.16) c.lerp(Bank, Math.min(1, (1.16 - d) * 8) * 0.8);
    });
  }
  const ridge = (z, y0, amp, tint, f, ph) => {
    const g = new THREE.PlaneGeometry(240, 80, 600, 1), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) if (a.getY(i) > 0) { const x = a.getX(i); a.setY(i, y0 + amp * (Math.sin(x * f + ph) * 0.6 + Math.sin(x * f * 2.3 + ph * 2) * 0.28 + Math.sin(x * f * 5.1 + ph) * 0.1)); } else a.setY(i, y0 - 80);
    g.computeVertexNormals();
    place(g, tint, { z });
  };
  if (!only) {
    ridge(RIM - 70, yAt(R(26), RIM - 70), 2.9, 0x8cc8ec, 0.15, 1.1);
    ridge(RIM - 42, yAt(R(62), RIM - 42), 2.6, 0x62b4d0, 0.21, 3.4);
    ridge(RIM - 22, yAt(R(128), RIM - 22), 1.1, 0x5fb886, 0.27, 0.2);
    // The water, ringed with stones.
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: night ? 0x31508a : 0x53c4f0, roughness: 0.1, metalness: 0.05 }));
    water.rotation.x = -Math.PI / 2; water.scale.set(PRX * 0.97, PRZ * 0.97, 1); water.position.set(PX, -0.03, PZ); scene.add(water);
    reseed(11);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + between(-0.03, 0.03), s = between(0.1, 0.17);
      place(new THREE.IcosahedronGeometry(1, 2), (c) => c.set(0xdedbd0).multiplyScalar(between(0.9, 1.06)), { x: PX + Math.cos(a) * PRX * 1.03, y: 0.03, z: PZ + Math.sin(a) * PRZ * 1.06, sx: s, sy: s * 0.62, sz: s * 0.85, ry: a });
    }
    [[-0.5, -0.1, 0.16], [0.1, 0.3, 0.14], [0.45, -0.25, 0.12], [-0.15, -0.45, 0.11]].forEach(([u, w, r], i) => {
      const x = PX + u * PRX, z = PZ + w * PRZ;
      place(new THREE.CylinderGeometry(r, r, 0.012, 20), 0x4f9f58, { x, y: -0.015, z, sz: 0.9 });
      if (i < 2) { for (let k = 0; k < 6; k++) ball(0.045, 0xfbd3e2, { x: x + Math.cos(k) * 0.05, y: 0.03, z: z + Math.sin(k) * 0.05, sy: 0.6 }); ball(0.026, 0xf4d36a, { x, y: 0.05, z }); }
    });
    // The fence: pointed white pickets on two rails, open at the gate.
    reseed(23);
    const picket = new THREE.ConeGeometry(0.062, 0.1, 4);
    const fence = (x0, x1) => {
      const n = Math.round((x1 - x0) / 0.165);
      for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; box(0.088, 0.34, 0.03, 0xfbfaf4, { x, y: 0.17, z: ZF, r: 0.012 }); place(picket, 0xfbfaf4, { x, y: 0.385, z: ZF, ry: Math.PI / 4, sz: 0.35 }); }
      [0.11, 0.27].forEach((y) => box(x1 - x0 + 0.1, 0.045, 0.024, 0xf1eee2, { x: (x0 + x1) / 2, y, z: ZF - 0.03, r: 0.01 }));
    };
    fence(-8, GATE - 0.42); fence(GATE + 0.42, 8);
    [GATE - 0.42, GATE + 0.42].forEach((x) => { box(0.15, 0.56, 0.15, 0xfffdf6, { x, y: 0.28, z: ZF, r: 0.03 }); ball(0.082, 0xfffdf6, { x, y: 0.58, z: ZF }); });
    // Beyond it: a lawn, then the wood. Pines far off, round trees nearer.
    reseed(37);
    for (let x = -8; x < 8; x += 0.74) { const z = RIM + between(-0.2, 0.3), s = between(0.34, 0.56); if (rnd() < 0.5) pine(x, z, s, rise(x, z)); else roundTree(x, z, s * 0.82, 'far', rise(x, z)); }
    [[-1.95, ZF - 1.3, 0.72, 'bright'], [0.98, ZF - 1.0, 0.62, 'vivid'], [2.95, ZF - 1.5, 0.66, 'bright'], [-0.5, ZF - 1.9, 0.6, 'far']].forEach(([x, z, s, k]) => roundTree(x, z, s, k, rise(x, z)));
    [[-4.3, 1.1], [-2.9, 0.9], [-1.5, 1.1], [1.7, 1.0], [3.0, 0.8]].forEach(([x, s], i) => bush(x, ZF - 0.28, s, i % 2 ? 'vivid' : 'bright'));
    // The paved path.
    reseed(41);
    for (let z = ZF + 0.35; z < pathEnd + 0.5; z += 0.46) {
      const x = pathX(z), wide = 0.3 + (z - ZF) * 0.012, ang = Math.atan2(pathX(z + 0.1) - x, 0.1);
      [-0.5, 0.5].forEach((side) => box(wide * 0.92, 0.04, 0.34, (c) => c.set(0xefe3c4).multiplyScalar(between(0.93, 1.03)), { x: x + side * wide * Math.cos(ang), y: 0.02, z: z - side * wide * Math.sin(ang) * 0.9 + between(-0.03, 0.03), ry: ang + between(-0.12, 0.12), r: 0.018 }));
    }
    // Rocks by the fence's right end and in the grass.
    [[2.2, ZF + 0.42, 0.2], [2.5, ZF + 0.55, 0.15], [2.75, ZF + 0.4, 0.24], [3.05, ZF + 0.52, 0.13], [-4.1, zAt(R(840)), 0.11], [-3.9, zAt(R(858)), 0.08]].forEach(([x, z, s]) => place(new THREE.IcosahedronGeometry(1, 2), (c) => c.set(0xd9d6cb).multiplyScalar(between(0.88, 1.05)), { x, y: s * 0.35, z, sx: s, sy: s * 0.72, sz: s * 0.85 }));
    // Grass tufts and scattered little flowers, more of them towards the sides.
    reseed(31);
    const dot = new THREE.SphereGeometry(0.022, 8, 6), tuft = new THREE.ConeGeometry(0.02, 0.09, 5);
    for (let i = 0; i < 1500; i++) {
      const x = between(-9, 9), z = between(ZF + 0.1, 12);
      if (Math.abs(x - pathX(z)) < 0.55 && z < pathEnd + 0.5) continue;
      if (pondAt(x, z) < 1.22) continue;
      const side = Math.min(1, Math.abs(x) / 3.1);
      if (rnd() < 0.2 * side * side) { const k = Math.floor(rnd() * 4); place(dot, [0xfffdf2, 0xffc6dc, 0xffe36a, 0xffffff][k], { x, y: 0.05, z }); }
      else place(tuft, (c) => c.set(0x4f9f2c).lerp(tmp.set(0xb6e35a), rnd()), { x, y: 0.05, z, rz: between(-0.3, 0.3), rx: between(-0.2, 0.2) });
    }
  }
  // What sways. A flower: a stem, petals round a yellow heart.
  const petal = new THREE.SphereGeometry(1, 8, 6);
  const flower = (x, z, h, r, color) => {
    cyl(0.012, 0.016, h, 0x4f9a35, { x, y: h / 2, z, seg: 6 });
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; place(petal, color, { x: x + Math.cos(a) * r * 0.62, y: h + Math.sin(a) * r * 0.42, z: z + 0.012, sx: r * 0.42, sy: r * 0.32, sz: r * 0.12, rz: a }); }
    place(petal, 0xf6c438, { x, y: h, z: z + 0.03, sx: r * 0.34, sy: r * 0.3, sz: r * 0.2 });
  };
  const clump = (cx, zRow, wide, deep, n, start) => {
    reseed(start);
    const z0 = zAt(R(zRow));
    blob(0.26, cx, 0.06, z0, 0x3f8f2c, 0x9fdc4a, { flat: 0.42 });
    blob(0.2, cx - wide * 0.36, 0.05, z0 + 0.06, 0x3f8f2c, 0x9fdc4a, { flat: 0.42 });
    blob(0.2, cx + wide * 0.36, 0.05, z0 - 0.04, 0x3f8f2c, 0x9fdc4a, { flat: 0.42 });
    for (let i = 0; i < n; i++) flower(cx + between(-wide, wide) * 0.5, z0 + between(-deep, deep), between(0.16, 0.42), between(0.09, 0.15), rnd() < 0.72 ? 0xfffdf4 : 0xffc7dd);
    for (let i = 0; i < 26; i++) place(new THREE.ConeGeometry(0.026, between(0.2, 0.4), 5), (c) => c.set(0x4c9c2c).lerp(tmp.set(0xb0e052), rnd()), { x: cx + between(-wide, wide) * 0.55, y: 0.1, z: z0 + between(-deep, deep), rz: between(-0.4, 0.4) });
  };
  const parts = {
    treeL: () => { reseed(61); roundTree(-3.42, ZF + 0.42, 1.2, 'vivid'); },
    treeR: () => { reseed(67); roundTree(3.4, ZF + 0.3, 1.22, 'vivid'); },
    blossom: () => { reseed(71); roundTree(1.98, ZF + 0.22, 0.98, 'pink'); },
    flowersL: () => clump(-2.3, 860, 1.05, 0.42, 22, 73),
    flowersR: () => clump(2.3, 845, 1.05, 0.42, 22, 79),
  };
  if (only) parts[only]();
  else if (!still) Object.values(parts).forEach((make) => make());
  finish();
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(halfTan) * 180 / Math.PI, W / H, 0.5, 400);
  cam.position.copy(pos); cam.lookAt(target); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  return cam;
}
