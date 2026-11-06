// The desk seen from above, where the notes lie: light boards, the same wood as the back of the desk, a tile that repeats downwards.
import { kit } from './kit.js';
export async function build({ THREE, scene, W, H }) {
  const { mat, box, daylight, flatCamera } = kit(THREE, scene);
  daylight({ sun: 8, power: 0.86, size: 22 });
  const tones = [0xe9e2d4, 0xe4dccc, 0xeee8dc, 0xe7e0d1];
  for (let i = -7; i <= 7; i++) box(0.665, 40, 0.1, mat(tones[(i + 14) % 4], 0.62), { x: i * 0.67, y: 0, z: 0, r: 0.016 });
  return flatCamera(4, W, H, [0, 0, 8]);
}
