// Sổ tay kiến thức: `&part=wall` (a tile of boards), `niche` (one shelf), `books` (the covers in a row) or `tops` (what stands on top).
import { kit } from './kit.js';
export async function build({ THREE, scene, W, H }) {
  const { mat, box, ball, cyl, lathe, leaf, daylight, flatCamera } = kit(THREE, scene);
  const part = new URLSearchParams(location.search).get('part') || 'wall';
  daylight({ sun: 11, power: 0.74, size: 20 });

  if (part === 'wall') {
    // Boards running up and down, so the tile repeats downwards without a seam.
    const tones = [0xcfeafa, 0xc8e6f8, 0xd6eefb, 0xc2e2f6];
    for (let i = -6; i <= 6; i++) box(0.62, 30, 0.1, mat(tones[(i + 12) % 4], 0.78), { x: i * 0.625, y: 0, z: 0, r: 0.022 });
    return flatCamera(4, W, H, [0, 0, 8]);
  }
  if (part === 'niche') {
    const wood = mat(0xeee1cc, 0.62), back = mat(0xf4fafe, 0.85), board = mat(0xe3cba8, 0.55);
    const w = 3.7, h = 1.4, d = 0.7;
    box(w, h, 0.05, back, { y: h / 2, z: -d, r: 0.004 });
    box(w + 0.2, 0.12, d + 0.18, board, { y: -0.06, z: -d / 2 + 0.06, r: 0.04 });
    box(w + 0.2, 0.09, d + 0.05, wood, { y: h + 0.045, z: -d / 2, r: 0.03 });
    box(0.1, h + 0.1, d + 0.05, wood, { x: -w / 2 - 0.05, y: h / 2, z: -d / 2, r: 0.03 });
    box(0.1, h + 0.1, d + 0.05, wood, { x: w / 2 + 0.05, y: h / 2, z: -d / 2, r: 0.03 });
    const camera = new THREE.PerspectiveCamera(20, W / H, 0.1, 40);
    camera.position.set(0, 1.1, 4.55); camera.lookAt(0, h / 2 - 0.02, -0.2); camera.updateMatrixWorld(true);
    return camera;
  }
  if (part === 'books') {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0xeee8dc, 0.9));
    floor.rotation.x = -Math.PI / 2; floor.userData.noMask = true; scene.add(floor);
    const covers = [0xd9685a, 0x4f8fbf, 0x62a97c, 0xdba53f, 0x8c72c4, 0xd47fa4, 0x4fafa8, 0xf0e4c8];
    covers.forEach((color, i) => {
      const x = (i - 3.5) * 0.8;
      const g = new THREE.Group(); g.position.set(x, 0, 0); g.rotation.y = 0.32; scene.add(g);
      const m = mat(color, 0.5), page = mat(0xfbf4e3, 0.8), gold = mat(i === 7 ? 0xb99a6a : 0xf6dc9c, 0.4);
      const bw = 0.66, bh = 0.96, bd = 0.15;
      box(bw - 0.03, bh - 0.05, bd - 0.03, page, { parent: g, x: 0.012, y: bh / 2, r: 0.006 });
      box(bw, bh, 0.022, m, { parent: g, y: bh / 2, z: bd / 2, r: 0.01 });
      box(bw, bh, 0.022, m, { parent: g, y: bh / 2, z: -bd / 2, r: 0.01 });
      box(0.055, bh, bd + 0.02, m, { parent: g, x: -bw / 2 + 0.02, y: bh / 2, r: 0.024 });
      box(bw - 0.1, 0.022, 0.006, gold, { parent: g, x: 0.02, y: bh - 0.075, z: bd / 2 + 0.012, r: 0.002 });
      box(bw - 0.1, 0.022, 0.006, gold, { parent: g, x: 0.02, y: 0.075, z: bd / 2 + 0.012, r: 0.002 });
      // The name goes on this label, drawn by the app.
      box(bw - 0.1, 0.52, 0.006, mat(0xffffff, 0.6), { parent: g, x: 0.02, y: bh * 0.56, z: bd / 2 + 0.012, r: 0.003 });
    });
    const span = 6.4, h = span * H / W;
    return flatCamera(span, W, H, [0, 0.52 + 0.9, 8], [0, 0.52, 0]);
  }
  // On top of the shelves: a plant, a globe and a cup.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0xe9dcc4, 0.9));
  floor.rotation.x = -Math.PI / 2; floor.userData.noMask = true; scene.add(floor);
  const clay = mat(0xd9825a, 0.62), a = mat(0x4f9f6b, 0.55), b = mat(0x77c288, 0.55);
  lathe([[0.001, 0], [0.16, 0], [0.22, 0.27], [0.235, 0.3], [0.2, 0.3], [0.001, 0.26]], clay, { x: -1.1, y: 0 });
  for (let i = 0; i < 11; i++) {
    const an = i * 2.4, s = 0.42 + (i % 3) * 0.13, lean = 0.24 + (i % 4) * 0.15;
    leaf(s, 0.13, i % 2 ? a : b, { x: -1.1 + Math.cos(an) * 0.03, y: 0.26, z: Math.sin(an) * 0.03, rz: Math.cos(an) * lean, rx: Math.sin(an) * lean });
  }
  // The globe: sea with soft green lands.
  const brass = mat(0xd9a64f, 0.32);
  cyl(0.16, 0.2, 0.04, brass, { x: 0, y: 0.02 });
  cyl(0.024, 0.03, 0.14, brass, { x: 0, y: 0.1 });
  ball(0.33, mat(0x5ea3d6, 0.36), { x: 0, y: 0.48 });
  [[-0.14, 0.58, 0.25, 0.14], [0.13, 0.42, 0.26, 0.11], [0.02, 0.68, 0.24, 0.09], [-0.18, 0.34, 0.21, 0.09]].forEach(([x, y, z, r]) => ball(r, mat(0x7cc48a, 0.5), { x, y, z, sz: 0.3 }));
  // The cup.
  const gold = mat(0xf0bf52, 0.3);
  cyl(0.2, 0.22, 0.05, mat(0xa56f3c, 0.5), { x: 1.1, y: 0.025 });
  cyl(0.04, 0.07, 0.17, gold, { x: 1.1, y: 0.13 });
  lathe([[0.001, 0.21], [0.05, 0.22], [0.16, 0.34], [0.2, 0.56], [0.19, 0.56], [0.14, 0.36], [0.001, 0.26]], gold, { x: 1.1 });
  [[-1, 0.92], [1, 1.28]].forEach(([, x]) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.016, 12, 24), gold); t.position.set(x, 0.45, 0); scene.add(t);
  });
  const span = 3.3, hh = span * H / W;
  return flatCamera(span, W, H, [0, hh * 0.5 + 0.6, 6], [0, hh * 0.5 - 0.04, 0]);
}
