// Cùng bạn tiến bộ: `&part=room` (the wall behind everything), `board` (the chalkboard) or `table` (the table the pets stand behind).
import { kit } from './kit.js';
export async function build({ THREE, scene, W, H }) {
  const { mat, glow, box, ball, cyl, lathe, torus, leaf, wall, daylight, flatCamera } = kit(THREE, scene);
  const part = new URLSearchParams(location.search).get('part') || 'room';
  daylight({ sun: 11, power: 0.7, size: 20 });
  let seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };

  if (part === 'board') {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0xdcd3c0, 0.9));
    floor.position.z = -0.1; floor.userData.noMask = true; scene.add(floor);
    const w = 3.5, h = 1.72, f = 0.1;
    const oak = mat(0xe3cba8, 0.55);
    box(w - f, h - f, 0.03, mat(0x1d4f73, 0.82), { z: 0, r: 0.006 });
    // Faint chalk rubbed away.
    for (let i = 0; i < 9; i++) ball(0.18 + rnd() * 0.24, mat(0x205377, 0.9), { x: -1.4 + rnd() * 2.8, y: -0.6 + rnd() * 1.2, z: 0.012, sz: 0.012, sy: 0.55 });
    box(w + f, f, 0.07, oak, { y: h / 2, z: 0.02, r: 0.024 });
    box(w + f, f, 0.07, oak, { y: -h / 2, z: 0.02, r: 0.024 });
    box(f, h, 0.07, oak, { x: -w / 2, z: 0.02, r: 0.024 });
    box(f, h, 0.07, oak, { x: w / 2, z: 0.02, r: 0.024 });
    box(w + f + 0.04, 0.05, 0.16, mat(0xead9c0, 0.5), { y: -h / 2 - 0.05, z: 0.09, r: 0.016 });
    [[1.15, 0xffffff, 0.1], [1.32, 0xffd9a0, -0.06], [-1.28, 0xbfe6ff, 0.04]].forEach(([x, c, rz]) => cyl(0.014, 0.014, 0.13, mat(c, 0.75), { x, y: -h / 2 - 0.01, z: 0.1, rz: 1.57 + rz }));
    const camera = flatCamera(w + 0.24, W, H, [0, 0.2, 8], [0, -0.03, 0]);
    return camera;
  }
  if (part === 'table') {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(0x8a6a4a, 0.9));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1; floor.userData.noMask = true; scene.add(floor);
    const top = mat(0xe3cba8, 0.5), front = mat(0xd6bb97, 0.62);
    box(7, 0.08, 0.9, top, { y: 0, r: 0.03 });
    box(7, 0.5, 0.05, front, { y: -0.29, z: 0.34, r: 0.012 });
    for (let x = -3.15; x <= 3.2; x += 0.9) box(0.74, 0.34, 0.012, mat(0xc9ab84, 0.68), { x, y: -0.27, z: 0.37, r: 0.006 });
    // A few things at the two ends, away from the pets.
    box(0.5, 0.08, 0.34, mat(0xdf6f5b, 0.65), { x: -1.72, y: 0.08, z: -0.05, ry: 0.1, r: 0.02 });
    box(0.46, 0.07, 0.31, mat(0x5b9bd0, 0.65), { x: -1.7, y: 0.155, z: -0.05, ry: -0.08, r: 0.02 });
    const mug = mat(0xfff8ec, 0.42);
    lathe([[0.001, 0], [0.075, 0], [0.08, 0.15], [0.07, 0.15], [0.062, 0.014], [0.001, 0.014]], mug, { x: 1.72, y: 0.04, z: 0 });
    torus(0.042, 0.01, mug, { x: 1.81, y: 0.115, z: 0 });
    cyl(0.066, 0.066, 0.006, mat(0x8a5a35, 0.25), { x: 1.72, y: 0.17, z: 0 });
    const span = 4, h = span * H / W;
    return flatCamera(span, W, H, [0, 1.8, 6], [0, -h / 2 + 0.24, 0]);
  }
  // The room: a soft wall, a row of little flags, and a wooden lower half.
  const paint = mat(0xb5dcf3, 0.9), wains = mat(0xf4fafe, 0.72), panelM = mat(0xe2f3fc, 0.76), rail = mat(0xffffff, 0.62);
  wall(-6, 6, -9, 3, [], 0.05, paint, { z: -0.05 });
  const railY = -1.21;
  box(12, 0.09, 0.05, rail, { y: railY, z: 0.02, r: 0.02 });
  box(12, 8, 0.03, wains, { y: railY - 4.04, z: -0.005, r: 0.004 });
  for (let x = -3; x <= 3; x += 1.04) for (let y = railY - 0.82; y > -8; y -= 1.4) box(0.84, 1.2, 0.012, panelM, { x, y, z: 0.012, r: 0.008 });
  // Two soft lamps on cords, and the flags between them.
  const pennant = [0xf2a98f, 0xf3d27c, 0x9fc9b0, 0x9ab8e0, 0xe8a9c0];
  const flagsAt = (x) => 1.02 - 0.2 * (1 - Math.pow((x / 2.1), 2));
  for (let x = -1.95, i = 0; x <= 1.96; x += 0.325, i++) {
    const y = flagsAt(x);
    const s = new THREE.Shape([new THREE.Vector2(-0.095, 0), new THREE.Vector2(0.095, 0), new THREE.Vector2(0, -0.22)]);
    const f = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.006, bevelSegments: 2 }), mat(pennant[i % 5], 0.8));
    f.position.set(x, y, 0.04); f.rotation.z = (x / 2.1) * 0.18; scene.add(f);
  }
  for (let x = -2.1; x < 2.1; x += 0.05) ball(0.009, mat(0x8a6a4a, 0.7), { x, y: flagsAt(x) + 0.004, z: 0.05 });
  const span = 4;
  const camera = flatCamera(span, W, H, [0, 1.15 - (span * H / W) / 2, 9]);
  camera.lookAt(0, 1.15 - (span * H / W) / 2, 0); camera.updateMatrixWorld(true);
  return camera;
}
