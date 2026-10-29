/**
 * The garden's plants: for every seed (backend items_catalog group `seed`) three pictures of the plant as it grows,
 * 0 = sprout, 1 = growing (leaves, a bud), 2 = grown (in bloom, or bearing fruit). Each is an SVG on a 64x64 canvas,
 * the plant coming out of the bottom centre (32, 64); the soil is not drawn, the app draws the plot (SOIL_PLOT) under it.
 * Plain SVG markup like rewardArt.ts, so it renders in the app (SvgXml) and in static previews.
 */

const svg = (body: string, viewBox = '0 0 64 64') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

const n = (x: number) => +x.toFixed(1);

const GREEN = '#5CC25A';
const GREEN_EDGE = '#2E7D3A';
const STEM = '#4E9A54';

/** An almond leaf, its base at x,y, `len` long and `width` wide, turned `deg` from pointing up. */
function leaf(x: number, y: number, len: number, width: number, deg: number, fill = GREEN, edge = GREEN_EDGE, vein = true) {
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(deg)})"><path d="M0 0Q${n(width)} ${n(-len * 0.45)} 0 ${n(-len)}Q${n(-width)} ${n(-len * 0.45)} 0 0Z" fill="${fill}" stroke="${edge}" stroke-width="0.9" stroke-linejoin="round"/>${
    vein ? `<path d="M0 ${n(-len * 0.15)}V${n(-len * 0.72)}" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="0.9" stroke-linecap="round"/>` : ''}</g>`;
}

const stem = (d: string, width = 2.4, color = STEM) => `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;

/** `count` copies of a shape turned evenly around cx,cy. */
const around = (count: number, cx: number, cy: number, shape: string, start = 0) =>
  Array.from({ length: count }, (_, i) => `<g transform="rotate(${n(start + (360 / count) * i)} ${cx} ${cy})">${shape}</g>`).join('');

/** The usual first pair of round seed leaves on a short stem. */
const sprout = (height = 10, size = 9, fill = GREEN) =>
  stem(`M32 64Q32 ${64 - height / 2} 32 ${64 - height}`) + leaf(32, 64 - height + 1, size, size, -62, fill) + leaf(32, 64 - height + 1, size, size, 62, fill);

// ------------------------------------------------------------------------------------------------ daisy
function daisy(cx: number, cy: number, r: number) {
  return around(12, cx, cy, `<ellipse cx="${cx}" cy="${n(cy - r * 0.58)}" rx="${n(r * 0.24)}" ry="${n(r * 0.5)}" fill="#FFFFFF" stroke="#C9BFB0" stroke-width="0.7"/>`)
    + `<circle cx="${cx}" cy="${cy}" r="${n(r * 0.36)}" fill="#FFC93C" stroke="#D9951A" stroke-width="0.8"/>`
    + `<circle cx="${n(cx - r * 0.12)}" cy="${n(cy - r * 0.12)}" r="${n(r * 0.1)}" fill="#FFFFFF" opacity="0.7"/>`;
}

const DAISY: [string, string, string] = [
  sprout(10, 8),
  stem('M32 64Q31 50 32 34') + leaf(32, 58, 13, 8, -58) + leaf(32, 56, 12, 8, 60) + leaf(31.6, 48, 10, 7, -50) + leaf(31.8, 44, 9, 6, 48)
    + '<path d="M28.6 32Q28.6 26 32 25Q35.4 26 35.4 32Q32 34.5 28.6 32Z" fill="#FFFFFF" stroke="#C9BFB0" stroke-width="0.7"/>'
    + '<path d="M28.4 31.5Q32 36.5 35.6 31.5Q35 36 32 36.4Q29 36 28.4 31.5Z" fill="#7BC96B" stroke="#3E8A44" stroke-width="0.7"/>',
  stem('M32 64Q30 47 24 28') + stem('M32 64Q35 50 43 37') + stem('M32 64Q33 56 35 47', 2)
    + leaf(31.5, 60, 14, 9, -60) + leaf(32.5, 59, 13, 9, 62) + leaf(29.5, 48, 10, 7, -55) + leaf(37, 50, 9, 6, 55)
    + daisy(24, 24.5, 14) + daisy(43, 34.5, 10.5) + daisy(35.5, 44, 7.5),
];

// ------------------------------------------------------------------------------------------------ sunflower
function sunflowerHead(cx: number, cy: number, r: number) {
  const seeds = [[-0.4, -0.3], [0.1, -0.45], [0.45, -0.1], [-0.15, 0.1], [0.3, 0.35], [-0.45, 0.25], [0, 0.5], [0.05, -0.05]]
    .map(([dx, dy]) => `<circle cx="${n(cx + dx * r * 0.62)}" cy="${n(cy + dy * r * 0.62)}" r="${n(r * 0.06)}"/>`).join('');
  return around(16, cx, cy, `<ellipse cx="${cx}" cy="${n(cy - r * 0.68)}" rx="${n(r * 0.17)}" ry="${n(r * 0.36)}" fill="#FFB92E" stroke="#E0851A" stroke-width="0.7"/>`, 11.25)
    + around(16, cx, cy, `<ellipse cx="${cx}" cy="${n(cy - r * 0.66)}" rx="${n(r * 0.17)}" ry="${n(r * 0.37)}" fill="#FFD23F" stroke="#E0911A" stroke-width="0.7"/>`)
    + `<circle cx="${cx}" cy="${cy}" r="${n(r * 0.42)}" fill="#7A4A22" stroke="#5C361C" stroke-width="0.9"/><g fill="#A8714A">${seeds}</g>`;
}

const SUNFLOWER: [string, string, string] = [
  stem('M32 64Q32 58 32 53', 3)
    + '<ellipse cx="26.5" cy="51.5" rx="6.4" ry="3.6" fill="#6CC36A" stroke="#2E7D3A" stroke-width="0.9" transform="rotate(-22 26.5 51.5)"/>'
    + '<ellipse cx="37.5" cy="51.5" rx="6.4" ry="3.6" fill="#6CC36A" stroke="#2E7D3A" stroke-width="0.9" transform="rotate(22 37.5 51.5)"/>'
    + '<path d="M24 50.5Q26.5 48.8 29.5 50" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="0.9" fill="none" stroke-linecap="round"/>'
    + '<ellipse cx="34" cy="47" rx="2.2" ry="3.4" fill="#3A2418" transform="rotate(30 34 47)"/><path d="M33 45.2L35 48.6" stroke="#FFFFFF" stroke-width="0.7" stroke-linecap="round"/>',
  stem('M32 64Q33 44 32 22', 3.2) + leaf(32, 56, 16, 14, -62) + leaf(32, 50, 15, 13, 64) + leaf(32.4, 40, 12, 11, -56) + leaf(32.2, 33, 10, 9, 54)
    + around(10, 32, 18, '<ellipse cx="32" cy="12.6" rx="1.6" ry="2.6" fill="#FFD23F" stroke="#E0911A" stroke-width="0.6"/>')
    + '<circle cx="32" cy="18" r="5.2" fill="#7BC96B" stroke="#3E8A44" stroke-width="0.9"/>'
    + '<path d="M28.5 17Q32 14 35.5 17M29 20Q32 17.5 35 20" stroke="#3E8A44" stroke-width="0.7" fill="none"/>',
  stem('M32 64Q34 46 32 28', 3.4) + leaf(32.4, 58, 16, 14, -64) + leaf(32.6, 52, 15, 13, 62) + leaf(33, 42, 12, 11, -56) + leaf(32.8, 36, 10, 9, 52)
    + sunflowerHead(32, 19, 15.5),
];

// ------------------------------------------------------------------------------------------------ tulip
function tulipCup(x: number, y: number, s: number, fill: string, edge: string) {
  return `<path d="M${n(x - 5 * s)} ${n(y - 5 * s)}Q${n(x - 6.2 * s)} ${n(y + 2 * s)} ${x} ${n(y + 4.5 * s)}Q${n(x + 6.2 * s)} ${n(y + 2 * s)} ${n(x + 5 * s)} ${n(y - 5 * s)}L${n(x + 2.5 * s)} ${n(y - 2.2 * s)}L${x} ${n(y - 6.2 * s)}L${n(x - 2.5 * s)} ${n(y - 2.2 * s)}Z" fill="${fill}" stroke="${edge}" stroke-width="0.9" stroke-linejoin="round"/>`
    + `<path d="M${x} ${n(y - 5 * s)}V${n(y + 3 * s)}" stroke="${edge}" stroke-width="0.7" opacity="0.55"/>`
    + `<path d="M${n(x - 3.6 * s)} ${n(y - 2.5 * s)}Q${n(x - 3.8 * s)} ${n(y + 0.8 * s)} ${n(x - 2 * s)} ${n(y + 2.4 * s)}" stroke="#FFFFFF" stroke-width="${n(0.9 * s)}" fill="none" opacity="0.5" stroke-linecap="round"/>`;
}

const TULIP: [string, string, string] = [
  leaf(31, 64, 16, 7, -12) + leaf(33, 64, 12.5, 6.5, 16),
  stem('M32 64Q32 48 32 30') + leaf(31, 64, 25, 9, -16) + leaf(33, 64, 21, 8.5, 20)
    + '<path d="M28.4 28Q28 34.5 32 35.5Q36 34.5 35.6 28Q34 24 32 23Q30 24 28.4 28Z" fill="#8ACB6A" stroke="#3E8A44" stroke-width="0.8"/>'
    + '<path d="M30 26.5Q32 23 34 26.5Q33.6 23.6 32 23Q30.4 23.6 30 26.5Z" fill="#F2456B"/>',
  stem('M31 64Q28 46 26 25') + stem('M33 64Q37 50 40 34') + leaf(30, 64, 28, 10, -20) + leaf(34, 64, 24, 9, 24) + leaf(32, 64, 18, 7, 4)
    + tulipCup(26, 22, 1.6, '#F2456B', '#B82A4C') + tulipCup(40, 31, 1.3, '#FF6F91', '#C94A75'),
];

// ------------------------------------------------------------------------------------------------ lavender
const LAV_LEAF = '#8DBF8A';
const LAV_EDGE = '#4E8A4A';
const needles = (angles: number[], len: number, x = 32) => angles.map((a) => leaf(x, 64, len, 2.8, a, LAV_LEAF, LAV_EDGE, false)).join('');

function spike(x: number, y: number, count: number, buds = ['#9B6BE0', '#B88CFF']) {
  return Array.from({ length: count }, (_, i) =>
    `<ellipse cx="${n(x - 1.2)}" cy="${n(y + i * 2.3)}" rx="1.3" ry="1.7" fill="${buds[0]}" stroke="#6B40B3" stroke-width="0.4"/>`
    + `<ellipse cx="${n(x + 1.2)}" cy="${n(y + i * 2.3 + 1.1)}" rx="1.3" ry="1.7" fill="${buds[1]}" stroke="#6B40B3" stroke-width="0.4"/>`).join('')
    + `<ellipse cx="${x}" cy="${n(y - 1.4)}" rx="1.1" ry="1.5" fill="${buds[1]}" stroke="#6B40B3" stroke-width="0.4"/>`;
}

const LAVENDER: [string, string, string] = [
  needles([-50, -22, 4, 28, 52], 11),
  needles([-62, -40, -20, 0, 18, 38, 60], 15)
    + stem('M31 62Q27 50 24 38', 1.4, '#6E9E64') + stem('M32 62V34', 1.4, '#6E9E64') + stem('M33 62Q37 50 40 38', 1.4, '#6E9E64')
    + spike(24, 33, 3, ['#7FB07A', '#A88BE0']) + spike(32, 29, 3, ['#7FB07A', '#A88BE0']) + spike(40, 33, 3, ['#7FB07A', '#A88BE0']),
  needles([-66, -46, -26, -8, 10, 28, 46, 66], 17)
    + [['M31 62Q22 44 16 26', 16, 20], ['M31.5 62Q27 40 25 16', 25, 10], ['M32 62Q33 38 33 11', 33, 5], ['M32.5 62Q38 40 41 16', 41, 10], ['M33 62Q42 44 48 26', 48, 20]]
      .map(([d, x, y]) => stem(d as string, 1.5, '#6E9E64') + spike(x as number, y as number, 6)).join(''),
];

// ------------------------------------------------------------------------------------------------ succulent
/** A fan of plump leaves seen from the side, from the base point at the bottom centre. */
function fan(len: number, angles: number[], fill: string, edge: string, tip = '#FF8FB0') {
  return angles.map((a) => `<g transform="translate(32 62) rotate(${a})"><path d="M0 0Q${n(len * 0.62)} ${n(-len * 0.55)} 0 ${-len}Q${n(-len * 0.62)} ${n(-len * 0.55)} 0 0Z" fill="${fill}" stroke="${edge}" stroke-width="0.9" stroke-linejoin="round"/>`
    + `<path d="M0 ${n(-len * 0.2)}V${n(-len * 0.7)}" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="0.9" stroke-linecap="round"/><circle cy="${n(-len + 1.4)}" r="1.1" fill="${tip}"/></g>`).join('');
}

const SUCCULENT: [string, string, string] = [
  fan(8, [-45, 0, 45], '#6FCF97', '#2E8A5E') + fan(5, [-22, 22], '#A8E6BF', '#2E8A5E'),
  fan(14, [-66, -33, 0, 33, 66], '#5DBB8A', '#2E8A5E') + fan(9.5, [-42, -14, 14, 42], '#7ED3A0', '#2E8A5E') + fan(5.5, [-18, 18], '#B4EDC8', '#2E8A5E'),
  stem('M33 50Q38 34 44 26', 1.4, '#7FB07A')
    + '<g fill="#FF9F43" stroke="#D9651A" stroke-width="0.5"><circle cx="44.5" cy="25" r="2"/><circle cx="41.5" cy="28.5" r="1.6"/><circle cx="47" cy="27.8" r="1.4"/></g>'
    + fan(22, [-72, -50, -26, -4, 18, 40, 64], '#4FAE7E', '#22704A') + fan(16, [-56, -30, -6, 18, 44], '#6FCF97', '#2E8A5E')
    + fan(10, [-36, -6, 26], '#9BE3B5', '#2E8A5E') + fan(5.5, [-14, 14], '#C8F2D6', '#2E8A5E'),
];

// ------------------------------------------------------------------------------------------------ strawberry
/** Three rounded leaflets at the end of a stalk. */
function trifoliate(x: number, y: number, s: number, deg = 0) {
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${deg})">${[-48, 0, 48].map((a) =>
    `<g transform="rotate(${a})"><ellipse cy="${n(-4.6 * s)}" rx="${n(3.2 * s)}" ry="${n(4.6 * s)}" fill="#4DB35C" stroke="#2E7D3A" stroke-width="0.9"/>`
    + `<path d="M0 ${n(-1.4 * s)}V${n(-7.6 * s)}" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="0.8"/></g>`).join('')}</g>`;
}

const blossom = (x: number, y: number, r: number) =>
  around(5, x, y, `<circle cx="${x}" cy="${n(y - r * 0.62)}" r="${n(r * 0.5)}" fill="#FFFFFF" stroke="#C9BFB0" stroke-width="0.6"/>`)
  + `<circle cx="${x}" cy="${y}" r="${n(r * 0.34)}" fill="#FFC93C"/>`;

function berry(x: number, y: number, s: number) {
  const seeds = [[-1.6, 1], [0, 0.6], [1.6, 1], [-0.8, 3], [0.8, 3], [0, 5]]
    .map(([dx, dy]) => `<ellipse cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" rx="${n(0.35 * s)}" ry="${n(0.55 * s)}"/>`).join('');
  return `<path d="M${x} ${n(y + 7 * s)}Q${n(x - 5 * s)} ${n(y + 3 * s)} ${n(x - 4 * s)} ${n(y - 0.5 * s)}Q${n(x - 3 * s)} ${n(y - 2 * s)} ${x} ${n(y - 1.6 * s)}Q${n(x + 3 * s)} ${n(y - 2 * s)} ${n(x + 4 * s)} ${n(y - 0.5 * s)}Q${n(x + 5 * s)} ${n(y + 3 * s)} ${x} ${n(y + 7 * s)}Z" fill="#F2454F" stroke="#B5222E" stroke-width="0.9"/>`
    + `<g fill="#FFE08A">${seeds}</g>`
    + `<path d="M${n(x - 3 * s)} ${n(y - 1.4 * s)}L${n(x - 1.4 * s)} ${n(y + 0.3 * s)}L${x} ${n(y - 1 * s)}L${n(x + 1.4 * s)} ${n(y + 0.3 * s)}L${n(x + 3 * s)} ${n(y - 1.4 * s)}L${x} ${n(y - 2.4 * s)}Z" fill="#5CC25A" stroke="#2E7D3A" stroke-width="0.6" stroke-linejoin="round"/>`
    + `<path d="M${n(x - 2.4 * s)} ${n(y + 1 * s)}Q${n(x - 2.4 * s)} ${n(y + 2.6 * s)} ${n(x - 1.4 * s)} ${n(y + 3.6 * s)}" stroke="#FFFFFF" stroke-width="${n(0.6 * s)}" fill="none" opacity="0.6" stroke-linecap="round"/>`;
}

const STRAWBERRY: [string, string, string] = [
  stem('M32 64Q32 60 32 56') + leaf(32, 57, 7, 7, -64) + stem('M32 60Q35 55 37 52', 1.6) + trifoliate(37, 52, 0.7, 20),
  stem('M31 64Q24 54 20 48', 1.8) + stem('M32 64Q32 50 31 40', 1.8) + stem('M33 64Q40 54 44 49', 1.8) + stem('M32 62Q38 50 40 40', 1.4)
    + trifoliate(20, 48, 1, -40) + trifoliate(44, 49, 1, 40) + trifoliate(31, 40, 1.05, 0) + blossom(40, 38, 4.6),
  stem('M31 64Q22 54 16 46', 1.8) + stem('M32 64Q31 46 30 34', 1.8) + stem('M33 64Q42 54 48 46', 1.8) + stem('M32 63Q36 48 38 34', 1.6)
    + stem('M31 62Q22 56 14 56', 1.4) + stem('M33 62Q42 56 49 58', 1.4) + stem('M32 60Q27 52 24 50', 1.2)
    + trifoliate(16, 46, 1.1, -42) + trifoliate(48, 46, 1.1, 42) + trifoliate(30, 34, 1.15, -6) + trifoliate(38, 34, 1, 22)
    + blossom(24, 46, 4.4) + berry(14, 56, 1.25) + berry(49, 58, 1.2) + berry(34, 48, 1.05),
];

// ------------------------------------------------------------------------------------------------ seedling (a young tree)
const SEEDLING: [string, string, string] = [
  sprout(12, 10, '#7CC47A'),
  stem('M32 64Q31 48 32 30', 2.6) + leaf(31.6, 52, 12, 10, -60, '#7CC47A') + leaf(31.8, 48, 12, 10, 62, '#7CC47A')
    + leaf(32, 39, 10, 8, -52, '#7CC47A') + leaf(32, 36, 10, 8, 50, '#7CC47A') + leaf(32, 31, 8, 6, -8, '#9BD98B'),
  '<path d="M30 64Q31 50 31.5 36Q31.8 30 32 26" stroke="#7A4A2A" stroke-width="4.4" stroke-linecap="round" fill="none"/>'
    + '<path d="M31.5 42Q26 38 22 32M32 38Q38 34 41 29" stroke="#7A4A2A" stroke-width="2.4" stroke-linecap="round" fill="none"/>'
    + '<path d="M30 62Q30.6 52 31 44" stroke="#A8714A" stroke-width="1.1" stroke-linecap="round" fill="none"/>'
    + '<g fill="#2E8A43">' + [[20, 28, 9], [44, 27, 9], [32, 16, 11], [25, 19, 9], [39, 18, 9], [32, 29, 9]].map(([x, y, r]) => `<circle cx="${x}" cy="${y + 1.5}" r="${r}"/>`).join('') + '</g>'
    + '<g fill="#4DB35C">' + [[20, 28, 9], [44, 27, 9], [32, 16, 11], [25, 19, 9], [39, 18, 9], [32, 29, 9]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('') + '</g>'
    + '<g fill="#8FD86C">' + [[17, 24, 3], [28, 11, 3.6], [36, 12, 2.6], [41, 22, 2.8], [24, 16, 2.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('') + '</g>'
    + '<g fill="#FF86A8" stroke="#D2557A" stroke-width="0.5"><circle cx="22" cy="31" r="1.6"/><circle cx="41" cy="30" r="1.6"/><circle cx="34" cy="21" r="1.6"/></g>',
];

const PLANTS: Record<string, [string, string, string]> = {
  seed_daisy: DAISY,
  seed_sunflower: SUNFLOWER,
  seed_tulip: TULIP,
  seed_lavender: LAVENDER,
  seed_succulent: SUCCULENT,
  seed_strawberry: STRAWBERRY,
  seedling: SEEDLING,
};

/** Every seed's plant at its three growth stages (0 sprout, 1 growing, 2 grown), as full SVG documents. */
export const GARDEN_PLANTS: Record<string, [string, string, string]> = Object.fromEntries(
  Object.entries(PLANTS).map(([id, stages]) => [id, stages.map((body) => svg(body)) as [string, string, string]]));

const furrows = [17, 22.5, 28].map((y) => `<path d="M10 ${y}Q20 ${y - 2.2} 32 ${y}T54 ${y}" stroke="#4E2F1A" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
  + `<path d="M10 ${y - 1.4}Q20 ${y - 3.6} 32 ${y - 1.4}T54 ${y - 1.4}" stroke="#A06A42" stroke-width="0.9" fill="none" stroke-linecap="round" opacity="0.8"/>`).join('');

/** A tilled soil patch in a wooden frame, under a garden plant (its plant stands at the middle, x 32). */
export const SOIL_PLOT = svg(`<defs><linearGradient id="soil_plot-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6B4226"/><stop offset="1" stop-color="#8C5A35"/></linearGradient></defs>
  <ellipse cx="32" cy="37.5" rx="29" ry="2.4" fill="#0A2438" opacity="0.1"/>
  <path d="M4 10Q4 7 7 7H57Q60 7 60 10V14H4Z" fill="#B97838" stroke="#7A4A22" stroke-width="1"/>
  <rect x="4" y="9.5" width="56" height="21" fill="url(#soil_plot-s)" stroke="#7A4A22" stroke-width="1"/>
  ${furrows}
  <g fill="#B08A6A"><ellipse cx="15" cy="13.5" rx="1.3" ry="0.9"/><ellipse cx="44" cy="19.5" rx="1.1" ry="0.8"/><ellipse cx="25" cy="25.5" rx="1" ry="0.7"/><ellipse cx="50" cy="13.8" rx="0.9" ry="0.7"/></g>
  <path d="M2.5 30Q2.5 28.5 4 28.5H60Q61.5 28.5 61.5 30V35.5Q61.5 37 60 37H4Q2.5 37 2.5 35.5Z" fill="#D79A5A" stroke="#8E5A2C" stroke-width="1.1"/>
  <path d="M6 31.6H30M34 31.6H58M8 34.4H22M40 34.4H56" stroke="#A8692E" stroke-width="0.7" stroke-linecap="round" opacity="0.6"/>
  <path d="M5 29.6H59" stroke="#FFFFFF" stroke-width="0.9" stroke-linecap="round" opacity="0.4"/>
  <rect x="1.5" y="6" width="5" height="31.5" rx="1.6" fill="#C98A4E" stroke="#7A4A22" stroke-width="1"/>
  <rect x="57.5" y="6" width="5" height="31.5" rx="1.6" fill="#C98A4E" stroke="#7A4A22" stroke-width="1"/>
  <g fill="#7A4A22"><circle cx="4" cy="32.8" r="0.7"/><circle cx="60" cy="32.8" r="0.7"/><circle cx="4" cy="9.2" r="0.7"/><circle cx="60" cy="9.2" r="0.7"/></g>
  <path d="M38 13Q40 10.5 42.5 11.5Q40.5 13.6 38 13Z" fill="#6FC25E"/>`, '0 0 64 40');
