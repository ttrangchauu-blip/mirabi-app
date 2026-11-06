// Thị trấn Mirabi. `&part=street`: a tile of hills, pavement and road that repeats sideways; the sky is left out for the app to draw.
// `&part=fountain|garden` (the five stages of each in a row), `places` (plaza, shop, hall), `houses` (five roofs, and the empty lot), `lantern`.
import { kit } from './kit.js';
const SEA = 0x8fd0ee;
export async function build({ THREE, scene, W, H, light }) {
  const { mat, glow, box, ball, cyl, cone, lathe, torus, leaf, sky, daylight, flatCamera } = kit(THREE, scene);
  const q = new URLSearchParams(location.search);
  const part = q.get('part') || 'street';
  const night = q.get('night') === '1' || light === 'night';
  if (night) sky({ top: 0x46508c, mid: 0x4a5088, low: 0x2a2c4a, power: 0.8, sun: { dir: [-0.3, 0.8, 0.6], size: 24, power: 2, color: 0xbcd0ff } });
  else daylight({ sun: 12, power: 0.72, size: 18 });
  let seed = 23;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
  const white = mat(0xfbfdff, 0.68), cream = mat(0xf7f0e2, 0.7), stone = mat(0xdfe6ea, 0.78), stoneD = mat(0xc2ccd3, 0.8), wood = mat(0xc9a077, 0.62), woodD = mat(0xa87f58, 0.68), green = mat(0x5fae78, 0.7), green2 = mat(0x86c98b, 0.7);
  const windowM = night ? glow(0xffd98a, 2.6) : mat(0xb8e2f6, 0.2);
  const floorAt = (color = 0xdde8ea) => { const f = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(color, 0.9)); f.rotation.x = -Math.PI / 2; f.userData.noMask = true; scene.add(f); };
  const from = (cx, cy) => [cx, cy + 1.6, 8];

  if (part === 'street') {
    const SPAN = 4, TAU = Math.PI * 2;
    const elev = 0.3;
    const lift = 1.06;
    const cam = [0, Math.sin(elev) * 30 + lift, Math.cos(elev) * 30];
    // Periodic land: the hills come back every SPAN.
    const hill = (x, z) => {
      const b = Math.max(0, -z - 0.9);
      return Math.min(b * 0.42, 1) * (0.82 + 0.16 * Math.sin(x * TAU / SPAN + 0.6) + 0.08 * Math.sin(x * TAU * 2 / SPAN + 2));
    };
    const geo = new THREE.PlaneGeometry(SPAN * 4, 3, 320, 80);
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const near = new THREE.Color(0x9ed27f), far = new THREE.Color(0xa9d3a2), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, hill(x, z));
      tmp.copy(near).lerp(far, Math.min(1, Math.max(0, (-z - 1) / 2.5)));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
    // The pavement and the road.
    box(SPAN * 4, 0.1, 1.5, mat(0xeef1f0, 0.85), { y: -0.05, z: -0.1, r: 0.02 });
    box(SPAN * 4, 0.05, 0.12, stoneD, { y: 0, z: 0.72, r: 0.02 });
    box(SPAN * 4, 0.1, 3, mat(0xb9c6d0, 0.86), { y: -0.14, z: 2.3, r: 0.02 });
    box(SPAN * 4, 0.1, 6, stoneD, { y: -0.22, z: 1, r: 0.005 });
    for (let x = -SPAN * 2; x < SPAN * 2; x += 0.5) box(0.28, 0.006, 0.05, mat(0xfbfdff, 0.6), { x: x + 0.25, y: -0.087, z: 1.95, r: 0.002 });
    // What repeats along it: a street lamp, bushes, far trees.
    const each = (x, fn) => [-SPAN * 2, -SPAN, 0, SPAN, SPAN * 2].forEach((d) => fn(x + d));
    const post = mat(0x8a9aa8, 0.42);
    each(0, (x) => {
      cyl(0.022, 0.03, 0.9, post, { x, y: 0.45, z: -0.45 });
      cyl(0.05, 0.06, 0.04, post, { x, y: 0.02, z: -0.45 });
      lathe([[0.02, 0.09], [0.07, 0.03], [0.075, 0]], post, { x, y: 1.03, z: -0.45 });
      ball(0.058, night ? glow(0xffe08a, 4) : mat(0xf6f8fa, 0.3), { x, y: 0.98, z: -0.45 });
    });
    const treeAt = (x0, z, s, a, b) => each(x0, (x) => {
      const y = hill(x, z);
      cyl(0.04 * s, 0.06 * s, 0.3 * s, mat(0x8a5e3a, 0.85), { x, y: y + 0.15 * s, z });
      [[0, 0.42, 0.24, a], [-0.16, 0.33, 0.17, b], [0.16, 0.32, 0.18, a], [0.02, 0.58, 0.16, b]].forEach(([dx, dy, r, m]) => ball(r * s, m, { x: x + dx * s, y: y + dy * s, z }));
    });
    treeAt(-1.35, -2.1, 0.95, green, green2);
    treeAt(0.7, -2.5, 1.05, green2, green);
    treeAt(1.6, -1.9, 0.8, mat(0xf2b3c6, 0.8), green2);
    treeAt(-0.45, -3.1, 1.1, green, green2);
    [[-1.65, 1], [-0.75, 0.8], [0.45, 0.9], [1.25, 1.1]].forEach(([x0, s]) => each(x0, (x) => {
      [[0, 0.1, 0.14], [-0.12, 0.07, 0.1], [0.12, 0.06, 0.1]].forEach(([dx, dy, r], i) => ball(r * s, i % 2 ? green : green2, { x: x + dx * s, y: dy * s, z: -0.95 }));
    }));
    return flatCamera(SPAN, W, H, cam, [0, lift, 0]);
  }

  floorAt();
  if (part === 'fountain') {
    const CELL = 1.5;
    for (let s = 0; s <= 4; s++) {
      const x = (s - 2) * CELL;
      const water = mat(0x8fd6f2, 0.16);
      if (s === 0) {
        // The site: a ring of stones laid out, nothing built yet.
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; box(0.16, 0.09, 0.1, stone, { x: x + Math.cos(a) * 0.48, y: 0.045, z: Math.sin(a) * 0.36, ry: -a + Math.PI / 2, r: 0.03 }); }
        continue;
      }
      const r = s === 1 ? 0.42 : 0.56;
      lathe([[0.001, 0], [r, 0], [r + 0.03, 0.05], [r + 0.03, 0.15], [r - 0.05, 0.16], [r - 0.05, 0.1], [0.001, 0.1]], stone, { x });
      cyl(r - 0.05, r - 0.05, 0.012, water, { x, y: 0.125 });
      if (s >= 2) {
        const h = s === 2 ? 0.2 : 0.46;
        cyl(0.075, 0.1, h, stoneD, { x, y: 0.12 + h / 2 });
        if (s === 2) ball(0.055, water, { x, y: 0.34, sy: 1.5 });
      }
      if (s >= 3) {
        lathe([[0.001, 0], [0.28, 0.02], [0.31, 0.07], [0.27, 0.09], [0.26, 0.05], [0.001, 0.05]], stone, { x, y: 0.56 });
        cyl(0.26, 0.26, 0.01, water, { x, y: 0.63 });
        if (s === 3) ball(0.05, water, { x, y: 0.7, sy: 1.5 });
      }
      if (s === 4) {
        cyl(0.04, 0.06, 0.2, stoneD, { x, y: 0.72 });
        lathe([[0.001, 0], [0.13, 0.015], [0.15, 0.05], [0.12, 0.06], [0.001, 0.035]], stone, { x, y: 0.82 });
        ball(0.05, mat(0xf3cb62, 0.3), { x, y: 0.92 });
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ball(0.022, water, { x: x + Math.cos(a) * 0.2, y: 0.74, z: Math.sin(a) * 0.2 }); ball(0.03, mat(i % 2 ? 0xf7a8bd : 0xffe08a, 0.6), { x: x + Math.cos(a) * 0.62, y: 0.09, z: Math.sin(a) * 0.44 }); }
      }
    }
    return flatCamera(CELL * 5, W, H, from(0, 0.55), [0, 0.55, 0]);
  }
  if (part === 'garden') {
    const CELL = 1.5, colors = [0xf7a8bd, 0xffd76a, 0xc9b4ee, 0xffffff, 0xf58a5c];
    for (let s = 0; s <= 4; s++) {
      const x = (s - 2) * CELL;
      box(1.26, 0.13, 0.62, wood, { x, y: 0.065, r: 0.03 });
      box(1.14, 0.03, 0.5, mat(0x7d5430, 0.95), { x, y: 0.125, r: 0.012 });
      const n = [0, 5, 10, 16, 22][s];
      for (let i = 0; i < n; i++) {
        const px = x - 0.5 + ((i * 0.618) % 1) * 1, pz = -0.18 + ((i * 0.37) % 1) * 0.36, h = 0.1 + (i % 3) * 0.05 + s * 0.012;
        cyl(0.009, 0.012, h, green, { x: px, y: 0.14 + h / 2, z: pz });
        leaf(0.07, 0.024, green2, { x: px, y: 0.15, z: pz, rz: i % 2 ? 1 : -1 });
        if (s >= 2) { ball(0.04, mat(colors[i % 5], 0.58), { x: px, y: 0.15 + h, z: pz, sy: 0.74 }); ball(0.016, mat(0xf5c542, 0.55), { x: px, y: 0.175 + h, z: pz + 0.012, sy: 0.7 }); }
      }
      if (s >= 3) for (let i = 0; i < 7; i++) box(0.04, 0.2, 0.03, white, { x: x - 0.6 + i * 0.2, y: 0.1, z: 0.36, r: 0.012 });
      if (s >= 3) box(1.3, 0.03, 0.02, white, { x, y: 0.14, z: 0.345, r: 0.008 });
      if (s === 4) {
        // An arch of roses over the bed.
        const arch = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.022, 12, 32, Math.PI), white);
        arch.position.set(x, 0.36, -0.22); scene.add(arch);
        cyl(0.022, 0.022, 0.36, white, { x: x - 0.46, y: 0.18, z: -0.22 });
        cyl(0.022, 0.022, 0.36, white, { x: x + 0.46, y: 0.18, z: -0.22 });
        for (let i = 0; i < 16; i++) { const a = (i / 15) * Math.PI; ball(0.045, i % 3 ? green2 : mat(0xf7a8bd, 0.6), { x: x + Math.cos(a) * 0.46, y: 0.36 + Math.sin(a) * 0.46, z: -0.2 }); }
      }
    }
    return flatCamera(CELL * 5, W, H, from(0, 0.48), [0, 0.48, 0]);
  }
  if (part === 'places') {
    const CELL = 1.5;
    // The event plaza: a low stage under an awning; the app hangs the running event's name over it.
    {
      const x = -CELL;
      box(1.26, 0.18, 0.72, wood, { x, y: 0.09, r: 0.03 });
      box(1.18, 0.03, 0.64, mat(0xe3cba8, 0.6), { x, y: 0.19, r: 0.012 });
      [-0.56, 0.56].forEach((dx) => cyl(0.03, 0.03, 0.58, white, { x: x + dx, y: 0.46, z: -0.22 }));
      [-0.56, 0.56].forEach((dx) => cyl(0.03, 0.03, 0.58, white, { x: x + dx, y: 0.46, z: 0.24 }));
      for (let i = 0; i < 7; i++) box(0.195, 0.05, 0.66, mat(i % 2 ? 0xfbfdff : 0xb8a7f0, 0.62), { x: x - 0.585 + i * 0.195, y: 0.79, z: 0, rx: 0, r: 0.02 });
      ball(0.05, mat(0xf3cb62, 0.3), { x, y: 0.86 });
    }
    // The gift shop.
    {
      const x = 0;
      box(1.06, 0.66, 0.66, white, { x, y: 0.33, r: 0.03 });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.88, 0.42, 4).rotateY(Math.PI / 4), mat(0xf2a3c0, 0.62));
      roof.position.set(x, 0.86, 0); roof.scale.set(1, 1, 0.74); scene.add(roof);
      for (let i = 0; i < 8; i++) box(0.14, 0.03, 0.2, mat(i % 2 ? 0xfbfdff : 0xf2a3c0, 0.6), { x: x - 0.49 + i * 0.14, y: 0.53, z: 0.42, rx: 0.35, r: 0.01 });
      box(0.26, 0.42, 0.03, wood, { x, y: 0.21, z: 0.335, r: 0.012 });
      ball(0.018, mat(0xf3cb62, 0.3), { x: x + 0.08, y: 0.2, z: 0.355 });
      [-0.34, 0.34].forEach((dx) => { box(0.24, 0.24, 0.02, windowM, { x: x + dx, y: 0.28, z: 0.335, r: 0.01 }); box(0.28, 0.03, 0.05, white, { x: x + dx, y: 0.14, z: 0.345, r: 0.01 }); });
      box(0.16, 0.14, 0.14, mat(0x5b9bd0, 0.6), { x: x + 0.6, y: 0.07, z: 0.34, r: 0.02 });
      box(0.18, 0.025, 0.03, mat(0xffe08a, 0.5), { x: x + 0.6, y: 0.145, z: 0.34, r: 0.008 });
      box(0.12, 0.1, 0.12, mat(0xf7a8bd, 0.6), { x: x - 0.6, y: 0.05, z: 0.36, r: 0.02 });
    }
    // The hall of achievements.
    {
      const x = CELL;
      box(1.28, 0.08, 0.72, stoneD, { x, y: 0.04, r: 0.02 });
      box(1.18, 0.07, 0.62, stone, { x, y: 0.115, r: 0.02 });
      box(1.0, 0.56, 0.36, cream, { x, y: 0.42, z: -0.08, r: 0.01 });
      [-0.48, -0.16, 0.16, 0.48].forEach((dx) => { cyl(0.05, 0.058, 0.56, white, { x: x + dx, y: 0.43, z: 0.22 }); box(0.13, 0.03, 0.13, white, { x: x + dx, y: 0.72, z: 0.22, r: 0.008 }); });
      box(1.2, 0.08, 0.66, white, { x, y: 0.77, z: 0.02, r: 0.018 });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.32, 4).rotateY(Math.PI / 4), mat(SEA, 0.55));
      roof.position.set(x, 0.97, 0.02); roof.scale.set(1.08, 1, 0.6); scene.add(roof);
      box(0.2, 0.32, 0.02, wood, { x, y: 0.31, z: 0.105, r: 0.01 });
      ball(0.055, mat(0xf3cb62, 0.28), { x, y: 1.17 });
    }
    return flatCamera(CELL * 3, W, H, from(0, 0.56), [0, 0.56, 0]);
  }
  if (part === 'houses') {
    const CELL = 1.2, roofs = [0xe99485, 0xf3c668, 0x8fb2e8, 0xb49be6, 0x82c28e, 0xc9d3dc];
    roofs.forEach((color, i) => {
      const x = (i - 2.5) * CELL, empty = i === 5;
      if (empty) {
        // A plot still waiting: a low fence and a little sign.
        box(0.9, 0.04, 0.6, mat(0xb7d99c, 0.9), { x, y: 0.02, r: 0.015 });
        for (let j = 0; j < 7; j++) box(0.035, 0.17, 0.03, white, { x: x - 0.42 + j * 0.14, y: 0.11, z: 0.3, r: 0.01 });
        box(0.92, 0.03, 0.02, white, { x, y: 0.13, z: 0.285, r: 0.008 });
        cyl(0.018, 0.018, 0.34, wood, { x, y: 0.2, z: -0.05 });
        box(0.36, 0.2, 0.03, cream, { x, y: 0.36, z: -0.03, r: 0.012 });
        return;
      }
      box(0.82, 0.54, 0.62, white, { x, y: 0.27, r: 0.025 });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.73, 0.4, 4).rotateY(Math.PI / 4), mat(color, 0.62));
      roof.position.set(x, 0.72, 0); roof.scale.set(1, 1, 0.82); scene.add(roof);
      box(0.1, 0.2, 0.1, mat(0xe3cba8, 0.7), { x: x + 0.24, y: 0.82, z: -0.06, r: 0.015 });
      box(0.18, 0.32, 0.025, wood, { x, y: 0.16, z: 0.315, r: 0.012 });
      ball(0.014, mat(0xf3cb62, 0.3), { x: x + 0.055, y: 0.16, z: 0.332 });
      [-0.26, 0.26].forEach((dx) => {
        box(0.17, 0.17, 0.018, windowM, { x: x + dx, y: 0.32, z: 0.315, r: 0.008 });
        box(0.2, 0.03, 0.05, cream, { x: x + dx, y: 0.215, z: 0.33, r: 0.008 });
        for (let j = 0; j < 4; j++) ball(0.018, mat([0xf7a8bd, 0xffe08a][j % 2], 0.6), { x: x + dx - 0.06 + j * 0.04, y: 0.24, z: 0.335 });
      });
    });
    return flatCamera(CELL * 6, W, H, from(0, 0.5), [0, 0.5, 0]);
  }
  // One paper lantern on its thread.
  {
    const red = night ? glow(0xff9a70, 1.6) : mat(0xef7f68, 0.6);
    cyl(0.006, 0.006, 0.2, mat(0x8e5a34, 0.7), { y: 0.72 });
    cyl(0.05, 0.05, 0.03, mat(0xf3cb62, 0.4), { y: 0.6 });
    ball(0.16, red, { y: 0.44, sy: 1.1 });
    cyl(0.05, 0.05, 0.03, mat(0xf3cb62, 0.4), { y: 0.26 });
    cyl(0.005, 0.009, 0.1, mat(0xf3cb62, 0.5), { y: 0.2 });
    return flatCamera(0.5, W, H, [0, 0.46, 8], [0, 0.46, 0]);
  }
}
