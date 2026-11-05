// What the two study rooms share: a camera that knows the app's canvas, planks and tiles, a curtained window, a bookcase, plants.
import { kit } from './kit.js';
export function studyKit(THREE, scene) {
  const K = kit(THREE, scene);
  const { mat, box, ball, cyl, lathe, leaf } = K;
  let seed = 41;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
  /** A group for one thing in the room; `mask=<name>` in the query keeps only it white. */
  const part = (name, parent = scene) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
  /** A perspective camera over a canvas of `cw` x `ch` units; picks points on planes by canvas coordinates. */
  const canvasCamera = (cw, ch, from, to, fov) => {
    const cam = new THREE.PerspectiveCamera(fov, cw / ch, 0.1, 200);
    cam.position.set(...from); cam.lookAt(...to); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const at = (cx, cy, plane) => {
      ray.setFromCamera(new THREE.Vector2(cx / cw * 2 - 1, 1 - cy / ch * 2), cam);
      const p = new THREE.Vector3(); ray.ray.intersectPlane(plane, p); return p;
    };
    return { cam, floorAt: (cx, cy, y = 0) => at(cx, cy, new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)), wallAt: (cx, cy, z = 0) => at(cx, cy, new THREE.Plane(new THREE.Vector3(0, 0, 1), -z)),
      project: (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cam); return [+((v.x + 1) / 2 * cw).toFixed(1), +((1 - v.y) / 2 * ch).toFixed(1)]; } };
  };
  /** Takes the part of the picture asked for in the query: `vw vh ox oy`, in pixels of a band `fw` x `fh`. */
  const view = (cam, q, fw, fh) => { cam.setViewOffset(fw, fh, +(q.get('ox') || 0), +(q.get('oy') || 0), +(q.get('vw') || fw), +(q.get('vh') || fh)); cam.updateMatrixWorld(true); };
  /** Keeps only what the query names: `show=a,b` (groups kept, others gone), `mask=a,b` (white in a mask pass, others black). */
  const select = (q, groups) => {
    const show = q.get('show');
    if (show != null) { const keep = show.split(',').filter(Boolean); Object.entries(groups).forEach(([n, g]) => { if (!keep.includes(n)) g.removeFromParent(); }); }
    const mask = q.get('mask');
    if (mask) { const names = mask.split(','); scene.traverse((o) => { if (!o.isMesh) return; let hit = false; for (let p = o; p; p = p.parent) if (names.includes(p.name)) hit = true; o.userData.noMask = !hit; }); }
  };
  const planks = (parent, x0, x1, z0, z1, base = 0xc4c4c4) => {
    const w = 0.36;
    for (let x = x0; x < x1; x += w) {
      let z = z0 - rnd() * 1.4;
      while (z < z1) {
        const len = 1.5 + rnd() * 1.8, v = 0.88 + rnd() * 0.2, c = new THREE.Color(base).multiplyScalar(v);
        box(w - 0.012, 0.05, len - 0.012, mat(c.getHex(), 0.5), { x: x + w / 2, y: -0.025, z: z + len / 2, r: 0.012, parent });
        z += len;
      }
    }
    box(x1 - x0 + 2, 0.02, z1 - z0 + 3, mat(0x8a8a8a, 0.9), { x: (x0 + x1) / 2, y: -0.06, z: (z0 + z1) / 2, parent });
  };
  const tiles = (parent, x0, x1, z0, z1, base = 0xd8d8d8) => {
    const s = 0.72;
    for (let x = x0; x < x1; x += s) for (let z = z0; z < z1; z += s) {
      const c = new THREE.Color(base).multiplyScalar(0.96 + rnd() * 0.06);
      box(s - 0.022, 0.05, s - 0.022, mat(c.getHex(), 0.34), { x: x + s / 2, y: -0.025, z: z + s / 2, r: 0.016, parent });
    }
    box(x1 - x0 + 2, 0.02, z1 - z0 + 3, mat(0x8a8a8a, 0.9), { x: (x0 + x1) / 2, y: -0.06, z: (z0 + z1) / 2, parent });
  };
  /** Cloth hanging from y = top, width w, height h, from its outer end at x (`side` -1: the left curtain), gathered at a tie. */
  const curtain = (parent, x, top, z, w, h, color, side, folds = 5) => {
    const g = new THREE.PlaneGeometry(1, 1, 90, 60), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = 0.5 - p.getY(i);
      const gather = Math.exp(-Math.pow((v - 0.62) / 0.2, 2));
      const span = w * (1 - gather * 0.52);
      const wave = Math.sin(u * folds * Math.PI * 2 + v * 0.6) * (0.035 + 0.03 * gather) + Math.sin(u * folds * Math.PI * 4.3) * 0.008;
      p.setXYZ(i, -side * u * span, -v * h, wave + 0.07);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(color, 0.86, { side: THREE.DoubleSide }));
    m.position.set(x, top, z); parent.add(m);
    return m;
  };
  /** An arched window in the XY plane, its glass from x ± r, between y0 and y1 (the arch's crown). The glass is empty: the app draws the sky. */
  const archWindow = (parent, cx, y0, y1, r, z, wood, sill) => {
    const t = 0.1, top = y1 - r;
    const outer = new THREE.Shape(); outer.moveTo(-r - t, y0 - t); outer.lineTo(r + t, y0 - t); outer.lineTo(r + t, top); outer.absarc(0, top, r + t, 0, Math.PI, false); outer.lineTo(-r - t, y0 - t);
    const inner = new THREE.Path(); inner.moveTo(-r, y0); inner.lineTo(-r, top); inner.absarc(0, top, r, Math.PI, 0, true); inner.lineTo(r, y0); inner.lineTo(-r, y0); outer.holes.push(inner);
    const f = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.09, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 30 }), wood);
    f.position.set(cx, 0, z); parent.add(f);
    box(0.035, y1 - y0, 0.04, wood, { x: cx, y: (y0 + y1) / 2, z: z + 0.05, r: 0.01, parent });
    box(2 * r, 0.035, 0.04, wood, { x: cx, y: top, z: z + 0.05, r: 0.01, parent });
    box(2 * r, 0.03, 0.04, wood, { x: cx, y: (y0 + top) / 2, z: z + 0.05, r: 0.01, parent });
    box(2 * r + 0.42, 0.06, 0.26, sill, { x: cx, y: y0 - 0.13, z: z + 0.12, r: 0.02, parent });
  };
  const BOOKS = [0xd9838d, 0x7aa6d8, 0xe9c46a, 0x8fc1a9, 0xb79bdc, 0xf2a98f, 0x6fb7c4, 0xeee2cf, 0x8a9bd4];
  const rowOfBooks = (parent, x0, x1, y, z, depth, hMax) => {
    let x = x0;
    while (x < x1 - 0.05) {
      const w = 0.035 + rnd() * 0.05, h = hMax * (0.72 + rnd() * 0.28), lean = rnd() < 0.12 ? (rnd() - 0.5) * 0.14 : 0;
      if (rnd() < 0.09) { x += 0.05 + rnd() * 0.05; continue; }
      box(w, h, depth * (0.8 + rnd() * 0.2), mat(BOOKS[Math.floor(rnd() * BOOKS.length)], 0.66), { x: x + w / 2, y: y + h / 2, z, rz: lean, r: 0.008, parent });
      x += w + 0.004;
    }
  };
  const bookcase = (parent, x, z, w, h, d, wood, back, rows = 4) => {
    const t = 0.04;
    box(t, h, d, wood, { x: x - w / 2 + t / 2, y: h / 2, z, r: 0.012, parent }); box(t, h, d, wood, { x: x + w / 2 - t / 2, y: h / 2, z, r: 0.012, parent });
    box(w, h, 0.012, back, { x, y: h / 2, z: z - d / 2 + 0.02, parent });
    box(w + 0.03, t, d + 0.03, wood, { x, y: h - t / 2, z, r: 0.012, parent });
    const step = (h - 0.1) / rows;
    for (let i = 0; i < rows; i++) {
      const y = 0.08 + i * step;
      box(w - t, 0.032, d - 0.02, wood, { x, y, z, r: 0.008, parent });
      rowOfBooks(parent, x - w / 2 + t + 0.01, x + w / 2 - t - (i % 2 ? 0.16 : 0.01), y + 0.016, z + 0.02, d * 0.72, step * 0.8);
    }
    box(w + 0.03, 0.07, d + 0.02, wood, { x, y: 0.035, z, r: 0.012, parent });
  };
  const pot = (parent, x, y, z, r, h, color, soil = 0x5a4332) => {
    lathe([[0.001, 0], [r * 0.72, 0], [r, h * 0.92], [r * 1.06, h * 0.94], [r * 1.06, h], [r * 0.9, h], [r * 0.84, h * 0.86], [0.001, h * 0.86]], mat(color, 0.62), { x, y, z, parent });
    cyl(r * 0.84, r * 0.84, 0.01, mat(soil, 0.95), { x, y: y + h * 0.87, z, parent });
  };
  const GREENS = [0x5fa45b, 0x4f9455, 0x74b768, 0x3f8450];
  /** A big-leaved plant: stems and wide leaves from (x, y, z), `size` high. */
  const bigLeaves = (parent, x, y, z, size, count = 9) => {
    for (let i = 0; i < count; i++) {
      const a = -1.3 + (2.6 * i) / (count - 1) + (rnd() - 0.5) * 0.14, l = size * (0.62 + rnd() * 0.3), m = mat(GREENS[i % 4], 0.5);
      const ex = x + Math.sin(a) * l * 0.42, ey = y + Math.cos(a) * l * 0.62, ez = z + (rnd() - 0.4) * 0.22;
      const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y, z), new THREE.Vector3(x + Math.sin(a) * l * 0.12, y + l * 0.34, z), new THREE.Vector3(ex, ey, ez)]);
      parent.add(new THREE.Mesh(new THREE.TubeGeometry(stem, 14, 0.012 * size + 0.006, 8), mat(0x6c9c58, 0.6)));
      leaf(size * 0.44, size * 0.135, m, { x: ex, y: ey, z: ez, rz: -a * 1.15, rx: 0.3 + (rnd() - 0.5) * 0.5, parent });
    }
  };
  /** A small plant in a pot, leaves falling over its rim. */
  const smallPlant = (parent, x, y, z, s, color) => {
    pot(parent, x, y, z, 0.085 * s, 0.13 * s, color);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, m = mat(GREENS[i % 4], 0.52);
      leaf(0.17 * s, 0.05 * s, m, { x, y: y + 0.12 * s, z, rz: Math.cos(a) * (0.5 + (i % 3) * 0.32), rx: Math.sin(a) * (0.5 + (i % 3) * 0.32), parent });
    }
  };
  /** A stack of flat books. */
  const stack = (parent, x, y, z, w, colors, step = 0.052) => colors.forEach((c, i) => {
    const ry = (i % 2 ? 1 : -1) * 0.09, dx = i % 2 ? 0.012 : -0.01;
    box(w * (1 - i * 0.05), step - 0.004, w * 0.72, mat(c, 0.64), { x: x + dx, y: y + step * i + step / 2, z, ry, r: 0.01, parent });
    box(w * (1 - i * 0.05) - 0.02, step * 0.62, w * 0.72 + 0.004, mat(0xfff6e4, 0.8), { x: x + dx + 0.004, y: y + step * i + step / 2, z, ry, r: 0.004, parent });
  });
  return { ...K, rnd, part, canvasCamera, view, select, planks, tiles, curtain, archWindow, rowOfBooks, bookcase, pot, bigLeaves, smallPlant, stack };
}
