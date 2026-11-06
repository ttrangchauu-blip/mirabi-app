// The walk on the home screen: an endless strip, so everything repeats every SPAN and the camera has no perspective sideways; depth comes
// from parallax (the app slides `far` slower than `near`), from smaller things further away, and from real shadows.
// `&part=far`: hazy hills and a far wood. `&part=near`: the meadow, trees, the path the pet walks on, the grass in front. The sky is left out.
import { kit } from './kit.js';
import { village } from './village.js';

export async function build({ THREE, scene, W, H, light }) {
  const { glow, mat, sky, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'near';
  const night = light === 'night';
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff } });
  else sky({ top: 0x8fbfee, mid: 0xdcebf4, low: 0x8f9c7c, power: 0.72, sun: { dir: [-0.62, 0.62, 0.62], size: 9, power: 46, color: 0xfff0d8 } });
  const v = village(THREE, scene, { night, start: 19 });
  const { reseed, between, rnd, tmp, place, box, cyl, ball, roundTree, pine, bush, tones, finish } = v;

  const SPAN = 6, TAU = Math.PI * 2;
  const wave = (x, k, ph) => Math.sin(x * TAU * k / SPAN + ph);
  /** Noise that comes back every SPAN, so the grass has no seam. */
  const grain = (x, z) => wave(x, 1, z * 0.9) * 0.34 + wave(x, 3, z * 1.7 + 1) * 0.26 + wave(x, 7, z * 3.1 + 2) * 0.16 + Math.sin(z * 2.3 + 0.4) * 0.14;
  /** Puts a thing and its copies a whole street away, the same each time, so a shadow crossing an edge of the picture comes back on the other side. */
  let count = 0;
  const each = (fn) => { const id = 900 + (count++) * 37; [-SPAN, 0, SPAN].forEach((d) => { reseed(id); fn(d); }); };
  const ridgeline = (x, y0, amp, ph) => y0 + amp * (wave(x, 1, ph) * 0.6 + wave(x, 2, ph * 2) * 0.28 + wave(x, 5, ph) * 0.1);

  const elev = 0.34, lift = 0.55;
  const cam = flatCamera(SPAN, W, H, [0, Math.sin(elev) * 40 + lift, Math.cos(elev) * 40], [0, lift, 0]);
  const tall = SPAN * H / W;
  // How high a thing at depth z must be to reach the row `r` of the picture (0 at the top).
  const reach = (r, z) => (0.5 - r) * tall / Math.cos(elev) + lift + z * Math.tan(elev);

  if (part === 'far') {
    const wall = (z, r, amp, ph, colour) => {
      const y0 = reach(r, z);
      const g = new THREE.PlaneGeometry(SPAN * 4, 30, 480, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, ridgeline(p.getX(i), y0, amp, ph)); else p.setY(i, y0 - 30);
      g.computeVertexNormals();
      place(g, colour, { z });
    };
    wall(-14, 0.3, 0.16, 2.6, night ? 0x8fa8c8 : 0xc4e0d2);
    wall(-9, 0.37, 0.16, 1, night ? 0x7f9cb4 : 0xa9cfae);
    wall(-5, 0.43, 0.1, 4, night ? 0x6f9288 : 0x8fc08e);
    [[-2.3, 0.2, 'deep'], [-1.5, 0.17, 'oak'], [-0.7, 0.2, 'lime'], [0.2, 0.18, 'deep'], [1.1, 0.2, 'oak'], [2.2, 0.17, 'deep']].forEach(([x, s, k]) => each((d) => roundTree(x + d, -5, s, k, reach(0.455, -5))));
    [[-2.7, 0.2], [-1.1, 0.23], [0.65, 0.21], [1.7, 0.2]].forEach(([x, s]) => each((d) => pine(x + d, -5, s, reach(0.455, -5))));
  } else {
    // The land: flat where the path runs, rising behind it to a soft ridge.
    const back = -3.6;
    const pathAt = (x) => 0.82 + 0.06 * wave(x, 2, 0.5) + 0.03 * wave(x, 5, 1);
    const rise = (x, z) => { const t = Math.max(0, Math.min(1, (-z - 0.4) / (-back - 0.4))); return t * t * (reach(0.5, back) + 0.1 * wave(x, 1, 0.9) + 0.05 * wave(x, 2, 2.4)); };
    {
      const g = new THREE.PlaneGeometry(SPAN * 3, 8.4, 900, 340);
      g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.6);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, rise(p.getX(i), p.getZ(i)));
      g.computeVertexNormals();
      const Earth = new THREE.Color(0xc9b28a), Earth2 = new THREE.Color(0xdccaa6);
      const A = new THREE.Color(0x7fae5c), B = new THREE.Color(0x9cc26c), C = new THREE.Color(0xb3cc7e), Far = new THREE.Color(0xa6c88e);
      place(g, (c, x, y, z) => {
        const n = grain(x, z);
        c.copy(A).lerp(B, Math.max(0, Math.min(1, 0.5 + n)));
        if (n > 0.3) c.lerp(C, Math.min(1, (n - 0.3) * 1.6));
        c.lerp(Far, Math.max(0, Math.min(0.7, (-z - 0.4) / 3)));
        const mid = pathAt(x), half = 0.23 + 0.03 * wave(x, 3, 2), edge = Math.abs(z - mid) + grain(x * 1, z * 4) * 0.035;
        const on = Math.max(0, Math.min(1, (half + 0.04 - edge) / 0.08));
        if (on > 0) c.lerp(tmp.copy(Earth).lerp(Earth2, Math.max(0, Math.min(1, 0.5 + grain(x, z * 5) * 0.9))), on * on * (3 - 2 * on));
      });
    }
    // Flat stones in the path.
    [[-2.4, -0.1], [-1.72, 0.1], [-0.86, -0.12], [-0.2, 0.08], [0.74, -0.09], [1.46, 0.11], [2.32, -0.08]].forEach(([x, dz]) => each((d) => place(new THREE.CylinderGeometry(0.045, 0.052, 0.014, 12), 0xc3b8a2, { x: x + d, y: 0.008, z: pathAt(x) + dz, sx: 1.25, sz: 0.8 })));
    // Trees and bushes: bigger in front, smaller behind. Nothing crosses the picture's edge except a shadow.
    [[-2.1, -0.75, 0.56, 'oak'], [-0.42, -1.25, 0.46, 'deep'], [1.72, -0.7, 0.6, 'lime'], [0.72, -1.9, 0.36, 'blossom'], [-1.25, -2.2, 0.32, 'lime'], [2.45, -2.1, 0.34, 'oak']].forEach(([x, z, s, k]) => each((d) => roundTree(x + d, z, s, k, rise(x, z))));
    [[-1.55, -1.5, 0.42], [0.2, -2.5, 0.32], [1.15, -1.2, 0.44], [-2.62, -2.6, 0.3]].forEach(([x, z, s]) => each((d) => pine(x + d, z, s, rise(x, z))));
    [[-2.55, 0.05, 0.55, 'deep'], [-1.0, -0.05, 0.46, 'oak'], [0.25, 0.1, 0.58, 'lime'], [2.5, 0, 0.5, 'deep']].forEach(([x, z, s, k]) => each((d) => bush(x + d, z, s, k)));
    // A bit of old fence along the path.
    [[-0.45, 0.32]].forEach(([x0, w]) => each((d) => { for (let i = 0; i < 6; i++) box(0.02, 0.13, 0.012, 0xe9e2d2, { x: x0 + d + i * w / 3 - w, y: 0.065, z: 0.3, r: 0.006 }); box(w * 2 + 0.06, 0.014, 0.01, 0xe3dac6, { x: x0 + d - w / 3, y: 0.085, z: 0.29, r: 0.004 }); }));
    // Flowers and tufts, in front of and behind the path.
    reseed(5);
    const dot = new THREE.SphereGeometry(0.0125, 8, 6), tuft = new THREE.ConeGeometry(0.014, 0.046, 6);
    for (let i = 0; i < 900; i++) {
      const x = between(-2.9, 2.9), z = rnd() < 0.42 ? between(pathAt(x) + 0.3, 2.1) : between(-3.2, pathAt(x) - 0.3), y = rise(x, z);
      if (rnd() < 0.4) place(dot, tones[Math.floor(rnd() * 4)], { x, y: y + 0.016, z });
      else place(tuft, (c) => c.set(0x6f9f52).lerp(tmp.set(0xa7c872), 0.5), { x, y: y + 0.022, z, rz: between(-0.25, 0.25) });
    }
  }
  finish();
  return cam;
}
