// A small kit for soft, toy-like scenes: everything is rounded and matte, lit by a soft sky with one wide, warm sun in it.
// Light comes only from that sky, so it is sampled well (little noise) and is the same everywhere (tiles stay seamless).
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export function kit(THREE, scene) {
  const add = (m, o = {}) => {
    m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    if (o.sx || o.sy || o.sz) m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    if (o.bare) m.userData.noMask = true;
    (o.parent ?? scene).add(m);
    return m;
  };
  const mat = (color, rough = 0.72, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
  const glow = (color, power) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: power });
  const box = (w, h, d, m, o = {}) => add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(o.r ?? 0.015, Math.min(w, h, d) * 0.49)), m), o);
  const ball = (r, m, o = {}) => add(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 22), m), o);
  const cyl = (rt, rb, h, m, o = {}) => add(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 32), m), o);
  const cone = (r, h, m, o = {}) => add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 32), m), o);
  const lathe = (pts, m, o = {}) => add(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40), new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity, side: THREE.DoubleSide })), o);
  const torus = (r, t, m, o = {}) => add(new THREE.Mesh(new THREE.TorusGeometry(r, t, 16, 40), m), o);
  /** A flat board with holes in it, standing in the XY plane. */
  const wall = (x0, x1, y0, y1, holes, depth, m, o = {}) => {
    const shape = new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);
    holes.forEach((h) => shape.holes.push(new THREE.Path([new THREE.Vector2(h.x0, h.y0), new THREE.Vector2(h.x0, h.y1), new THREE.Vector2(h.x1, h.y1), new THREE.Vector2(h.x1, h.y0)])));
    return add(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), m), o);
  };
  // A leaf: a flattened pointed ball, from its base outwards along +y.
  const leafGeo = (() => {
    const g = new THREE.SphereGeometry(1, 20, 16);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = 1 - Math.pow(Math.abs(y), 2.2) * 0.25;
      const tip = y > 0 ? 1 - y * y * 0.55 : 1;
      p.setX(i, p.getX(i) * k * tip);
      p.setZ(i, p.getZ(i) * 0.16);
      p.setY(i, y + 1);
    }
    g.computeVertexNormals();
    return g;
  })();
  const leaf = (len, wid, m, o = {}) => {
    const l = new THREE.Mesh(leafGeo, m);
    l.scale.set(wid, len / 2, wid);
    l.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    l.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    (o.parent ?? scene).add(l);
    return l;
  };
  /** A soft sky all around: `top` overhead, `mid` at the horizon, `low` from below, and a wide sun. */
  const sky = ({ top, mid, low, power = 1, sun }) => {
    const W = 256, H = 128, data = new Float32Array(W * H * 4), T = new THREE.Color(top), M = new THREE.Color(mid), L = new THREE.Color(low), c = new THREE.Color();
    const dir = sun ? new THREE.Vector3(...sun.dir).normalize() : null;
    const warm = sun ? new THREE.Color(sun.color ?? 0xfff0d8) : null;
    const edge = sun ? Math.cos((sun.size ?? 16) * Math.PI / 180) : 0;
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;
      if (v > 0.5) c.copy(M).lerp(T, (v - 0.5) * 2); else c.copy(L).lerp(M, Math.min(1, v * 2.6));
      const el = (v - 0.5) * Math.PI, r = Math.cos(el), y = Math.sin(el);
      for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 4, an = ((i + 0.5) / W - 0.5) * Math.PI * 2;
        let add = 0;
        if (dir) { const d = Math.cos(an) * r * dir.x + y * dir.y + Math.sin(an) * r * dir.z; add = d <= edge ? 0 : Math.min(1, (d - edge) / ((1 - edge) * 0.35)) * sun.power; }
        data[k] = c.r * power + (warm ? warm.r * add : 0);
        data[k + 1] = c.g * power + (warm ? warm.g * add : 0);
        data[k + 2] = c.b * power + (warm ? warm.b * add : 0);
        data[k + 3] = 1;
      }
    }
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    t.mapping = THREE.EquirectangularReflectionMapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
    scene.environment = t; scene.background = t;
    return t;
  };
  /** The day of every scene but the garden's own. */
  const daylight = (o = {}) => sky({ top: 0xf2f5fa, mid: 0xf6f5f2, low: 0xdfd9cf, power: o.power ?? 0.62, sun: { dir: o.dir ?? [-0.55, 0.75, 0.75], size: o.size ?? 15, power: o.sun ?? 16, color: 0xfff1e2 } });
  /** The evening: little sky, a warm light over the middle of the picture. */
  const evening = (o = {}) => sky({ top: 0x6d78c0, mid: 0x6a6fb4, low: 0x3a3a5e, power: o.power ?? 0.85, sun: { dir: o.dir ?? [0.1, 0.8, 0.55], size: o.size ?? 20, power: o.sun ?? 1.6, color: 0xffd8b0 } });
  /** A wide light out of frame. */
  const panel = (w, h, x, y, z, color, power, at = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: power, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(...at); m.userData.noMask = true; scene.add(m);
    return m;
  };
  /** Looking straight along a slant, without perspective: `span` world units across the picture. */
  const flatCamera = (span, W, H, from, to = [0, 0, 0]) => {
    const h = span * H / W;
    const cam = new THREE.OrthographicCamera(-span / 2, span / 2, h / 2, -h / 2, 0.1, 200);
    cam.position.set(...from); cam.lookAt(...to); cam.updateMatrixWorld(true);
    return cam;
  };
  return { add, mat, glow, box, ball, cyl, cone, lathe, torus, wall, leaf, sky, daylight, evening, panel, flatCamera };
}
