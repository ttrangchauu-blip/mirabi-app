// node join-tiles.mjs <out.png> <count> <tile width> <tile height> <tile files…>: lays tiles of one camera side by side.
import sharp from 'sharp';
const [out, count, w, h, ...files] = process.argv.slice(2);
await sharp({ create: { width: +count * +w, height: +h, channels: 3, background: '#000' }, limitInputPixels: false })
  .composite(files.map((input, i) => ({ input, left: i * +w, top: 0 }))).png().toFile(out);
console.log('joined', out);
