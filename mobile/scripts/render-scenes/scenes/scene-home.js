// Nhà của Pet (Phòng cá nhân). One camera over the room's 420 x 770 canvas (room-art.json, `rooms.personal`), so a patch of the
// picture can be drawn wherever an item is placed: the back wall is the canvas plane from y 160 to 440, the floor runs from there
// to the front at 770, and it all goes on over the canvas's bleed. The room is a cutaway: the wall ends in a cap just above the
// content, so its thickness shows, and the floor ends in a slab a little past the front. Items are modelled in canvas units
// around their anchor and scaled into the room, so each looks as large as its catalog box says.
// `show=a,b` keeps some items, `mask=a,b` makes a cut-out, `floor=tile` swaps the floor, `v=item:variant,...` picks colours,
// `at=item:x:y,...` moves an item's anchor (canvas units).
import { studyKit } from './study-kit.js';
import { more } from './home-more.js';
export async function build({ THREE, scene }) {
  const q = new URLSearchParams(location.search);
  const ART = await (await fetch('/room-art.json')).json();
  const K = studyKit(THREE, scene);
  const { mat, glow, box, ball, cyl, lathe, torus, leaf, part, canvasCamera, view, select, rnd } = K;
  /** Planks, cut to the room: none hangs past its sides or its front. */
  const planks = (parent, x0, x1, z0, z1, base = 0xc4c4c4) => {
    const w = 0.3;
    for (let x = x0; x < x1 - 0.01; x += w) {
      const pw = Math.min(w, x1 - x); let z = z0 - rnd() * 1.4;
      while (z < z1) {
        const len = 1.4 + rnd() * 1.6, a = Math.max(z, z0 - 0.2), b = Math.min(z + len, z1), v = 0.88 + rnd() * 0.2;
        if (b - a > 0.05) box(pw - 0.01, 0.05, b - a - 0.01, mat(new THREE.Color(base).multiplyScalar(v).getHex(), 0.5), { x: x + pw / 2, y: -0.025, z: (a + b) / 2, r: 0.01, parent });
        z += len;
      }
    }
  };
  const tiles = (parent, x0, x1, z0, z1, base = 0xd8d8d8) => {
    const s = 0.5;
    for (let x = x0; x < x1 - 0.01; x += s) for (let z = z0 - 0.2; z < z1 - 0.01; z += s) {
      const w = Math.min(s, x1 - x), d = Math.min(s, z1 - z);
      box(w - 0.016, 0.05, d - 0.016, mat(new THREE.Color(base).multiplyScalar(0.96 + rnd() * 0.06).getHex(), 0.34), { x: x + w / 2, y: -0.025, z: z + d / 2, r: 0.012, parent });
    }
  };
  /** Cloth from y = top down h (units), w wide from its outer end at x, gathered at a tie; folds `fold` units deep. */
  const curtain = (parent, x, top, z, w, h, color, side, folds = 5, fold = 3.2) => {
    const g = new THREE.PlaneGeometry(1, 1, 90, 60), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = 0.5 - p.getY(i), gather = Math.exp(-Math.pow((v - 0.62) / 0.2, 2)), span = w * (1 - gather * 0.52);
      const wave = Math.sin(u * folds * Math.PI * 2 + v * 0.6) * fold * (1 + 0.8 * gather) + Math.sin(u * folds * Math.PI * 4.3) * fold * 0.25;
      p.setXYZ(i, -side * u * span, -v * h, wave + fold * 2);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(color, 0.86, { side: THREE.DoubleSide }));
    m.position.set(x, top, z); parent.add(m); return m;
  };
  /** Big leaves on stems from (x, y, z), `size` units high. */
  const bigLeaves = (parent, x, y, z, size, count = 9) => {
    const GREENS = [0x5fa45b, 0x4f9455, 0x74b768, 0x3f8450];
    for (let i = 0; i < count; i++) {
      const a = -1.3 + (2.6 * i) / (count - 1) + (rnd() - 0.5) * 0.14, l = size * (0.62 + rnd() * 0.3);
      const ex = x + Math.sin(a) * l * 0.42, ey = y + Math.cos(a) * l * 0.62, ez = z + (rnd() - 0.45) * size * 0.3;
      const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y, z), new THREE.Vector3(x + Math.sin(a) * l * 0.12, y + l * 0.34, z), new THREE.Vector3(ex, ey, ez)]);
      parent.add(new THREE.Mesh(new THREE.TubeGeometry(stem, 14, size * 0.012, 8), mat(0x6c9c58, 0.6)));
      leaf(size * 0.44, size * 0.135, mat(GREENS[i % 4], 0.5), { x: ex, y: ey, z: ez, rz: -a * 1.15, rx: 0.3 + (rnd() - 0.5) * 0.5, parent });
    }
  };
  K.sky({ top: 0xf4f6fb, mid: 0xf8f4ee, low: 0xe4dcd0, power: 0.6, sun: { dir: [-0.5, 0.86, 0.55], size: 9, power: 58, color: 0xfff0d6 } });

  // ------------------------------------------------------------------ the camera: the wall's foot exactly on canvas y 440
  const PITCH = 34 * Math.PI / 180, FOV = 10, DIST = 40;
  let lo = -20, hi = 20, C = null;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    C = canvasCamera(420, 770, [0, Math.sin(PITCH) * DIST, m + Math.cos(PITCH) * DIST], [0, 0, m], FOV);
    if (C.project(0, 0, 0)[1] < 440) hi = m; else lo = m;
  }
  const { cam, floorAt, wallAt, project } = C;
  const raw = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cam); return [(v.x + 1) / 2 * 420, (1 - v.y) / 2 * 770]; };
  /** Metres per canvas unit at a row of the floor: across, and up for something standing there. */
  const UX = (cy) => Math.abs(floorAt(220, cy).x - floorAt(200, cy).x) / 20;
  const UY = (cy) => { const b = floorAt(210, cy); return 1 / (raw(b.x, 0, b.z)[1] - raw(b.x, 1, b.z)[1]); };
  /** The same on the back wall. */
  const WX = Math.abs(wallAt(220, 300).x - wallAt(200, 300).x) / 20, WY = Math.abs(wallAt(210, 290).y - wallAt(210, 310).y) / 20;
  /** The height (metres) of a flat top whose middle, `depth` metres deep behind an item's front at (cx, cy), shows at canvas y `ty`. */
  const solveTop = (cx, cy, ty, depth, back = 0) => {
    const want = floorAt(cx, cy).z - back - depth / 2;
    let a = 0, b = 4;
    for (let i = 0; i < 50; i++) { const h = (a + b) / 2; if (floorAt(cx, ty, h).z < want) a = h; else b = h; }
    return (a + b) / 2;
  };

  // ------------------------------------------------------------------ colours
  const DEFAULTS = Object.fromEntries(ART.defaults.personal.items.map((p) => [p.item, p.variant]));
  const asked = Object.fromEntries((q.get('v') || '').split(',').filter(Boolean).map((s) => s.split(':')));
  const colours = (id) => {
    const vs = ART.items[id].variants, want = asked[id] ?? DEFAULTS[id] ?? vs[0].id;
    const v = vs.find((x) => x.id === want) ?? vs[0];
    return Object.fromEntries(Object.entries(v.colors).map(([k, c]) => [k, typeof c === 'string' && c.startsWith('#') ? parseInt(c.slice(1), 16) : c]));
  };
  const M = (c, r = 0.7, extra) => mat(c, r, extra);

  // ------------------------------------------------------------------ the room itself
  const paintM = M(0xe9e9e9, 0.9), trim = M(0xfbf8f2, 0.5), capM = M(0xf3eee6, 0.7), slabM = M(0xe8dccb, 0.75);
  const paint = part('paint'), shell = part('shell'), floor = part('floor');
  const xL = wallAt(-2, 440).x, xR = wallAt(422, 440).x, wallH = wallAt(210, 150).y, T = 0.16;
  const zFront = floorAt(210, 806).z, wide = xR - xL;
  // The back wall with its cap: the room is open at the top, the sides and the front, like a stage (no side wall's shadow on the room).
  box(wide + 2 * T, wallH, T, paintM, { x: (xL + xR) / 2, y: wallH / 2, z: -T / 2, r: 0.004, parent: paint });
  box(wide + 2 * T + 0.02, 0.05, T + 0.02, capM, { x: (xL + xR) / 2, y: wallH + 0.025, z: -T / 2, r: 0.012, parent: shell });
  // Trim: a crown under the cap, a chair rail with panels under it, a skirting board.
  box(wide, 0.07, 0.05, trim, { x: (xL + xR) / 2, y: wallH - 0.035, z: 0.025, r: 0.016, parent: shell });
  box(wide, 0.035, 0.035, trim, { x: (xL + xR) / 2, y: wallH - 0.1, z: 0.018, r: 0.01, parent: shell });
  const wallId = q.get('wallid'), floorId = q.get('floorid');
  if (!wallId) {
    // The room the items are rendered in: plain paint, white trim (their shadows are measured against it).
    const rail = 0.92;
    box(wide, 0.06, 0.05, trim, { x: (xL + xR) / 2, y: rail, z: 0.025, r: 0.018, parent: shell });
    box(wide, 0.11, 0.03, trim, { x: (xL + xR) / 2, y: 0.055, z: 0.015, r: 0.01, parent: shell });
    const nPanels = 6, gap = 0.1, pw = (wide - gap * (nPanels + 1)) / nPanels;
    for (let i = 0; i < nPanels; i++) {
      const cx = xL + gap + pw / 2 + i * (pw + gap), y0 = 0.2, y1 = rail - 0.1, h = y1 - y0;
      for (const [w, hh, dx, dy] of [[pw, 0.022, 0, h / 2], [pw, 0.022, 0, -h / 2], [0.022, h, pw / 2, 0], [0.022, h, -pw / 2, 0]])
        box(w, hh, 0.018, paintM, { x: cx + dx, y: y0 + h / 2 + dy, z: 0.009, r: 0.006, parent: paint });
    }
  } else {
    // A wallpaper of the catalog: its own 2D pattern (walltex/<id>.png, canvas x -120..540, y -240..440) laid on the wall by canvas
    // coordinates, so stripes, dots, hearts, checks and stars are exactly where the 2D room has them; its rail, panels and skirting
    // stand out of the wall where, and in the colours, the 2D drawing has them.
    const svg = ART.surfaces[wallId].svg, hexOf = (re) => parseInt((svg.match(re) ?? [0, '#cccccc'])[1].slice(1), 16);
    const railC = hexOf(/y='356' width='660' height='8' fill='(#[0-9A-Fa-f]{6})'/), skirtC = hexOf(/y='426' width='660' height='14' fill='(#[0-9A-Fa-f]{6})'/);
    const panelC = hexOf(/rx='4' fill='none' stroke='(#[0-9A-Fa-f]{6})'/);
    const map = await new THREE.TextureLoader().loadAsync(`/walltex/${wallId}.png`); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const extra = {};
    if (wallId === 'wall_night') { const em = await new THREE.TextureLoader().loadAsync('/walltex/wall_night-stars.png'); em.colorSpace = THREE.SRGBColorSpace; Object.assign(extra, { emissive: 0xfff3c4, emissiveMap: em, emissiveIntensity: 1.6 }); }
    const nx = 120, ny = 90, g = new THREE.PlaneGeometry(wide + 2 * T, wallH, nx, ny), pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const [cx, cy] = raw(pos.getX(i) + (xL + xR) / 2, pos.getY(i) + wallH / 2, 0.001);
      uv.setXY(i, (cx + 120) / 660, 1 - (cy + 240) / 680);
    }
    const plane = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, roughness: 0.9, ...extra }));
    plane.position.set((xL + xR) / 2, wallH / 2, 0.001); paint.add(plane);
    const yAt = (cy) => wallAt(210, cy).y;
    const band = (c0, c1, d, colour, r) => box(wide + 2 * T, yAt(c0) - yAt(c1), d, M(colour, 0.55), { x: (xL + xR) / 2, y: (yAt(c0) + yAt(c1)) / 2, z: d / 2, r, parent: shell });
    band(355, 365, 0.04, railC, 0.012);
    band(425, 440, 0.026, skirtC, 0.008);
    for (let i = 0; i < 7; i++) {
      const x0 = wallAt(-121 + 96 * i, 400).x, x1 = wallAt(-35 + 96 * i, 400).x, y0 = yAt(418), y1 = yAt(374), t = 0.016, w = x1 - x0, h = y1 - y0;
      for (const [bw, bh, dx, dy] of [[w, t, 0, h / 2], [w, t, 0, -h / 2], [t, h, w / 2, 0], [t, h, -w / 2, 0]])
        box(bw, bh, 0.014, M(panelC, 0.6), { x: (x0 + x1) / 2 + dx, y: (y0 + y1) / 2 + dy, z: 0.008, r: 0.005, parent: shell });
    }
  }
  // The floor, then its slab's front edge.
  if (floorId) {
    // A floor of the catalog in 3D: planks across the room, staggered and grained, or a checkerboard of glazed tiles, in its 2D colours.
    const svg = ART.surfaces[floorId].svg;
    const cols = [...new Set(svg.match(/#[0-9A-Fa-f]{6}/g))].filter((c) => !['#3B2618', '#FFFFFF'].includes(c.toUpperCase())).map((c) => parseInt(c.slice(1), 16));
    if (floorId.startsWith('floor_wood')) {
      const [c1, c2, seam] = cols;
      // Grain: soft streaks along a plank, in a texture the plank's colour tints.
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const x2 = cv.getContext('2d');
      x2.fillStyle = '#ffffff'; x2.fillRect(0, 0, 512, 64);
      for (let i = 0; i < 70; i++) { const y = rnd() * 64, a = 0.04 + rnd() * 0.07; x2.strokeStyle = `rgba(90,60,30,${a})`; x2.lineWidth = 0.6 + rnd() * 1.6; x2.beginPath(); x2.moveTo(0, y); for (let x = 0; x <= 512; x += 32) x2.lineTo(x, y + Math.sin(x / 60 + i) * 1.5); x2.stroke(); }
      for (let i = 0; i < 3; i++) { x2.fillStyle = 'rgba(110,70,35,0.10)'; x2.beginPath(); x2.ellipse(rnd() * 512, rnd() * 64, 14, 4, 0, 0, Math.PI * 2); x2.fill(); }
      const grain = new THREE.CanvasTexture(cv); grain.colorSpace = THREE.SRGBColorSpace;
      box(wide, 0.03, zFront + 0.2, M(seam, 0.8), { x: (xL + xR) / 2, y: -0.04, z: (zFront - 0.2) / 2, parent: floor });
      const rowD = 0.15;
      for (let z = -0.2; z < zFront - 0.005; z += rowD) {
        const d = Math.min(rowD, zFront - z); let x = xL - rnd() * 1.2;
        while (x < xR) {
          const len = 0.8 + rnd() * 0.9, a = Math.max(x, xL), b = Math.min(x + len, xR);
          if (b - a > 0.04) {
            const c = new THREE.Color(c1).lerp(new THREE.Color(c2), rnd()).multiplyScalar(0.95 + rnd() * 0.1);
            box(b - a - 0.006, 0.04, d - 0.006, new THREE.MeshStandardMaterial({ color: c, map: grain, roughness: 0.42 }), { x: (a + b) / 2, y: -0.02, z: z + d / 2, r: 0.004, parent: floor });
          }
          x += len;
        }
      }
    } else {
      const [c1, c2, grout] = cols, s = 0.42;
      box(wide, 0.03, zFront + 0.2, M(grout, 0.8), { x: (xL + xR) / 2, y: -0.04, z: (zFront - 0.2) / 2, parent: floor });
      for (let i = 0, x = xL; x < xR - 0.01; x += s, i++) for (let j = 0, z = -0.2; z < zFront - 0.01; z += s, j++) {
        const w = Math.min(s, xR - x), d = Math.min(s, zFront - z), c = new THREE.Color((i + j) % 2 ? c1 : c2).multiplyScalar(0.97 + rnd() * 0.05);
        box(w - 0.012, 0.04, d - 0.012, new THREE.MeshStandardMaterial({ color: c, roughness: 0.22 }), { x: x + w / 2, y: -0.02, z: z + d / 2, r: 0.01, parent: floor });
      }
    }
  } else if (q.get('floor') === 'tile') tiles(floor, xL, xR, 0, zFront); else planks(floor, xL, xR, 0, zFront);
  box(wide + 2 * T, 0.16, zFront + T, slabM, { x: (xL + xR) / 2, y: -0.135, z: (zFront - T) / 2, r: 0.02, parent: shell });
  box(wide + 2 * T + 0.01, 0.012, 0.012, trim, { x: (xL + xR) / 2, y: -0.052, z: zFront + 0.002, parent: shell });

  // ------------------------------------------------------------------ frames to model in canvas units
  const STAGE = {};
  for (const p of ART.defaults.personal.items) STAGE[p.item] = [p.x, p.y];
  // Items not in the starting room: where they are rendered (each alone, or on what they stand on).
  Object.assign(STAGE, {
    fairy_lights: [210, 190], cork_board: [110, 300], memo_board: [110, 300], wall_shelf: [300, 300],
    chair: [210, 560], toy_blocks: [210, 620], bookcase: [210, 520], floor_lamp: [210, 560], teddy_bear: [210, 620], plant_monstera: [210, 600],
    rug_stripes: [210, 640], rug_oval: [210, 640], desk_lamp: [90, 390], desk_plant: [60, 390],
  });
  for (const s of (q.get('at') || '').split(',').filter(Boolean)) { const [id, x, y] = s.split(':'); STAGE[id] = [+x, +y]; }
  const groups = {};
  const item = (name) => (groups[name] = part(name));
  /** A group for a thing standing on the floor, in canvas units: x across, y up, z towards the camera (its front at 0). */
  const onFloor = (g, [cx, cy], h = 0) => {
    const at = floorAt(cx, cy, h), u = new THREE.Group();
    u.position.copy(at); u.scale.set(UX(cy), UY(cy), UX(cy)); g.add(u); return u;
  };
  /** A group for a thing on the back wall, in canvas units: x across, y up, z out of the wall. */
  const onWall = (g, [cx, cy]) => {
    const at = wallAt(cx, cy), u = new THREE.Group();
    u.position.set(at.x, at.y, 0); u.scale.set(WX, WY, WX); g.add(u); return u;
  };
  const tube = (pts, r, m, parent, seg = 40) => { const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))); const o = new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, 8), m); parent.add(o); return o; };
  const sag = (x0, x1, y, dip, z, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [x0 + (x1 - x0) * t, y - dip * Math.sin(Math.PI * t), z]; });
  const starGeo = (r, depth) => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: depth * 0.3, bevelThickness: depth * 0.3, bevelSegments: 2 });
  };
  const heartGeo = (r, depth) => {
    const s = new THREE.Shape(); s.moveTo(0, -r); s.bezierCurveTo(r * 1.4, -r * 0.1, r * 0.7, r * 1.1, 0, r * 0.45); s.bezierCurveTo(-r * 0.7, r * 1.1, -r * 1.4, -r * 0.1, 0, -r);
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: depth * 0.3, bevelThickness: depth * 0.3, bevelSegments: 2 });
  };
  const mesh = (geo, m, o, parent) => { const x = new THREE.Mesh(geo, m); x.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); x.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0); if (o.s) x.scale.setScalar(o.s); parent.add(x); return x; };
  /** A row of books standing on y, from x0 to x1, at depth z (units). */
  const BOOKS = [0xb79bdc, 0x8fcfb3, 0xe9a593, 0xe9c46a, 0x7aa6d8, 0xf2a9b8, 0x9cc594];
  const books = (parent, x0, x1, y, z, hMax, depth, skip = 0.1) => {
    let x = x0;
    while (x < x1 - 3) {
      const w = 4 + rnd() * 4, h = hMax * (0.72 + rnd() * 0.28);
      if (rnd() < skip) { x += 4 + rnd() * 4; continue; }
      box(w, h, depth * (0.8 + rnd() * 0.2), M(BOOKS[Math.floor(rnd() * BOOKS.length)], 0.66), { x: x + w / 2, y: y + h / 2, z, r: 0.8, parent });
      x += w + 0.4;
    }
  };
  /** Woven rings and ribs round a basket of radius r (units), height h, from y0. */
  const weave = (parent, r, h, y0, cz, c1, c2, sz = 1) => {
    for (let i = 0; i < 5; i++) { const t = torus(r * (0.96 + i * 0.012), 1.1, M(i % 2 ? c1 : c2, 0.85), { x: 0, y: y0 + 4 + i * (h - 6) / 4, z: cz, rx: Math.PI / 2, parent }); t.scale.set(1, sz, 1); }
  };

  // ================================================================== wall things
  // Window: glass at x ±46, y -64..62 around its anchor (RoomAmbience's GLASS), curtains out to ±107, the rod at -88.
  {
    const g = item('window'), c = colours('window'), u = onWall(g, STAGE.window);
    const frame = part('window.frame', u), left = part('window.curtainL', u), right = part('window.curtainR', u);
    const r = 46, top = 64 - r, bot = -62, t = 7, wood = trim;
    const outer = new THREE.Shape(); outer.moveTo(-r - t, bot - t); outer.lineTo(r + t, bot - t); outer.lineTo(r + t, top); outer.absarc(0, top, r + t, 0, Math.PI, false); outer.lineTo(-r - t, bot - t);
    const inner = new THREE.Path(); inner.moveTo(-r, bot); inner.lineTo(-r, top); inner.absarc(0, top, r, Math.PI, 0, true); inner.lineTo(r, bot); inner.lineTo(-r, bot); outer.holes.push(inner);
    mesh(new THREE.ExtrudeGeometry(outer, { depth: 5, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2, curveSegments: 40 }), wood, { z: 4 }, frame);
    // The reveal: the opening's inner faces, a little deeper than the frame.
    const reveal = new THREE.Shape(); reveal.moveTo(-r, bot); reveal.lineTo(r, bot); reveal.lineTo(r, top); reveal.absarc(0, top, r, 0, Math.PI, false); reveal.lineTo(-r, bot);
    const rin = new THREE.Path(); rin.moveTo(-r + 0.6, bot + 0.6); rin.lineTo(-r + 0.6, top); rin.absarc(0, top, r - 0.6, Math.PI, 0, true); rin.lineTo(r - 0.6, bot + 0.6); rin.lineTo(-r + 0.6, bot + 0.6); reveal.holes.push(rin);
    mesh(new THREE.ExtrudeGeometry(reveal, { depth: 6, bevelEnabled: false, curveSegments: 40 }), M(0xf1ece4, 0.6), { z: 0 }, frame);
    box(3, top - bot + r, 3, wood, { x: 0, y: (bot + top + r) / 2, z: 3, r: 0.8, parent: frame });
    box(2 * r, 3, 3, wood, { x: 0, y: -20, z: 3, r: 0.8, parent: frame });
    box(2 * r + 26, 5, 18, wood, { x: 0, y: bot - t - 2, z: 9, r: 1.4, parent: frame });
    // Rod, finials, and the curtains tied back.
    const rod = M(0xc9975e, 0.42);
    cyl(1.8, 1.8, 222, rod, { x: 0, y: 88, z: 12, rz: Math.PI / 2, parent: frame });
    for (const s of [-1, 1]) { ball(3.6, rod, { x: s * 111, y: 88, z: 12, parent: frame }); box(2.4, 8, 12, rod, { x: s * 96, y: 90, z: 6, parent: frame }); }
    // Cloth in shade comes out deeper than the flat colour of the catalog: a little lighter keeps it as pale as it is drawn.
    const cloth = new THREE.Color(c.curtain).lerp(new THREE.Color(0xffffff), 0.22).getHex();
    curtain(left, -106, 87, 10, 48, 172, cloth, -1);
    curtain(right, 106, 87, 10, 48, 172, cloth, 1);
    for (const [s, tie] of [[-1, left], [1, right]]) box(26, 3.2, 9, M(c.curtain2, 0.8), { x: s * 86, y: 87 - 172 * 0.62, z: 15, r: 1.2, parent: tie });
  }
  // Garland: a cord between two hooks, little round bulbs hanging from it.
  {
    const g = item('garland'), c = colours('garland'), u = onWall(g, STAGE.garland);
    tube(sag(-86, 86, 8, 13, 5), 1.5, M(0x9a7a58, 0.7), u);
    for (const s of [-1, 1]) ball(2.4, M(0xb98a55, 0.4), { x: s * 86, y: 8, z: 4, parent: u });
    const cols = [c.b1, c.b2, c.b3];
    for (let i = 0; i < 8; i++) {
      const t = (i + 0.5) / 8, x = -86 + 172 * t, y = 8 - 13 * Math.sin(Math.PI * t);
      cyl(1.6, 1.6, 3, M(0xb08a5a, 0.5), { x, y: y - 2, z: 6, parent: u });
      const b = ball(4.4, M(cols[i % 3], 0.25, { emissive: c.glow, emissiveIntensity: 0.35 }), { x, y: y - 7.5, z: 6.5, parent: u }); b.scale.set(0.9, 1.15, 0.9);
    }
  }
  // Hanging plant: a hook, three cords, a pot in front of the wall, leaves on top and long trailing vines.
  {
    const g = item('hanging_plant'), c = colours('hanging_plant'), u = onWall(g, STAGE.hanging_plant), hold = part('hanging_plant.all', u);
    ball(2.2, M(0xb98a55, 0.4), { x: 0, y: 50, z: 2, parent: hold });
    torus(2.4, 0.6, M(0xb98a55, 0.4), { x: 0, y: 47, z: 3, parent: hold });
    for (const a of [0, 2.1, 4.2]) tube([[0, 46, 4], [Math.cos(a) * 15, 4, 16 + Math.sin(a) * 15]], 0.45, M(0xd8b98e, 0.8), hold, 4);
    lathe([[0.01, -16], [11, -16], [17, -4], [18.5, 4], [17, 4], [15, -2], [0.01, -2]], M(c.pot, 0.6), { x: 0, y: 0, z: 16, parent: hold });
    torus(17.6, 1.4, M(c.pot2, 0.6), { x: 0, y: 4, z: 16, rx: Math.PI / 2, parent: hold });
    cyl(15, 15, 1, M(0x5a4332, 0.95), { x: 0, y: 2.5, z: 16, parent: hold });
    const greens = [0x6bb565, 0x58a456, 0x7fc276];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; leaf(13, 5, M(greens[i % 3], 0.5), { x: Math.cos(a) * 6, y: 3, z: 16 + Math.sin(a) * 6, rz: Math.cos(a) * 0.9, rx: Math.sin(a) * 0.9, parent: hold }); }
    for (const [x0, len, z0, bend] of [[-14, 48, 22, -6], [-6, 40, 26, -2], [9, 44, 25, 4], [15, 30, 20, 8], [2, 22, 28, 0]]) {
      const pts = [[x0, 0, z0], [x0 + bend * 0.4, -len * 0.4, z0 + 2], [x0 + bend, -len, z0 - 2]];
      tube(pts, 0.6, M(0x5d9a50, 0.6), hold, 12);
      for (let k = 1; k <= 5; k++) { const t = k / 5.5, x = x0 + bend * t, y = -len * t; leaf(6.5, 2.8, M(greens[k % 3], 0.5), { x: x + (k % 2 ? 1.5 : -1.5), y, z: z0 + 1, rz: (k % 2 ? -1 : 1) * 2.2, rx: 0.3, parent: hold }); }
    }
  }
  // Clock: its face and rim; the hands are drawn live in the app.
  {
    const g = item('wall_clock'), c = colours('wall_clock'), u = onWall(g, STAGE.wall_clock), cx = 1.5, cy = -2;
    cyl(24, 24.5, 5, M(c.rim, 0.45), { x: cx, y: cy, z: 2.5, rx: Math.PI / 2, parent: u });
    torus(22, 1.6, M(c.rim2, 0.45), { x: cx, y: cy, z: 5, parent: u });
    cyl(20, 20, 1, M(0xfffaf0, 0.5), { x: cx, y: cy, z: 5.4, rx: Math.PI / 2, parent: u });
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, l = i % 3 ? 1.4 : 2.6; box(1.1, l * 2, 0.6, M(0x7a6a5a, 0.5), { x: cx + Math.sin(a) * 16, y: cy + Math.cos(a) * 16, z: 6.1, rz: -a, parent: u }); }
    ball(1.4, M(0xd9534f, 0.4), { x: cx, y: cy, z: 6.2, parent: u });
  }
  // A small painting of tulips, hung on a string.
  {
    const g = item('painting_tulips'), c = colours('painting_tulips'), u = onWall(g, STAGE.painting_tulips), fy = -3;
    tube([[-18, fy + 31, 2], [0, 50, 2.5], [18, fy + 31, 2]], 0.4, M(0x9c7a58, 0.7), u, 6);
    ball(1.5, M(0xb98a55, 0.4), { x: 0, y: 50, z: 2.5, parent: u });
    box(52, 66, 4, M(0xf4e3cc, 0.55), { x: 1, y: fy, z: 2, r: 1.5, parent: u });
    box(42, 54, 1, M(c.bg, 0.85), { x: 1, y: fy + 1, z: 4.2, r: 0.5, parent: u });
    box(40, 4, 1.2, M(c.band, 0.8), { x: 1, y: fy - 22, z: 4.6, r: 0.4, parent: u });
    lathe([[0.01, 0], [5, 0], [6.5, 6], [4.5, 12], [3.5, 14], [0.01, 14]], M(0xf7f0e4, 0.5), { x: 1, y: fy - 22, z: 5, sz: 0.4, parent: u });
    for (const [dx, h, col] of [[-6, 22, c.f1], [1, 27, c.f2], [8, 21, c.f1]]) {
      tube([[1, fy - 9, 5.4], [dx, fy - 9 + h, 5.4]], 0.5, M(0x6aa860, 0.6), u, 4);
      const f = ball(3.6, M(col, 0.55), { x: dx, y: fy - 7 + h, z: 5.6, parent: u }); f.scale.set(0.85, 1.15, 0.45);
    }
    for (const s of [-1, 1]) leaf(10, 3, M(0x6aa860, 0.55), { x: 1, y: fy - 9, z: 5.5, rz: s * 0.7, parent: u });
  }
  // Cork board with notes and a photo.
  {
    const g = item('cork_board'), c = colours('cork_board'), u = onWall(g, STAGE.cork_board), cy = 3;
    box(96, 70, 5, M(c.frame, 0.55), { x: 2, y: cy, z: 2.5, r: 2, parent: u });
    box(86, 60, 2, M(0xd9ae7a, 0.95), { x: 2, y: cy, z: 4.6, r: 0.8, parent: u });
    box(20, 22, 0.6, M(0xf5e7a8, 0.85), { x: -24, y: cy + 8, z: 5.9, rz: 0.08, r: 0.2, parent: u });
    box(24, 26, 0.8, M(0xffffff, 0.6), { x: 20, y: cy + 6, z: 6, rz: -0.07, r: 0.3, parent: u });
    box(19, 15, 0.4, M(0x9ccbe8, 0.7), { x: 20, y: cy + 8, z: 6.5, rz: -0.07, parent: u });
    box(18, 12, 0.6, M(0xf3b3c0, 0.85), { x: -8, y: cy - 16, z: 5.9, rz: -0.05, r: 0.2, parent: u });
    for (const [x, y, col] of [[-24, cy + 17, 0xe05d5d], [20, cy + 18, 0x4f8fdc], [-8, cy - 10, 0x58b06b]]) ball(1.8, M(col, 0.35), { x, y, z: 7, parent: u });
  }
  // Whiteboard with notes and a tray of markers.
  {
    const g = item('memo_board'), c = colours('memo_board'), u = onWall(g, STAGE.memo_board), cy = 2;
    box(100, 66, 4, M(c.body, 0.55), { x: 0, y: cy, z: 2, r: 2, parent: u });
    box(92, 58, 1, M(0xfdfdfb, 0.3), { x: 0, y: cy, z: 4.2, r: 0.6, parent: u });
    for (const [x, y, w] of [[-26, cy + 18, 28], [-28, cy + 12, 24], [-27, cy + 6, 26]]) box(w, 1.4, 0.3, M(0x7da4cf, 0.6), { x, y, z: 4.8, parent: u });
    tube(Array.from({ length: 9 }, (_, i) => [-36 + i * 4, cy - 8 + Math.sin(i * 1.3) * 2.5, 4.9]), 0.7, M(0xe07a8b, 0.6), u, 20);
    for (const [x, y, col, rz] of [[14, cy + 14, 0xf6d06a, 0.06], [30, cy + 14, 0xf3a6b8, -0.08], [22, cy - 6, 0x9bd3b3, 0.04]]) box(14, 14, 0.6, M(col, 0.8), { x, y, z: 5, rz, r: 0.3, parent: u });
    box(64, 3, 7, M(c.edge, 0.55), { x: 0, y: cy - 33, z: 5, r: 1, parent: u });
    for (const [x, col] of [[-12, 0x5f8fd0], [6, 0xe07a8b]]) cyl(1.3, 1.3, 12, M(col, 0.4), { x, y: cy - 30.5, z: 6, rz: Math.PI / 2, parent: u });
  }
  // A wall shelf: books on its left, the right half free for things to stand on (`tops` [0, 48] at +8).
  {
    const g = item('wall_shelf'), c = colours('wall_shelf'), u = onWall(g, STAGE.wall_shelf);
    box(102, 5, 22, M(c.wood, 0.55), { x: 0, y: -10.5, z: 11, r: 1.2, parent: u });
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(18, 0); sh.lineTo(0, -20); sh.lineTo(0, 0);
      mesh(new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.5 }), M(c.wood2, 0.55), { x: s * 34 - 1.5, y: -13, z: 0.5, ry: -Math.PI / 2 }, u);
    }
    books(u, -48, -12, -8, 10, 30, 14, 0);
    box(5, 28, 13, M(0xe9c46a, 0.66), { x: -9, y: 5, z: 10, rz: -0.32, r: 0.8, parent: u });
  }
  // Fairy lights: a cord with little stars and two photos pegged on it.
  {
    const g = item('fairy_lights'), c = colours('fairy_lights'), u = onWall(g, STAGE.fairy_lights);
    tube(sag(-78, 78, 6, 12, 4), 0.7, M(0x6f7f5a, 0.7), u);
    for (const s of [-1, 1]) ball(2.4, M(0xd4a74a, 0.35), { x: s * 78, y: 6, z: 3, parent: u });
    const cols = [c.l1, c.l2, c.l3], sg = starGeo(3.8, 1.4);
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9, x = -78 + 156 * t, y = 6 - 12 * Math.sin(Math.PI * t);
      mesh(sg, M(cols[i % 3], 0.3, { emissive: cols[i % 3], emissiveIntensity: 0.4 }), { x, y: y - 4, z: 4.5, rz: (i % 2 ? 0.2 : -0.15) }, u);
    }
    for (const [t, rz] of [[0.3, 0.08], [0.72, -0.06]]) {
      const x = -78 + 156 * t, y = 6 - 12 * Math.sin(Math.PI * t);
      box(13, 15, 0.8, M(0xffffff, 0.6), { x, y: y - 10, z: 4.2, rz, r: 0.3, parent: u });
      box(10, 9, 0.4, M(i2c(t), 0.7), { x, y: y - 9, z: 4.7, rz, parent: u });
      box(2, 4, 1.4, M(0xd4a74a, 0.4), { x, y: y - 2, z: 5, parent: u });
    }
    function i2c(t) { return t < 0.5 ? 0x9ccbe8 : 0xf3b3c0; }
  }

  // ================================================================== on the floor
  // Desk with drawers, its chair behind it (the pet sits there: `desk.body` is drawn again over it).
  {
    const g = item('desk'), c = colours('desk'), [ax, ay] = STAGE.desk, D = 50;
    const H = solveTop(ax, ay, ay - 86, D * UX(ay)) / UY(ay);
    const u = onFloor(g, STAGE.desk), body = part('desk.body', u), chair = part('desk.chair', u);
    box(188, 7, D + 4, M(c.top, 0.5), { x: 0, y: H - 3.5, z: -D / 2, r: 1.6, parent: body });
    box(186, 2.4, D + 2, M(c.edge, 0.5), { x: 0, y: H - 7.6, z: -D / 2, r: 0.8, parent: body });
    for (const z of [-4, -D + 4]) box(7, H - 9, 7, M(c.leg, 0.55), { x: -84, y: (H - 9) / 2, z, r: 1.4, parent: body });
    box(40, H - 9, D - 2, M(c.body, 0.55), { x: 66, y: (H - 9) / 2, z: -D / 2, r: 1.4, parent: body });
    for (let i = 0; i < 3; i++) {
      const h = (H - 15) / 3, y = 3 + h / 2 + i * h;
      box(34, h - 3, 2, M(c.body2, 0.5), { x: 66, y, z: 0.4, r: 0.8, parent: body });
      box(10, 1.8, 2, M(c.edge, 0.4), { x: 66, y: y + 1, z: 2, r: 0.8, parent: body });
    }
    // The chair is pushed in: its seat under the desk top, its back just behind the desk, above the top (the desk stands close to the wall).
    const sy = H * 0.6, cxC = -8, bz = -D - 7;
    box(50, 6, 34, M(c.seat, 0.85), { x: cxC, y: sy, z: -D + 15, r: 2.6, parent: chair });
    for (const s of [-1, 1]) box(3.6, sy - 3, 3.6, M(c.leg, 0.55), { x: cxC + s * 20, y: (sy - 3) / 2, z: -D + 28, r: 1, parent: chair });
    for (const s of [-1, 1]) box(3.6, sy + 40, 3.6, M(c.leg, 0.55), { x: cxC + s * 21, y: (sy + 40) / 2, z: bz, r: 1, parent: chair });
    box(56, 38, 6, M(c.top, 0.55), { x: cxC, y: H + 26, z: bz, r: 3.6, parent: chair });
    box(46, 28, 3, M(c.seat, 0.85), { x: cxC, y: H + 26, z: bz + 3.5, r: 2.4, parent: chair });
  }
  // A chair on its own.
  {
    const g = item('chair'), c = colours('chair'), u = onFloor(g, STAGE.chair), sy = 40, d = 36, cz = -d / 2;
    box(48, 6, d, M(c.cushion, 0.85), { x: 0, y: sy, z: cz, r: 2.6, parent: u });
    box(46, 2.6, d - 2, M(c.edge, 0.6), { x: 0, y: sy - 4, z: cz, r: 1, parent: u });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(4, sy - 5, 4, M(c.leg, 0.55), { x: a * 19, y: (sy - 5) / 2, z: cz + b * 14, r: 1, parent: u });
    box(38, 2.4, 2.4, M(c.leg2, 0.55), { x: 0, y: 14, z: cz + 14, r: 0.8, parent: u });
    for (const s of [-1, 1]) box(4, 34, 4, M(c.leg, 0.55), { x: s * 19, y: sy + 17, z: cz - 15, r: 1, parent: u });
    box(50, 30, 7, M(c.top, 0.55), { x: 0, y: sy + 34, z: cz - 16, r: 4, parent: u });
    box(40, 22, 3, M(c.cushion, 0.85), { x: 0, y: sy + 34, z: cz - 12, r: 2.4, parent: u });
  }
  // Cube shelf: three cubbies (a basket, books, folded towels), things stand on its top (`tops` at -69).
  {
    const g = item('cube_shelf'), c = colours('cube_shelf'), [ax, ay] = STAGE.cube_shelf, D = 38;
    const H = solveTop(ax, ay, ay - 69, D * UX(ay)) / UY(ay);
    const u = onFloor(g, STAGE.cube_shelf), w = 130, t = 4;
    box(w + 2, t, D + 2, M(c.top, 0.5), { x: 0, y: H - t / 2, z: -D / 2, r: 1.2, parent: u });
    box(w, t, D, M(c.body, 0.55), { x: 0, y: 3 + t / 2, z: -D / 2, r: 1, parent: u });
    for (const x of [-w / 2 + t / 2, -w / 6, w / 6, w / 2 - t / 2]) box(t, H - t, D, M(c.body, 0.55), { x, y: (H - t) / 2, z: -D / 2, r: 1, parent: u });
    box(w, H - t, 1.5, M(c.inner, 0.7), { x: 0, y: (H - t) / 2, z: -D + 1, parent: u });
    for (const s of [-1, 1]) box(4, 3, 4, M(c.leg2, 0.55), { x: s * (w / 2 - 6), y: 1.5, z: -4, parent: u });
    const inner = H - t - 6, cw = w / 3 - t;
    // left: a woven basket
    box(cw - 6, inner * 0.8, D - 10, M(c.basket, 0.85), { x: -w / 3, y: 5 + inner * 0.4, z: -D / 2, r: 2, parent: u });
    for (let i = 0; i < 4; i++) box(cw - 5, 1.2, 0.8, M(0xc9955c, 0.9), { x: -w / 3, y: 9 + i * inner * 0.18, z: -9.6, parent: u });
    // middle: books
    books(u, -cw / 2 + 2, cw / 2 - 2, 5, -D / 2 - 2, inner * 0.92, D * 0.7, 0.05);
    // right: towels
    for (const [y, col] of [[5, 0x9cc7e6], [5 + inner * 0.3, 0xf3b3c0]]) box(cw - 8, inner * 0.28, D - 12, M(col, 0.9), { x: w / 3, y: y + inner * 0.14, z: -D / 2, r: 3.5, parent: u });
  }
  // Bookcase: three shelves with books, a photo, a little plant, a basket below (`tops` at -170).
  {
    const g = item('bookcase'), c = colours('bookcase'), [ax, ay] = STAGE.bookcase, D = 34;
    const H = solveTop(ax, ay, ay - 170, D * UX(ay)) / UY(ay);
    const u = onFloor(g, STAGE.bookcase), w = 98, t = 4;
    box(w + 3, t, D + 3, M(c.top, 0.5), { x: 0, y: H - t / 2, z: -D / 2, r: 1.2, parent: u });
    for (const s of [-1, 1]) box(t, H - t, D, M(c.body, 0.55), { x: s * (w / 2 - t / 2), y: (H - t) / 2, z: -D / 2, r: 1, parent: u });
    box(w, H, 1.5, M(c.inner, 0.7), { x: 0, y: H / 2, z: -D + 1, parent: u });
    box(w, 6, D, M(c.edge, 0.55), { x: 0, y: 3, z: -D / 2, r: 1, parent: u });
    const step = (H - t - 6) / 3;
    for (let i = 1; i <= 2; i++) box(w - t * 2, 3, D - 2, M(c.body2, 0.55), { x: 0, y: 6 + step * i, z: -D / 2, r: 0.8, parent: u });
    box(w - 22, step * 0.75, D - 10, M(c.basket, 0.85), { x: 0, y: 6 + step * 0.38, z: -D / 2, r: 2, parent: u });
    books(u, -w / 2 + 6, w / 2 - 6, 6 + step + 1.5, -D / 2 - 2, step * 0.82, D * 0.72, 0.05);
    books(u, -w / 2 + 6, 6, 6 + step * 2 + 1.5, -D / 2 - 2, step * 0.8, D * 0.72, 0.05);
    box(18, 22, 2.4, M(0xffffff, 0.5), { x: 22, y: 6 + step * 2 + 13, z: -D / 2, rx: -0.12, r: 0.6, parent: u });
    box(13, 16, 0.6, M(0xf1c6bd, 0.7), { x: 22, y: 6 + step * 2 + 13, z: -D / 2 + 1.3, rx: -0.12, parent: u });
    K.smallPlant(u, 36, 6 + step * 2 + 1.5, -D / 2, 60, 0xf0e2cc);
  }
  // Floor lamp: a weighted base, a slim pole and a cloth shade (its light is drawn live in the app).
  {
    const g = item('floor_lamp'), c = colours('floor_lamp'), u = onFloor(g, STAGE.floor_lamp), cz = -16;
    cyl(16, 17, 3, M(0xa98a6a, 0.45), { x: 0, y: 1.5, z: cz, parent: u });
    cyl(1.6, 1.6, 140, M(0xb48f6a, 0.4), { x: 0, y: 72, z: cz, parent: u });
    lathe([[13, 0], [23, 0], [19, 28], [13, 28]], M(c.shade, 0.75), { x: 0, y: 136, z: cz, parent: u });
    torus(23, 1, M(c.shade2, 0.7), { x: 0, y: 136, z: cz, rx: Math.PI / 2, parent: u });
    ball(5, glow(0xffe2a8, 1.6), { x: 0, y: 140, z: cz, parent: u });
  }
  // Pet bed: an oval wicker basket with a cushion, a little pillow and a folded blanket.
  {
    const g = item('pet_bed_basket'), c = colours('pet_bed_basket'), u = onFloor(g, STAGE.pet_bed_basket), rz = 40, cz = -rz;
    const sz = rz / 66;
    const shell = lathe([[0.01, 0], [58, 0], [64, 10], [66, 26], [62, 26], [60, 12], [0.01, 4]], M(c.a, 0.85), { x: 0, y: 0, z: cz, parent: u }); shell.scale.set(1, 1, sz);
    weave(u, 64, 26, 0, cz, c.a, c.b, sz);
    for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; box(1.6, 22, 1.2, M(c.b, 0.85), { x: Math.cos(a) * 64.5, y: 12, z: cz + Math.sin(a) * 64.5 * sz, ry: -a, parent: u }); }
    const rim = torus(64, 3, M(c.rim, 0.75), { x: 0, y: 26, z: cz, rx: Math.PI / 2, parent: u }); rim.scale.set(1, sz, 1);
    const cushion = ball(57, M(c.pillow, 0.92), { x: 0, y: 14, z: cz, parent: u }); cushion.scale.set(1, 0.2, sz * 0.96);
    const pillow = ball(18, M(c.pillow, 0.92), { x: -36, y: 36, z: cz - 14, parent: u }); pillow.scale.set(1.25, 0.6, 0.8);
    for (let i = 0; i < 6; i++) box(3, 1, 1, M(c.stripe, 0.8), { x: -48 + i * 4.8, y: 36, z: cz - 14 + 14.5, parent: u });
    box(36, 24, 5, M(c.stripe, 0.9), { x: 38, y: 24, z: -6, rz: -0.1, rx: -0.15, r: 2.4, parent: u });
    box(36, 3, 6, M(0xfff4ec, 0.9), { x: 38, y: 32, z: -6, rz: -0.1, rx: -0.15, r: 1.4, parent: u });
  }
  // Pet bowl with food.
  {
    const g = item('pet_bowl'), c = colours('pet_bowl'), u = onFloor(g, STAGE.pet_bowl), cz = -14;
    const b = lathe([[0.01, 0], [14, 0], [20, 10], [21, 13], [18, 13], [15, 4], [0.01, 4]], M(c.a, 0.4), { x: 0, y: 0, z: cz, parent: u }); b.scale.set(1, 1, 0.7);
    const rim = torus(19.5, 1.5, M(c.b, 0.4), { x: 0, y: 13, z: cz, rx: Math.PI / 2, parent: u }); rim.scale.set(1, 0.7, 1);
    for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, r = rnd() * 14; ball(2.4, M(i % 3 ? 0xa56a3c : 0xc0834c, 0.8), { x: Math.cos(a) * r, y: 9 + rnd() * 3, z: cz + Math.sin(a) * r * 0.7, parent: u }); }
  }
  // A plush bunny-bear sitting up, with a bow.
  {
    const g = item('toy_plush'), c = colours('toy_plush'), u = onFloor(g, STAGE.toy_plush), cz = -12, fur = M(c.fur, 0.95), belly = M(c.belly, 0.95);
    const body = ball(17, fur, { x: 0, y: 17, z: cz, parent: u }); body.scale.set(1, 1.05, 0.85);
    const bl = ball(11, belly, { x: 0, y: 15, z: cz + 8, parent: u }); bl.scale.set(1, 1.1, 0.5);
    for (const s of [-1, 1]) {
      const foot = ball(7, fur, { x: s * 10, y: 5, z: cz + 9, parent: u }); foot.scale.set(1, 0.8, 1.2);
      ball(4, belly, { x: s * 10, y: 5, z: cz + 16, parent: u }).scale.set(1, 1, 0.4);
      const arm = ball(6, fur, { x: s * 15, y: 20, z: cz + 6, parent: u }); arm.scale.set(0.8, 1.3, 0.8);
      ball(6.5, fur, { x: s * 10, y: 59, z: cz - 1, parent: u }).scale.set(1, 1, 0.6);
      ball(3.6, belly, { x: s * 10, y: 59, z: cz + 2, parent: u }).scale.set(1, 1, 0.4);
    }
    ball(15, fur, { x: 0, y: 45, z: cz, parent: u });
    const muzzle = ball(6, belly, { x: 0, y: 41, z: cz + 12, parent: u }); muzzle.scale.set(1.2, 0.85, 0.7);
    ball(1.8, M(0x4a3530, 0.3), { x: 0, y: 43.5, z: cz + 16, parent: u });
    for (const s of [-1, 1]) ball(1.7, M(0x2e2420, 0.25), { x: s * 6, y: 48, z: cz + 13.5, parent: u });
    for (const s of [-1, 1]) { const b = ball(4.5, M(c.bow, 0.6), { x: s * 5, y: 32, z: cz + 13, parent: u }); b.scale.set(1.2, 0.8, 0.6); }
    ball(2.4, M(c.bow, 0.6), { x: 0, y: 32, z: cz + 14, parent: u });
  }
  // A woven basket of toys.
  {
    const g = item('toy_basket'), c = colours('toy_basket'), u = onFloor(g, STAGE.toy_basket), cz = -18;
    lathe([[0.01, 0], [24, 0], [29, 30], [27, 30], [22, 3], [0.01, 3]], M(c.a, 0.85), { x: 0, y: 0, z: cz, parent: u }).scale.set(1, 1, 0.65);
    for (let i = 0; i < 4; i++) torus(25 + i * 1.3, 0.9, M(i % 2 ? c.b : c.a, 0.85), { x: 0, y: 5 + i * 7, z: cz, rx: Math.PI / 2, parent: u }).scale.set(1, 0.65, 1);
    torus(29, 2.2, M(c.rim, 0.7), { x: 0, y: 30, z: cz, rx: Math.PI / 2, parent: u }).scale.set(1, 0.65, 1);
    ball(10, M(0xf08a9a, 0.6), { x: -12, y: 32, z: cz - 2, parent: u });
    const duck = ball(7, M(0xf7d13d, 0.45), { x: 4, y: 36, z: cz + 2, parent: u }); duck.scale.set(1, 0.9, 1);
    ball(4.5, M(0xf7d13d, 0.45), { x: 7, y: 44, z: cz + 3, parent: u });
    box(4, 2, 3, M(0xf09a3c, 0.5), { x: 12, y: 44, z: cz + 3, r: 0.8, parent: u });
    box(15, 15, 15, M(0xe9cf7a, 0.6), { x: 16, y: 38, z: cz - 4, rz: 0.3, rx: 0.15, r: 2, parent: u });
  }
  // A ball of yarn and its loose end.
  {
    const g = item('toy_ball'), c = colours('toy_ball'), u = onFloor(g, STAGE.toy_ball), cz = -12;
    ball(15, M(c.a, 0.95), { x: 0, y: 15, z: cz, parent: u });
    for (let i = 0; i < 7; i++) torus(15.2, 0.7, M(c.b, 0.9), { x: 0, y: 15, z: cz, rx: rnd() * Math.PI, ry: rnd() * Math.PI, parent: u });
    tube([[12, 6, cz + 6], [18, 1, cz + 10], [24, 0.8, cz + 6], [27, 0.8, cz + 12]], 0.8, M(c.b, 0.9), u, 20);
  }
  // Toy blocks: two below, one on top.
  {
    const g = item('toy_blocks'), u = onFloor(g, STAGE.toy_blocks), cz = -12;
    box(23, 22, 22, M(0xf0b4a8, 0.6), { x: -13, y: 11, z: cz, r: 2.4, parent: u });
    box(23, 22, 22, M(0x9cc7e6, 0.6), { x: 12, y: 11, z: cz, r: 2.4, parent: u });
    mesh(heartGeo(5, 1), M(0xe0677a, 0.5), { x: -13, y: 11, z: cz + 11.2 }, u);
    torus(5, 1.8, M(0x4f8fdc, 0.5), { x: 12, y: 11, z: cz + 11.5, parent: u });
    box(21, 21, 21, M(0xeacf7e, 0.6), { x: -4, y: 33, z: cz - 1, rz: 0.22, r: 2.4, parent: u });
    mesh(starGeo(6, 1), M(0xd4a33a, 0.5), { x: -4, y: 33, z: cz + 9.8, rz: 0.22 }, u);
  }
  // Flowers in a pot (the flowers sway).
  {
    const g = item('plant_flowers'), c = colours('plant_flowers'), u = onFloor(g, STAGE.plant_flowers), cz = -14, top = part('plant_flowers.top', u);
    lathe([[0.01, 0], [14, 0], [18, 30], [19.5, 30], [19.5, 34], [16.5, 34], [0.01, 32]], M(0xf3e1c6, 0.6), { x: 0, y: 0, z: cz, parent: u });
    torus(18.7, 1.3, M(0xe8a8a8, 0.6), { x: 0, y: 22, z: cz, rx: Math.PI / 2, parent: u });
    cyl(16, 16, 1, M(0x5a4332, 0.95), { x: 0, y: 32.5, z: cz, parent: u });
    const heads = [[-12, 72, -2], [0, 80, -4], [11, 70, 0], [-3, 64, 6], [14, 58, 2]];
    for (const [x, y, dz] of heads) {
      tube([[0, 32, cz], [x * 0.5, (32 + y) / 2, cz + dz / 2], [x, y - 3, cz + dz]], 0.8, M(0x6aa860, 0.6), top, 8);
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; const p = ball(4.4, M(c.f1, 0.6), { x: x + Math.cos(a) * 4.6, y: y + Math.sin(a) * 4.6, z: cz + dz + 2, parent: top }); p.scale.set(1, 1, 0.45); }
      ball(2.8, M(0xf6d98a, 0.5), { x, y, z: cz + dz + 3.6, parent: top }).scale.set(1, 1, 0.6);
    }
    for (const [rz, l] of [[0.9, 18], [-0.9, 18], [0.4, 14], [-0.35, 15]]) leaf(l, 5, M(0x74b768, 0.5), { x: 0, y: 34, z: cz + 3, rz, rx: 0.4, parent: top });
  }
  // A teddy bear with a scarf.
  {
    const g = item('teddy_bear'), c = colours('teddy_bear'), u = onFloor(g, STAGE.teddy_bear), cz = -12, fur = M(c.fur, 0.95), dark = M(c.fur2, 0.95), pad = M(c.pad, 0.9);
    ball(16, fur, { x: 0, y: 17, z: cz, parent: u }).scale.set(1, 1.05, 0.85);
    for (const s of [-1, 1]) {
      ball(8, fur, { x: s * 12, y: 6, z: cz + 9, parent: u }).scale.set(1, 0.8, 1.15);
      ball(4.4, pad, { x: s * 12, y: 6, z: cz + 17.5, parent: u }).scale.set(1, 1, 0.35);
      ball(6.5, fur, { x: s * 17, y: 20, z: cz + 4, rz: s * 0.5, parent: u }).scale.set(0.8, 1.35, 0.8);
      ball(5.5, fur, { x: s * 10, y: 50, z: cz - 1, parent: u }).scale.set(1, 1, 0.65);
      ball(3, dark, { x: s * 10, y: 50, z: cz + 2, parent: u }).scale.set(1, 1, 0.4);
    }
    ball(14, fur, { x: 0, y: 39, z: cz, parent: u });
    ball(6, pad, { x: 0, y: 36, z: cz + 11, parent: u }).scale.set(1.15, 0.85, 0.7);
    ball(2, M(0x3a2620, 0.3), { x: 0, y: 38.5, z: cz + 15, parent: u });
    for (const s of [-1, 1]) ball(1.7, M(0x2e2420, 0.25), { x: s * 5.5, y: 43, z: cz + 12.5, parent: u });
    torus(11.5, 3, M(c.scarf, 0.8), { x: 0, y: 27.5, z: cz + 1, rx: Math.PI / 2 - 0.15, parent: u });
    box(6, 12, 3, M(c.scarf, 0.8), { x: 6, y: 21, z: cz + 12, rz: 0.2, r: 1.2, parent: u });
    mesh(heartGeo(3, 0.8), M(0xe05d5d, 0.5), { x: 0, y: 16, z: cz + 13.5 }, u);
  }
  // A big monstera in its pot (the leaves sway).
  {
    const g = item('plant_monstera'), c = colours('plant_monstera'), u = onFloor(g, STAGE.plant_monstera), cz = -26, leaves = part('plant_monstera.leaves', u);
    lathe([[0.01, 0], [22, 0], [29, 46], [31, 46], [31, 52], [27, 52], [0.01, 50]], M(c.pot, 0.6), { x: 0, y: 0, z: cz, parent: u });
    torus(30, 2, M(c.pot2, 0.6), { x: 0, y: 46, z: cz, rx: Math.PI / 2, parent: u });
    cyl(27, 27, 1, M(0x5a4332, 0.95), { x: 0, y: 50.5, z: cz, parent: u });
    bigLeaves(leaves, 0, 50, cz, 92, 11);
  }

  // ================================================================== rugs: flat on the floor, centred on their anchor
  const rugFrame = (cx, cy, hx, hy) => {
    const c0 = floorAt(cx, cy), rx = Math.abs(floorAt(cx + hx, cy).x - c0.x), rz = Math.abs(floorAt(cx, cy + hy).z - floorAt(cx, cy - hy).z) / 2;
    return { c0, rx, rz };
  };
  const flat = (parent, c0, rx, rz, k, y, m, seg = 64) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.012, seg), m); o.position.set(c0.x, y, c0.z); o.scale.set(rx * k, 1, rz * k); parent.add(o); return o; };
  {
    const g = item('rug_round'), c = colours('rug_round'), [cx, cy] = STAGE.rug_round, { c0, rx, rz } = rugFrame(cx, cy, 98, 30);
    flat(g, c0, rx, rz, 0.94, 0.008, M(c.b, 0.97));
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; flat(g, { x: c0.x + Math.cos(a) * rx * 0.93, z: c0.z + Math.sin(a) * rz * 0.93 }, rx, rz, 0.11, 0.009, M(c.a, 0.97), 24); }
    flat(g, c0, rx, rz, 0.86, 0.016, M(c.a, 0.97));
    flat(g, c0, rx, rz, 0.62, 0.02, M(c.c, 0.97));
    flat(g, c0, rx, rz, 0.3, 0.023, M(c.c, 0.97));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 64), M(0xfff8f2, 0.8)); ring.rotation.x = Math.PI / 2; ring.position.set(c0.x, 0.026, c0.z); ring.scale.set(rx * 0.3, rz * 0.3, 1); g.add(ring);
  }
  {
    const g = item('rug_stripes'), c = colours('rug_stripes'), [cx, cy] = STAGE.rug_stripes, { c0, rx, rz } = rugFrame(cx, cy, 112, 30);
    const W = rx * 2, Dz = rz * 2, n = 7;
    for (let i = 0; i < n; i++) box(W, 0.016, Dz / n + 0.002, M([c.a, c.b, c.c][i % 3], 0.97), { x: c0.x, y: 0.008, z: c0.z - rz + Dz * (i + 0.5) / n, r: 0.004, parent: g });
    for (let i = 0; i < 26; i++) for (const s of [-1, 1]) box(0.012, 0.006, 0.07, M(0xfaf6ee, 0.8), { x: c0.x - rx + 0.04 + (W - 0.08) * i / 25, y: 0.005, z: c0.z + s * (rz + 0.035), parent: g });
  }
  {
    const g = item('rug_oval'), c = colours('rug_oval'), [cx, cy] = STAGE.rug_oval, { c0, rx, rz } = rugFrame(cx, cy, 117, 32);
    flat(g, c0, rx, rz, 1, 0.008, M(c.b, 0.97)); flat(g, c0, rx, rz, 0.9, 0.016, M(c.a, 0.97)); flat(g, c0, rx, rz, 0.72, 0.02, M(c.c, 0.97));
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; box(0.05, 0.004, 0.012, M(0xfaf6ee, 0.8), { x: c0.x + Math.cos(a) * rx * 0.66, y: 0.023, z: c0.z + Math.sin(a) * rz * 0.66, ry: -Math.atan2(Math.sin(a) * rz, Math.cos(a) * rx) + Math.PI / 2, parent: g }); }
  }

  // ================================================================== on a desk or a shelf: their feet on its top
  // The height of each support's top (metres), as the support was built: things standing on it go there.
  const topOf = {
    desk: (() => { const [ax, ay] = STAGE.desk; return solveTop(ax, ay, ay - 86, 50 * UX(ay)); })(),
    cube_shelf: (() => { const [ax, ay] = STAGE.cube_shelf; return solveTop(ax, ay, ay - 69, 38 * UX(ay)); })(),
  };
  const ON = { pencil_cup: 'desk', notebook: 'desk', mug: 'desk', desk_lamp: 'desk', desk_plant: 'desk', book_stack: 'cube_shelf', night_lamp: 'cube_shelf' };
  const onTop = (g, id) => {
    const [cx, cy] = STAGE[id], h = topOf[ON[id]], at = floorAt(cx, cy, h), u = new THREE.Group();
    u.position.copy(at); u.scale.set(UX(cy), UY(cy), UX(cy)); g.add(u); return u;
  };
  {
    const g = item('book_stack'), c = colours('book_stack'), u = onTop(g, 'book_stack');
    [[c.b1, 36, 0.06], [c.b2, 33, -0.08], [c.b3, 30, 0.1]].forEach(([col, w, ry], i) => {
      box(w, 7.5, w * 0.62, M(col, 0.62), { x: i % 2 ? 1.5 : -1, y: 4 + i * 8, z: 0, ry, r: 1, parent: u });
      box(w - 3, 5.2, w * 0.62 + 0.5, M(0xfff6e4, 0.8), { x: (i % 2 ? 1.5 : -1) + 1.5, y: 4 + i * 8, z: 0, ry, r: 0.5, parent: u });
    });
  }
  {
    const g = item('night_lamp'), c = colours('night_lamp'), u = onTop(g, 'night_lamp');
    lathe([[0.01, 0], [6, 0], [5, 4], [4.2, 14], [0.01, 14]], M(0xfaf1e2, 0.6), { x: 0, y: 0, z: -2, parent: u });
    ball(5, glow(0xffe6b0, 1.2), { x: 0, y: 13, z: -2, parent: u });
    const cap = ball(12, M(c.cap, 0.55, { emissive: 0xffd6a0, emissiveIntensity: 0.12 }), { x: 0, y: 14, z: -2, parent: u }); cap.scale.set(1, 0.95, 1);
    cyl(11.5, 11.5, 1, M(c.cap2, 0.7), { x: 0, y: 14.2, z: -2, parent: u });
    for (const [x, y] of [[-6, 22], [5, 24], [0, 19], [8, 18], [-8, 17]]) { const d = ball(1.9, M(0xfffaf2, 0.6), { x, y, z: 8.5, parent: u }); d.scale.set(1, 1, 0.4); }
  }
  {
    const g = item('desk_lamp'), c = colours('desk_lamp'), u = onTop(g, 'desk_lamp');
    cyl(10, 11, 2.5, M(c.arm, 0.4), { x: 0, y: 1.2, z: -2, parent: u });
    tube([[0, 2, -2], [2, 22, -2], [10, 40, -2], [6, 46, -2]], 1.1, M(c.arm, 0.4), u, 20);
    lathe([[0.01, 12], [3, 12], [9, 5], [13, 0], [12, 0], [7, 4.5], [0.01, 10]], M(c.shade, 0.5), { x: 12, y: 33, z: -2, rz: -0.55, parent: u });
    ball(4, glow(0xffe0a0, 1.6), { x: 13, y: 33, z: -2, parent: u });
  }
  {
    const g = item('pencil_cup'), c = colours('pencil_cup'), u = onTop(g, 'pencil_cup');
    lathe([[0.01, 0], [7.5, 0], [8.5, 20], [7.3, 20], [6.4, 1.4], [0.01, 1.4]], M(c.cup, 0.45), { x: 0, y: 0, z: -2, parent: u });
    torus(8, 0.8, M(c.cup2, 0.45), { x: 0, y: 20, z: -2, rx: Math.PI / 2, parent: u });
    for (const [x, col, h, rz] of [[-3, 0xf2c14e, 31, 0.18], [1, 0x4f8fdc, 29, -0.06], [4, 0xe0677a, 27, -0.2]]) cyl(1.1, 1.1, h, M(col, 0.5), { x: x + Math.sin(-rz) * h / 4, y: h / 2 + 2, z: -2, rz, parent: u });
  }
  {
    const g = item('notebook'), c = colours('notebook'), u = onTop(g, 'notebook');
    for (const s of [-1, 1]) {
      box(20, 1.6, 26, M(c.cover, 0.6), { x: s * 10.4, y: 0.8 + (s > 0 ? 0.6 : 0), z: -2, rz: s * -0.06, r: 0.5, parent: u });
      box(19, 2.4, 24.5, M(0xfffaf0, 0.8), { x: s * 9.8, y: 2.4 + (s > 0 ? 0.6 : 0), z: -2, rz: s * -0.08, r: 0.6, parent: u });
      for (let i = 0; i < 4; i++) box(13, 0.2, 0.6, M(0xb9c6d4, 0.7), { x: s * 10, y: 3.7 + (s > 0 ? 0.6 : 0), z: -10 + i * 5, rz: s * -0.08, parent: u });
    }
    cyl(0.9, 0.9, 26, M(0xe07a8b, 0.5), { x: 6, y: 5, z: -2, rx: Math.PI / 2, rz: 0.5, ry: 0.4, parent: u });
  }
  {
    const g = item('mug'), c = colours('mug'), u = onTop(g, 'mug');
    lathe([[0.01, 0], [7, 0], [7.6, 17], [6.6, 17], [6, 1.4], [0.01, 1.4]], M(c.mug, 0.4), { x: 0, y: 0, z: -2, parent: u });
    torus(4.4, 1.3, M(c.mug2, 0.4), { x: 8, y: 9, z: -2, parent: u });
    cyl(6.4, 6.4, 0.6, M(0x8a5a35, 0.25), { x: 0, y: 15, z: -2, parent: u });
  }
  {
    const g = item('desk_plant'), c = colours('desk_plant'), u = onTop(g, 'desk_plant');
    lathe([[0.01, 0], [7, 0], [9, 14], [10, 14], [10, 16], [8.5, 16], [0.01, 15]], M(c.pot, 0.6), { x: 0, y: 0, z: -2, parent: u });
    torus(9.6, 0.9, M(c.pot2, 0.6), { x: 0, y: 14, z: -2, rx: Math.PI / 2, parent: u });
    for (let i = 0; i < 8; i++) { const a = -1.1 + (2.2 * i) / 7; leaf(15 + (i % 2) * 3, 4, M([0x5fa45b, 0x74b768, 0x4f9455][i % 3], 0.5), { x: 0, y: 15, z: -2 + (i % 2 ? 2 : -2), rz: -a * 0.8, rx: (i % 2 ? 0.2 : -0.2), parent: u }); }
  }

  // ------------------------------------------------------------------ the rest of the catalog (home-more.js)
  more({ THREE, M, glow, box, ball, cyl, lathe, torus, leaf, part, item, colours, onFloor, onWall, onTop, tube, sag, starGeo, heartGeo, mesh, books, curtain, bigLeaves, solveTop, UX, UY, rugFrame, flat, rnd, STAGE, ON });

  // ------------------------------------------------------------------ what the cut script needs to know
  const support = Object.fromEntries(Object.entries(ON).map(([k, v]) => [k, v]));
  const projBox = (g) => { const b = new THREE.Box3().setFromObject(g); if (b.isEmpty()) return null; const xs = [], ys = []; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const p = raw(x, y, z); xs.push(p[0]); ys.push(p[1]); } return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(1)); };
  window.__rect = JSON.stringify({ stage: STAGE, support, boxes: Object.fromEntries(Object.entries(groups).map(([n, g]) => [n, projBox(g)])),
    wallTop: raw(0, wallH, 0)[1], capTop: raw(0, wallH + 0.05, -T)[1], floorFront: raw(0, 0, zFront)[1], slabBottom: raw(0, -0.215, zFront)[1], sideL: raw(xL, 0, zFront)[0] });
  select(q, groups);
  view(cam, q, 840, 1540);
  return cam;
}
