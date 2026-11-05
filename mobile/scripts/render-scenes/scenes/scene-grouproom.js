// Phòng học cùng bạn bè: wider than the focus room and seen from further away. A long table in the middle, five chairs behind it and three
// poufs in front, as patches (a room shows as many seats as it has). The table comes again as a cut-out over the back row. The glass and what
// is on the board are live, in the app. `show=` keeps some things, `mask=` makes a cut-out. Prints where each seat's pet goes.
import { studyKit } from './study-kit.js';
export async function build({ THREE, scene }) {
  const q = new URLSearchParams(location.search);
  const K = studyKit(THREE, scene);
  const { mat, glow, box, ball, cyl, lathe, leaf, part, canvasCamera, view, select, planks, curtain, archWindow, bookcase, pot, bigLeaves, smallPlant, stack, rnd } = K;
  K.sky({ top: 0xf4f6fb, mid: 0xf8f4ee, low: 0xe4dcd0, power: 0.7, sun: { dir: [-0.58, 0.8, 0.72], size: 9, power: 44, color: 0xfff0d6 } });
  const { cam, floorAt, wallAt, project } = canvasCamera(640, 440, [2.3, 6.1, 21], [0.05, 0.42, 0], 17.6);

  // ------------------------------------------------------------------ the room
  const paintM = mat(0xcfe0f2, 0.88), oak = mat(0xd8b78f, 0.52), oakDark = mat(0xbf9c75, 0.56), oakPale = mat(0xe8d0b0, 0.5), white = mat(0xfbf7f0, 0.55);
  const room = part('room');
  const xL = wallAt(8, 200).x, xR = wallAt(632, 200).x, railY = 0.92;
  box(xR - xL + 0.4, 12, 0.1, paintM, { x: (xL + xR) / 2, y: 6, z: -0.05, parent: room });
  box(0.1, 12, 0.5, paintM, { x: xL - 0.05, y: 6, z: 0.2, parent: room });
  box(0.1, 12, 0.5, paintM, { x: xR + 0.05, y: 6, z: 0.2, parent: room });
  box(xR - xL, railY, 0.03, oakDark, { x: (xL + xR) / 2, y: railY / 2, z: 0.015, parent: room });
  for (let x = xL + 0.03; x < xR - 0.2; x += 0.5) box(0.47, railY - 0.2, 0.03, oak, { x: x + 0.235, y: railY / 2 + 0.03, z: 0.032, r: 0.012, parent: room });
  box(xR - xL, 0.08, 0.07, oakPale, { x: (xL + xR) / 2, y: railY, z: 0.04, r: 0.02, parent: room });
  box(xR - xL, 0.11, 0.05, oakPale, { x: (xL + xR) / 2, y: 0.055, z: 0.04, r: 0.012, parent: room });
  box(xR - xL, 0.1, 0.08, oakPale, { x: (xL + xR) / 2, y: 4.9, z: 0.05, r: 0.024, parent: room });
  const floor = part('roomfloor', room);
  planks(floor, xL - 1, xR + 1, 0, 18, 0xdfb98a);

  // A wide round rug under the table.
  {
    const c = floorAt(320, 352, 0.02), rx = Math.abs(floorAt(320 + 268, 352).x - floorAt(320, 352).x), rz = Math.abs(floorAt(320, 428).z - floorAt(320, 276).z) / 2;
    const flat = (r, y, col) => { const o = cyl(r, r, 0.012, mat(col, 0.96), { x: c.x, y, z: c.z, parent: room }); o.scale.set(rx, 1, rz); return o; };
    flat(1, 0.012, 0x9fc4dd); flat(0.9, 0.02, 0xb4d4e6); flat(0.84, 0.024, 0xa6cbe0);
  }
  // Window, with long curtains: the glass is at (112, 110), ±42 x ±58.
  const GX = 112, GY = 110;
  {
    const g = part('win', room), frame = part('win.frame', g), left = part('win.curtainL', g), right = part('win.curtainR', g);
    const C = wallAt(GX, GY, 0.02), top = wallAt(GX, GY - 58, 0.02).y, bot = wallAt(GX, GY + 58, 0.02).y, r = Math.abs(wallAt(GX + 42, GY, 0.02).x - C.x);
    archWindow(frame, C.x, bot, top, r, 0.02, white, oakPale);
    const rodY = wallAt(GX, GY - 84, 0.1).y, h = rodY - wallAt(GX, GY + 92, 0.1).y;
    cyl(0.02, 0.02, 2.5, mat(0xc9975e, 0.42), { x: C.x, y: rodY, z: 0.14, rz: Math.PI / 2, parent: frame });
    for (const s of [-1, 1]) ball(0.05, mat(0xc9975e, 0.42), { x: C.x + s * 1.26, y: rodY, z: 0.14, parent: frame });
    const a = curtain(left, C.x - 1.18, rodY, 0.1, 0.62, h, 0xc6d4ef, -1), b = curtain(right, C.x + 1.18, rodY, 0.1, 0.62, h, 0xc6d4ef, 1);
    left.add(a); right.add(b);
    for (let i = 0; i < 2; i++) box(0.3, 0.035, 0.1, mat(0x9fb4de, 0.8), { x: C.x + (i ? 1 : -1) * 0.97, y: rodY - h * 0.62, z: 0.17, r: 0.014, parent: i ? right : left });
  }
  // The board: (340, 112), ±110 x ±58, its frame and tray. What is written on it is live.
  {
    const g = part('board', room), C = wallAt(338, 104, 0.03), hw = Math.abs(wallAt(432, 104, 0.03).x - C.x), hh = Math.abs(wallAt(338, 154, 0.03).y - C.y);
    box(hw * 2 + 0.12, hh * 2 + 0.12, 0.05, oak, { x: C.x, y: C.y, z: 0.03, r: 0.024, parent: g });
    box(hw * 2, hh * 2, 0.02, mat(0x3f7f8c, 0.86), { x: C.x, y: C.y, z: 0.06, r: 0.006, parent: g });
    box(hw * 2 + 0.1, 0.05, 0.14, oakPale, { x: C.x, y: C.y - hh - 0.08, z: 0.1, r: 0.016, parent: g });
    [[0.6, 0xffffff], [0.8, 0xffd9a0], [-0.7, 0xbfe6ff]].forEach(([dx, c]) => cyl(0.014, 0.014, 0.14, mat(c, 0.75), { x: C.x + dx, y: C.y - hh - 0.04, z: 0.12, rz: 1.57, parent: g }));
  }
  // Bookcase on the right; another low shelf; plants.
  {
    const g = part('shelves', room), F = floorAt(556, 272), z = Math.max(0.33, F.z - 0.25);
    bookcase(g, F.x, z, 1.5, 2.25, 0.5, oak, oakDark, 5);
    smallPlant(g, F.x - 0.3, 2.25, z, 1.5, 0xe9e2d4);
    stack(g, F.x + 0.34, 2.25, z, 0.42, [0x7aa6d8, 0xe9c46a, 0xb79bdc], 0.07);
    const L = floorAt(30, 272); pot(g, L.x + 0.15, 0, Math.max(0.5, L.z), 0.3, 0.5, 0xe9e2d4);
    bigLeaves(g, L.x + 0.15, 0.44, Math.max(0.5, L.z), 1.25, 13);
  }
  // Two lamps from the ceiling, in front of the wall.
  {
    const g = part('lamps', room);
    for (const cx of [230, 450]) {
      const p = wallAt(cx, 28, 1.6);
      cyl(0.008, 0.008, 6, mat(0x6b5a48, 0.6), { x: p.x, y: p.y + 3.2, z: 1.6, parent: g });
      lathe([[0.001, 0.26], [0.05, 0.26], [0.16, 0.12], [0.3, 0], [0.285, 0], [0.15, 0.1], [0.001, 0.22]], mat(0xf3e2c0, 0.5), { x: p.x, y: p.y, z: 1.6, parent: g });
      ball(0.08, glow(0xffdf9e, 2.4), { x: p.x, y: p.y + 0.04, z: 1.6, parent: g });
    }
  }
  // ------------------------------------------------------------------ the table and the seats
  const front = floorAt(320, 338), tW = 5.5, tD = 1.4, tH = 0.82, tz = front.z - tD / 2, tx = front.x;
  const groups = { room };
  {
    const g = (groups.table = part('table'));
    box(tW, 0.11, tD, oakPale, { x: tx, y: tH - 0.045, z: tz, r: 0.03, parent: g });
    box(tW - 0.24, 0.22, tD - 0.22, oak, { x: tx, y: tH - 0.2, z: tz, r: 0.02, parent: g });
    for (let i = -2; i <= 2; i++) { box(0.86, 0.15, 0.02, oakPale, { x: tx + i * 1.02, y: tH - 0.2, z: tz + (tD - 0.22) / 2 + 0.005, r: 0.008, parent: g }); ball(0.02, mat(0xb98a55, 0.36), { x: tx + i * 1.02, y: tH - 0.2, z: tz + (tD - 0.22) / 2 + 0.03, parent: g }); }
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.2, tH - 0.08, 0.2, oak, { x: tx + a * (tW / 2 - 0.26), y: (tH - 0.08) / 2, z: tz + b * (tD / 2 - 0.2), r: 0.03, parent: g });
    // Things along the table's two ends and middle, kept away from the seats.
    stack(g, tx - tW / 2 + 0.34, tH, tz + 0.2, 0.42, [0x8fc1a9, 0xf2a98f, 0x7aa6d8], 0.07);
    stack(g, tx + tW / 2 - 0.4, tH, tz + 0.25, 0.42, [0xb79bdc, 0xe9c46a], 0.07);
    smallPlant(g, tx, tH, tz + 0.4, 1.1, 0xd98f6c);
  }
  const seats = [];
  const back = [-2, -1, 0, 1, 2], fr = [-1, 0, 1];
  back.forEach((s, i) => {
    const g = (groups[`seat${i}`] = part(`seat${i}`)), x = tx + s * 1.02, z = tz - tD / 2 - 0.3;
    cyl(0.27, 0.27, 0.07, mat(0xa9c4e8, 0.85), { x, y: 0.56, z, parent: g });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(0.024, 0.02, 0.54, oak, { x: x + a * 0.18, y: 0.27, z: z + b * 0.14, parent: g });
    cyl(0.024, 0.024, 0.62, oak, { x: x - 0.22, y: 0.88, z: z - 0.26, parent: g }); cyl(0.024, 0.024, 0.62, oak, { x: x + 0.22, y: 0.88, z: z - 0.26, parent: g });
    box(0.56, 0.3, 0.06, oakPale, { x, y: 1.16, z: z - 0.26, r: 0.05, parent: g });
    box(0.44, 0.05, 0.03, oak, { x, y: 0.86, z: z - 0.26, r: 0.012, parent: g });
    seats.push({ row: 'back', foot: project(x, tH, z + 0.34) });
  });
  fr.forEach((s, i) => {
    const g = (groups[`seat${5 + i}`] = part(`seat${5 + i}`)), x = tx + s * 1.5, z = tz + tD / 2 + 1.75;
    lathe([[0.001, 0], [0.3, 0], [0.37, 0.06], [0.38, 0.16], [0.34, 0.27], [0.22, 0.32], [0.001, 0.34]], mat([0xf4ead8, 0xdce6f6, 0xe9dff5][i], 0.92), { x, y: 0, z, parent: g });
    seats.push({ row: 'front', foot: project(x, 0.3, z) });
  });
  // Leaves close to the camera at the corners, which move in the app.
  {
    const g = (groups.fore = part('fore')), left = part('fore.left', g), right = part('fore.right', g);
    const fan = (parent, p, dir, n, s) => { for (let i = 0; i < n; i++) { const a = dir * (0.1 + i * (1.15 / n)) + (rnd() - 0.5) * 0.1; leaf(s * (0.75 + rnd() * 0.3), s * 0.27, mat([0x79b86b, 0x5fa45b, 0x8cc677][i % 3], 0.5), { x: p.x, y: p.y, z: p.z, rz: -a, rx: 0.25 + rnd() * 0.25, parent }); } };
    fan(left, floorAt(-6, 440, 0.2), 1, 5, 0.72); fan(right, floorAt(646, 440, 0.2), -1, 5, 0.7);
  }
  window.__rect = JSON.stringify({ seats, glass: [GX, GY, project(0, 0, 0)], tableTop: project(tx, tH, tz) });
  select(q, groups);
  view(cam, q, 1280, 880);
  return cam;
}
