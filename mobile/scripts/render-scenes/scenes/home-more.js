// The rest of Nhà của Pet's catalog, modelled like scene-home.js's own items: in canvas units round their anchor (x across, y up, z towards the
// camera; a floor thing's front at z 0), each as large as its catalog box, in the colours of the variant asked for.
export const MORE = {
  wall: ['window_round', 'painting_hills', 'lantern_shelf', 'poster', 'calendar', 'curtains', 'element_banner', 'note_board', 'framed_painting', 'cuckoo_clock', 'wind_chime', 'leaf_wreath', 'lace_curtain'],
  floor: ['side_table', 'pouf', 'pet_cushion', 'pet_house', 'small_pot', 'mushroom_lamp', 'computer_desk', 'low_table', 'swivel_chair', 'armchair', 'bean_bag', 'low_cabinet', 'drawer_chest', 'easel', 'floor_cushion', 'sofa', 'heart_leaf_pot', 'flower_pot_mini', 'bouncy_ball', 'ring_toy', 'paper_box', 'play_tunnel', 'wicker_stool', 'tea_table', 'mini_bookshelf', 'seat_cushion', 'woven_basket', 'star_pillow', 'small_blanket'],
  rug: ['knit_rug_round', 'leaf_rug'],
  top: ['flower_vase', 'laptop', 'fish_tank', 'globe', 'record_player', 'element_crystal', 'cactus_mini', 'bonsai', 'story_book', 'pocket_notebook', 'pencil_case', 'desk_globe', 'bud_vase', 'mini_statue', 'wave_jar', 'thunder_lamp', 'flame_lamp', 'snow_globe', 'mist_jar'],
};

export function more(c) {
  const { THREE, M, glow, box, ball, cyl, lathe, torus, leaf, part, item, colours, onFloor, onWall, onTop, tube, sag, starGeo, heartGeo, mesh, curtain, bigLeaves, solveTop, UX, UY, rugFrame, flat, rnd, STAGE, ON } = c;
  for (const id of MORE.wall) STAGE[id] ??= [210, 290];
  for (const id of MORE.floor) STAGE[id] ??= [210, 600];
  for (const id of MORE.rug) STAGE[id] ??= [210, 640];
  for (const id of MORE.top) { STAGE[id] ??= [120, 390]; ON[id] = 'desk'; }
  const W = (id) => [item(id), colours(id)];
  const wood = (cc) => M(cc, 0.55);
  const H = (id, dy, depth) => { const [ax, ay] = STAGE[id]; return solveTop(ax, ay, ay + dy, depth * UX(ay)) / UY(ay); };
  const nail = (u, y) => { ball(1.6, M(0xb98a55, 0.4), { x: 0, y, z: 2, parent: u }); };
  const hang = (u, top, y, w) => { tube([[-w, y, 2], [0, top, 2.4], [w, y, 2]], 0.4, M(0x9c7a58, 0.7), u, 6); nail(u, top); };
  const greens = [0x5fa45b, 0x74b768, 0x4f9455];
  /** Clear glass: it lets what is inside show (a tint, a little reflection). */
  /** A turned glass shape (the kit's lathe makes its own material). */
  const glassLathe = (pts, mat, o) => { const m2 = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40), mat); m2.material.side = THREE.DoubleSide; m2.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); o.parent.add(m2); return m2; };
  const glass = (tint = 0xffffff, extra = {}) => new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.4, ior: 1.35, transparent: true, ...extra });
  const sym = (u, cc, x, y, z, s) => {
    // An element's sign: fire, water, grass, ice, lightning or mist (`ef`… say which).
    const m = M(cc.c3 ?? 0xffffff, 0.45), w2 = M(0xffffff, 0.5);
    if (cc.ef === '1') { const f = ball(5 * s, m, { x, y, z, parent: u }); f.scale.set(0.8, 1.25, 0.4); const t = ball(2.6 * s, M(cc.c2, 0.5), { x, y: y - 1 * s, z: z + 1.2 * s, parent: u }); t.scale.set(0.8, 1.2, 0.4); }
    else if (cc.ew === '1') { const d = ball(5 * s, m, { x, y: y - 1.5 * s, z, parent: u }); d.scale.set(1, 1, 0.45); const tip = new THREE.Mesh(new THREE.ConeGeometry(3.6 * s, 7 * s, 24), m); tip.position.set(x, y + 4 * s, z); tip.scale.set(1, 1, 0.45); u.add(tip); }
    else if (cc.eg === '1') { leaf(12 * s, 4 * s, m, { x, y: y - 6 * s, z, rz: -0.3, parent: u }); }
    else if (cc.ei === '1') { for (let i = 0; i < 3; i++) box(1.4 * s, 11 * s, 1 * s, w2, { x, y, z, rz: i * Math.PI / 3, r: 0.4, parent: u }); ball(1.6 * s, m, { x, y, z: z + 0.6 * s, parent: u }); }
    else if (cc.ee === '1') { const sh = new THREE.Shape(); [[1, 6], [-3, 0], [0, 0], [-1, -6], [3, 1], [0, 1], [1, 6]].forEach(([a, b], i) => (i ? sh.lineTo(a * s, b * s) : sh.moveTo(a * s, b * s))); mesh(new THREE.ExtrudeGeometry(sh, { depth: 1 * s, bevelEnabled: true, bevelSize: 0.3 * s, bevelThickness: 0.3 * s }), m, { x, y, z }, u); }
    else { for (const [dx, dy, r] of [[-3, -1, 3], [1, 1, 3.8], [4, -1.5, 2.8]]) ball(r * s, w2, { x: x + dx * s, y: y + dy * s, z, parent: u }).scale.set(1, 1, 0.45); }
  };

  // ================================================================== on the wall
  { // A round window: glass ±40, a deep cream frame with a cross, a small sill.
    const [g] = W('window_round'), u = onWall(g, STAGE.window_round), trim = M(0xfbf8f2, 0.5);
    const ring = new THREE.Shape(); ring.absarc(0, 0, 51, 0, Math.PI * 2, false); const hole = new THREE.Path(); hole.absarc(0, 0, 40, 0, Math.PI * 2, true); ring.holes.push(hole);
    mesh(new THREE.ExtrudeGeometry(ring, { depth: 6, bevelEnabled: true, bevelSize: 1.4, bevelThickness: 1.4, curveSegments: 48 }), trim, { z: 3 }, u);
    const rv = new THREE.Shape(); rv.absarc(0, 0, 40, 0, Math.PI * 2, false); const rh = new THREE.Path(); rh.absarc(0, 0, 39.3, 0, Math.PI * 2, true); rv.holes.push(rh);
    mesh(new THREE.ExtrudeGeometry(rv, { depth: 6, bevelEnabled: false, curveSegments: 48 }), M(0xf1ece4, 0.6), {}, u);
    box(3, 80, 3, trim, { x: 0, y: 0, z: 3, r: 0.8, parent: u }); box(80, 3, 3, trim, { x: 0, y: 0, z: 3, r: 0.8, parent: u });
    box(64, 4, 14, trim, { x: 0, y: -52, z: 7, r: 1.4, parent: u });
  }
  { // A framed landscape on a string.
    const [g, cc] = W('painting_hills'), u = onWall(g, STAGE.painting_hills), cy = -2;
    hang(u, 46, cy + 30, 22);
    box(80, 64, 5, M(cc.frame, 0.55), { x: 2, y: cy, z: 2.5, r: 2, parent: u });
    box(80, 3, 6, M(cc.frame2, 0.55), { x: 2, y: cy - 31, z: 3, r: 1, parent: u });
    box(66, 50, 1, M(0xbfe3f7, 0.8), { x: 2, y: cy, z: 5.2, r: 0.4, parent: u });
    // Two hills inside the picture: shapes cut to its edges.
    for (const [top, mid, col, z] of [[-4, -10, 0x8fd07e, 5.6], [-12, 14, 0x74bf68, 6]]) {
      const sh = new THREE.Shape(); sh.moveTo(-31, cy - 25); sh.lineTo(-31, cy + top); sh.quadraticCurveTo(mid, cy + top + 18, 35, cy + top - 4); sh.lineTo(35, cy - 25); sh.lineTo(-31, cy - 25);
      mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.6, bevelEnabled: false }), M(col, 0.85), { z }, u);
    }
    ball(5.5, M(0xf2d27a, 0.5), { x: 22, y: cy + 14, z: 5.8, parent: u }).scale.set(1, 1, 0.3);
    ball(5, M(0xffffff, 0.8), { x: -14, y: cy + 12, z: 5.8, parent: u }).scale.set(1.8, 0.7, 0.3);
  }
  { // A shelf with a paper lantern and two little stars on sticks.
    const [g, cc] = W('lantern_shelf'), u = onWall(g, STAGE.lantern_shelf);
    box(102, 5, 22, wood(cc.wood), { x: 0, y: -8, z: 11, r: 1.2, parent: u });
    for (const s of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(18, 0); sh.lineTo(0, -20); sh.lineTo(0, 0); mesh(new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.5 }), wood(cc.wood2), { x: s * 34 - 1.5, y: -10.5, z: 0.5, ry: -Math.PI / 2 }, u); }
    lathe([[0.01, 0], [12, 0], [15, 10], [15, 26], [12, 36], [0.01, 36]], M(0xfbefcf, 0.6, { emissive: 0xffe2a8, emissiveIntensity: 0.55 }), { x: 0, y: -5.5, z: 11, parent: u });
    for (const y of [-5.5, 30.5]) cyl(12.5, 12.5, 3, wood(cc.wood2), { x: 0, y: y + 1.5, z: 11, parent: u });
    tube([[0, 33, 11], [0, 40, 11], [-6, 44, 6], [0, 45, 2]], 0.6, M(0x8a6a4a, 0.6), u, 10);
    for (const s of [-1, 1]) { cyl(0.6, 0.6, 18, M(0xc9a05a, 0.5), { x: s * 38, y: 3, z: 13, parent: u }); c.mesh(starGeo(4.2, 1.2), M(0xe9c25a, 0.4), { x: s * 38, y: 13, z: 12.4 }, u); }
  }
  { // A poster pinned at its corners.
    const [g, cc] = W('poster'), u = onWall(g, STAGE.poster);
    box(56, 78, 0.8, M(cc.bg, 0.85), { x: 0, y: 0, z: 1, r: 0.3, parent: u });
    mesh(starGeo(12, 1.2), M(cc.accent, 0.5), { x: 0, y: 14, z: 1.6 }, u);
    for (const [y, w] of [[-12, 32], [-19, 26], [-26, 18]]) box(w, 2.4, 0.5, M(cc.ink, 0.6), { x: 0, y, z: 1.7, r: 0.4, parent: u });
    for (const [x, y] of [[-24, 35], [24, 35]]) ball(1.8, M(0xe7838f, 0.4), { x, y, z: 2.2, parent: u });
  }
  { // A wall calendar on a nail.
    const [g, cc] = W('calendar'), u = onWall(g, STAGE.calendar);
    hang(u, 31, 20, 8);
    box(40, 52, 1.2, M(0xfffaf0, 0.72), { x: 0, y: -3, z: 1.2, r: 0.4, parent: u });
    box(40, 12, 1.8, M(cc.top, 0.6), { x: 0, y: 17, z: 1.6, r: 0.6, parent: u });
    box(30, 2, 0.6, M(0xffffff, 0.6), { x: 0, y: 19, z: 2.6, parent: u });
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) box(5, 4, 0.4, M(r === 1 && k === 2 ? cc.top2 : 0xc8d2db, 0.7), { x: -11 + k * 7.3, y: 6 - r * 7, z: 2.1, parent: u });
    torus(4, 0.7, M(cc.top, 0.5), { x: 3.6, y: -1, z: 2.3, parent: u });
  }
  { // Curtains on a rod, tied back (they stir).
    const [g, cc] = W('curtains'), u = onWall(g, STAGE.curtains), left = part('curtains.curtainL', u), right = part('curtains.curtainR', u), rod = M(cc.rod, 0.42);
    cyl(1.8, 1.8, 206, rod, { x: 0, y: 86, z: 12, rz: Math.PI / 2, parent: u });
    for (const s of [-1, 1]) { ball(3.6, rod, { x: s * 102, y: 86, z: 12, parent: u }); box(2.4, 8, 12, rod, { x: s * 88, y: 88, z: 6, parent: u }); }
    const cloth = new THREE.Color(cc.curtain).lerp(new THREE.Color(0xffffff), 0.18).getHex();
    curtain(left, -100, 85, 10, 50, 170, cloth, -1); curtain(right, 100, 85, 10, 50, 170, cloth, 1);
    for (const [s, tie] of [[-1, left], [1, right]]) box(28, 3.2, 9, M(cc.curtain2, 0.8), { x: s * 80, y: 85 - 170 * 0.62, z: 15, r: 1.2, parent: tie });
  }
  { // A pennant with the element's sign.
    const [g, cc] = W('element_banner'), u = onWall(g, STAGE.element_banner);
    cyl(1.6, 1.6, 46, M(0x9c6b45, 0.5), { x: 0, y: 36, z: 4, rz: Math.PI / 2, parent: u });
    for (const s of [-1, 1]) ball(2.4, M(0x9c6b45, 0.5), { x: s * 23, y: 36, z: 4, parent: u });
    const sh = new THREE.Shape(); sh.moveTo(-20, 34); sh.lineTo(20, 34); sh.lineTo(20, -36); sh.lineTo(0, -26); sh.lineTo(-20, -36); sh.lineTo(-20, 34);
    mesh(new THREE.ExtrudeGeometry(sh, { depth: 1.4, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6 }), M(cc.c1, 0.8), { z: 1.5 }, u);
    const sh2 = new THREE.Shape(); sh2.moveTo(-15, 28); sh2.lineTo(15, 28); sh2.lineTo(15, -28); sh2.lineTo(0, -20); sh2.lineTo(-15, -28); sh2.lineTo(-15, 28);
    mesh(new THREE.ExtrudeGeometry(sh2, { depth: 0.6, bevelEnabled: false }), M(cc.c2, 0.8), { z: 3.4 }, u);
    ball(10, M(cc.c1, 0.6), { x: 0, y: 6, z: 4, parent: u }).scale.set(1, 1, 0.2);
    sym(u, cc, 0, 6, 6, 1.2);
  }
  { // A cloth memo board with criss-cross ribbons, notes and a photo.
    const [g, cc] = W('note_board'), u = onWall(g, STAGE.note_board), cy = -2;
    hang(u, 37, cy + 26, 26);
    box(66, 50, 4, M(0xc49264, 0.55), { x: 0, y: cy, z: 2, r: 2, parent: u });
    box(58, 42, 1.6, M(cc.cloth, 0.95), { x: 0, y: cy, z: 4.2, r: 0.8, parent: u });
    for (const a of [-0.65, 0.65]) for (const dx of [-14, 14]) box(66, 1.4, 0.5, M(0xfff6e4, 0.8), { x: dx, y: cy, z: 5.3, rz: a, parent: u });
    box(14, 12, 0.6, M(0xf6d06a, 0.8), { x: -16, y: cy + 8, z: 5.6, rz: 0.08, parent: u });
    box(15, 15, 0.7, M(0xffffff, 0.6), { x: 14, y: cy + 8, z: 5.6, rz: -0.08, parent: u }); box(12, 9, 0.4, M(0x9ccbe8, 0.7), { x: 14, y: cy + 9, z: 6, rz: -0.08, parent: u });
    box(13, 10, 0.6, M(0xf3a6b8, 0.8), { x: -6, y: cy - 10, z: 5.6, rz: -0.05, parent: u });
    box(13, 11, 0.6, M(0xb9e3a6, 0.8), { x: 14, y: cy - 11, z: 5.6, rz: 0.06, parent: u });
  }
  { // A gilt-framed seascape with a sailboat.
    const [g, cc] = W('framed_painting'), u = onWall(g, STAGE.framed_painting), cy = -4;
    hang(u, 34, cy + 26, 22);
    box(64, 52, 5, M(0xd9a548, 0.4), { x: 0, y: cy, z: 2.5, r: 1.6, parent: u });
    box(54, 42, 1, M(cc.sky2, 0.8), { x: 0, y: cy, z: 5.2, parent: u });
    box(54, 22, 1, M(cc.sky, 0.8), { x: 0, y: cy + 10, z: 5.3, parent: u });
    box(54, 12, 1.2, M(cc.sea, 0.7), { x: 0, y: cy - 15, z: 5.5, parent: u });
    ball(5, M(cc.sun, 0.5), { x: 16, y: cy + 10, z: 5.9, parent: u }).scale.set(1, 1, 0.3);
    for (const [x, h, col] of [[-16, 14, 0x5f7f9c], [-6, 10, 0x7894ad]]) { const m2 = new THREE.Mesh(new THREE.ConeGeometry(8, h, 3), M(col, 0.8)); m2.position.set(x, cy - 9 + h / 2, 5.6); m2.scale.set(1, 1, 0.15); u.add(m2); }
    box(10, 2.4, 1, M(0xb5532a, 0.6), { x: 6, y: cy - 10, z: 6.2, r: 0.6, parent: u }); const sail = new THREE.Mesh(new THREE.ConeGeometry(4, 9, 3), M(0xffffff, 0.6)); sail.position.set(6, cy - 4, 6.3); sail.scale.set(1, 1, 0.15); u.add(sail);
  }
  { // A cuckoo clock: a little house with a roof, a bird's door, a dial, chains and cone weights.
    const [g, cc] = W('cuckoo_clock'), u = onWall(g, STAGE.cuckoo_clock), cy = -10;
    box(36, 34, 12, M(cc.body, 0.55), { x: 0, y: cy, z: 6, r: 1.6, parent: u });
    for (const s of [-1, 1]) box(30, 4, 16, M(cc.roof, 0.6), { x: s * 11, y: cy + 23, z: 7, rz: s * -0.62, r: 1.2, parent: u });
    box(6, 6, 2, M(cc.roof2, 0.6), { x: 0, y: cy + 33, z: 8, rz: Math.PI / 4, r: 1, parent: u });
    cyl(4.5, 4.5, 1.5, M(cc.body2, 0.6), { x: 0, y: cy + 21, z: 12.4, rx: Math.PI / 2, parent: u }); ball(2.6, M(0xf2c14e, 0.5), { x: 0, y: cy + 21, z: 13.6, parent: u });
    cyl(11, 11, 1.4, M(0xfffaf0, 0.5), { x: 0, y: cy, z: 12.4, rx: Math.PI / 2, parent: u }); torus(11, 1.1, M(cc.body2, 0.5), { x: 0, y: cy, z: 12.6, parent: u });
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; box(0.8, 2, 0.4, M(0x6b5040, 0.5), { x: Math.sin(a) * 8.5, y: cy + Math.cos(a) * 8.5, z: 13.3, rz: -a, parent: u }); }
    box(1.2, 8, 0.6, M(0x4a3a30, 0.5), { x: 0, y: cy + 3, z: 13.5, parent: u }); box(1.2, 6, 0.6, M(0x4a3a30, 0.5), { x: 2, y: cy, z: 13.6, rz: -1.2, parent: u });
    for (const s of [-1, 1]) { cyl(0.4, 0.4, 24, M(0x7a6a5a, 0.5), { x: s * 9, y: cy - 29, z: 7, parent: u }); const w = ball(3.4, M(cc.body2, 0.7), { x: s * 9, y: cy - 43, z: 7, parent: u }); w.scale.set(0.8, 1.5, 0.8); }
    cyl(0.6, 0.6, 30, M(0x9c8a5a, 0.4), { x: 0, y: cy - 30, z: 6.5, parent: u }); cyl(4, 4, 1.2, M(0xe2b23e, 0.35), { x: 0, y: cy - 45, z: 6.8, rx: Math.PI / 2, parent: u });
  }
  { // A wind chime: a hook, a disc, metal tubes and a tag; it all stirs from the hook.
    const [g, cc] = W('wind_chime'), u = onWall(g, STAGE.wind_chime);
    torus(2.6, 0.7, M(0xb98a55, 0.4), { x: 0, y: 37, z: 8, parent: u });
    for (const a of [-1, 0, 1]) tube([[0, 35, 8], [a * 12, 28, 8 + (a ? 0 : 4)]], 0.3, M(0x8a7a6a, 0.6), u, 3);
    cyl(14, 14, 3, M(0xc9955c, 0.55), { x: 0, y: 27, z: 8, parent: u });
    [[-11, 22, 0], [-4, 30, 0], [4, 26, 1], [11, 18, 0]].forEach(([x, h], i) => { cyl(1.6, 1.6, h, M(i % 2 ? cc.tube : cc.tube2, 0.25), { x, y: 25 - h / 2, z: 8, parent: u }); cyl(0.2, 0.2, 2, M(0x7a6a5a, 0.5), { x, y: 25.5, z: 8, parent: u }); });
    ball(2.6, M(0xc9955c, 0.5), { x: 0, y: 6, z: 8, parent: u });
    cyl(0.3, 0.3, 14, M(0x7a6a5a, 0.5), { x: 0, y: 4, z: 8, parent: u });
    const sh = new THREE.Shape(); sh.moveTo(-5, 6); sh.lineTo(5, 6); sh.lineTo(5, -6); sh.lineTo(0, -2); sh.lineTo(-5, -6); sh.lineTo(-5, 6);
    mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.8, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3 }), M(cc.tag, 0.6), { x: 0, y: -12, z: 8 }, u);
    mesh(heartGeo(2.2, 0.4), M(cc.tag2, 0.5), { x: 0, y: -10.5, z: 9.2 }, u);
  }
  { // A wreath of leaves and berries with a bow.
    const [g, cc] = W('leaf_wreath'), u = onWall(g, STAGE.leaf_wreath), cols = [cc.leaf, cc.leaf2, cc.leaf3];
    hang(u, 35, 25, 4);
    torus(23, 4, M(0x8a6a4a, 0.8), { x: 0, y: 0, z: 4, parent: u });
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2, r = 23 + (i % 2 ? 4 : -3); leaf(13, 5, M(cols[i % 3], 0.5), { x: Math.cos(a) * r, y: Math.sin(a) * r, z: 6 + (i % 3), rz: a - Math.PI / 2 + 0.5, rx: 0.2, parent: u }); }
    for (let i = 0; i < 7; i++) { const a = 0.5 + i * 0.85; ball(2.4, M(cc.berry, 0.35), { x: Math.cos(a) * 24, y: Math.sin(a) * 24, z: 9.5, parent: u }); }
    for (const s of [-1, 1]) ball(5, M(cc.bow, 0.6), { x: s * 6, y: -24, z: 10, parent: u }).scale.set(1.2, 0.8, 0.5);
    ball(2.6, M(cc.bow2, 0.6), { x: 0, y: -24, z: 11, parent: u });
    for (const s of [-1, 1]) box(3.5, 12, 1, M(cc.bow, 0.6), { x: s * 4, y: -32, z: 10, rz: s * 0.35, r: 0.5, parent: u });
  }
  { // A lace panel on a rod with rings, a scalloped hem and little flowers (it stirs from the rod).
    const [g, cc] = W('lace_curtain'), u = onWall(g, STAGE.lace_curtain), rod = M(cc.rod, 0.45);
    cyl(1.6, 1.6, 114, rod, { x: 0, y: 51, z: 9, rz: Math.PI / 2, parent: u });
    for (const s of [-1, 1]) ball(3.2, rod, { x: s * 56, y: 51, z: 9, parent: u });
    for (let i = 0; i < 9; i++) torus(2, 0.5, rod, { x: -48 + i * 12, y: 49, z: 9, parent: u });
    const lace = new THREE.Color(cc.lace).lerp(new THREE.Color(0xe8eef6), 0.15).getHex();
    const gm = new THREE.PlaneGeometry(1, 1, 80, 40), p = gm.attributes.position;
    for (let i = 0; i < p.count; i++) { const uu = p.getX(i) + 0.5, v = 0.5 - p.getY(i); const hem = v > 0.92 ? Math.cos(uu * Math.PI * 18) * 2 * (v - 0.92) / 0.08 : 0; p.setXYZ(i, -52 + uu * 104, 47 - v * 90 + hem, Math.sin(uu * Math.PI * 12) * 2.2 + 6); }
    gm.computeVertexNormals(); u.add(new THREE.Mesh(gm, M(lace, 0.8, { side: THREE.DoubleSide })));
    for (const [x, y] of [[-30, 26], [8, 30], [-12, 8], [24, 10], [-30, -6], [6, -10]]) for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ball(1.6, M(cc.lace2, 0.6), { x: x + Math.cos(a) * 2.4, y: y + Math.sin(a) * 2.4, z: 9.2, parent: u }).scale.set(1, 1, 0.3); }
    for (let i = 0; i < 8; i++) torus(1.6, 0.4, M(cc.lace2, 0.6), { x: -42 + i * 12, y: -36, z: 9, parent: u });
  }

  // ================================================================== on the floor
  const legs4 = (u, w, d, h, m, t = 3.4, inset = 4) => { for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(t, h, t, m, { x: a * (w / 2 - inset), y: h / 2, z: -d / 2 + b * (d / 2 - inset), r: 0.8, parent: u }); };
  { // A round side table on one stem.
    const [g, cc] = W('side_table'), id = 'side_table', D = 40, Ht = H(id, -47, D), u = onFloor(g, STAGE[id]);
    const top = cyl(31, 31, 5, wood(cc.top), { x: 0, y: Ht - 2.5, z: -D / 2, parent: u }); top.scale.set(1, 1, D / 62);
    torus(30.5, 1.6, wood(cc.edge), { x: 0, y: Ht - 4, z: -D / 2, rx: Math.PI / 2, parent: u }).scale.set(1, D / 62, 1);
    cyl(3, 3.6, Ht - 6, wood(cc.leg), { x: 0, y: (Ht - 6) / 2 + 2, z: -D / 2, parent: u });
    cyl(14, 16, 3, wood(cc.leg2), { x: 0, y: 1.5, z: -D / 2, parent: u }).scale.set(1, 1, 0.7);
  }
  { // A round pouf with seams and a button.
    const [g, cc] = W('pouf'), u = onFloor(g, STAGE.pouf), cz = -22;
    lathe([[0.01, 0], [24, 0], [28, 8], [28.5, 20], [26, 30], [18, 33], [0.01, 33.5]], M(cc.a, 0.9), { x: 0, y: 0, z: cz, parent: u }).scale.set(1, 1, 0.8);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; box(0.8, 26, 0.8, M(cc.c, 0.9), { x: Math.cos(a) * 28.2, y: 16, z: cz + Math.sin(a) * 28.2 * 0.8, ry: -a, parent: u }); }
    torus(26, 1.2, M(cc.c, 0.8), { x: 0, y: 30, z: cz, rx: Math.PI / 2, parent: u }).scale.set(1, 0.8, 1);
    cyl(20, 20, 1, M(cc.b, 0.9), { x: 0, y: 33.2, z: cz, parent: u }).scale.set(1, 1, 0.8);
    ball(2.4, M(cc.c, 0.6), { x: 0, y: 34, z: cz, parent: u });
  }
  { // A pet's oval cushion: a plump rim and a soft middle (the pet lies on it).
    const [g, cc] = W('pet_cushion'), u = onFloor(g, STAGE.pet_cushion), sz = 0.55, cz = -63 * sz + 14;
    torus(52, 10, M(cc.a, 0.9), { x: 0, y: 10, z: cz, rx: Math.PI / 2, parent: u }).scale.set(1, sz, 1);
    const mid = ball(52, M(cc.b, 0.92), { x: 0, y: 6, z: cz, parent: u }); mid.scale.set(1, 0.14, sz);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; ball(1.6, M(cc.c, 0.7), { x: Math.cos(a) * 52, y: 10 + Math.sin(a) * 0 + 5, z: cz + Math.sin(a) * 52 * sz, parent: u }); }
  }
  { // A teepee for the pet: a closed canvas cone, an arched door on its front, poles, a band and a flag.
    const [g, cc] = W('pet_house'), u = onFloor(g, STAGE.pet_house), cz = -40, R = 57, Ht = 116, sz = 0.7;
    const tent = new THREE.Mesh(new THREE.ConeGeometry(R, Ht, 48), M(cc.a, 0.85)); tent.position.set(0, Ht / 2, cz); tent.scale.set(1, 1, sz); u.add(tent);
    const onCone = (theta, y, out) => { const r = R * (1 - y / Ht) + out; return [r * Math.sin(theta), y, cz + r * Math.cos(theta) * sz]; };
    // The door: a patch of the cone itself, arched at its top.
    const dg = new THREE.PlaneGeometry(1, 1, 24, 16), dp = dg.attributes.position;
    for (let i = 0; i < dp.count; i++) { const uu = dp.getX(i) * 2, v = dp.getY(i) + 0.5, y = v * 70 * Math.sqrt(Math.max(0, 1 - uu * uu * 0.92)); dp.setXYZ(i, ...onCone(uu * 0.5, y, 0.8)); }
    dg.computeVertexNormals(); u.add(new THREE.Mesh(dg, M(cc.inner, 0.9, { side: THREE.DoubleSide })));
    // A band round its foot, and the poles crossing over its top.
    const bg = new THREE.CylinderGeometry(R * (1 - 14 / Ht) + 0.6, R + 0.6, 8, 48, 1, true); const band = new THREE.Mesh(bg, M(cc.b, 0.8, { side: THREE.DoubleSide })); band.position.set(0, 10, cz); band.scale.set(1, 1, sz); u.add(band);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.5; tube([onCone(a, 0, 1), onCone(a, Ht, 1), [-Math.sin(a) * 5, Ht + 12, cz - Math.cos(a) * 3]], 1.2, M(0xb98a55, 0.6), u, 4); }
    cyl(0.9, 0.9, 20, M(0x9c6b45, 0.5), { x: 0, y: Ht + 10, z: cz, parent: u });
    const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.lineTo(14, -4); fl.lineTo(0, -8); fl.lineTo(0, 0);
    mesh(new THREE.ExtrudeGeometry(fl, { depth: 0.6, bevelEnabled: false }), M(cc.flag, 0.7), { x: 0.6, y: Ht + 20, z: cz }, u);
  }
  { // A seedling in a little pot.
    const [g] = W('small_pot'), u = onFloor(g, STAGE.small_pot), cz = -12;
    lathe([[0.01, 0], [10, 0], [13.5, 22], [15, 22], [15, 26], [12, 26], [0.01, 24]], M(0xdf9a74, 0.6), { x: 0, y: 0, z: cz, parent: u });
    cyl(12, 12, 1, M(0x5a4332, 0.95), { x: 0, y: 24.5, z: cz, parent: u });
    for (const [x, y] of [[-5, 10], [4, 14], [-2, 5]]) ball(1.2, M(0xfff1e6, 0.6), { x, y, z: cz + 12, parent: u });
    tube([[0, 25, cz], [0, 35, cz]], 0.7, M(0x6aa860, 0.6), u, 3);
    leaf(14, 6, M(0x74b768, 0.5), { x: 0, y: 34, z: cz, rz: 0.9, parent: u }); leaf(16, 7, M(0x5fa45b, 0.5), { x: 0, y: 34, z: cz, rz: -0.6, parent: u });
  }
  { // A big mushroom lamp, its cap glowing from under.
    const [g, cc] = W('mushroom_lamp'), u = onFloor(g, STAGE.mushroom_lamp), cz = -16;
    lathe([[0.01, 0], [10, 0], [8, 6], [7, 22], [0.01, 22]], M(0xfaf1e2, 0.6), { x: 0, y: 0, z: cz, parent: u });
    ball(8, glow(0xffe0b0, 1.4), { x: 0, y: 22, z: cz, parent: u }).scale.set(1, 0.4, 1);
    const cap = ball(23, M(cc.cap, 0.55, { emissive: 0xffc8a0, emissiveIntensity: 0.15 }), { x: 0, y: 22, z: cz, parent: u }); cap.scale.set(1, 0.95, 0.9);
    cyl(22.5, 22.5, 1.4, M(cc.cap2, 0.7), { x: 0, y: 22.5, z: cz, parent: u });
    for (const [x, y] of [[-12, 35], [9, 37], [0, 30], [15, 29], [-17, 28]]) ball(2.8, M(0xfffaf2, 0.6), { x, y, z: cz + 19, parent: u }).scale.set(1, 1, 0.4);
  }
  { // A computer desk: a wide top, drawers on the right, a monitor and a keyboard (`tops` at -74, either side of the screen).
    const [g, cc] = W('computer_desk'), id = 'computer_desk', D = 48, Ht = H(id, -74, D), u = onFloor(g, STAGE[id]);
    box(164, 6, D + 2, wood(cc.top), { x: 0, y: Ht - 3, z: -D / 2, r: 1.4, parent: u });
    box(162, 2.2, D, wood(cc.edge), { x: 0, y: Ht - 7, z: -D / 2, r: 0.6, parent: u });
    for (const z of [-4, -D + 4]) box(6, Ht - 8, 6, wood(cc.leg), { x: -76, y: (Ht - 8) / 2, z, r: 1.2, parent: u });
    box(42, Ht - 8, D - 2, wood(cc.body), { x: 56, y: (Ht - 8) / 2, z: -D / 2, r: 1.2, parent: u });
    for (let i = 0; i < 2; i++) { const h = (Ht - 14) / 2, y = 3 + h / 2 + i * h; box(36, h - 3, 2, wood(cc.body2), { x: 56, y, z: 0.4, r: 0.8, parent: u }); box(11, 1.8, 2, wood(cc.edge), { x: 56, y: y + 1, z: 2, r: 0.8, parent: u }); }
    const mz = -D + 12;
    box(12, 2, 9, M(0x5c6476, 0.4), { x: -12, y: Ht + 1, z: mz, r: 0.8, parent: u }); box(4, 12, 3, M(0x5c6476, 0.4), { x: -12, y: Ht + 7, z: mz - 1, parent: u });
    box(70, 46, 5, M(0x4a5468, 0.35), { x: -12, y: Ht + 36, z: mz, r: 3, parent: u });
    box(62, 38, 1, M(0x9ad0ee, 0.3, { emissive: 0x9ad0ee, emissiveIntensity: 0.25 }), { x: -12, y: Ht + 36, z: mz + 2.6, r: 1, parent: u });
    ball(12, M(0xa9dba0, 0.6), { x: -20, y: Ht + 22, z: mz + 3, parent: u }).scale.set(2.2, 0.7, 0.1);
    ball(4, M(0xf6d06a, 0.5), { x: 2, y: Ht + 44, z: mz + 3.2, parent: u }).scale.set(1, 1, 0.2);
    box(40, 2, 12, M(0xe9edf2, 0.5), { x: -10, y: Ht + 1, z: -14, r: 1, parent: u });
  }
  { // A low coffee table with a shelf under it (`tops` at -34).
    const [g, cc] = W('low_table'), id = 'low_table', D = 48, Ht = H(id, -34, D), u = onFloor(g, STAGE[id]);
    box(120, 5, D + 2, wood(cc.top), { x: 0, y: Ht - 2.5, z: -D / 2, r: 1.6, parent: u });
    box(118, 2, D, wood(cc.edge), { x: 0, y: Ht - 6, z: -D / 2, r: 0.6, parent: u });
    legs4(u, 120, D, Ht - 6, wood(cc.leg), 5, 6);
    box(104, 2.4, D - 12, wood(cc.body), { x: 0, y: 7, z: -D / 2, r: 0.6, parent: u });
  }
  { // A swivel chair: five feet on castors, a stem, a padded seat and back.
    const [g, cc] = W('swivel_chair'), u = onFloor(g, STAGE.swivel_chair), cz = -18, metal = M(0x6f7a8a, 0.35);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; box(24, 2.4, 3, metal, { x: Math.cos(a) * 11, y: 4, z: cz + Math.sin(a) * 11, ry: -a, r: 0.8, parent: u }); ball(2.6, M(0x3a4250, 0.4), { x: Math.cos(a) * 22, y: 2.6, z: cz + Math.sin(a) * 22, parent: u }); }
    cyl(2.2, 2.2, 30, metal, { x: 0, y: 19, z: cz, parent: u });
    box(50, 8, 40, M(cc.c, 0.8), { x: 0, y: 36, z: cz, r: 3.6, parent: u }); box(46, 3, 36, M(cc.a, 0.85), { x: 0, y: 41, z: cz, r: 1.4, parent: u });
    box(4, 14, 3, metal, { x: 0, y: 46, z: cz - 18, parent: u });
    box(48, 44, 8, M(cc.a, 0.85), { x: 0, y: 72, z: cz - 18, r: 7, parent: u });
    box(38, 34, 2, M(cc.b, 0.85), { x: 0, y: 72, z: cz - 13.6, r: 5, parent: u });
  }
  { // A plump armchair.
    const [g, cc] = W('armchair'), u = onFloor(g, STAGE.armchair), D = 52, cz = -D / 2;
    for (const s of [-1, 1]) box(4, 4, 4, M(0x9c6b45, 0.5), { x: s * 36, y: 2, z: cz + 18, r: 1, parent: u });
    box(84, 22, D, M(cc.a, 0.88), { x: 0, y: 15, z: cz, r: 5, parent: u });
    box(62, 10, D - 10, M(cc.b, 0.9), { x: 0, y: 29, z: cz + 4, r: 4, parent: u });
    box(80, 44, 14, M(cc.a, 0.88), { x: 0, y: 46, z: cz - D / 2 + 7, r: 7, parent: u });
    box(60, 30, 4, M(cc.b, 0.9), { x: 0, y: 44, z: cz - D / 2 + 15, r: 4, parent: u });
    for (const s of [-1, 1]) { box(14, 34, D, M(cc.a, 0.88), { x: s * 37, y: 26, z: cz, r: 6, parent: u }); torus(6, 0.9, M(cc.c, 0.8), { x: s * 37, y: 42, z: cz + D / 2 - 6, parent: u }); }
    box(84, 2, 2, M(cc.c, 0.8), { x: 0, y: 5, z: 0.5, r: 0.8, parent: u });
  }
  { // A bean bag slumped on the floor.
    const [g, cc] = W('bean_bag'), u = onFloor(g, STAGE.bean_bag), cz = -26;
    const bag = new THREE.SphereGeometry(1, 48, 32), p = bag.attributes.position;
    for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); y = y < -0.3 ? -0.3 - (y + 0.3) * 0.15 : y; const dent = Math.exp(-((x * x) / 0.2 + ((z - 0.3) ** 2) / 0.2)) * 0.35 * Math.max(0, y); p.setXYZ(i, x * (1 + 0.12 * (1 - y)), y - dent, z); }
    bag.computeVertexNormals(); const m2 = new THREE.Mesh(bag, M(cc.a, 0.95)); m2.position.set(0, 30, cz); m2.scale.set(40, 38, 28); u.add(m2);
    tube([[0, 60, cz - 6], [3, 42, cz + 18], [0, 22, cz + 27]], 0.7, M(cc.c, 0.9), u, 12);
    ball(12, M(cc.b, 0.9), { x: -14, y: 52, z: cz + 6, parent: u }).scale.set(1.3, 0.3, 0.8);
  }
  const cabinet = (id, Wd, D, dy, rows) => { // a cabinet of drawers or doors, its top at `dy`
    const [g, cc] = W(id), Ht = H(id, dy, D), u = onFloor(g, STAGE[id]);
    box(Wd + 2, 4, D + 2, wood(cc.top), { x: 0, y: Ht - 2, z: -D / 2, r: 1.2, parent: u });
    box(Wd, Ht - 8, D, wood(cc.body), { x: 0, y: (Ht - 8) / 2 + 4, z: -D / 2, r: 1.2, parent: u });
    for (const s of [-1, 1]) box(6, 4, 6, wood(cc.leg2), { x: s * (Wd / 2 - 6), y: 2, z: -6, r: 1, parent: u });
    rows(u, cc, Ht);
  };
  cabinet('low_cabinet', 110, 40, -59, (u, cc, Ht) => { for (const s of [-1, 1]) { box(50, Ht - 16, 2, wood(cc.body2), { x: s * 26, y: Ht / 2, z: 0.4, r: 1, parent: u }); ball(2.4, wood(cc.edge), { x: s * 6, y: Ht / 2, z: 2, parent: u }); } });
  cabinet('drawer_chest', 76, 40, -97, (u, cc, Ht) => { const h = (Ht - 12) / 4; for (let i = 0; i < 4; i++) { const y = 6 + h / 2 + i * h; box(66, h - 3, 2, wood(cc.body2), { x: 0, y, z: 0.4, r: 1, parent: u }); box(14, 1.8, 2, wood(cc.edge), { x: 0, y: y + 1, z: 2, r: 0.8, parent: u }); } });
  { // An easel with a little painting on it.
    const [g, cc] = W('easel'), u = onFloor(g, STAGE.easel), cz = -14;
    for (const s of [-1, 1]) box(4, 120, 4, wood(cc.leg), { x: s * 22, y: 58, z: cz, rz: s * -0.17, r: 1, parent: u });
    box(4, 110, 4, wood(cc.leg2), { x: 0, y: 52, z: cz - 22, rx: 0.32, r: 1, parent: u });
    box(64, 4, 10, wood(cc.top), { x: 0, y: 46, z: cz + 3, r: 1, parent: u });
    box(56, 66, 3, M(0xfaf6ee, 0.7), { x: 0, y: 82, z: cz + 4, rx: -0.08, r: 1, parent: u });
    box(48, 30, 0.6, M(0xbfe3f7, 0.8), { x: 0, y: 92, z: cz + 6, rx: -0.08, parent: u });
    ball(20, M(0x8fd07e, 0.8), { x: -6, y: 70, z: cz + 6.6, parent: u }).scale.set(1.3, 0.55, 0.05);
    ball(5, M(0xf2d27a, 0.5), { x: 12, y: 98, z: cz + 6.8, parent: u }).scale.set(1, 1, 0.2);
    box(3, 18, 2, M(0xe07a8b, 0.5), { x: 22, y: 54, z: cz + 8, rz: -0.6, r: 0.8, parent: u });
  }
  { // A square floor cushion, tufted, with tassels.
    const [g, cc] = W('floor_cushion'), u = onFloor(g, STAGE.floor_cushion), cz = -22;
    box(62, 16, 44, M(cc.a, 0.92), { x: 0, y: 8, z: cz, r: 7, parent: u });
    ball(2.4, M(cc.c, 0.6), { x: 0, y: 16.2, z: cz, parent: u });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ball(3, M(cc.c, 0.8), { x: a * 31, y: 8, z: cz + b * 21, parent: u }).scale.set(1, 1.4, 1);
    box(60, 1.4, 1.4, M(cc.b, 0.8), { x: 0, y: 8, z: 0.4, parent: u });
  }
  { // A two-seat sofa with a cushion.
    const [g, cc] = W('sofa'), u = onFloor(g, STAGE.sofa), D = 56, cz = -D / 2;
    for (const s of [-1, 1]) box(4, 6, 4, M(0x9c6b45, 0.5), { x: s * 70, y: 3, z: cz + 20, r: 1, parent: u });
    box(156, 22, D, M(cc.a, 0.88), { x: 0, y: 17, z: cz, r: 5, parent: u });
    for (const s of [-1, 1]) box(60, 11, D - 10, M(cc.b, 0.9), { x: s * 31, y: 32, z: cz + 4, r: 4.5, parent: u });
    for (const s of [-1, 1]) box(62, 38, 14, M(cc.a, 0.88), { x: s * 31, y: 52, z: cz - D / 2 + 9, r: 7, parent: u });
    for (const s of [-1, 1]) { box(16, 34, D, M(cc.a, 0.88), { x: s * 72, y: 28, z: cz, r: 7, parent: u }); }
    box(156, 3, 3, M(cc.c, 0.85), { x: 0, y: 7, z: 0.5, r: 1, parent: u });
    box(20, 18, 7, M(0xfaf1dc, 0.9), { x: -40, y: 46, z: cz - 6, rz: 0.15, rx: -0.2, r: 4, parent: u });
  }
  { // A pot with heart-shaped leaves.
    const [g, cc] = W('heart_leaf_pot'), u = onFloor(g, STAGE.heart_leaf_pot), cz = -16;
    lathe([[0.01, 0], [13, 0], [17, 24], [18.5, 26], [18.5, 30], [15.5, 30], [0.01, 28]], M(cc.pot, 0.55), { x: 0, y: 0, z: cz, parent: u });
    torus(18, 1.3, M(cc.pot2, 0.55), { x: 0, y: 26, z: cz, rx: Math.PI / 2, parent: u });
    for (const [x, y] of [[-8, 10], [0, 14], [8, 10], [-4, 6], [5, 5]]) ball(1.5, M(cc.deco, 0.5), { x, y, z: cz + 15.5, parent: u });
    cyl(16, 16, 1, M(0x5a4332, 0.95), { x: 0, y: 29, z: cz, parent: u });
    for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3, l = 22 + (i % 3) * 6, ex = Math.sin(a) * l * 0.9, ey = 29 + Math.cos(a) * l, ez = cz + (i % 2 ? 6 : -4);
      tube([[0, 29, cz], [ex * 0.4, 29 + l * 0.5, cz + 2], [ex, ey, ez]], 0.6, M(0x6c9c58, 0.6), u, 8);
      mesh(heartGeo(6, 1), M(greens[i % 3], 0.5), { x: ex, y: ey, z: ez, rz: Math.PI - a * 0.8, rx: 0.3 }, u); }
  }
  { // Red flowers in a little pot.
    const [g, cc] = W('flower_pot_mini'), u = onFloor(g, STAGE.flower_pot_mini), cz = -12;
    lathe([[0.01, 0], [10, 0], [13, 20], [15, 20], [15, 24], [12, 24], [0.01, 22]], M(0xd9744a, 0.6), { x: 0, y: 0, z: cz, parent: u });
    for (const [x, y] of [[-5, 10], [4, 13], [0, 6]]) ball(1.3, M(0xfff1e6, 0.6), { x, y, z: cz + 12, parent: u });
    for (let i = 0; i < 6; i++) leaf(9, 3.5, M(greens[i % 3], 0.5), { x: 0, y: 24, z: cz, rz: -1.2 + i * 0.48, rx: 0.3, parent: u });
    for (const [x, y, z] of [[-6, 36, 2], [6, 34, 0], [0, 40, -2], [-1, 31, 6]]) { for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ball(3.4, M(k % 2 ? cc.flower : cc.flower2, 0.55), { x: x + Math.cos(a) * 3.4, y: y + Math.sin(a) * 3.4, z: cz + z + 3, parent: u }).scale.set(1, 1, 0.45); } ball(2, M(cc.eye, 0.5), { x, y, z: cz + z + 4.5, parent: u }); }
  }
  { // A bouncy ball with a band and a star.
    const [g, cc] = W('bouncy_ball'), u = onFloor(g, STAGE.bouncy_ball), cz = -12;
    ball(13, M(cc.a, 0.3), { x: 0, y: 13, z: cz, parent: u });
    torus(13.1, 2.2, M(cc.band, 0.35), { x: 0, y: 13, z: cz, rx: 1.2, ry: 0.3, parent: u });
    mesh(starGeo(3.4, 0.8), M(cc.band, 0.4), { x: 4, y: 19, z: cz + 11 }, u);
  }
  { // A stacking ring toy.
    const [g, cc] = W('ring_toy'), u = onFloor(g, STAGE.ring_toy), cz = -12;
    cyl(15, 15, 5, M(cc.base, 0.45), { x: 0, y: 2.5, z: cz, parent: u });
    cyl(1.6, 1.6, 34, M(0xe9d6b0, 0.5), { x: 0, y: 20, z: cz, parent: u });
    [[cc.r1, 13], [cc.r2, 11.5], [cc.r3, 10], [cc.r4, 8.5]].forEach(([col, r], i) => { const t = torus(r - 3, 3.6, M(col, 0.4), { x: 0, y: 9 + i * 7.4, z: cz, rx: Math.PI / 2, parent: u }); t.scale.set(1, 1, 0.85); });
    ball(5.6, M(cc.top, 0.35), { x: 0, y: 39, z: cz, parent: u });
  }
  { // An open cardboard box for the pet.
    const [g, cc] = W('paper_box'), u = onFloor(g, STAGE.paper_box), D = 36, cz = -D / 2;
    box(56, 34, D, M(cc.box, 0.85), { x: 0, y: 17, z: cz, r: 1, parent: u });
    box(52, 2, D - 4, M(cc.inner, 0.9), { x: 0, y: 33.4, z: cz, parent: u });
    for (const s of [-1, 1]) box(4, 14, D, M(cc.box2, 0.85), { x: s * 31, y: 39, z: cz, rz: s * -0.7, r: 0.6, parent: u });
    box(56, 14, 2, M(cc.box2, 0.85), { x: 0, y: 39, z: cz - D / 2 - 2, rx: -0.5, r: 0.6, parent: u });
    box(14, 3, 0.6, M(cc.inner, 0.8), { x: 0, y: 26, z: 0.4, r: 0.6, parent: u });
    for (const [x, y, r] of [[-12, 10, 2.4], [-16, 14, 1.2], [-12, 15.5, 1.2], [-8, 14, 1.2]]) ball(r, M(cc.inner, 0.7), { x, y, z: 0.4, parent: u }).scale.set(1, 1, 0.3);
    mesh(heartGeo(2.6, 0.6), M(0xe0677a, 0.5), { x: 14, y: 12, z: 0.5 }, u);
  }
  { // A striped play tunnel lying on its side.
    const [g, cc] = W('play_tunnel'), u = onFloor(g, STAGE.play_tunnel), cz = -18, r = 16;
    for (let i = 0; i < 6; i++) { const seg = cyl(r, r, 13.6, M(i % 2 ? cc.c : cc.a, 0.8), { x: -34 + i * 13.6, y: r, z: cz, rz: Math.PI / 2, parent: u }); seg.geometry = new THREE.CylinderGeometry(r, r, 13.6, 40, 1, true); seg.material.side = THREE.DoubleSide; }
    for (let i = 0; i <= 6; i++) torus(r, 1, M(cc.b, 0.6), { x: -40.8 + i * 13.6, y: r, z: cz, ry: Math.PI / 2, parent: u });
    cyl(r - 0.4, r - 0.4, 0.6, M(cc.hole, 0.95), { x: -40, y: r, z: cz, rz: Math.PI / 2, parent: u });
  }
  { // A woven stool.
    const [g, cc] = W('wicker_stool'), u = onFloor(g, STAGE.wicker_stool), cz = -14;
    lathe([[0.01, 0], [16, 0], [12, 18], [16, 34], [0.01, 34]], M(cc.w, 0.85), { x: 0, y: 0, z: cz, parent: u });
    for (let i = 0; i < 7; i++) { const y = 3 + i * 4.6, r = 16 - Math.sin((y / 34) * Math.PI) * 4; torus(r, 0.8, M(i % 2 ? cc.w2 : cc.w, 0.85), { x: 0, y, z: cz, rx: Math.PI / 2, parent: u }); }
    cyl(16.5, 16.5, 3, M(cc.seat, 0.75), { x: 0, y: 35, z: cz, parent: u }); torus(16, 1, M(cc.w2, 0.8), { x: 0, y: 36.6, z: cz, rx: Math.PI / 2, parent: u });
  }
  { // A round tea table on three curved legs (`tops` at -29).
    const [g, cc] = W('tea_table'), id = 'tea_table', D = 40, Ht = H(id, -29, D), u = onFloor(g, STAGE[id]), cz = -D / 2;
    cyl(31, 31, 5, wood(cc.top), { x: 0, y: Ht - 2.5, z: cz, parent: u }).scale.set(1, 1, D / 62);
    torus(30.5, 1.6, wood(cc.edge), { x: 0, y: Ht - 4, z: cz, rx: Math.PI / 2, parent: u }).scale.set(1, D / 62, 1);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + Math.PI / 2; tube([[Math.cos(a) * 16, Ht - 5, cz + Math.sin(a) * 10], [Math.cos(a) * 22, Ht / 2, cz + Math.sin(a) * 14], [Math.cos(a) * 20, 1, cz + Math.sin(a) * 13]], 1.8, wood(cc.leg), u, 10); }
  }
  { // A small bookshelf with books and a ball (`tops` at -71).
    const [g, cc] = W('mini_bookshelf'), id = 'mini_bookshelf', D = 28, Ht = H(id, -71, D), u = onFloor(g, STAGE[id]), w = 56, t = 3.4;
    box(w + 2, t, D + 2, wood(cc.top), { x: 0, y: Ht - t / 2, z: -D / 2, r: 1, parent: u });
    for (const s of [-1, 1]) box(t, Ht - t, D, wood(cc.body), { x: s * (w / 2 - t / 2), y: (Ht - t) / 2, z: -D / 2, r: 0.8, parent: u });
    box(w, Ht, 1.2, wood(cc.inner), { x: 0, y: Ht / 2, z: -D + 0.8, parent: u });
    for (const y of [3, Ht / 2]) box(w - 2, 3, D, wood(cc.edge), { x: 0, y: y + 1.5, z: -D / 2, r: 0.8, parent: u });
    c.books(u, -w / 2 + 5, w / 2 - 12, Ht / 2 + 3, -D / 2 - 1, Ht / 2 - 12, D * 0.7, 0.05);
    for (const [y, col] of [[6, 0xe9c46a], [11, 0x7aa6d8]]) box(22, 4.4, D * 0.7, M(col, 0.66), { x: -12, y: y + 2, z: -D / 2, r: 0.8, parent: u });
    ball(6, M(0xf08a9a, 0.6), { x: 14, y: 12, z: -D / 2 + 4, parent: u });
  }
  { // A round seat cushion.
    const [g, cc] = W('seat_cushion'), u = onFloor(g, STAGE.seat_cushion), cz = -16;
    const s = ball(22, M(cc.a, 0.92), { x: 0, y: 8, z: cz, parent: u }); s.scale.set(1, 0.36, 0.72);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; tube([[0, 16.2, cz], [Math.cos(a) * 21, 8.6, cz + Math.sin(a) * 15.5]], 0.5, M(cc.b, 0.85), u, 6); }
    ball(2.4, M(cc.c, 0.6), { x: 0, y: 16.4, z: cz, parent: u });
  }
  { // A woven basket with handles and a cloth.
    const [g, cc] = W('woven_basket'), u = onFloor(g, STAGE.woven_basket), cz = -18;
    lathe([[0.01, 0], [20, 0], [26, 22], [24, 22], [18.5, 2.5], [0.01, 2.5]], M(cc.w, 0.85), { x: 0, y: 0, z: cz, parent: u }).scale.set(1, 1, 0.7);
    for (let i = 0; i < 4; i++) torus(21 + i * 1.4, 0.8, M(i % 2 ? cc.w2 : cc.w, 0.85), { x: 0, y: 4 + i * 5, z: cz, rx: Math.PI / 2, parent: u }).scale.set(1, 0.7, 1);
    for (const s of [-1, 1]) torus(6, 1.3, M(cc.w2, 0.8), { x: s * 26, y: 20, z: cz, ry: Math.PI / 2, parent: u });
    const cl = ball(20, M(cc.cloth, 0.9), { x: 0, y: 23, z: cz, parent: u }); cl.scale.set(1.05, 0.3, 0.7);
    ball(7, M(0x8cc677, 0.9), { x: 8, y: 28, z: cz + 2, parent: u });
  }
  { // A star pillow standing up, with a sleepy face.
    const [g, cc] = W('star_pillow'), u = onFloor(g, STAGE.star_pillow), cz = -8;
    const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 9.5 : 21; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
    mesh(new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 6 }), M(cc.a, 0.9), { x: 0, y: 21, z: cz - 3 }, u);
    for (const sx of [-1, 1]) { tube([[sx * 7 - 2.4, 23, cz + 7.2], [sx * 7, 21.6, cz + 7.4], [sx * 7 + 2.4, 23, cz + 7.2]], 0.5, M(0x5a3a2a, 0.5), u, 6); ball(2.4, M(0xf4a3a8, 0.8), { x: sx * 11, y: 19, z: cz + 6.6, parent: u }).scale.set(1, 0.7, 0.3); }
    tube([[-1.6, 17.5, cz + 7.4], [0, 16.6, cz + 7.6], [1.6, 17.5, cz + 7.4]], 0.45, M(0x5a3a2a, 0.5), u, 6);
  }
  { // A folded blanket, three layers deep.
    const [g, cc] = W('small_blanket'), u = onFloor(g, STAGE.small_blanket), cz = -14;
    for (let i = 0; i < 3; i++) { box(48, 6.6, 26, M(cc.a, 0.92), { x: 0, y: 3.4 + i * 6.8, z: cz, r: 3, parent: u }); for (const x of [-14, 0, 14]) box(3, 6.8, 26.4, M(cc.b, 0.92), { x, y: 3.4 + i * 6.8, z: cz, r: 1.2, parent: u }); }
    for (let i = 0; i < 6; i++) box(0.8, 3, 0.8, M(cc.c, 0.8), { x: 22 + (i % 2), y: 1.5 + i * 3.4, z: cz + 13, parent: u });
  }

  // ================================================================== rugs
  {
    const [g, cc] = W('knit_rug_round'), [cx, cy] = STAGE.knit_rug_round, { c0, rx, rz } = rugFrame(cx, cy, 86, 27);
    [[1, cc.d], [0.86, cc.a], [0.7, cc.b], [0.55, cc.c], [0.4, cc.a], [0.24, cc.b]].forEach(([k, col], i) => flat(g, c0, rx, rz, k, 0.006 + i * 0.003, M(col, 0.97)));
    for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; box(0.012, 0.006, 0.08, M(cc.d, 0.9), { x: c0.x + Math.cos(a) * rx * 1.04, y: 0.004, z: c0.z + Math.sin(a) * rz * 1.04, ry: -Math.atan2(Math.sin(a) * rz, Math.cos(a) * rx) + Math.PI / 2, parent: g }); }
  }
  {
    const [g, cc] = W('leaf_rug'), [cx, cy] = STAGE.leaf_rug, { c0, rx, rz } = rugFrame(cx, cy, 94, 28);
    const s = new THREE.Shape(); s.moveTo(-1, 0); s.quadraticCurveTo(-0.2, 1.05, 0.95, 0); s.quadraticCurveTo(-0.2, -1.05, -1, 0);
    const lf = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 40 }), M(cc.a, 0.95), { x: c0.x, y: 0.012, z: c0.z, rx: -Math.PI / 2 }, g); lf.scale.set(rx, rz, 1);
    const s2 = new THREE.Shape(); s2.moveTo(-0.85, 0); s2.quadraticCurveTo(-0.2, 0.85, 0.82, 0); s2.quadraticCurveTo(-0.2, -0.85, -0.85, 0);
    const in2 = mesh(new THREE.ExtrudeGeometry(s2, { depth: 0.004, bevelEnabled: false, curveSegments: 40 }), M(cc.b, 0.95), { x: c0.x, y: 0.016, z: c0.z, rx: -Math.PI / 2 }, g); in2.scale.set(rx, rz, 1);
    box(rx * 1.75, 0.006, 0.02, M(cc.c, 0.9), { x: c0.x - rx * 0.05, y: 0.02, z: c0.z, parent: g });
    for (let i = 0; i < 5; i++) for (const sgn of [-1, 1]) { const x = c0.x - rx * 0.6 + i * rx * 0.3; box(rx * 0.32, 0.006, 0.016, M(cc.c, 0.9), { x: x + rx * 0.12, y: 0.02, z: c0.z + sgn * rz * 0.22, ry: sgn * 0.55, parent: g }); }
    box(rx * 0.25, 0.012, 0.03, M(cc.c, 0.9), { x: c0.x - rx * 1.1, y: 0.012, z: c0.z + rz * 0.05, ry: 0.15, parent: g });
  }

  // ================================================================== on a desk or a shelf
  { const [g, cc] = W('flower_vase'), u = onTop(g, 'flower_vase'); // a vase of flowers
    lathe([[0.01, 0], [6, 0], [9, 8], [8, 18], [4.5, 24], [5.5, 27], [0.01, 27]], M(cc.vase, 0.35), { x: 0, y: 0, z: -2, parent: u });
    torus(5.4, 0.8, M(cc.vase2, 0.35), { x: 0, y: 26.5, z: -2, rx: Math.PI / 2, parent: u });
    for (const [x, y, z] of [[-6, 42, 0], [5, 44, -1], [0, 38, 3]]) { tube([[0, 26, -2], [x, y - 2, -2 + z]], 0.5, M(0x6aa860, 0.6), u, 4); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ball(2.6, M(cc.flower, 0.55), { x: x + Math.cos(a) * 2.6, y: y + Math.sin(a) * 2.6, z: -1 + z, parent: u }).scale.set(1, 1, 0.5); } ball(1.4, M(0xf6d98a, 0.5), { x, y, z: z, parent: u }); }
  }
  { const [g, cc] = W('laptop'), u = onTop(g, 'laptop'); // an open laptop
    box(46, 2.4, 30, M(cc.body, 0.35), { x: 0, y: 1.2, z: -4, r: 1, parent: u });
    box(38, 0.6, 14, M(cc.body2, 0.5), { x: 0, y: 2.6, z: -8, parent: u });
    box(46, 30, 2, M(cc.body2, 0.35), { x: 0, y: 17, z: -19, rx: -0.2, r: 1.2, parent: u });
    box(40, 24, 0.6, M(cc.screen, 0.3, { emissive: cc.screen, emissiveIntensity: 0.25 }), { x: 0, y: 17.4, z: -17.8, rx: -0.2, parent: u });
    for (const [y, w] of [[23, 26], [19, 30], [15, 20]]) box(w, 1.6, 0.3, M(0xffffff, 0.5), { x: -2, y: y - 0.6, z: -17.2 + (y - 17) * 0.2, rx: -0.2, parent: u });
  }
  { const [g, cc] = W('fish_tank'), u = onTop(g, 'fish_tank'); // a little aquarium
    box(56, 3, 26, M(cc.frame2, 0.5), { x: 0, y: 1.5, z: -6, r: 1, parent: u });
    box(54, 34, 24, glass(0xd8f1fb), { x: 0, y: 20, z: -6, r: 1, parent: u });
    box(52, 26, 22, M(0x9fd8ef, 0.3, { transparent: true, opacity: 0.35 }), { x: 0, y: 17, z: -6, r: 0.6, parent: u });
    box(56, 3, 26, M(cc.frame, 0.5), { x: 0, y: 38, z: -6, r: 1, parent: u });
    for (const s of [-1, 1]) box(2.4, 37, 2.4, M(cc.frame, 0.5), { x: s * 27, y: 19, z: 6.4, r: 0.6, parent: u });
    box(52, 4, 22, M(0xe7d3a8, 0.9), { x: 0, y: 5, z: -6, r: 1, parent: u });
    for (const [x, h] of [[-18, 20], [-12, 26], [16, 22]]) tube([[x, 6, -2], [x + 3, 6 + h / 2, -2], [x - 1, 6 + h, -2]], 1.2, M(0x5fae63, 0.5), u, 8);
    for (const [x, y, col] of [[2, 24, 0xf39a54], [-4, 16, 0xf6d06a]]) { const f = ball(3.6, M(col, 0.4), { x, y, z: 7, parent: u }); f.scale.set(1.4, 0.9, 0.6); const t = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4, 3), M(col, 0.4)); t.position.set(x - 6, y, 7); t.rotation.z = Math.PI / 2; u.add(t); }
  }
  { const [g, cc] = W('globe'), u = onTop(g, 'globe'); // a globe on a stand
    cyl(9, 10, 3, M(cc.stand, 0.45), { x: 0, y: 1.5, z: -2, parent: u }); cyl(1.4, 1.6, 10, M(cc.stand2, 0.45), { x: 0, y: 7, z: -2, parent: u });
    ball(14, M(0x6fb2e6, 0.4), { x: 0, y: 28, z: -2, parent: u });
    for (const [x, y, z, r] of [[-5, 34, 9, 6], [7, 24, 9, 7], [-8, 22, 6, 4], [3, 38, 5, 4]]) ball(r, M(0x86c86f, 0.6), { x, y, z: z - 2, parent: u }).scale.set(1, 0.8, 0.5);
    torus(16, 0.9, M(cc.stand2, 0.4), { x: 0, y: 28, z: -2, ry: Math.PI / 2, rz: 0.4, parent: u });
  }
  { const [g, cc] = W('record_player'), u = onTop(g, 'record_player'); // a record player
    box(52, 12, 34, M(cc.body, 0.5), { x: 0, y: 6, z: -8, r: 2, parent: u });
    cyl(14, 14, 1.4, M(0x2a2a30, 0.3), { x: -6, y: 12.8, z: -8, parent: u }).scale.set(1, 1, 0.9); cyl(4.4, 4.4, 1.6, M(0xe07a6a, 0.5), { x: -6, y: 13.2, z: -8, parent: u });
    tube([[18, 14, -18], [16, 16, -6], [4, 15, -2]], 0.8, M(0xbcc4cc, 0.3), u, 8);
    for (const x of [13, 20]) cyl(1.8, 1.8, 2, M(cc.body2, 0.5), { x, y: 7, z: 9, rx: Math.PI / 2, parent: u });
  }
  { const [g, cc] = W('element_crystal'), u = onTop(g, 'element_crystal'); // a glowing crystal cluster of an element
    cyl(12, 13, 4, M(0x9aa3b2, 0.6), { x: 0, y: 2, z: -2, parent: u });
    [[0, 36, 0, 6.5, cc.c1], [-7, 22, 0.4, 4.6, cc.c2], [7, 26, -0.35, 4.8, cc.c3], [-3, 16, 0.7, 3.4, cc.c2]].forEach(([x, h, rz, r, col]) => {
      const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, r, h, 6), M(col, 0.25, { emissive: col, emissiveIntensity: 0.3 })); m2.position.set(x, 4 + h / 2, -2); m2.rotation.z = rz; u.add(m2); });
  }
  { const [g, cc] = W('cactus_mini'), u = onTop(g, 'cactus_mini'); // a little cactus with a flower
    lathe([[0.01, 0], [8, 0], [10, 13], [11, 13], [11, 16], [9, 16], [0.01, 15]], M(cc.pot, 0.6), { x: 0, y: 0, z: -2, parent: u }); torus(10.5, 1, M(cc.band, 0.6), { x: 0, y: 8, z: -2, rx: Math.PI / 2, parent: u });
    const cm = M(0x5fae63, 0.55); const body = ball(6, cm, { x: 0, y: 24, z: -2, parent: u }); body.scale.set(1, 1.6, 1);
    for (const s of [-1, 1]) { const arm = ball(3, cm, { x: s * 7, y: 25 + (s > 0 ? 3 : 0), z: -2, parent: u }); arm.scale.set(1, 1.7, 1); }
    for (let i = 0; i < 4; i++) box(0.5, 16, 0.5, M(0x3f8a4a, 0.6), { x: Math.cos(i * 1.57) * 5.7, y: 24, z: -2 + Math.sin(i * 1.57) * 5.7, parent: u });
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ball(2, M(0xf07ba0, 0.5), { x: Math.cos(a) * 2, y: 34 + Math.sin(a) * 0.6, z: -2 + Math.sin(a) * 2, parent: u }); }
  }
  { const [g] = W('bonsai'), u = onTop(g, 'bonsai'); // a bonsai in a blue tray
    box(42, 7, 22, M(0x4a7fc0, 0.45), { x: 0, y: 3.5, z: -4, r: 1.6, parent: u }); for (const s of [-1, 1]) box(5, 2, 5, M(0x3a64a0, 0.5), { x: s * 16, y: 0.5, z: -4, parent: u });
    tube([[0, 7, -4], [-6, 16, -4], [4, 26, -3], [-2, 34, -4]], 2.6, M(0x7a5236, 0.8), u, 16);
    for (const [x, y, r] of [[-12, 34, 8], [4, 40, 9], [14, 32, 7], [-2, 30, 6]]) { ball(r, M(0x5fa45b, 0.7), { x, y, z: -4, parent: u }).scale.set(1.4, 0.75, 1); ball(r * 0.6, M(0x7fbf6a, 0.7), { x: x - 2, y: y + 3, z: -1, parent: u }).scale.set(1.4, 0.7, 1); }
  }
  { const [g, cc] = W('story_book'), u = onTop(g, 'story_book'); // a storybook standing up
    box(22, 32, 8, M(cc.cover, 0.6), { x: 0, y: 16, z: -3, ry: -0.35, r: 1.2, parent: u });
    box(21, 30, 7.4, M(0xfff6e4, 0.8), { x: 0.8, y: 16, z: -3, ry: -0.35, r: 0.6, parent: u });
    box(3.4, 32, 8.2, M(cc.cover2, 0.6), { x: -10, y: 16, z: -6.6, ry: -0.35, r: 1, parent: u });
    box(12, 8, 0.8, M(cc.plate, 0.6), { x: 1.6, y: 22, z: 1.2, ry: -0.35, r: 0.4, parent: u });
    mesh(starGeo(3, 0.8), M(0xf2c14e, 0.4), { x: 1.6, y: 12, z: 1.4, ry: -0.35 }, u);
  }
  { const [g, cc] = W('pocket_notebook'), u = onTop(g, 'pocket_notebook'); // a spiral notebook and a pencil
    box(20, 26, 4, M(cc.cover, 0.6), { x: -3, y: 13, z: -3, rz: 0.08, rx: -0.1, r: 0.8, parent: u });
    for (let i = 0; i < 6; i++) torus(1.4, 0.4, M(0xbcc4cc, 0.3), { x: -11 + i * 3.4, y: 26.4, z: -3, ry: Math.PI / 2, parent: u });
    box(3, 26, 4.4, M(cc.band, 0.6), { x: 3, y: 13, z: -3, rz: 0.08, rx: -0.1, parent: u });
    box(12, 10, 0.6, M(0xffffff, 0.7), { x: -5, y: 15, z: -0.6, rz: 0.08, parent: u });
    cyl(1.4, 1.4, 26, M(0xf2c14e, 0.5), { x: 12, y: 13, z: -1, rz: -0.2, parent: u }); const tip = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 12), M(0xf3dcb4, 0.6)); tip.position.set(14.6, 26.5, -1); tip.rotation.z = -0.2; u.add(tip);
  }
  { const [g, cc] = W('pencil_case'), u = onTop(g, 'pencil_case'); // a cat pencil case with a pencil and a ruler
    box(36, 18, 14, M(cc.case, 0.75), { x: 0, y: 9, z: -4, r: 6, parent: u });
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(4, 6, 4), M(cc.case2, 0.7)); ear.position.set(s * 12, 19.5, -4); ear.scale.set(1, 1, 0.6); u.add(ear); }
    for (const s of [-1, 1]) ball(1.3, M(0x3a2a20, 0.4), { x: s * 6, y: 10, z: 3.2, parent: u });
    tube([[-2.4, 7, 3.2], [0, 6, 3.4], [2.4, 7, 3.2]], 0.45, M(0x3a2a20, 0.4), u, 6);
    box(30, 1, 0.6, M(cc.case2, 0.6), { x: 0, y: 16.4, z: 2.4, parent: u });
    cyl(1.4, 1.4, 22, M(0x4f8fdc, 0.5), { x: -8, y: 22, z: -6, rz: 0.4, parent: u });
    box(4, 22, 1, M(0xf6d06a, 0.6), { x: 8, y: 22, z: -6, rz: -0.25, r: 0.4, parent: u });
  }
  { const [g, cc] = W('desk_globe'), u = onTop(g, 'desk_globe'); // a globe in a gilt ring
    cyl(10, 11, 3, M(cc.stand2, 0.35), { x: 0, y: 1.5, z: -2, parent: u }); cyl(1.6, 2, 7, M(cc.stand, 0.35), { x: 0, y: 6, z: -2, parent: u });
    ball(13, M(0x5aa9e6, 0.4), { x: 0, y: 26, z: -2, parent: u });
    for (const [x, y, r] of [[-5, 31, 6], [6, 22, 6], [-7, 20, 3.5]]) ball(r, M(0x7fc46a, 0.6), { x, y, z: 8, parent: u }).scale.set(1, 0.8, 0.5);
    torus(15.5, 1.1, M(cc.stand, 0.3), { x: 0, y: 26, z: -2, ry: Math.PI / 2, parent: u });
  }
  { const [g, cc] = W('bud_vase'), u = onTop(g, 'bud_vase'); // a round flask with a tulip
    lathe([[0.01, 0], [6, 0], [8.5, 6], [8, 12], [3, 18], [2.6, 24], [3.4, 25], [0.01, 25]], M(cc.glass, 0.15), { x: 0, y: 0, z: -2, parent: u });
    ball(5.5, M(cc.glass2, 0.3), { x: 0, y: 6, z: -2, parent: u }).scale.set(1.2, 0.6, 1.2);
    tube([[0, 24, -2], [1, 36, -2], [0, 42, -2]], 0.6, M(0x6aa860, 0.6), u, 6); leaf(12, 3, M(0x6aa860, 0.5), { x: 0.6, y: 28, z: -2, rz: -0.6, parent: u });
    for (let k = 0; k < 3; k++) { const p2 = ball(3.4, M(k % 2 ? cc.bloom2 : cc.bloom, 0.5), { x: Math.cos(k * 2.1) * 1.6, y: 45, z: -2 + Math.sin(k * 2.1) * 1.6, parent: u }); p2.scale.set(0.8, 1.4, 0.8); }
  }
  { const [g, cc] = W('mini_statue'), u = onTop(g, 'mini_statue'); // a stone cat on a plinth with a gem
    box(28, 8, 18, M(cc.stone3, 0.75), { x: 0, y: 4, z: -4, r: 1.2, parent: u }); box(24, 4, 15, M(cc.stone2, 0.75), { x: 0, y: 9.5, z: -4, r: 1, parent: u });
    const st = M(cc.stone, 0.75); ball(9, st, { x: 0, y: 19, z: -4, parent: u }).scale.set(1, 1.1, 0.8); ball(7.5, st, { x: 0, y: 32, z: -4, parent: u });
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 4), st); ear.position.set(s * 4.4, 39.5, -4); u.add(ear); tube([[s * 3, 32, 3], [s * 1.2, 31.6, 3.4]], 0.4, M(cc.stone3, 0.6), u, 3); }
    tube([[7, 12, -6], [13, 18, -4], [10, 26, -2]], 1.6, st, u, 10);
    ball(2.2, M(cc.gem, 0.15, { emissive: cc.glow, emissiveIntensity: 0.4 }), { x: 0, y: 23, z: 3, parent: u }).scale.set(1, 1.3, 0.6);
  }
  { const [g, cc] = W('wave_jar'), u = onTop(g, 'wave_jar'); // a jar of waves under a cork
    glassLathe([[11.5, 4], [11.5, 26], [8, 30], [8, 32]], glass(0xf2fbff), { x: 0, y: 0, z: -2, parent: u });
    cyl(10.6, 10.6, 18, M(cc.water, 0.2, { emissive: cc.glow, emissiveIntensity: 0.2 }), { x: 0, y: 11, z: -2, parent: u }); cyl(11.5, 11.5, 2, glass(0xf2fbff), { x: 0, y: 1, z: -2, parent: u });
    for (let i = 0; i < 3; i++) torus(10.8, 0.9, M(cc.water2, 0.3), { x: 0, y: 15 + i * 3, z: -2, rx: Math.PI / 2 + Math.sin(i) * 0.12, parent: u });
    cyl(7.5, 7, 6, M(0xc49a6c, 0.8), { x: 0, y: 34, z: -2, parent: u });
  }
  { const [g, cc] = W('thunder_lamp'), u = onTop(g, 'thunder_lamp'); // a glass dome with a lightning bolt in it
    cyl(11, 12, 6, M(cc.base, 0.45), { x: -2, y: 3, z: -2, parent: u }); torus(11, 1.2, M(cc.base2, 0.4), { x: -2, y: 6, z: -2, rx: Math.PI / 2, parent: u });
    glassLathe([[9.5, 0], [10, 18], [6, 30], [0.01, 32]], glass(0xfffbe8), { x: -2, y: 6, z: -2, parent: u });
    const sh = new THREE.Shape(); [[1, 10], [-4, 0], [0, 0], [-2, -10], [4, 2], [0, 2], [1, 10]].forEach(([a, b], i) => (i ? sh.lineTo(a, b) : sh.moveTo(a, b)));
    mesh(new THREE.ExtrudeGeometry(sh, { depth: 2, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6 }), M(cc.bolt, 0.3, { emissive: cc.bolt, emissiveIntensity: 0.8 }), { x: -2, y: 20, z: -2 }, u);
  }
  { const [g, cc] = W('flame_lamp'), u = onTop(g, 'flame_lamp'); // a lantern with a flame
    box(22, 3, 22, M(cc.frame, 0.4), { x: 0, y: 1.5, z: -6, r: 1, parent: u }); box(20, 3, 20, M(cc.frame, 0.4), { x: 0, y: 26, z: -6, r: 1, parent: u });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(1.8, 23, 1.8, M(cc.frame2, 0.4), { x: a * 9, y: 14, z: -6 + b * 9, parent: u });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(13, 8, 4), M(cc.frame, 0.4)); roof.position.set(0, 31.5, -6); roof.rotation.y = Math.PI / 4; u.add(roof); torus(2.6, 0.6, M(cc.frame2, 0.4), { x: 0, y: 36.5, z: -6, parent: u });
    const fl = ball(5, M(cc.flame, 0.3, { emissive: cc.flame, emissiveIntensity: 1.2 }), { x: 0, y: 12, z: -6, parent: u }); fl.scale.set(0.9, 1.6, 0.9);
    ball(2.6, glow(cc.core, 2), { x: 0, y: 10, z: -6, parent: u }).scale.set(0.9, 1.5, 0.9);
  }
  { const [g, cc] = W('snow_globe'), u = onTop(g, 'snow_globe'); // a snow globe with a tree and a house
    lathe([[0.01, 0], [14, 0], [12, 8], [10, 9], [0.01, 9]], M(cc.base, 0.5), { x: 0, y: 0, z: -2, parent: u }); box(10, 3, 1, M(0xf2c14e, 0.4), { x: 0, y: 4, z: 9.6, parent: u });
    ball(14, glass(0xf4fbff), { x: 0, y: 22, z: -2, parent: u });
    cyl(11, 11, 2, M(0xffffff, 0.9), { x: 0, y: 11, z: -2, parent: u });
    const tr = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 16), M(0x3f9a5a, 0.6)); tr.position.set(-4, 18, -2); u.add(tr);
    box(8, 6, 6, M(0xe05d5d, 0.6), { x: 5, y: 15, z: -1, r: 0.6, parent: u }); box(9, 2, 7, M(0xffffff, 0.8), { x: 5, y: 19, z: -1, parent: u });
  }
  { const [g, cc] = W('mist_jar'), u = onTop(g, 'mist_jar'); // a potion bottle of swirling mist
    glassLathe([[9, 0], [13, 10], [11, 22], [4.5, 26], [4.5, 31]], glass(cc.glass), { x: 0, y: 0, z: -2, parent: u });
    ball(9, M(cc.mist, 0.5, { emissive: cc.glow, emissiveIntensity: 0.35, transparent: true, opacity: 0.7 }), { x: 0, y: 11, z: -2, parent: u }).scale.set(1.15, 1, 1.15);
    for (let i = 0; i < 3; i++) torus(8 - i * 1.5, 1.2, M(cc.mist, 0.4), { x: 0, y: 8 + i * 4.5, z: -2, rx: Math.PI / 2 + 0.25 * (i % 2 ? 1 : -1), parent: u });
    cyl(4.4, 4, 6, M(0xc49a6c, 0.8), { x: 0, y: 33, z: -2, parent: u }); torus(4.8, 0.7, M(cc.glass2, 0.4), { x: 0, y: 30, z: -2, rx: Math.PI / 2, parent: u });
  }
}
