// What Vườn tài chính's scenes share: the sun, the lawn's colours, the stone ring a goal grows in, and shapes for trees that have real bark, branches and leaves.
export const SUN = { dir: [-0.5, 0.78, 0.46], size: 9, power: 42, color: 0xfff2dc };
export const NIGHT_SUN = { dir: [-0.4, 0.75, 0.55], size: 14, power: 8, color: 0xbcd0ff };
export const PITCH_DEG = 20;

export function light(sky, night) {
  if (night) sky({ top: 0x35447e, mid: 0x46558e, low: 0x262c48, power: 0.82, sun: NIGHT_SUN });
  else sky({ top: 0xa6d8fa, mid: 0xeaf6fc, low: 0xa8c47a, power: 0.86, sun: SUN });
}
const clamp01 = (n) => Math.max(0, Math.min(1, n));
/** The lawn's colour at a point: the same wherever a scene of this garden draws it. */
export function lawnPaint(THREE, wave) {
  const A = new THREE.Color(0x7db44c), B = new THREE.Color(0x93c55a), C = new THREE.Color(0xabd46e);
  return (c, x, z) => {
    const n = wave(x, z);
    c.copy(A).lerp(B, clamp01(0.55 + n));
    if (n > 0.32) c.lerp(C, clamp01((n - 0.32) * 1.6));
  };
}

export function shapes(THREE, v) {
  const { place, rnd, between, lumps, blob, tmp } = v;
  const V3 = (a) => new THREE.Vector3(...a);
  const BARK_D = new THREE.Color(0x70431f), BARK_L = new THREE.Color(0xc08a4c);
  const bark = (c, x, y, z, nx, ny, nz) => {
    const a = Math.atan2(nz, nx), k = 0.5 + 0.5 * Math.sin(a * 11 + y * 2.4 + lumps(x * 3, y * 2, z * 3) * 2.2);
    c.copy(BARK_D).lerp(BARK_L, 0.12 + k * 0.72 + lumps(x * 9, y * 7, z * 9) * 0.1);
  };
  /** A round limb along points, thinner as it goes: `flare` spreads its foot into roots, `ridges` furrows it like bark. */
  const tube = (pts, r0, r1, paint = bark, { radial = 12, along = 14, flare = 0, ridges = 0, into } = {}) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(V3));
    const frames = curve.computeFrenetFrames(along, false);
    const pos = [], idx = [], off = rnd() * 9;
    for (let i = 0; i <= along; i++) {
      const t = i / along, p = curve.getPointAt(t), r = (r0 + (r1 - r0) * t) * (1 + flare * Math.pow(1 - t, 7));
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2, rr = r * (1 + ridges * Math.sin(a * 7 + t * 4 + off) + (flare ? flare * 0.32 * Math.pow(1 - t, 5) * Math.sin(a * 5 + off) : 0));
        const n = frames.normals[i], b = frames.binormals[i];
        pos.push(p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * rr, p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * rr, p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * rr);
      }
    }
    for (let i = 0; i < along; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, d = i * radial + (j + 1) % radial, e = a + radial, f = d + radial; idx.push(a, d, e, d, f, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    place(g, paint, into ? { into } : {});
  };
  // A leaf or a petal: a flattened, pointed lump, from its base out along +y.
  const bladeGeo = (() => {
    const g = new THREE.SphereGeometry(1, 7, 5), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), tip = y > 0 ? 1 - y * y * 0.62 : 1 - y * y * 0.2;
      p.setXYZ(i, p.getX(i) * tip, y + 1, p.getZ(i) * 0.16 + (y * y - 0.5) * 0.14);
    }
    g.computeVertexNormals();
    return g;
  })();
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), spin = new THREE.Quaternion(), mtx = new THREE.Matrix4(), one = new THREE.Vector3();
  /** A blade from a point, pointing along a direction, turned by `roll`. */
  const blade = (x, y, z, dir, len, wid, paint, roll = rnd() * 6.28) => {
    one.set(dir[0], dir[1], dir[2]).normalize();
    q.setFromUnitVectors(up, one);
    spin.setFromAxisAngle(up, roll);
    q.multiply(spin);
    mtx.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(wid, len / 2, wid));
    place(bladeGeo, paint, { M: mtx.clone() });
  };
  /** Foliage or blossom round a point: lobes of soft mass, and on them a coat of separate leaves or petals. */
  const cloud = (x, y, z, r, { dark, lit, coat, n = 150, len = 0.11, wid = 0.05, flat = 0.86, lobes = 5 }) => {
    blob(r * 0.84, x, y, z, dark, lit, { flat, rough: 0.2 });
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + rnd(), e = between(-0.2, 0.55), R = r * 0.62;
      blob(r * between(0.42, 0.56), x + Math.cos(a) * R * Math.cos(e), y + Math.sin(e) * R * flat, z + Math.sin(a) * R * Math.cos(e) * 0.82, dark, lit, { flat, rough: 0.18 });
    }
    for (let i = 0; i < n; i++) {
      // Spread evenly over the ball, fewer underneath where nothing would see them.
      const t = (i + 0.5) / n, ny = 1 - 2 * t * 0.86, nr = Math.sqrt(Math.max(0, 1 - ny * ny)), a = i * 2.39996;
      const nx = Math.cos(a) * nr, nz = Math.sin(a) * nr, d = r * between(0.86, 1.06) * (1 + lumps(nx * 3, ny * 3, nz * 3) * 0.1);
      const col = coat[Math.floor(rnd() * coat.length)], tone = between(0.92, 1.08);
      blade(x + nx * d, y + ny * d * flat, z + nz * d * 0.92, [nx + between(-0.45, 0.45), ny + between(-0.2, 0.55), nz + between(-0.45, 0.45)], len * between(0.8, 1.2), wid * between(0.85, 1.2), (c) => c.set(col).multiplyScalar(tone));
    }
  };
  // Gold ornaments have a shiny mesh of their own.
  const gold = [];
  const star = (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.44 : 1; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    g.deleteAttribute('uv');
    return g;
  })();
  /** A gold coin hanging by a little stalk, facing the viewer, with a star on it. */
  const coin = (x, y, z, r = 0.12, yaw = 0, stalk = true) => {
    if (stalk) tube([[x, y + r * 2.2, z - 0.03], [x, y + r * 1.5, z], [x, y + r * 0.9, z]], 0.012, 0.009, 0x6d8a3a, { radial: 6, along: 4 });
    place(new THREE.CylinderGeometry(r, r, r * 0.34, 26), 0xf6bf2e, { x, y, z, rx: Math.PI / 2, ry: 0, rz: yaw, into: gold });
    place(new THREE.TorusGeometry(r * 0.9, r * 0.12, 8, 28), 0xffd764, { x, y, z: z + r * 0.15, ry: yaw, into: gold });
    place(star, 0xffe58a, { x, y, z: z + r * 0.14, sx: r * 0.54, sy: r * 0.54, sz: r * 0.5, ry: yaw, into: gold });
  };
  return { tube, blade, cloud, coin, gold, bark, tmp };
}

/** The ring of cut stones a goal stands in, with soil or still water in it and grass against its foot. The middle of its soil is at `SOIL_Y`. */
export const RING = 0.96;
export const SOIL_Y = 0.17;
export function ring(THREE, v, cx, water = false, waterParts = null) {
  const { place, box, between, rnd, reseed, lumps, tmp } = v;
  reseed(301);
  const N = 19;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + between(-0.015, 0.015), tone = between(0.92, 1.05), h = between(0.21, 0.27);
    box(between(0.31, 0.34), h, between(0.2, 0.25), (c, x, y) => c.set(0xdcd6c6).lerp(tmp.set(0xb7ae9c), Math.max(0, 0.75 - y * 3.2)).multiplyScalar(tone), { x: cx + Math.cos(a) * RING, y: h / 2 - 0.005, z: Math.sin(a) * RING, ry: -a + Math.PI / 2, r: 0.05 });
  }
  // An inner course, so the rim has thickness when seen from above.
  for (let i = 0; i < N - 2; i++) {
    const a = (i / (N - 2)) * Math.PI * 2 + 0.11, tone = between(0.86, 0.98);
    box(0.27, 0.16, 0.15, (c) => c.set(0xcfc7b4).multiplyScalar(tone), { x: cx + Math.cos(a) * (RING - 0.16), y: 0.08, z: Math.sin(a) * (RING - 0.16), ry: -a + Math.PI / 2, r: 0.04 });
  }
  if (water) {
    const g = new THREE.CircleGeometry(RING - 0.1, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x53c4f0, roughness: 0.08, metalness: 0.05 }));
    m.position.set(cx, SOIL_Y, 0);
    (waterParts ?? []).push(m);
    place(new THREE.CircleGeometry(RING - 0.05, 40), 0x3b8ea6, { x: cx, y: 0.05, rx: -Math.PI / 2 });
  } else {
    const r = RING - 0.13, rings = 18, around = 56, pos = [], idx = [];
    for (let j = 0; j <= rings; j++) for (let i = 0; i < around; i++) {
      const k = j / rings, a = (i / around) * Math.PI * 2, x = Math.cos(a) * k * r, z = Math.sin(a) * k * r;
      pos.push(x, SOIL_Y * (1 - Math.pow(k, 3) * 0.28) + 0.018 * lumps(x * 7, z * 7, 1) + 0.008 * Math.sin(x * 31) * Math.sin(z * 29), z);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < around; i++) { const a = j * around + i, d = j * around + (i + 1) % around, e = a + around, f = d + around; idx.push(a, d, e, d, f, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const D = new THREE.Color(0x6b4023), L = new THREE.Color(0xa56f3f);
    place(g, (c, x, y, z) => c.copy(D).lerp(L, Math.max(0, Math.min(1, 0.5 + lumps(x * 6, z * 6, 2) * 0.5 + Math.sin(z * 27 + Math.sin(x * 5)) * 0.14))), { x: cx });
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * (RING - 0.26), s = between(0.012, 0.03); place(new THREE.IcosahedronGeometry(1, 0), (c) => c.set(0x8a6a48).multiplyScalar(between(0.9, 1.2)), { x: cx + Math.cos(a) * d, y: SOIL_Y + 0.008, z: Math.sin(a) * d, sx: s, sy: s * 0.6, sz: s }); }
  }
  // Grass grown up against the stones.
  const tuft = new THREE.ConeGeometry(0.03, 0.15, 5);
  for (let i = 0; i < 170; i++) {
    const a = rnd() * 6.28, d = RING + between(0.13, 0.32), h = between(0.8, 1.5);
    place(tuft, (c) => c.set(0x4c9c2c).lerp(tmp.set(0xb0e052), between(0.1, 0.9)), { x: cx + Math.cos(a) * d, y: 0.07 * h, z: Math.sin(a) * d, sy: h, rz: between(-0.32, 0.32), rx: between(-0.2, 0.2) });
  }
}
