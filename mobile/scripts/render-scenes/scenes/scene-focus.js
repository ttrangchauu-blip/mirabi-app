// Phòng tập trung. One camera; each thing of the room's starting layout stands where room-art.json's default layout puts it on the
// 640 x 440 canvas, so a patch of the picture can be drawn at any item's place. `show=` keeps some of them, `mask=` makes a cut-out,
// `floor=tile` swaps the floor.
import { studyKit } from './study-kit.js';
export async function build({ THREE, scene }) {
  const q = new URLSearchParams(location.search);
  const K = studyKit(THREE, scene);
  const { mat, glow, box, ball, cyl, lathe, torus, leaf, part, canvasCamera, view, select, planks, tiles, curtain, archWindow, bookcase, pot, bigLeaves, smallPlant, stack, rnd } = K;
  K.sky({ top: 0xf4f6fb, mid: 0xf8f4ee, low: 0xe4dcd0, power: 0.66, sun: { dir: [-0.58, 0.8, 0.72], size: 9, power: 46, color: 0xfff0d6 } });
  const { cam, floorAt, wallAt, project } = canvasCamera(640, 440, [1.7, 3.75, 15], [0.02, 0.72, 0], 16.7);

  // ------------------------------------------------------------------ the room itself
  const paintM = mat(0xe9e9e9, 0.88), oak = mat(0xd8b78f, 0.52), oakDark = mat(0xbf9c75, 0.56), oakPale = mat(0xe8d0b0, 0.5), white = mat(0xfbf7f0, 0.55);
  const paint = part('paint'), shell = part('shell'), floor = part('floor');
  const xL = wallAt(10, 200).x, xR = wallAt(630, 200).x, railY = 0.98;
  box(xR - xL + 0.4, 9, 0.1, paintM, { x: (xL + xR) / 2, y: 4.5, z: -0.05, parent: paint });
  box(0.1, 9, 0.5, paintM, { x: xL - 0.05, y: 4.5, z: 0.2, parent: paint });
  box(0.1, 9, 0.5, paintM, { x: xR + 0.05, y: 4.5, z: 0.2, parent: paint });
  // Wainscot: planks of wood below a rail, on the back wall and the sides.
  box(xR - xL, railY, 0.03, oakDark, { x: (xL + xR) / 2, y: railY / 2, z: 0.015, parent: shell });
  for (let x = xL + 0.03; x < xR - 0.2; x += 0.47) box(0.44, railY - 0.2, 0.03, oak, { x: x + 0.22, y: railY / 2 + 0.03, z: 0.032, r: 0.012, parent: shell });
  box(xR - xL, 0.07, 0.07, oakPale, { x: (xL + xR) / 2, y: railY, z: 0.04, r: 0.02, parent: shell });
  box(xR - xL, 0.1, 0.05, oakPale, { x: (xL + xR) / 2, y: 0.05, z: 0.04, r: 0.012, parent: shell });
  for (const [x, s] of [[xL + 0.012, 1], [xR - 0.012, -1]]) {
    box(0.03, railY, 0.5, oakDark, { x, y: railY / 2, z: 0.2, parent: shell });
    box(0.05, 0.07, 0.5, oakPale, { x: x + s * 0.02, y: railY, z: 0.2, r: 0.02, parent: shell });
  }
  // High up, only seen in photo mode: a picture rail and a soft line of wood.
  box(xR - xL, 0.09, 0.08, oakPale, { x: (xL + xR) / 2, y: 3.72, z: 0.05, r: 0.024, parent: shell });
  box(xR - xL, 0.05, 0.05, oakPale, { x: (xL + xR) / 2, y: 3.55, z: 0.04, r: 0.016, parent: shell });
  {
    const shelfY = 4.5, sx = -1.55;
    box(1.5, 0.05, 0.26, oakPale, { x: sx, y: shelfY, z: 0.14, r: 0.014, parent: shell });
    for (const dx of [-0.55, 0.55]) box(0.04, 0.16, 0.2, oakDark, { x: sx + dx, y: shelfY - 0.1, z: 0.12, parent: shell });
    stack(shell, sx - 0.4, shelfY + 0.025, 0.14, 0.34, [0x7aa6d8, 0xe9c46a, 0xb79bdc], 0.06);
    smallPlant(shell, sx + 0.12, shelfY + 0.025, 0.14, 1.1, 0xf0e6d6);
    smallPlant(shell, sx + 0.5, shelfY + 0.025, 0.14, 0.85, 0xd98f6c);
    [[1.25, 4.45, 0.62, 0.8, 0xf6e3b4], [2.05, 4.62, 0.5, 0.5, 0xcfe3fb], [2.05, 4.0, 0.5, 0.44, 0xf8c6d2]].forEach(([x, y, w, h, c]) => {
      box(w, h, 0.04, oak, { x, y, z: 0.03, r: 0.012, parent: shell });
      box(w - 0.1, h - 0.1, 0.012, mat(c, 0.8), { x, y, z: 0.055, r: 0.004, parent: shell });
      ball(0.05, mat(0xffffff, 0.5), { x, y, z: 0.07, parent: shell });
    });
    const cord = cyl(0.008, 0.008, 3, mat(0x6b5a48, 0.6), { x: 0.05, y: 6.2, z: 0.9, parent: shell });
    lathe([[0.001, 0.3], [0.05, 0.3], [0.2, 0.14], [0.36, 0], [0.34, 0], [0.18, 0.12], [0.001, 0.26]], mat(0xf3e2c0, 0.5), { x: 0.05, y: 4.45, z: 0.9, parent: shell });
    ball(0.09, glow(0xffdf9e, 2.2), { x: 0.05, y: 4.5, z: 0.9, parent: shell });
  }
  if (q.get('floor') === 'tile') tiles(floor, xL - 1, xR + 1, 0, 12); else planks(floor, xL - 1, xR + 1, 0, 12);

  // ------------------------------------------------------------------ the starting layout
  const groups = {};
  const item = (name) => (groups[name] = part(name));

  // Window: (320, 118), glass ±46 across and -64..62 down, curtains out to ±107.
  {
    const g = item('window'), frame = part('window.frame', g), left = part('window.curtainL', g), right = part('window.curtainR', g);
    const C = wallAt(320, 118, 0.02), yTop = wallAt(320, 118 - 64, 0.02).y, yBot = wallAt(320, 118 + 62, 0.02).y, r = 0.46;
    archWindow(frame, C.x, yBot, yTop, r, 0.02, white, oakPale);
    const rodY = wallAt(320, 118 - 88, 0.1).y;
    cyl(0.018, 0.018, 2.2, mat(0xc9975e, 0.42), { x: C.x, y: rodY, z: 0.14, rz: Math.PI / 2, parent: frame });
    for (const s of [-1, 1]) { ball(0.04, mat(0xc9975e, 0.42), { x: C.x + s * 1.11, y: rodY, z: 0.14, parent: frame }); box(0.025, 0.09, 0.14, mat(0xc9975e, 0.42), { x: C.x + s * 0.96, y: rodY + 0.015, z: 0.07, parent: frame }); }
    const cloth = 0xc9bbef, h = rodY - wallAt(320, 118 + 86, 0.1).y;
    curtain(left, C.x - 1.05, rodY - 0.005, 0.1, 0.62, h, cloth, -1);
    curtain(right, C.x + 1.05, rodY - 0.005, 0.1, 0.62, h, cloth, 1);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, tie = i ? right : left, x = C.x + s * 0.84;
      box(0.3, 0.035, 0.1, mat(0xa794dc, 0.8), { x, y: rodY - h * 0.62, z: 0.17, r: 0.014, parent: tie });
    }
    // The curtains are the two meshes `curtain` adds to the scene's own children: move them into their groups.
    scene.children.filter((m) => m.isMesh && m.geometry.type === 'PlaneGeometry').forEach((m) => (m.position.x < C.x ? left : right).add(m));
  }
  // Pinboard: (136, 116), ±50 x ±35.
  {
    const g = item('memo_board'), C = wallAt(136, 116, 0.03), w = 0.98, h = 0.68;
    box(w, h, 0.05, oak, { x: C.x, y: C.y, z: 0.03, r: 0.02, parent: g });
    box(w - 0.1, h - 0.1, 0.02, mat(0xe7c99c, 0.92), { x: C.x, y: C.y, z: 0.055, r: 0.006, parent: g });
    [[-0.28, 0.14, 0xfff3c0, 0.2, 0.15, 0.06], [-0.04, 0.17, 0xf8c6d2, 0.14, 0.13, -0.08], [0.2, 0.13, 0xbfe5d2, 0.17, 0.16, 0.05], [-0.26, -0.13, 0xcfe3fb, 0.2, 0.14, -0.05], [0.03, -0.11, 0xfff8ea, 0.22, 0.17, 0.04], [0.28, -0.14, 0xffe0a6, 0.13, 0.12, -0.1]].forEach(([dx, dy, c, nw, nh, rz], i) => {
      box(nw, nh, 0.006, mat(c, 0.86), { x: C.x + dx, y: C.y + dy, z: 0.07, rz, r: 0.002, parent: g });
      ball(0.014, mat([0xe05d5d, 0x4f8fdc, 0xf0b73c][i % 3], 0.4), { x: C.x + dx, y: C.y + dy + nh * 0.36, z: 0.08, parent: g });
    });
  }
  // Clock: (470, 64), radius 24: the hands are live, in the app.
  {
    const g = item('wall_clock'), C = wallAt(470, 66, 0.04);
    cyl(0.235, 0.245, 0.05, oak, { x: C.x, y: C.y, z: 0.04, rx: Math.PI / 2, parent: g });
    cyl(0.2, 0.2, 0.02, mat(0xdff3e6, 0.5), { x: C.x, y: C.y, z: 0.07, rx: Math.PI / 2, parent: g });
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, l = i % 3 ? 0.012 : 0.02; box(0.012, l * 2, 0.006, mat(0x46645a, 0.5), { x: C.x + Math.sin(a) * 0.165, y: C.y + Math.cos(a) * 0.165, z: 0.082, rz: -a, parent: g }); }
  }
  // Calendar: (500, 150).
  {
    const g = item('calendar'), C = wallAt(500, 148, 0.02);
    box(0.4, 0.5, 0.012, mat(0xfffaf0, 0.72), { x: C.x, y: C.y, z: 0.02, r: 0.004, parent: g });
    box(0.4, 0.12, 0.018, mat(0xe0695f, 0.6), { x: C.x, y: C.y + 0.19, z: 0.024, r: 0.006, parent: g });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) box(0.04, 0.04, 0.004, mat(r === 2 && c === 3 ? 0xe0695f : 0xc8d2db, 0.7), { x: C.x - 0.13 + c * 0.065, y: C.y + 0.08 - r * 0.07, z: 0.028, parent: g });
  }
  // Rug: (320, 400), ±119 across, ±33 deep.
  {
    const g = item('rug_oval'), c = floorAt(320, 400, 0.02), rx = Math.abs(floorAt(320 + 118, 400).x - floorAt(320, 400).x), rz = Math.abs(floorAt(320, 433).z - floorAt(320, 367).z) / 2;
    const flat = (r, y, m) => { const o = cyl(r, r, 0.012, m, { x: c.x, y, z: c.z, parent: g }); o.scale.set(rx, 1, rz); return o; };
    flat(1, 0.012, mat(0xb6a3e4, 0.96)); flat(0.86, 0.02, mat(0xa691dc, 0.97)); flat(0.8, 0.024, mat(0xbcaae8, 0.97)); flat(0.42, 0.027, mat(0xa892dd, 0.97));
    for (let i = 0; i < 54; i++) { const a = i / 54 * Math.PI * 2; box(0.05, 0.006, 0.016, mat(0xf4efff, 0.8), { x: c.x + Math.cos(a) * rx * 0.83, y: 0.03, z: c.z + Math.sin(a) * rz * 0.83, ry: -a + Math.PI / 2, parent: g }); }
  }
  // Desk: (320, 352) its front feet; desk top at canvas y of about 266 at its middle. With its chair behind it.
  const front = floorAt(320, 352);
  const dW = 1.7, dD = 0.82, dH = 0.8, dz = front.z - dD / 2, dx = front.x;
  {
    const g = item('desk'), body = part('desk.body', g), chair = part('desk.chair', g);
    box(dW, 0.07, dD, oakPale, { x: dx, y: dH - 0.035, z: dz, r: 0.022, parent: body });
    for (const s of [-1, 1]) {
      const px = dx + s * (dW / 2 - 0.25);
      box(0.44, dH - 0.08, dD - 0.08, oak, { x: px, y: (dH - 0.08) / 2 + 0.02, z: dz, r: 0.016, parent: body });
      for (let i = 0; i < 3; i++) {
        const y = 0.16 + i * 0.205;
        box(0.38, 0.17, 0.02, oakPale, { x: px, y, z: dz + dD / 2 - 0.035, r: 0.008, parent: body });
        ball(0.018, mat(0xb98a55, 0.36), { x: px, y, z: dz + dD / 2 - 0.018, parent: body });
      }
    }
    box(dW - 0.9, dH - 0.2, 0.03, oak, { x: dx, y: 0.14 + (dH - 0.2) / 2, z: dz + 0.1, r: 0.01, parent: body });
    const cz = dz - dD / 2 - 0.1;
    cyl(0.25, 0.25, 0.06, mat(0xa58fdc, 0.85), { x: dx - 0.16, y: 0.52, z: cz, parent: chair });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(0.022, 0.018, 0.5, oak, { x: dx - 0.16 + a * 0.17, y: 0.25, z: cz + b * 0.13, parent: chair });
    box(0.5, 0.56, 0.05, oak, { x: dx - 0.16, y: 0.86, z: cz - 0.24, r: 0.024, parent: chair });
  }
  const topAt = (cx, cy) => floorAt(cx, cy, dH);
  // On the desk, standing where their anchors say.
  { const g = item('book_stack'), p = topAt(256, 266); stack(g, p.x, dH, p.z, 0.3, [0x7aa6d8, 0xb79bdc, 0x8fc1a9, 0x6fb7c4]); }
  {
    const g = item('desk_lamp'), p = topAt(384, 266), brass = mat(0xd3a960, 0.34), shade = mat(0xe9c777, 0.5);
    cyl(0.1, 0.11, 0.025, brass, { x: p.x, y: dH + 0.012, z: p.z, parent: g });
    const arc = new THREE.CatmullRomCurve3([new THREE.Vector3(p.x, dH, p.z), new THREE.Vector3(p.x + 0.02, dH + 0.22, p.z), new THREE.Vector3(p.x + 0.09, dH + 0.42, p.z), new THREE.Vector3(p.x - 0.03, dH + 0.5, p.z)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 24, 0.012, 10), brass));
    lathe([[0.001, 0.13], [0.03, 0.13], [0.08, 0.06], [0.12, 0], [0.11, 0], [0.07, 0.05], [0.001, 0.1]], shade, { x: p.x - 0.09, y: dH + 0.41, z: p.z, rz: 0.25, parent: g });
    ball(0.05, glow(0xffd98a, 2.2), { x: p.x - 0.1, y: dH + 0.42, z: p.z, parent: g });
  }
  {
    const g = item('mug'), p = topAt(352, 266), m = mat(0xfbf3e4, 0.42);
    lathe([[0.001, 0], [0.05, 0], [0.055, 0.1], [0.046, 0.1], [0.04, 0.012], [0.001, 0.012]], m, { x: p.x, y: dH, z: p.z, parent: g });
    torus(0.028, 0.008, m, { x: p.x + 0.06, y: dH + 0.05, z: p.z, parent: g });
    cyl(0.044, 0.044, 0.004, mat(0x8a5a35, 0.25), { x: p.x, y: dH + 0.085, z: p.z, parent: g });
  }
  // Bookcase: (566, 330); its top at canvas y = 160.
  const bcF = floorAt(566, 330), bcD = 0.5, bcH = 1.62, bcZ = Math.max(bcD / 2 + 0.03, bcF.z - bcD / 2);
  { const g = item('bookcase'); bookcase(g, bcF.x, bcZ, 0.95, bcH, bcD, oak, oakDark, 4); }
  { const g = item('desk_plant'); smallPlant(g, bcF.x, bcH, bcZ, 1.25, 0xd98f6c); }
  // Monstera: (74, 424), 136 high.
  {
    const g = item('plant_monstera'), potG = part('plant_monstera.pot', g), leaves = part('plant_monstera.leaves', g), p = floorAt(74, 418);
    pot(potG, p.x, 0, p.z, 0.24, 0.42, 0xd98f6c);
    bigLeaves(leaves, p.x, 0.36, p.z, 0.9, 13);
  }
  // ------------------------------------------------------------------ the room's own: always there, and not in anyone's layout
  {
    const g = item('extras'), o = floorAt(528, 408), b = floorAt(150, 372);
    lathe([[0.001, 0], [0.27, 0], [0.34, 0.06], [0.36, 0.14], [0.33, 0.25], [0.22, 0.31], [0.001, 0.33]], mat(0xf5ecdc, 0.92), { x: o.x, y: 0, z: o.z, parent: g });
    ball(0.035, mat(0xd8c6ab, 0.8), { x: o.x, y: 0.325, z: o.z, sy: 0.5, parent: g });
    stack(g, b.x, 0, b.z, 0.42, [0x6fb7c4, 0xb79bdc, 0xe9c46a], 0.07);
  }
  // Leaves close to the camera at the corners, which move in the app. They are cut by mask alone.
  {
    const g = item('fore'), left = part('fore.left', g), right = part('fore.right', g), vine = part('fore.vine', g);
    const bl = floorAt(-6, 440, 0.2), br = floorAt(646, 440, 0.2);
    const fan = (parent, p, dir, n, s) => { for (let i = 0; i < n; i++) { const a = dir * (0.1 + i * (1.15 / n)) + (rnd() - 0.5) * 0.1; leaf(s * (0.75 + rnd() * 0.3), s * 0.27, mat([0x79b86b, 0x5fa45b, 0x8cc677][i % 3], 0.5), { x: p.x, y: p.y, z: p.z, rz: -a, rx: 0.25 + rnd() * 0.25, parent }); } };
    fan(left, bl, 1, 5, 0.5); fan(right, br, -1, 5, 0.48);
    const t = wallAt(636, -6, 0.12);
    for (let i = 0; i < 9; i++) { const y = t.y - i * 0.1, x = t.x - 0.1 - i * 0.012; leaf(0.17, 0.06, mat([0x79b86b, 0x5fa45b][i % 2], 0.52), { x: x + (i % 2 ? 0.03 : -0.03), y, z: 0.14, rz: (i % 2 ? -1 : 1) * 2.3, parent: vine }); }
  }
  window.__rect = JSON.stringify({ glass: [project(wallAt(320, 118).x - 0.46, wallAt(320, 118 - 64).y, 0.02), project(wallAt(320, 118).x + 0.46, wallAt(320, 118 + 62).y, 0.02)], deskTop: project(dx, dH, dz), floorL: project(xL, 0, 0), floorR: project(xR, 0, 0), seat: project(dx - 0.16, 0.55, dz - dD / 2 - 0.1) });
  select(q, groups);
  view(cam, q, 1280, 880);
  return cam;
}
