import ART from '../assets/memory-art.json';
import { ITEM_ICONS } from '../src/itemArt';
import { GARDEN_PLANTS, SOIL_PLOT } from '../src/gardenArt';

// The backend draws walk keepsakes and harvests into memory pictures from this export (memories.py).
test('memory-art.json matches the app drawings (run node scripts/export-memory-art.mjs)', () => {
  expect(ART.items).toEqual(ITEM_ICONS);
  expect(ART.plants).toEqual(GARDEN_PLANTS);
  expect(ART.soil).toEqual(SOIL_PLOT);
});

// The backend renders memory pictures with these files (memory_render.py): the same letters the app draws.
test.each(['400Regular', '600SemiBold', '700Bold', '800ExtraBold'])('the backend renders with the app\'s Nunito %s', (weight) => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const file = `Nunito_${weight}.ttf`;
  const app = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@expo-google-fonts', 'nunito', weight, file));
  const backend = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'app', 'data', 'fonts', file));
  expect(backend.equals(app)).toBe(true);
});
