// The Work Desk's back: a window, a corkboard, the desk with a laptop, books and a plant.
import { kit } from './kit.js';
export async function build({ THREE, scene, W, H, light }) {
  const { mat, glow, box, ball, cyl, lathe, torus, wall, leaf, daylight, evening } = kit(THREE, scene);
  const night = light === 'night';
  const WZ = -0.6;
  const paint = mat(0xc4e6f8, 0.92), wains = mat(0xf4fafe, 0.78), rail = mat(0xffffff, 0.65), wood = mat(0xe3cba8, 0.58), plank = mat(0xc9ab84, 0.7), frame = mat(0xffffff, 0.55);
  // The wall, with a real hole for the window.
  const win = { x0: -0.92, x1: -0.3, y0: 0.32, y1: 0.92 };
  wall(-3.5, 3.5, -0.5, 3, [win], 0.08, paint, { z: WZ - 0.08 });
  // Wainscot, low on the wall, and its rail.
  box(7, 0.22, 0.02, wains, { y: 0.11, z: WZ + 0.012, r: 0.006 });
  for (let x = -3.4; x < 3.5; x += 0.4) box(0.3, 0.14, 0.008, mat(0xe2f3fc, 0.8), { x, y: 0.105, z: WZ + 0.024, r: 0.004 });
  box(7, 0.026, 0.04, rail, { y: 0.225, z: WZ + 0.018, r: 0.01 });
  // The window's frame and sill.
  const t = 0.042, mx = (win.x0 + win.x1) / 2, my = (win.y0 + win.y1) / 2, ww = win.x1 - win.x0, wh = win.y1 - win.y0;
  box(ww + t * 2, t, 0.07, frame, { x: mx, y: win.y1 + t / 2, z: WZ + 0.03, r: 0.014 });
  box(ww + t * 2, t, 0.07, frame, { x: mx, y: win.y0 - t / 2, z: WZ + 0.03, r: 0.014 });
  box(t, wh, 0.07, frame, { x: win.x0 - t / 2, y: my, z: WZ + 0.03, r: 0.014 });
  box(t, wh, 0.07, frame, { x: win.x1 + t / 2, y: my, z: WZ + 0.03, r: 0.014 });
  box(ww + 0.19, 0.032, 0.17, frame, { x: mx, y: win.y0 - t - 0.014, z: WZ + 0.08, r: 0.014 });
  // Curtains, gathered at the sides.
  const curtain = mat(0x8fd0ee, 0.85);
  [win.x0 - 0.075, win.x1 + 0.075].forEach((x) => { for (let i = -1; i <= 1; i++) box(0.042, wh + 0.14, 0.05, curtain, { x: x + i * 0.03, y: my + 0.03, z: WZ + 0.075 + (i ? 0 : 0.012), r: 0.02 }); });
  box(ww + 0.42, 0.018, 0.018, mat(0xc9ab84, 0.5), { x: mx, y: win.y1 + 0.1, z: WZ + 0.08, r: 0.008 });
  // A small corkboard under where the pet's words go, with notes pinned on it.
  box(0.36, 0.2, 0.022, mat(0xe9d6b8, 0.95), { x: 0.56, y: 0.59, z: WZ + 0.012, r: 0.012 });
  box(0.385, 0.225, 0.016, mat(0xffffff, 0.7), { x: 0.56, y: 0.59, z: WZ + 0.006, r: 0.012 });
  [[0.46, 0.62, 0xffe08a, 0.06], [0.56, 0.56, 0xffb9a6, -0.07], [0.655, 0.62, 0xb9e2b1, 0.05]].forEach(([x, y, c, rz]) => box(0.075, 0.075, 0.005, mat(c, 0.8), { x, y, z: WZ + 0.025, rz, r: 0.002 }));
  // The desk: boards side by side, thick and rounded at the front.
  for (let i = -12; i <= 12; i++) box(0.298, 0.09, 1.3, [wood, mat(0xdcc29e, 0.58), mat(0xe8d3b3, 0.6)][(i + 24) % 3], { x: i * 0.3, y: -0.045, z: 0.05, r: 0.007 });
  box(7, 0.03, 0.03, plank, { y: -0.075, z: 0.71, r: 0.01 });
  // A laptop: slim, with soft corners, the screen facing you.
  const shell = mat(0xe4e7ee, 0.38), ink = mat(0x262c3b, 0.3);
  const lx = 0.22, lz = -0.14, lidW = 0.5, lidH = 0.32, tilt = -0.1;
  box(lidW, 0.02, 0.32, shell, { x: lx, y: 0.01, z: lz + 0.16, r: 0.01 });
  box(lidW * 0.86, 0.002, 0.16, mat(0xb4bbc7, 0.55), { x: lx, y: 0.0205, z: lz + 0.125, r: 0.001 });
  box(lidW * 0.3, 0.002, 0.08, mat(0xd2d7df, 0.5), { x: lx, y: 0.0205, z: lz + 0.26, r: 0.001 });
  const midY = 0.02 + lidH / 2 * Math.cos(tilt), midZ0 = lz + lidH / 2 * Math.sin(tilt);
  box(lidW, lidH, 0.016, shell, { x: lx, y: midY, z: midZ0, rx: tilt, r: 0.009 });
  box(lidW - 0.032, lidH - 0.032, 0.002, ink, { x: lx, y: midY, z: midZ0 + 0.0085, rx: tilt, r: 0.001 });
  // A stack of books, and a plant on top of them.
  const bx = 0.9, bz = -0.2;
  box(0.36, 0.062, 0.26, mat(0xdf6f5b, 0.68), { x: bx, y: 0.031, z: bz, ry: 0.06, r: 0.014 });
  box(0.33, 0.058, 0.24, mat(0x5b9bd0, 0.68), { x: bx + 0.01, y: 0.091, z: bz, ry: -0.08, r: 0.014 });
  box(0.3, 0.052, 0.22, mat(0xf3c65c, 0.68), { x: bx - 0.01, y: 0.146, z: bz, ry: 0.1, r: 0.014 });
  const clay = mat(0xd9825a, 0.66), leafA = mat(0x4f9f6b, 0.55), leafB = mat(0x77c288, 0.55);
  const px = bx - 0.02, py = 0.172;
  lathe([[0.001, 0], [0.062, 0], [0.082, 0.105], [0.088, 0.118], [0.074, 0.118], [0.001, 0.1]], clay, { x: px, y: py, z: bz });
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, s = 0.15 + (i % 3) * 0.05, lean = 0.28 + (i % 4) * 0.14;
    leaf(s, 0.05, i % 2 ? leafA : leafB, { x: px + Math.cos(a) * 0.014, y: py + 0.1, z: bz + Math.sin(a) * 0.014, rz: Math.cos(a) * lean, rx: Math.sin(a) * lean });
  }
  // A desk lamp, on in the evening.
  const lampM = mat(0xffd66b, 0.42), bulb = night ? glow(0xffcf90, 1.6) : mat(0xfff4dc, 0.3);
  const lampX = -0.26, lampZ = -0.3;
  cyl(0.065, 0.075, 0.018, lampM, { x: lampX, y: 0.009, z: lampZ });
  cyl(0.009, 0.009, 0.32, lampM, { x: lampX + 0.022, y: 0.17, z: lampZ, rz: -0.14 });
  cyl(0.009, 0.009, 0.17, lampM, { x: lampX + 0.11, y: 0.36, z: lampZ, rz: 1.0 });
  lathe([[0.028, 0.095], [0.052, 0.075], [0.105, 0], [0.105, -0.006]], lampM, { x: lampX + 0.215, y: 0.33, z: lampZ, rz: -0.22 });
  ball(0.036, bulb, { x: lampX + 0.22, y: 0.34, z: lampZ });
    // A mug and a pencil pot.
  const mug = mat(0xfff8ec, 0.42);
  lathe([[0.001, 0], [0.045, 0], [0.049, 0.095], [0.043, 0.095], [0.038, 0.008], [0.001, 0.008]], mug, { x: 0.68, y: 0, z: 0.12 });
  torus(0.026, 0.0065, mug, { x: 0.74, y: 0.048, z: 0.12 });
  cyl(0.04, 0.04, 0.004, mat(0x8a5a35, 0.25), { x: 0.68, y: 0.08, z: 0.12 });
  lathe([[0.001, 0], [0.046, 0], [0.046, 0.12], [0.04, 0.12], [0.04, 0.01], [0.001, 0.01]], mat(0x5b9bd0, 0.55), { x: 1.28, y: 0, z: -0.28 });
  [[0xdf6f5b, 0.16, -0.1], [0xf3c65c, 0.19, 0.08], [0x69ad7c, 0.17, 0.16]].forEach(([c, h, rz], i) => cyl(0.007, 0.007, h, mat(c, 0.5), { x: 1.28 + rz * 0.1, y: 0.1, z: -0.28 + i * 0.008 - 0.008, rz }));

  // Outside: only for the glow it gives; the app draws the real sky over this glass.
  const out = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), glow(night ? 0x1a2547 : 0xdcecff, night ? 0.4 : 2.2));
  out.position.set(-1, 1, WZ - 1.2); scene.add(out);
  if (night) evening({ dir: [-0.05, 0.8, 0.6] }); else daylight({ sun: 13 });

  const camera = new THREE.PerspectiveCamera(22, W / H, 0.05, 40);
  camera.position.set(0, 0.74, 3.25); camera.lookAt(0, 0.42, WZ); camera.updateMatrixWorld(true);
  const at = (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(camera); return [+(p.x * 0.5 + 0.5).toFixed(4), +(0.5 - p.y * 0.5).toFixed(4)]; };
  const midZ = midZ0 + 0.0095, hh = (lidH - 0.032) / 2, hw = (lidW - 0.032) / 2;
  window.__rect = JSON.stringify({ glass: { tl: at(win.x0, win.y1, WZ), br: at(win.x1, win.y0, WZ) }, screen: { tl: at(lx - hw, midY + hh * Math.cos(tilt), midZ + hh * Math.sin(tilt)), br: at(lx + hw, midY - hh * Math.cos(tilt), midZ - hh * Math.sin(tilt)) } });
  return camera;
}
