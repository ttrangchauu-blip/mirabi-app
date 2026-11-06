// Vườn tài chính's land: hills, a fence, far trees and the meadow where the goals grow. The sky is left out: the app draws the real one.
import { kit } from './kit.js';
export async function build({ THREE, scene, W, H, light }) {
  const { mat, glow, box, ball, cyl, sky } = kit(THREE, scene);
  const night = light === 'night';
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
  if (night) sky({ top: 0x46508c, mid: 0x4a5088, low: 0x2a2c4a, power: 0.72, sun: { dir: [-0.3, 0.8, 0.5], size: 24, power: 2.4, color: 0xbcd0ff } });
  else sky({ top: 0xdcecff, mid: 0xf4f4ee, low: 0xc8d8a8, power: 0.66, sun: { dir: [-0.55, 0.72, 0.65], size: 16, power: 13, color: 0xfff0dc } });

  /** The height of the land here: flat where the goals stand, swelling into hills at the back. */
  const hill = (x, z) => {
    const back = Math.min(1, Math.max(0, (-z - 4) / 10));
    const beyond = Math.max(0, (-z - 14) / 2.5);
    const ridge = back * back * 3.1 * (0.74 + 0.26 * Math.sin(x * 0.62 + 1.1)) + back * 0.42 * Math.sin(x * 1.25 + 0.4);
    return 0.05 * Math.sin(x * 1.1 + z * 0.7) + 0.035 * Math.sin(x * 2.3 - z * 1.1) + ridge - beyond * beyond * 2.2;
  };
  const landGeo = new THREE.PlaneGeometry(40, 34, 260, 220);
  landGeo.rotateX(-Math.PI / 2);
  landGeo.translate(0, 0, -12);
  const pos = landGeo.attributes.position, colors = new Float32Array(pos.count * 3);
  const front = new THREE.Color(0x9ed27f), back = new THREE.Color(0x8fc78a), far = new THREE.Color(0xa9d3a2), soil = new THREE.Color(0x7d5430), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, hill(x, z));
    tmp.copy(front).lerp(back, Math.min(1, Math.max(0, (-z - 1) / 5))).lerp(far, Math.min(1, Math.max(0, (-z - 6) / 6)));
    // The soil at the front, with a soft wavy edge.
    const edge = 9;
    if (z > edge) tmp.copy(soil);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  landGeo.computeVertexNormals();
  landGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(landGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 })));

  const soft = mat(0x7dbb86, 0.85), soft2 = mat(0x93c997, 0.85), softWarm = mat(0xe9bd83, 0.85), softWarm2 = mat(0xe3ab74, 0.85), softPink = mat(0xf2c6d2, 0.85);
  const leafy = mat(0x5ba56b, 0.8), leafy2 = mat(0x71b878, 0.8), warm = mat(0xe3a35e, 0.8), warm2 = mat(0xd98a50, 0.8), pink = mat(0xf2b3c6, 0.8), bark = mat(0x8a5e3a, 0.85);
  const tree = (x, z, s, a, b) => {
    const y0 = hill(x, z);
    cyl(0.07 * s, 0.1 * s, 0.5 * s, bark, { x, y: y0 + 0.25 * s, z });
    [[0, 0.72, 0.4], [-0.26, 0.56, 0.28], [0.27, 0.54, 0.3], [0.04, 1.0, 0.27], [-0.14, 0.86, 0.22], [0.2, 0.84, 0.2]].forEach(([dx, dy, r], i) => ball(r * s, i % 2 ? a : b, { x: x + dx * s, y: y0 + dy * s, z: z + (i % 3) * 0.06 * s }));
  };
  [[-4.6, -9.2, 0.95, soft, soft2], [-3, -10.2, 0.85, soft2, soft], [-1.4, -9.8, 0.8, softWarm, softWarm2], [0.5, -10.6, 0.85, soft, soft2], [2.1, -9.6, 0.82, softPink, soft2], [3.5, -10.3, 0.9, soft2, soft], [4.9, -9.1, 1, soft, soft2]].forEach((t) => tree(...t));
  // A fence across the meadow.
  const post = mat(0xefdcbc, 0.72);
  const fz = -3.4;
  for (let x = -5.2; x <= 5.2; x += 0.62) box(0.085, 0.42, 0.06, post, { x, y: hill(x, fz) + 0.2, z: fz, r: 0.03 });
  box(11, 0.05, 0.035, post, { y: hill(0, fz) + 0.3, z: fz - 0.04, r: 0.016 });
  box(11, 0.05, 0.035, post, { y: hill(0, fz) + 0.15, z: fz - 0.04, r: 0.016 });
  // Bushes along the fence, at the ends of the meadow.
  const bush = (x, z, s) => { const y0 = hill(x, z); [[0, 0.16, 0.25], [-0.21, 0.1, 0.19], [0.22, 0.09, 0.18], [0.03, 0.27, 0.15]].forEach(([dx, dy, r], i) => ball(r * s, i % 2 ? leafy : leafy2, { x: x + dx * s, y: y0 + dy * s, z })); };
  bush(-3.75, -2.6, 1.2); bush(3.8, -2.7, 1.3); bush(-1.9, -3, 0.85); bush(1.75, -3.05, 0.85); bush(0.1, -3.1, 0.7);
  // Flowers and tufts of grass over the meadow.
  const petals = [0xffffff, 0xffe08a, 0xf7a8bd, 0xc9b4ee];
  for (let i = 0; i < 56; i++) {
    const x = -4.6 + rnd() * 9.2, z = -3 + rnd() * 5.6, y = hill(x, z), c = petals[i % 4];
    cyl(0.009, 0.011, 0.1, mat(0x5e9e55, 0.7), { x, y: y + 0.05, z });
    ball(0.04, mat(c, 0.55), { x, y: y + 0.11, z, sy: 0.7 });
    ball(0.016, mat(0xf5c542, 0.55), { x, y: y + 0.133, z, sy: 0.7 });
  }
  const tuft = mat(0x8cc56f, 0.9), tuft2 = mat(0xaedb86, 0.9);
  for (let i = 0; i < 90; i++) { const x = -4.8 + rnd() * 9.6, z = -3.2 + rnd() * 5.8, r = 0.05 + rnd() * 0.08; ball(r, i % 3 ? tuft2 : tuft, { x, y: hill(x, z) + r * 0.1, z, sy: 0.4 }); }
  if (night) for (let i = 0; i < 26; i++) ball(0.022, glow(0xffe9a0, 7), { x: -4 + rnd() * 8, y: 0.25 + rnd() * 0.5, z: -3 + rnd() * 3.4 });

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 80);
  camera.position.set(0, 1.6, 7.1); camera.lookAt(0, 0.96, -4); camera.updateMatrixWorld(true);
  return camera;
}
