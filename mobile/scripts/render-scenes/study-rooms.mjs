// What the two study rooms are made of: which passes `render-study.mjs` renders and `cut-study.mjs` cuts.
// `on`: what must stand there for the item to stand on it (its shadow is measured against that). `parts`: cut out apart, because they move.
// `cover`: a second cut-out without shadow, drawn over the pet. `noShadow`: cut by its mask alone. `fromBase`: a cut-out of the empty room's own
// picture, nothing more to render. `show`: the group that holds it.
export const ROOMS = {
  focus: {
    scene: 'scene-focus', empty: '', floors: ['tile'], shellMasks: ['paint', 'floor'],
    items: [
      { name: 'window', parts: ['window.curtainL', 'window.curtainR'], glass: [272, 52, 368, 182] },
      { name: 'memo_board' }, { name: 'wall_clock' }, { name: 'calendar' }, { name: 'rug_oval' },
      { name: 'desk', cover: 'desk.body' },
      { name: 'book_stack', on: ['desk'] }, { name: 'desk_lamp', on: ['desk'] }, { name: 'mug', on: ['desk'] },
      { name: 'bookcase' }, { name: 'desk_plant', on: ['bookcase'] },
      { name: 'plant_monstera', parts: ['plant_monstera.leaves'] },
      { name: 'extras' },
      { name: 'fore.left', show: 'fore', noShadow: true }, { name: 'fore.right', show: 'fore', noShadow: true }, { name: 'fore.vine', show: 'fore', noShadow: true },
    ],
  },
  group: {
    scene: 'scene-grouproom', empty: 'room,table', floors: [], shellMasks: [],
    items: [
      ...Array.from({ length: 8 }, (_, i) => ({ name: `seat${i}` })),
      { name: 'table', fromBase: true }, { name: 'win.frame', fromBase: true }, { name: 'win.curtainL', fromBase: true }, { name: 'win.curtainR', fromBase: true },
      { name: 'fore.left', show: 'fore', noShadow: true }, { name: 'fore.right', show: 'fore', noShadow: true },
    ],
  },
};
