// Vườn tài chính's valley, far behind the plants: blue mountains, hills, a river running down to the left under a wooden bridge, a white fence, a windmill and a
// few far houses. A real, wide camera near the ground, so the land really goes away. The sky is left out: the app draws the real one, and a rainbow in it.
// `&light=mask` its shape. `&sails=1` only the windmill's sails, flat on, to be turned by the app; without it the windmill has none.
import { kit } from './kit.js';
import { village } from './village.js';
import { lawnPaint, light as lightOf } from './grove-kit.js';

export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const night = light === 'night';
  lightOf(sky, night);
  const v = village(THREE, scene, { night, start: 53 });
  const { reseed, rnd, between, lumps, tmp, place, box, cyl, ball, blob, LEAF, roundTree, pine, bush, shell, finish } = v;
  LEAF.vivid = [0x4c9a2c, 0xc6e650]; LEAF.bright = [0x3f8f34, 0xa9dc4e]; LEAF.pink = [0xe58bb4, 0xffd9e8]; LEAF.far = [0x2f7f4e, 0x74b862]; LEAF.haze = [0x4f9f78, 0x9ed2a0];

  const MILL = { x: 2.6, z: -12.4, tower: 2.5 };
  const HUB = { x: MILL.x - 0.1, y: MILL.tower + 0.38 + 0.46, z: MILL.z + 1.12 };
  const SAIL = 1.75;
  const sails = (px, py, pz) => {
    const wood = 0xcfa574, cloth = 0xfff8ec;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.5, c = Math.cos(a), s = Math.sin(a), M = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a - Math.PI / 2)), new THREE.Vector3(1, 1, 1));
      box(0.07, SAIL, 0.05, wood, { y: SAIL / 2, M, r: 0.018 });
      for (let i = 0; i < 6; i++) box(0.5, 0.03, 0.03, wood, { x: 0.22, y: 0.42 + i * 0.25, M, r: 0.01 });
      [0, 0.44].forEach((dx) => box(0.03, SAIL - 0.4, 0.03, wood, { x: dx, y: 0.3 + (SAIL - 0.4) / 2, M, r: 0.01 }));
      box(0.42, SAIL - 0.5, 0.012, cloth, { x: 0.22, y: 0.36 + (SAIL - 0.5) / 2, z: -0.015, M, r: 0.005 });
      void c; void s;
    }
    ball(0.17, 0xcfa574, { x: px, y: py, z: pz + 0.04, sz: 0.7 });
  };
  if (q.has('sails')) {
    sails(0, 0, 0);
    finish();
    return flatCamera(SAIL * 2 + 0.24, W, H, [0, 0, 12], [0, 0, 0]);
  }

  // The camera first: everything is placed by what it sees.
  const pos = new THREE.Vector3(0, 3.2, 10), PITCH = 8 * Math.PI / 180, TAN = 0.3;
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(TAN) * 180 / Math.PI, W / H, 0.5, 600);
  cam.position.copy(pos); cam.lookAt(0, pos.y - Math.tan(PITCH) * 100, pos.z - 100); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);

  // The river comes from the far middle and runs off to the left.
  const riverX = (z) => -1.5 + 1.35 * Math.sin(z * 0.22) - 9.5 * Math.pow(Math.max(0, Math.min(1.3, (z + 16) / 14.5)), 2.2);
  const riverW = (z) => 0.42 + Math.max(0, z + 32) * 0.033;
  const bank = (x, z) => Math.abs(x - riverX(z)) - riverW(z);
  const smooth = (e0, e1, n) => { const t = Math.max(0, Math.min(1, (n - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const knoll = (x, z) => 0.62 * Math.exp(-(((x - MILL.x) / 3.4) ** 2 + ((z - MILL.z - 0.4) / 2.6) ** 2));
  const hills = (x, z) => {
    const far = Math.max(0, -z - 5);
    return far * 0.055 + smooth(0, 30, far) * (0.9 * Math.sin(x * 0.17 + 0.7) + 0.55 * Math.sin(x * 0.37 + z * 0.09 + 2) + 0.25 * Math.sin(x * 0.81 - z * 0.13));
  };
  const groundY = (x, z) => {
    let y = hills(x, z) + knoll(x, z) + 0.02 * lumps(x * 0.9, z * 0.9, 0.4);
    const d = bank(x, z);
    if (d < 0.9) y = y * smooth(0.1, 0.9, d) + (-0.2) * (1 - smooth(-0.1, 0.5, d));
    return y;
  };
  // The path from the windmill's door down to the gate in the fence.
  const GATE = { x: 4.6, z: -5.6 };
  const pathX = (z) => { const t = Math.max(0, Math.min(1, (z - (MILL.z + 1.2)) / (GATE.z - MILL.z - 1.2))); return MILL.x + (GATE.x - MILL.x) * (t * t * (3 - 2 * t)) + Math.sin(t * 3.14) * 0.3; };
  {
    const R = 360, C = 460, pts = [], idx = [];
    for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
      const z = 7 - 92 * Math.pow(r / R, 1.9), half = 3 + (10 - z) * 0.74, x = (c / C - 0.5) * 2 * half;
      pts.push(x, groundY(x, z), z);
    }
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const a = r * (C + 1) + c, d = a + 1, e = a + C + 1, f = e + 1; idx.push(a, d, e, d, f, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals();
    const paint = lawnPaint(THREE, (x, z) => Math.sin(x * 1.3 + z * 1.7) * 0.14 + Math.sin(x * 2.9 - z * 2.3 + 1) * 0.2 + Math.sin(x * 0.6 + z * 0.4 + 2) * 0.22);
    const Far = new THREE.Color(0x86cf84), Sand = new THREE.Color(0xe8d6a4), Mud = new THREE.Color(0xc2b98a), Field = new THREE.Color(0xc7dc62);
    place(g, (c, x, y, z) => {
      paint(c, x, z);
      // Fields far off, as patches of another green.
      const f = Math.sin(x * 0.52 + 1.1) * Math.sin(z * 0.34 + x * 0.1);
      if (z < -12 && f > 0.55) c.lerp(Field, smooth(0.55, 0.7, f) * 0.55);
      c.lerp(Far, smooth(-9, -52, z) * 0.82);
      const d = bank(x, z);
      if (d < 0.48) c.lerp(Sand, 1 - smooth(0.12, 0.48, d));
      if (d < 0.08) c.lerp(Mud, 0.7);
      if (z > MILL.z + 0.9 && z < GATE.z + 0.2) { const e = Math.abs(x - pathX(z)) - 0.16; if (e < 0.08) c.lerp(Sand, (1 - smooth(-0.04, 0.08, e)) * 0.9); }
    });
  }
  // The mountains, layers of them, paler with distance. Each climbs from the land to a soft ridge.
  const ridge = (z, y0, amp, near, far, f, ph) => {
    const g = new THREE.PlaneGeometry(420, 90, 900, 18), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), k = (a.getY(i) + 45) / 90, top = y0 + amp * (Math.sin(x * f + ph) * 0.58 + Math.sin(x * f * 2.3 + ph * 2) * 0.28 + Math.sin(x * f * 5.1 + ph) * 0.1);
      a.setY(i, top - (1 - k) * 90);
      a.setZ(i, (1 - k) * 34 + 0.5 * Math.sin(x * f * 3 + k * 9) * k);
    }
    g.computeVertexNormals();
    const N = new THREE.Color(near), F = new THREE.Color(far);
    place(g, (c, x, y) => c.copy(N).lerp(F, smooth(top0(y0, amp), y0 + amp * 0.5, y) * 0.95 + lumps(x * 0.2, y * 0.2, 1) * 0.08), { z });
  };
  const top0 = (y0, amp) => y0 - amp * 2.2;
  ridge(-130, 18, 5, 0xc6e7f4, 0x9bd0ee, 0.033, 1.1);
  ridge(-104, 12.2, 3.6, 0xa4d9e2, 0x6dbbd9, 0.05, 3.4);
  ridge(-82, 8.2, 2.2, 0x98d6b4, 0x5cb596, 0.07, 0.2);

  // The water, and what lies in it.
  {
    const R = 190, pts = [], idx = [];
    for (let r = 0; r <= R; r++) {
      const z = 6 - 44 * Math.pow(r / R, 1.2), x = riverX(z), w = riverW(z) + 0.12;
      pts.push(x - w, -0.075, z, x + w, -0.075, z);
    }
    for (let r = 0; r < R; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: night ? 0x31508a : 0x4fc3ee, roughness: 0.14, metalness: 0.08, side: THREE.DoubleSide }));
    scene.add(m);
    reseed(11);
    for (let i = 0; i < 90; i++) {
      const z = between(-30, -2.4), side = rnd() < 0.5 ? -1 : 1, x = riverX(z) + side * (riverW(z) + between(0.02, 0.18)), s = between(0.05, 0.2) * (1 + Math.max(0, z + 30) * 0.02);
      place(new THREE.IcosahedronGeometry(1, 2), (c) => c.set(0xd6d3c8).multiplyScalar(between(0.82, 1.05)), { x, y: -0.02, z, sx: s, sy: s * 0.6, sz: s * 0.8, ry: rnd() * 3 });
    }
    // A big grey boulder or two on the near bank, and lily pads in a still bend.
    [[-5.3, -3.4, 0.5], [-4.6, -3.1, 0.28], [-5.8, -2.9, 0.22]].forEach(([x, z, s]) => place(new THREE.IcosahedronGeometry(1, 3), (c, X, Y) => c.set(0xa8a69c).lerp(tmp.set(0xdedcd2), Math.min(1, 0.4 + (Y + 0.1) * 1.1)).multiplyScalar(1 + lumps(X * 7, Y * 7, 2) * 0.08), { x, y: s * 0.32 + groundY(x, z), z, sx: s * 1.25, sy: s * 0.82, sz: s, ry: x }));
    [[-3.1, -7.2, 0.14], [-2.6, -7.6, 0.1], [-3.0, -8.2, 0.12]].forEach(([x, z, r]) => { const X = riverX(z) + (x + 2.9) * 1.1; const pad = new THREE.CircleGeometry(r, 18); pad.rotateX(-Math.PI / 2); place(pad, 0x4f9f58, { x: X, y: -0.06, z }); });
  }
  // The wooden bridge: a shallow arch of planks with rails.
  {
    const z = -10.4, cx = riverX(z), half = riverW(z) + 0.62, n = 15, wood = (c) => c.set(0xc99a60).multiplyScalar(between(0.88, 1.08)), archY = (t) => 0.18 + 0.36 * (1 - t * t);
    reseed(83);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 - 1, x = cx + t * half;
      box(half * 2 / n * 0.92, 0.05, 0.86, wood, { x, y: archY(t), z, rz: -t * 0.3, r: 0.012 });
    }
    [-0.4, 0.4].forEach((dz) => {
      for (let i = 0; i <= 6; i++) { const t = (i / 6) * 2 - 1, x = cx + t * half; box(0.06, 0.34, 0.06, 0xb28650, { x, y: archY(t) + 0.15, z: z + dz, r: 0.014 }); }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * 2 - 1, b = ((i + 1) / 6) * 2 - 1, xa = cx + a * half, xb = cx + b * half, ya = archY(a) + 0.3, yb = archY(b) + 0.3; box(Math.hypot(xb - xa, yb - ya) + 0.04, 0.045, 0.05, 0xd8ad72, { x: (xa + xb) / 2, y: (ya + yb) / 2, z: z + dz, rz: Math.atan2(yb - ya, xb - xa), r: 0.012 }); }
      [[-0.92, 0], [0.92, 0]].forEach(([t]) => box(0.09, 0.42, 0.09, 0xa97e4a, { x: cx + t * half, y: 0.09, z: z + dz, r: 0.016 }));
    });
  }
  // The windmill on its knoll: a round plastered tower, a pink cap, a cottage against its side, and the door the path comes from.
  {
    const { x, z, tower } = MILL, y0 = groundY(x, z) - 0.04;
    const wall = (c, X, Y, Z) => { c.set(0xfbf3e0).lerp(tmp.set(0xd9c8a8), Math.max(0, 0.34 - (Y - y0) * 0.8)); const row = Math.sin((Y - y0) * 40), col = Math.sin(Math.atan2(Z - z, X - x) * 26 + Math.floor((Y - y0) * 6.4) * 2); if (Y - y0 < 0.42 && row > 0.72 + col * 0.05) c.multiplyScalar(0.9); };
    cyl(0.72, 0.98, tower, wall, { x, y: y0 + tower / 2, z, seg: 40 });
    cyl(0.78, 0.8, 0.09, 0xefe2c8, { x, y: y0 + tower + 0.02, z, seg: 40 });
    place(new THREE.ConeGeometry(0.98, 1.08, 40, 8), (c, X, Y) => { const row = Math.sin((Y - y0) * 62); c.set(0xee7fa6).lerp(tmp.set(0xf9b0c8), 0.4 + row * 0.26).multiplyScalar(0.94 + lumps(X * 9, Y * 9, 1) * 0.08); }, { x, y: y0 + tower + 0.56, z });
    ball(0.09, 0xf6cc4e, { x, y: y0 + tower + 1.14, z });
    // A little axle, the door, two windows.
    cyl(0.1, 0.13, 0.5, 0x9a7446, { x: HUB.x, y: HUB.y, z: HUB.z - 0.25, rx: Math.PI / 2 });
    box(0.52, 0.86, 0.06, 0x9a6a3c, { x: x + 0.02, y: y0 + 0.43, z: z + 0.96, r: 0.04 });
    box(0.6, 0.94, 0.04, 0xefe2c8, { x: x + 0.02, y: y0 + 0.45, z: z + 0.94, r: 0.03 });
    ball(0.035, 0xf6cc4e, { x: x + 0.19, y: y0 + 0.42, z: z + 1.0 });
    [[0.0, 1.58], [-0.34, 2.28]].forEach(([dx, h]) => { box(0.36, 0.42, 0.05, 0xfff8ea, { x: x + dx, y: y0 + h, z: z + 0.84, r: 0.02 }); box(0.28, 0.34, 0.05, 0x6fb6d6, { x: x + dx, y: y0 + h, z: z + 0.86, r: 0.01 }); });
    shell(new THREE.Matrix4().makeTranslation(x + 1.5, y0, z + 0.25), { w: 1.5, d: 1.2, h: 0.82, rh: 0.5, wall: 0xfbf3e0, roof: 0xee8aaf, base: true });
    box(0.28, 0.5, 0.04, 0x9a6a3c, { x: x + 1.5, y: y0 + 0.25, z: z + 0.87, r: 0.02 });
    [-0.46, 0.46].forEach((dx) => { box(0.26, 0.28, 0.04, 0xfff8ea, { x: x + 1.5 + dx, y: y0 + 0.48, z: z + 0.87, r: 0.012 }); box(0.2, 0.22, 0.04, 0x6fb6d6, { x: x + 1.5 + dx, y: y0 + 0.48, z: z + 0.89, r: 0.008 }); });
    reseed(47);
    bush(x - 1.15, z + 0.75, 1.6, 'bright', y0); bush(x + 2.55, z + 0.7, 1.5, 'vivid', y0 - 0.1);
    for (let i = 0; i < 40; i++) { const a = between(-1.2, 1.2), d = between(1.15, 1.7), X = x + Math.sin(a) * d, Z = z + Math.cos(a) * d; if (Math.abs(X - pathX(Z)) > 0.3) ball(0.05, [0xffc0d6, 0xfffdf2, 0xffe36a][i % 3], { x: X, y: groundY(X, Z) + 0.06, z: Z }); }
  }
  // The white fence: along the far side of the lawn on the right, open at the path's gate, and on across the left beyond the river.
  {
    const run = (x0, z0, x1, z1, gap) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.round(L / 0.3), yaw = Math.atan2(z0 - z1, x1 - x0);
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = groundY(x, z);
        if (gap && Math.abs(x - gap) < 0.5) continue;
        box(0.13, 0.56, 0.04, 0xfdfbf4, { x, y: y + 0.28, z, ry: yaw, r: 0.014 });
        place(new THREE.ConeGeometry(0.09, 0.13, 4), 0xfdfbf4, { x, y: y + 0.62, z, ry: yaw + Math.PI / 4, sz: 0.4 });
        if (i < n && !(gap && Math.abs(x + (x1 - x0) / n - gap) < 0.5)) [0.2, 0.44].forEach((h) => { const nx = x0 + (x1 - x0) * ((i + 1) / n), nz = z0 + (z1 - z0) * ((i + 1) / n), ny = groundY(nx, nz); box(Math.hypot(nx - x, nz - z) + 0.03, 0.05, 0.03, 0xf4f0e2, { x: (x + nx) / 2, y: (y + ny) / 2 + h, z: (z + nz) / 2 - 0.03, ry: yaw, r: 0.01 }); });
      }
    };
    run(-0.2, -5.3, 14, -6.5, GATE.x);
    run(-13, -7.4, -4.4, -8.6, null);
    run(-0.2, -5.3, -1.0, -7.6, null);
    [GATE.x - 0.5, GATE.x + 0.5].forEach((x) => { const z = GATE.z, y = groundY(x, z); box(0.2, 0.86, 0.2, 0xfffdf6, { x, y: y + 0.43, z, r: 0.04 }); ball(0.11, 0xfffdf6, { x, y: y + 0.9, z }); });
    reseed(29);
    for (let i = 0; i < 9; i++) { const x = between(0, 12), z = -5.05 - (x + 0.2) * 0.085; if (Math.abs(x - GATE.x) > 0.8) bush(x, z, between(0.9, 1.3), i % 2 ? 'vivid' : 'bright', groundY(x, z)); }
  }
  // Far houses, like the town's, with pink and red roofs.
  [[-7.4, -27, 0xe86a5e, 0], [-4.6, -31, 0xee8aaf, 0.3], [-9.9, -33, 0xe9a45e, -0.2], [9.4, -29, 0xe86a5e, -0.3], [12.4, -33, 0xee8aaf, 0.2], [7.1, -34, 0xe9a45e, 0.1]].forEach(([x, z, roof, yaw]) => {
    const M = new THREE.Matrix4().makeTranslation(x, groundY(x, z) - 0.05, z).multiply(new THREE.Matrix4().makeRotationY(yaw));
    shell(M, { w: 2.2, d: 1.8, h: 1.2, rh: 0.86, wall: 0xfdf6e6, roof, base: false });
  });
  // Trees: the woods far off, round ones in the middle distance, some left and right to frame it. None on the river, the path or the mill.
  const clear = (x, z, room = 0.9) => bank(x, z) > room && Math.hypot(x - MILL.x, (z - MILL.z) * 1.1) > 3.3 && !(z > MILL.z && z < GATE.z && Math.abs(x - pathX(z)) < 0.7) && Math.abs(x - 2.2) + Math.abs(z + 16) > 2;
  reseed(37);
  for (let i = 0; i < 300; i++) {
    const z = between(-74, -22), x = between(-52, 52);
    if (!clear(x, z, 1.4)) continue;
    const s = between(1.1, 1.9), y = groundY(x, z);
    if (rnd() < 0.44) pine(x, z, s * 1.25, y); else roundTree(x, z, s, z < -38 ? 'haze' : 'far', y);
  }
  [[-12.5, -11.5, 2.0, 'vivid'], [-9.2, -17, 1.9, 'bright'], [-13.4, -19, 2.2, 'vivid'], [-3.6, -20, 1.5, 'bright'], [-6.4, -24, 1.5, 'far'], [6.2, -19, 1.6, 'vivid'], [8.6, -16.5, 1.8, 'bright'], [11.8, -14.5, 2.0, 'vivid'], [15.5, -16, 2.2, 'bright'], [4.0, -23, 1.5, 'far'], [0.1, -26, 1.5, 'far'], [14.4, -10.6, 1.9, 'pink'], [9.4, -11.6, 1.35, 'pink'], [-2.6, -25, 1.25, 'pink']].forEach(([x, z, s, k]) => roundTree(x, z, s, k, groundY(x, z)));
  [[7.0, -14.6, 1.5], [10.8, -18, 1.7], [-10.6, -14.4, 1.6], [-6.2, -18.5, 1.3]].forEach(([x, z, s]) => pine(x, z, s, groundY(x, z)));
  // Grass and small flowers in front; rocks here and there.
  reseed(31);
  const dot = new THREE.SphereGeometry(0.035, 8, 6), tuft = new THREE.ConeGeometry(0.035, 0.15, 5);
  for (let i = 0; i < 9000; i++) {
    const z = 6 - 22 * Math.pow(rnd(), 1.5), span = 3 + (10 - z) * 0.74, x = between(-span, span);
    if (bank(x, z) < 0.26) continue;
    const y = groundY(x, z);
    if (rnd() < 0.12) place(dot, [0xfffdf2, 0xffc6dc, 0xffe36a, 0xffffff][Math.floor(rnd() * 4)], { x, y: y + 0.07, z });
    else place(tuft, (c) => c.set(0x4f9f2c).lerp(tmp.set(0xb6e35a), rnd()), { x, y: y + 0.07, z, rz: between(-0.3, 0.3), rx: between(-0.2, 0.2) });
  }
  finish();
  const shot = (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(cam); return [+((p.x + 1) / 2).toFixed(4), +((1 - p.y) / 2).toFixed(4)]; };
  window.__rect = JSON.stringify({
    hub: shot(HUB.x, HUB.y, HUB.z), hubEdge: shot(HUB.x + SAIL + 0.12, HUB.y, HUB.z),
    horizon: shot(0, pos.y, -500), river: [-26, -21, -17, -14, -11.5, -9, -7.5, -6.3, -5.2, -4.3, -3.6].map((z) => [...shot(riverX(z), -0.07, z), +riverW(z).toFixed(2), shot(riverX(z) + riverW(z), -0.07, z)[0]]),
    tris: scene.children.reduce((n, m) => n + (m.geometry ? m.geometry.attributes.position.count / 3 : 0), 0),
  });
  return cam;
}
