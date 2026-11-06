// Học tập: the school seen across its yard, through a long lens, with the hills behind it. The sky is left out: the app draws the real one.
import { kit } from './kit.js';
import { village } from './village.js';

const FULL_W = 1170, FULL_H = 540, SPAN = 9.2;
export async function build({ THREE, scene, light }) {
  const { sky } = kit(THREE, scene);
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night, start: 53 });
  const { reseed, rnd, between, lumps, tmp, place, box, cyl, ball, roundTree, pine, bush, shell, window_, tones, finish } = v;

  const dist = 30, pitch = 12 * Math.PI / 180;
  const target = new THREE.Vector3(0, 1.02, -0.5);
  const pos = new THREE.Vector3(0, target.y + Math.tan(pitch) * dist, dist - 0.5);
  const vfov = 2 * Math.atan((SPAN / 2) * (FULL_H / FULL_W) / pos.distanceTo(target));
  const rowAt = (row, z) => pos.y + Math.tan(-pitch + (0.5 - row) * vfov) * (pos.z - z);

  const RIM = -8, RISE = Math.max(0.3, rowAt(0.24, RIM));
  const rise = (x, z) => {
    const t = Math.max(0, Math.min(1, (-z - 1.9) / (-RIM - 1.9)));
    return t * t * (RISE * 0.86 + 0.13 * RISE * Math.sin(x * 0.7 + 0.9) + 0.06 * RISE * Math.sin(x * 1.7 + 2.4));
  };
  {
    const g = new THREE.PlaneGeometry(24, 14.6, 500, 150);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.9);
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
    const g = new THREE.PlaneGeometry(60, 40, 200, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i); p.setY(i, y0 + amp * (Math.sin(x * f + ph) * 0.6 + Math.sin(x * f * 2.3 + ph * 2) * 0.28 + Math.sin(x * f * 5.1 + ph) * 0.1)); } else p.setY(i, y0 - 40);
    g.computeVertexNormals();
    place(g, tint, { z });
  };
  ridge(-16, rowAt(0.19, -16), 0.3, night ? 0x7f9cb4 : 0xa9cfae, 0.42, 1);
  ridge(-26, rowAt(0.14, -26), 0.42, night ? 0x8fa8c8 : 0xc4e0d2, 0.26, 2.6);

  // --- The paved yard and the way up to the door.
  const stone = 0xdcd6c8, stoneD = 0xbfb8a8;
  box(3.5, 0.02, 1.25, 0xcfc8b6, { y: 0.011, z: 1.3, r: 0.006 });
  for (let x = -1.72; x < 1.75; x += 0.3) for (let row = 0; row < 4; row++) box(0.28, 0.02, 0.28, stone - Math.floor(rnd() * 4) * 0x040404, { x: x + (row % 2 ? 0.15 : 0), y: 0.022, z: 0.82 + row * 0.31, r: 0.01 });
  // The pavement along the front, as on the friends' street.
  for (let x = -6; x < 6; x += 0.31) for (let row = 0; row < 2; row++) box(0.29, 0.03, 0.22, 0xd8d2c4 + Math.floor(rnd() * 3) * 0x050505, { x: x + (row % 2 ? 0.155 : 0), y: 0.015, z: 2.42 + row * 0.24, r: 0.012 });
  box(14, 0.02, 0.7, 0xa8b2bd, { y: 0.008, z: 3.1 });

  // --- The school: a long body, a middle block standing forward, a clock and a flag.
  const wall = 0xf8f1e0, trim = 0xfbf8f0, roof = 0x4f94bd;
  const M = new THREE.Matrix4().makeTranslation(0.1, 0, -0.4).multiply(new THREE.Matrix4().makeRotationY(-0.2));
  shell(M, { w: 3.9, d: 1.1, h: 1.12, rh: 0.34, wall, roof, side: true, eave: 0.12 });
  shell(M, { w: 1.24, d: 1.1, h: 1.42, rh: 0.42, wall: 0xfbf4e2, roof: 0x3f83ac, z: 0.42, eave: 0.1 });
  // Windows on two floors, along the body; lit at night through the village's panes.
  for (const side of [-1, 1]) for (let i = 0; i < 2; i++) for (const y of [0.45, 0.9]) window_(M, side * (0.98 + i * 0.5), y, 0.55, 0.28, 0.27, trim, null, y < 0.5);
  // The middle block: its door, windows over it, a round clock in the gable.
  box(0.62, 0.72, 0.03, trim, { y: 0.44, z: 0.985, M, r: 0.012 });
  box(0.24, 0.62, 0.035, 0x5d8fb5, { x: -0.135, y: 0.39, z: 1, M, r: 0.012 });
  box(0.24, 0.62, 0.035, 0x5d8fb5, { x: 0.135, y: 0.39, z: 1, M, r: 0.012 });
  [-0.04, 0.04].forEach((x) => ball(0.016, 0xf3cb62, { x, y: 0.4, z: 1.024, M }));
  window_(M, -0.3, 1.1, 0.975, 0.24, 0.3, trim, null, false);
  window_(M, 0.3, 1.1, 0.975, 0.24, 0.3, trim, null, false);
  cyl(0.125, 0.125, 0.03, 0xfbfdff, { y: 1.57, z: 0.985, rx: Math.PI / 2, M, seg: 28 });
  place(new THREE.TorusGeometry(0.125, 0.018, 8, 28), 0x3f83ac, { y: 1.57, z: 1, M });
  box(0.012, 0.09, 0.008, 0x2b3a55, { y: 1.61, z: 1.008, M, r: 0.003 });
  box(0.065, 0.012, 0.008, 0x2b3a55, { x: 0.03, y: 1.57, z: 1.008, M, r: 0.003 });
  // Steps up to the door.
  box(0.9, 0.05, 0.3, stone, { y: 0.025, z: 1.13, M, r: 0.012 });
  box(0.76, 0.05, 0.2, 0xe8e3d6, { y: 0.075, z: 1.08, M, r: 0.012 });
  // The flag, in the yard.
  cyl(0.014, 0.02, 1.7, 0xdfe5ea, { x: -1.62, y: 0.85, z: 0.98 });
  ball(0.032, 0xf3cb62, { x: -1.62, y: 1.72, z: 0.98 });
  box(0.4, 0.24, 0.014, 0xe25a4c, { x: -1.4, y: 1.54, z: 0.98, r: 0.005, ry: 0.08 });
  cyl(0.13, 0.15, 0.06, stoneD, { x: -1.62, y: 0.03, z: 0.98 });
  // A notice board, benches, a stack of big books on a low bed, a bicycle rack's hoops.
  box(0.62, 0.42, 0.03, 0x8e6a4c, { x: 1.62, y: 0.54, z: 1.0, r: 0.012 });
  box(0.54, 0.34, 0.012, 0xeef4f7, { x: 1.62, y: 0.54, z: 1.02, r: 0.005 });
  [[-0.14, 0.03, 0xf0b63c], [0.13, 0.05, 0xe78aa3], [0, -0.09, 0x6fb2d8]].forEach(([x, y, c]) => box(0.14, 0.12, 0.006, c, { x: 1.62 + x, y: 0.54 + y, z: 1.03, r: 0.002 }));
  [1.42, 1.82].forEach((x) => cyl(0.016, 0.02, 0.36, 0x7a5a42, { x, y: 0.18, z: 1 }));
  const bench = (x, z) => { box(0.54, 0.035, 0.15, 0xb98a60, { x, y: 0.15, z, r: 0.012 }); box(0.54, 0.09, 0.022, 0xb98a60, { x, y: 0.25, z: z - 0.07, r: 0.008 }); [-0.21, 0.21].forEach((d) => box(0.03, 0.15, 0.13, 0x6a4c38, { x: x + d, y: 0.075, z, r: 0.008 })); };
  bench(-3.3, 1.5); bench(3.3, 1.5);
  const bed = (x, z, w) => {
    box(w, 0.08, 0.34, 0x8e6a4c, { x, y: 0.04, z, r: 0.016 });
    box(w - 0.05, 0.03, 0.28, 0x5d4636, { x, y: 0.08, z, r: 0.01 });
    const n = Math.round(w * 26);
    for (let i = 0; i < n; i++) ball(between(0.024, 0.04), tones[Math.floor(rnd() * 4)], { x: x + between(-w / 2 + 0.03, w / 2 - 0.03), y: between(0.11, 0.19), z: z + between(-0.11, 0.11) });
    for (let i = 0; i < n; i++) ball(0.034, 0x6f9f52, { x: x + between(-w / 2 + 0.03, w / 2 - 0.03), y: 0.1, z: z + between(-0.11, 0.11), sy: 1.4 });
  };
  bed(-2.75, 0.75, 1.1); bed(2.8, 0.75, 1.1);
  // A big open book on a stand at the edge of the yard: this is where learning lives.
  {
    const bx = -2.05, bz = 1.5;
    cyl(0.1, 0.14, 0.26, stoneD, { x: bx, y: 0.13, z: bz });
    [-1, 1].forEach((s) => { box(0.26, 0.03, 0.34, 0x3f83ac, { x: bx + s * 0.135, y: 0.3 + 0.05, z: bz, rz: s * -0.3, r: 0.008 }); box(0.235, 0.02, 0.31, 0xfbf8f0, { x: bx + s * 0.13, y: 0.325 + 0.05, z: bz, rz: s * -0.3, r: 0.006 }); });
  }

  // --- Green around it.
  reseed(301);
  [[-3.95, -0.5, 1.5, 'oak'], [-3.1, -1.5, 1.32, 'deep'], [3.9, -0.75, 1.55, 'lime'], [3.05, -1.7, 1.25, 'oak'], [-2.3, -1.9, 1.05, 'lime'], [2.25, -2.1, 1.1, 'blossom'], [-4.6, 1.15, 1.2, 'lime'], [4.6, 1.05, 1.25, 'deep']].forEach(([x, z, s, k]) => roundTree(x, z, s, k));
  [[-3.4, -2.8, 1.25], [3.45, -3, 1.3], [-1.3, -2.9, 1.2], [1.1, -3.1, 1.25], [0.05, -2.9, 1.1]].forEach(([x, z, s]) => pine(x, z, s, rise(x, z)));
  [[-1.1, -5, 0.8, 'oak'], [0.55, -5.4, 0.74, 'deep'], [2.1, -5, 0.76, 'lime'], [-2.9, -5.4, 0.72, 'lime'], [3.6, -5.6, 0.7, 'oak'], [-4.2, -4.6, 0.8, 'deep']].forEach(([x, z, s, k]) => roundTree(x, z, s, k, rise(x, z)));
  [-3.25, -2.85, -2.45, 2.45, 2.85, 3.25].forEach((x) => bush(x, 0.02, 1, 'deep'));
  // Hedge along the pavement, gap for the gate.
  for (let x = -5.4; x < 5.4; x += 0.17) if (Math.abs(x) > 1.86) v.blob(between(0.115, 0.14), x, 0.1, 2.24, v.LEAF.deep[0], v.LEAF.deep[1], { flat: 0.9 });
  [-1.86, 1.86].forEach((x) => box(0.09, 0.38, 0.09, 0xe9e2d2, { x, y: 0.19, z: 2.24, r: 0.02 }));
  const dot = new THREE.SphereGeometry(0.02, 8, 6), tuft = new THREE.ConeGeometry(0.024, 0.08, 6);
  for (let i = 0; i < 620; i++) {
    const x = between(-6, 6), z = between(-6, 2.1);
    if (Math.abs(x) < 2.1 && z > -1.4) continue;
    const y = rise(x, z);
    if (rnd() < 0.4) place(dot, tones[Math.floor(rnd() * 4)], { x, y: y + 0.024, z });
    else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: y + 0.04, z, rz: between(-0.25, 0.25) });
  }
  finish();
  const cam = new THREE.PerspectiveCamera(vfov * 180 / Math.PI, FULL_W / FULL_H, 0.5, 300);
  cam.position.copy(pos); cam.lookAt(target);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const share = (p) => { const c = p.clone().project(cam); return [+(0.5 + c.x / 2).toFixed(4), +(0.5 - c.y / 2).toFixed(4)]; };
  window.__rect = JSON.stringify({ gate: share(new THREE.Vector3(0, 0, 2.5)), door: share(new THREE.Vector3(0, 0, 1)) });
  return cam;
}
