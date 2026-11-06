// Khám phá: the road the pet walks, close up and tall enough for a whole screen. An endless strip like the home walk, in three layers the
// app slides at different speeds. `&part=far` the hills, `&part=mid` the rise with its trees, `&part=road` the road and the grass in front. No sky.
import { kit } from './kit.js';
import { village } from './village.js';

export const ROAD_ROW = 0.66;
export async function build({ THREE, scene, W, H, light }) {
  const { sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'road';
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night, start: 29 });
  const { reseed, between, rnd, tmp, place, box, roundTree, pine, bush, tones, finish } = v;

  const SPAN = 6, TAU = Math.PI * 2;
  const wave = (x, k, ph) => Math.sin(x * TAU * k / SPAN + ph);
  const grain = (x, z) => wave(x, 1, z * 0.9) * 0.34 + wave(x, 3, z * 1.7 + 1) * 0.26 + wave(x, 7, z * 3.1 + 2) * 0.16 + Math.sin(z * 2.3 + 0.4) * 0.14;
  let count = 0;
  const each = (fn) => { const id = 900 + (count++) * 37; [-SPAN, 0, SPAN].forEach((d) => { reseed(id); fn(d); }); };
  const elev = 0.3, lift = 0.9;
  const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40 + lift, Math.cos(elev) * 40], [0, lift, 0]);
  const tall = SPAN * H / W;
  const reach = (r, z) => (0.5 - r) * tall / Math.cos(elev) + lift + z * Math.tan(elev);
  // The road's depth is whatever falls on ROAD_ROW at ground height.
  const roadZ = -(0.5 - ROAD_ROW) * tall / Math.sin(elev) - lift / Math.tan(elev);

  const land = (z0, z1, rise, colourAt, zSeg = 200) => {
    const g = new THREE.PlaneGeometry(SPAN * 3, z1 - z0, 900, zSeg);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, rise(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    place(g, colourAt);
  };
  const A = new THREE.Color(0x7fae5c), B = new THREE.Color(0x9cc26c), C = new THREE.Color(0xb3cc7e), Far = new THREE.Color(0xa6c88e);
  const grass = (c, x, z, fade = 0) => {
    const n = grain(x, z);
    c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n)));
    if (n > 0.3) c.lerp(C, Math.min(1, (n - 0.3) * 1.6));
    if (fade) c.lerp(Far, fade);
  };

  if (part === 'far') {
    const wall = (z, r, amp, ph, colour) => {
      const y0 = reach(r, z);
      const g = new THREE.PlaneGeometry(SPAN * 4, 40, 480, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i); p.setY(i, y0 + amp * (wave(x, 1, ph) * 0.6 + wave(x, 2, ph * 2) * 0.28 + wave(x, 5, ph) * 0.1)); } else p.setY(i, y0 - 40);
      g.computeVertexNormals();
      place(g, colour, { z });
    };
    wall(-30, 0.24, 0.4, 2.6, night ? 0x8fa8c8 : 0xc4e0d2);
    wall(-22, 0.3, 0.36, 1, night ? 0x7f9cb4 : 0xa9cfae);
    [[-2.5, 0.42, 'deep'], [-1.7, 0.36, 'oak'], [-0.6, 0.42, 'lime'], [0.4, 0.38, 'deep'], [1.5, 0.42, 'oak'], [2.45, 0.36, 'deep']].forEach(([x, s, k]) => each((d) => roundTree(x + d, -20, s, k, reach(0.34, -20))));
    [[-2.1, 0.42], [-1.1, 0.46], [0.95, 0.44], [2.05, 0.42]].forEach(([x, s]) => each((d) => pine(x + d, -20, s, reach(0.34, -20))));
  } else if (part === 'mid') {
    // The rise behind the road: it starts low and ends in a soft ridge, its trees standing on it.
    const zb = -10, y1 = reach(0.355, zb);
    const rise = (x, z) => { const t = Math.max(0, Math.min(1, (z - (roadZ - 1)) / (zb - (roadZ - 1)))); return t * t * (y1 + 0.16 * wave(x, 1, 0.9) + 0.07 * wave(x, 2, 2.4)); };
    land(zb, roadZ + 1.2, rise, (c, x, y, z) => grass(c, x, z, Math.max(0, Math.min(0.7, (roadZ - z) / 8))), 180);
    [[-2.2, roadZ - 2.2, 1.22, 'oak'], [-0.35, roadZ - 3.8, 0.98, 'deep'], [1.75, roadZ - 2, 1.25, 'lime'], [0.85, roadZ - 5.2, 0.78, 'blossom'], [-1.2, roadZ - 5.8, 0.72, 'lime'], [2.6, roadZ - 5.4, 0.74, 'oak']].forEach(([x, z, s, k]) => each((d) => roundTree(x + d, z, s, k, rise(x, z))));
    [[-1.3, roadZ - 3, 0.9], [0.2, roadZ - 6.2, 0.66], [0.8, roadZ - 3.3, 0.92], [-2.7, roadZ - 6.4, 0.64]].forEach(([x, z, s]) => each((d) => pine(x + d, z, s, rise(x, z))));
    reseed(5);
    const dot = new THREE.SphereGeometry(0.02, 8, 6), tuft = new THREE.ConeGeometry(0.024, 0.08, 6);
    for (let i = 0; i < 500; i++) {
      const x = between(-2.9, 2.9), z = between(zb + 0.8, roadZ - 0.7), y = rise(x, z);
      if (rnd() < 0.4) place(dot, tones[Math.floor(rnd() * 4)], { x, y: y + 0.024, z });
      else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: y + 0.04, z, rz: between(-0.25, 0.25) });
    }
  } else {
    // The road, worn into the grass, with the bank behind it and tall grass in front.
    const Earth = new THREE.Color(0xc9b28a), Earth2 = new THREE.Color(0xdccaa6);
    const mid = (x) => roadZ + 0.05 * wave(x, 2, 0.5) + 0.025 * wave(x, 5, 1);
    const half = (x) => 0.46 + 0.03 * wave(x, 3, 2);
    const flat = (x, z) => 0.012 * wave(x, 4, z * 2);
    land(roadZ - 1.5, roadZ + 7, flat, (c, x, y, z) => {
      grass(c, x, z);
      const e = Math.abs(z - mid(x)) + grain(x, z * 4) * 0.05, on = Math.max(0, Math.min(1, (half(x) + 0.05 - e) / 0.1));
      if (on > 0) c.lerp(tmp.copy(Earth).lerp(Earth2, Math.max(0, Math.min(1, 0.5 + grain(x, z * 5) * 0.9))), on * on * (3 - 2 * on));
    }, 340);
    [[-2.4, -0.2], [-1.72, 0.22], [-0.86, -0.26], [-0.2, 0.16], [0.74, -0.18], [1.46, 0.24], [2.32, -0.16]].forEach(([x, dz]) => each((d) => place(new THREE.CylinderGeometry(0.08, 0.09, 0.024, 12), 0xc3b8a2, { x: x + d, y: 0.012, z: mid(x) + dz, sx: 1.25, sz: 0.8 })));
    [[-2.45, roadZ - 0.95, 0.9, 'deep'], [-1, roadZ - 1.05, 0.72, 'oak'], [0.3, roadZ - 0.9, 0.95, 'lime'], [2.45, roadZ - 1, 0.8, 'deep'], [-1.9, roadZ + 1.4, 0.9, 'oak'], [1.3, roadZ + 1.5, 1, 'deep']].forEach(([x, z, s, k]) => each((d) => bush(x + d, z, s, k)));
    reseed(6);
    const dot = new THREE.SphereGeometry(0.028, 8, 6), tuft = new THREE.ConeGeometry(0.034, 0.12, 6);
    for (let i = 0; i < 700; i++) {
      const x = between(-2.9, 2.9), z = rnd() < 0.3 ? between(roadZ - 1.4, roadZ - 0.6) : between(roadZ + 0.62, roadZ + 6.5);
      if (rnd() < 0.3) place(dot, tones[Math.floor(rnd() * 4)], { x, y: 0.034, z });
      else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: 0.055, z, rz: between(-0.25, 0.25) });
    }
  }
  finish();
  // `&crop=x,y,w,h` renders part of the full 1950 picture: a picture that size in one piece hangs Chrome's screenshot.
  const crop = (q.get('crop') || '').split(',').map(Number);
  if (crop.length === 4) cam.setViewOffset(1950, 1950, crop[0], crop[1], crop[2], crop[3]);
  window.__rect = JSON.stringify({ roadZ, row: ROAD_ROW });
  return cam;
}
