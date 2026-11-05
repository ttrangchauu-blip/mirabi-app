// node compose-focus.mjs <cut folder> <out.png> [wall] [floor] : stacks the layers the way the app does, for a look without the app.
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
const [dir, out, wall = 'wall_lilac', floor = 'floor_wood_honey'] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync('raw/focus/plates.json', 'utf8'));
const at = (file, b) => ({ input: path.join(dir, file), left: Math.round(b[0] * 2), top: Math.round(b[1] * 2) });
const order = ['extras', 'window', 'memo_board', 'wall_clock', 'calendar', 'rug_oval', 'desk', 'book_stack', 'desk_lamp', 'mug', 'bookcase', 'desk_plant', 'plant_monstera'];
const layers = [at(`${floor}.webp`, t[floor])];
for (const n of order) {
  layers.push(at(`${n}.webp`, t[n].box));
  if (n === 'window') { layers.push(at('window-curtainL.webp', t.window.curtainL), at('window-curtainR.webp', t.window.curtainR)); }
  if (n === 'plant_monstera') layers.push(at('plant_monstera-leaves.webp', t.plant_monstera.leaves));
}
layers.push(at('desk-body.webp', t.desk.cover), at('book_stack.webp', t.book_stack.box), at('desk_lamp.webp', t.desk_lamp.box), at('mug.webp', t.mug.box));
for (const n of ['fore.left', 'fore.right', 'fore.vine']) layers.push(at(`${n.replace('.', '-')}.webp`, t[n].box));
const whole = await sharp(path.join(dir, `${wall}.jpg`)).composite(layers).png().toBuffer(); await sharp(whole).resize(900).png().toFile(out);
console.log('ok');
