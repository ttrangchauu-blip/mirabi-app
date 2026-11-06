// One species of Vườn tài chính in a row, stage 0 to 5, cut apart afterwards. `&plant=` names the species; `&plant=can` is the watering can.
import { kit } from './kit.js';
const TONES = {
  sakura: { deep: 0x5f9c6f, mid: 0x7cba8a, light: 0xa9d9ae, bloom: 0xfbbfd3, bloomDeep: 0xef93b3 },
  oak: { deep: 0x3a8152, mid: 0x55a568, light: 0x86c98b, bloom: 0xd9a25e, bloomDeep: 0xa8703a },
  sunflower: { deep: 0x46904a, mid: 0x68b05a, light: 0x9cd07e, bloom: 0xfbd148, bloomDeep: 0xf0a92a },
  bamboo: { deep: 0x5c9a44, mid: 0x86be5b, light: 0xc4e28f, bloom: 0xe5f4be, bloomDeep: 0xa9cf74 },
  maple: { deep: 0xc2502f, mid: 0xe2744c, light: 0xf6a56f, bloom: 0xf7bc5f, bloomDeep: 0xd98530 },
  lotus: { deep: 0x2f8a7c, mid: 0x4fb3a1, light: 0x94d9c6, bloom: 0xf9b4ce, bloomDeep: 0xe276a2 },
};
const CELL = 1.2;
export async function build({ THREE, scene, W, H }) {
  const k = kit(THREE, scene);
  const { mat, box, ball, cyl, cone, lathe, torus, leaf, daylight, flatCamera } = k;
  const q = new URLSearchParams(location.search);
  const plant = q.get('plant') || 'sakura';
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
  daylight({ dir: [-0.55, 0.8, 0.8], sun: 12, power: 0.7, size: 18 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(0xe9e2d2, 0.95));
  floor.rotation.x = -Math.PI / 2; floor.userData.noMask = true; scene.add(floor);

  if (plant === 'can') {
    const blue = mat(0x5fb0cc, 0.42), deep = mat(0x3e8fac, 0.45);
    lathe([[0.001, 0], [0.21, 0], [0.235, 0.03], [0.235, 0.36], [0.2, 0.42], [0.19, 0.42], [0.001, 0.4]], blue, { y: 0.02 });
    torus(0.15, 0.022, deep, { y: 0.47, rx: 0, rz: 0, z: 0 });
    torus(0.14, 0.024, deep, { x: 0.25, y: 0.22, ry: 0, rz: 0, sx: 0.8 });
    const spout = cyl(0.045, 0.075, 0.46, deep, { x: -0.36, y: 0.33, rz: 0.95 });
    spout.position.z = 0.02;
    lathe([[0.001, 0.04], [0.09, 0.0], [0.1, -0.015], [0.03, 0.05]], blue, { x: -0.565, y: 0.48, rz: 0.95 });
    return flatCamera(1.4, W, H, [0, 1.0, 5], [0, 0.26, 0]);
  }

  const c = TONES[plant];
  const toM = (x) => mat(x, 0.62);
  const deep = toM(c.deep), mid = toM(c.mid), lite = toM(c.light), bloom = toM(c.bloom), bloomDeep = toM(c.bloomDeep);
  const bark = mat(0x8a5e3a, 0.8), barkD = mat(0x6e4a2c, 0.85);
  const soilM = mat(0x8a5a35, 0.95), soilT = mat(0xa16f47, 0.95);

  const soil = (x) => {
    ball(0.33, soilM, { x, y: 0.02, sy: 0.3, sz: 0.62 });
    ball(0.25, soilT, { x: x - 0.04, y: 0.055, z: 0.02, sy: 0.25, sz: 0.55 });
  };
  const sprout = (x, h, leaves, size) => {
    cyl(0.012, 0.016, h, deep, { x, y: 0.09 + h / 2 });
    for (let i = 0; i < leaves; i++) {
      const up = 0.09 + h * (i < 2 ? 1 : 0.62), s = i % 2 ? 1 : -1;
      leaf(size * (i < 2 ? 1 : 0.8), size * 0.34, i % 2 ? mid : lite, { x, y: up, z: 0.01, rz: -s * (1.05 + (i >> 1) * 0.1), rx: 0.2 });
    }
  };
  const crown = (x, y, r, count, tones, spread = 1) => {
    for (let i = 0; i < count; i++) {
      const a = i * 2.4, t = i / Math.max(1, count - 1), u = Math.sqrt(t);
      const rr = r * (0.3 + rnd() * 0.12);
      ball(rr, tones[i % tones.length], { x: x + Math.cos(a) * r * 0.86 * u * spread, y: y + (0.5 - t) * r * 1.3 * (1 - u * 0.25) + (rnd() - 0.5) * r * 0.1, z: Math.sin(a) * r * 0.62 * u + 0.05 });
    }
  };
  const trunk = (x, h) => {
    cyl(0.038, 0.062, h, bark, { x, y: 0.08 + h / 2 });
    cyl(0.018, 0.03, h * 0.5, barkD, { x: x - 0.06, y: 0.08 + h * 0.74, rz: 0.62 });
    cyl(0.018, 0.03, h * 0.5, barkD, { x: x + 0.06, y: 0.08 + h * 0.78, rz: -0.62 });
  };
  const dots = (x, y, r, n, ms, size) => {
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + 0.4, u = Math.sqrt((i + 0.5) / n);
      ball(size * (0.85 + rnd() * 0.3), ms[i % ms.length], { x: x + Math.cos(a) * r * u, y: y + Math.sin(a) * r * u * 0.8, z: r * 0.62 * Math.sqrt(Math.max(0.05, 1 - u * u)) + 0.08 });
    }
  };

  const tree = (x, s) => {
    const h = [0, 0, 0, 0.42, 0.56, 0.62][s], r = [0, 0, 0, 0.22, 0.31, 0.38][s], n = [0, 0, 0, 16, 30, 44][s];
    trunk(x, h);
    const y = 0.08 + h + r * 0.36;
    if (plant === 'sakura') {
      crown(x, y, r, n, s === 5 ? [bloom, bloomDeep, bloom] : s === 4 ? [mid, lite, bloom, mid] : [mid, lite, deep]);
      if (s >= 4) dots(x, y, r * 0.95, s === 5 ? 24 : 16, [mat(0xffe2ec, 0.6), bloomDeep], 0.024);
    } else if (plant === 'maple') {
      crown(x, y, r, n, s === 3 ? [mid, lite, deep] : [mid, lite, deep, bloom]);
    } else {
      crown(x, y, r, n, [mid, deep, lite, mid]);
      if (s >= 4) dots(x, y, r * 0.9, s === 5 ? 12 : 6, [bloom], 0.03);
    }
  };
  const sunflower = (x, s) => {
    const h = [0, 0, 0, 0.5, 0.7, 0.88][s], head = [0, 0, 0, 0.055, 0.1, 0.15][s], top = 0.08 + h;
    cyl(0.018, 0.026, h, deep, { x, y: 0.08 + h / 2 });
    const count = s >= 4 ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const sd = i % 2 ? 1 : -1;
      leaf(0.26 - i * 0.02, 0.09, i % 2 ? mid : lite, { x, y: 0.2 + i * h * 0.2, z: 0.02, rz: -sd * 1.2, rx: 0.3 });
    }
    const head3 = new THREE.Group(); head3.position.set(x, top, 0.04); head3.rotation.x = -0.28; scene.add(head3);
    const petals = s >= 4 ? 14 : 8;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      leaf(head * 1.1, head * 0.34, i % 2 ? bloom : bloomDeep, { parent: head3, x: Math.cos(a) * head * 0.5, y: Math.sin(a) * head * 0.5, rz: a - Math.PI / 2 });
    }
    const disc = ball(head * 0.62, mat(0x6b4221, 0.8), { parent: head3, sz: 0.4, z: 0.01 });
    ball(head * 0.3, mat(0x8c5e30, 0.8), { parent: head3, sz: 0.3, z: head * 0.2, x: -head * 0.08, y: head * 0.08 });
    return disc;
  };
  const bamboo = (x, s) => {
    const stems = s === 3 ? [[0, 0.55]] : s === 4 ? [[-0.09, 0.56], [0.08, 0.76]] : [[-0.15, 0.62], [0, 0.94], [0.15, 0.74]];
    stems.forEach(([dx, h], j) => {
      const segs = Math.round(h / 0.14);
      for (let i = 0; i < segs; i++) {
        const seg = h / segs;
        cyl(0.026, 0.028, seg - 0.012, j === 1 ? mid : lite, { x: x + dx, y: 0.07 + seg * (i + 0.5), z: j * 0.01 });
        cyl(0.032, 0.032, 0.012, deep, { x: x + dx, y: 0.07 + seg * (i + 1), z: j * 0.01 });
      }
      const top = 0.07 + h;
      [[-1, 0], [1, -0.1], [-1, -0.2], [1, -0.28], [-1, -0.4]].slice(0, h > 0.7 ? 5 : 3).forEach(([sd, off], i) => {
        leaf(0.2, 0.05, i % 2 ? mid : lite, { x: x + dx, y: top + off, z: 0.03, rz: -sd * (1.1 + i * 0.06), rx: 0.2 });
      });
    });
  };
  const lotus = (x, s) => {
    lathe([[0.001, 0], [0.42, 0], [0.47, 0.045], [0.45, 0.075], [0.4, 0.05], [0.001, 0.05]], mat(0xa39078, 0.9), { x });
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.012, 48), mat(0x6fc6d6, 0.16));
    water.position.set(x, 0.058, 0); scene.add(water);
    const pad = (dx, dz, r) => { cyl(r, r, 0.012, mid, { x: x + dx, y: 0.072, z: dz }); cyl(r * 0.8, r * 0.8, 0.003, lite, { x: x + dx, y: 0.08, z: dz }); };
    pad(-0.22, 0.14, 0.1);
    if (s >= 1) pad(0.24, 0.1, 0.085);
    if (s >= 2) pad(0.08, 0.24, 0.07);
    if (s >= 3) {
      const h = s === 3 ? 0.2 : s === 4 ? 0.3 : 0.28;
      cyl(0.012, 0.014, h, deep, { x, y: 0.06 + h / 2 });
      if (s < 5) {
        const bud = s === 3 ? 0.08 : 0.12;
        leaf(bud * 1.8, bud * 0.72, bloomDeep, { x, y: 0.05 + h, z: 0 });
        leaf(bud * 1.6, bud * 0.6, bloom, { x: x - bud * 0.25, y: 0.05 + h, z: 0.02, rz: 0.22 });
        leaf(bud * 1.6, bud * 0.6, bloom, { x: x + bud * 0.25, y: 0.05 + h, z: 0.02, rz: -0.22 });
      } else {
        const ly = 0.06 + h;
        [[0, 0.34, bloomDeep, 1.3], [1, 0.3, bloomDeep, 0.85], [2, 0.26, bloom, 0.42]].forEach(([, len, m, lean]) => {
          const n = 9;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + lean;
            leaf(len, 0.075, m, { x: x + Math.cos(a) * 0.015, y: ly, z: Math.sin(a) * 0.015, rz: Math.cos(a) * lean, rx: Math.sin(a) * lean });
          }
        });
        ball(0.036, mat(0xf8d66b, 0.6), { x, y: ly + 0.1, z: 0.01, sy: 0.7 });
      }
    }
  };

  for (let s = 0; s <= 5; s++) {
    const x = (s - 2.5) * CELL;
    if (plant === 'lotus') { lotus(x, s); continue; }
    soil(x);
    if (s === 0) {
      ball(0.05, mat(0xc99c6a, 0.7), { x, y: 0.105, z: 0.13, sy: 0.72 });
      cyl(0.007, 0.01, 0.05, mid, { x: x + 0.005, y: 0.15, z: 0.13, rz: -0.25 });
      leaf(0.05, 0.02, lite, { x: x + 0.01, y: 0.17, z: 0.13, rz: -0.9 });
    } else if (s === 1) sprout(x, 0.16, 2, 0.17);
    else if (s === 2) sprout(x, 0.32, 4, 0.22);
    else if (plant === 'sunflower') sunflower(x, s);
    else if (plant === 'bamboo') bamboo(x, s);
    else tree(x, s);
  }
  // The picture is `6 × CELL` wide and the ground sits low in each cell, as in the viewBox of 120 by 140.
  const camHeight = CELL * 6 * H / W;
  return flatCamera(CELL * 6, W, H, [0, camHeight * 0.42 + 1.0, 5], [0, camHeight * 0.42, 0]);
}
