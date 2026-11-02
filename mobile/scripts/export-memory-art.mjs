// Writes assets/memory-art.json: the item icons (src/itemArt.ts) and garden plants (src/gardenArt.ts) the backend
// draws into memory pictures (backend/app/memories.py), so a walk keepsake or a harvest shows the same drawing as the
// app. Run it after changing those drawings; __tests__/memory-art.test.ts fails while the JSON is out of date.
// Usage: node scripts/export-memory-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('sucrase/register/ts');
const { ITEM_ICONS } = require('../src/itemArt.ts');
const { GARDEN_PLANTS, SOIL_PLOT } = require('../src/gardenArt.ts');

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'memory-art.json');
fs.writeFileSync(out, `${JSON.stringify({ items: ITEM_ICONS, plants: GARDEN_PLANTS, soil: SOIL_PLOT }, null, 1)}\n`);
console.log(`${out}: ${Object.keys(ITEM_ICONS).length} items, ${Object.keys(GARDEN_PLANTS).length} plants`);
