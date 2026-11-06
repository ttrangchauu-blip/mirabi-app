/**
 * Pictures of the inventory items that are not drawn in a room (backend items_catalog.ITEMS: seeds, materials and
 * keepsakes), keyed by item id; a place badge has one picture per place, keyed `place_badge.<place>`. The walk finds
 * of before the catalog (rewardArt.ts) are included, so this is the one lookup for item icons. Decorations are drawn
 * from the room artwork (room/art.ts `itemThumb`).
 * Plain SVG markup on a 48x48 canvas, like rewardArt.ts; gradient and clip ids are prefixed with the item id.
 */
import { REWARD_ART } from './rewardArt';

/** Four-point twinkle used as the "magic" accent on rarer items. */
function twinkle(cx: number, cy: number, r: number, fill = '#FFFFFF') {
  return `<path d="M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${fill}"/>`;
}

function starPath(cx: number, cy: number, outer: number, inner: number) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(angle)).toFixed(1)} ${(cy + r * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${points.join('L')}Z`;
}

const linear = (id: string, stops: string[], x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map((color, i) => `<stop offset="${stops.length > 1 ? i / (stops.length - 1) : 0}" stop-color="${color}"/>`).join('')}</linearGradient>`;

const shadow = (cx = 24, cy = 44, rx = 13) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="2.2" fill="#0A2438" opacity="0.1"/>`;

/** `count` copies of a shape turned evenly around cx,cy. */
const around = (count: number, cx: number, cy: number, shape: (deg: number, i: number) => string) =>
  Array.from({ length: count }, (_, i) => {
    const deg = (360 / count) * i;
    return `<g transform="rotate(${deg.toFixed(1)} ${cx} ${cy})">${shape(deg, i)}</g>`;
  }).join('');

// ------------------------------------------------------------------------------------------------ seeds
/** A seed packet with a crimped top, the plant pictured in its window and a few seeds spilt beside it. */
function packet(color: string, edge: string, window: string, picture: string, seeds: string) {
  const crimp = Array.from({ length: 14 }, (_, i) => `L${11 + i * 2} ${i % 2 ? 6.5 : 9}`).join('');
  return `${shadow(24, 44.5, 14)}
    <path d="M11 9${crimp}V40.5Q37 43 34.5 43H13.5Q11 43 11 40.5Z" fill="${color}" stroke="${edge}" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="11.6" y="9" width="24.8" height="3.2" fill="${edge}" opacity="0.3"/>
    <rect x="14.5" y="14" width="19" height="18.5" rx="3" fill="${window}" stroke="${edge}" stroke-width="1"/>
    ${picture}
    <path d="M17 36.2H31M19 39.4H29" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
    <path d="M13.3 15V38" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
    ${seeds}`;
}

const seedDots = (fill: string, stroke: string) =>
  `<g fill="${fill}" stroke="${stroke}" stroke-width="0.6"><ellipse cx="40" cy="42.5" rx="2" ry="1.3" transform="rotate(-20 40 42.5)"/><ellipse cx="43.5" cy="40" rx="1.8" ry="1.2" transform="rotate(30 43.5 40)"/></g>`;

const PARTS: Record<string, string> = {
  seed_daisy: packet('#4FA8EE', '#2672BD', '#DFF3FF', `
    <path d="M24 26V32.5" stroke="#4E9A54" stroke-width="1.6" stroke-linecap="round"/>
    ${around(8, 24, 22, () => '<ellipse cx="24" cy="17.6" rx="1.9" ry="3.6" fill="#FFFFFF" stroke="#B9C7D4" stroke-width="0.6"/>')}
    <circle cx="24" cy="22" r="2.8" fill="#FFC93C" stroke="#D9951A" stroke-width="0.6"/>`,
  seedDots('#EAD9AE', '#B89A5E')),

  seed_sunflower: packet('#5CC25A', '#3A8F3E', '#DFF3FF', `
    <path d="M24 28V32.5" stroke="#3E8A44" stroke-width="1.8" stroke-linecap="round"/>
    ${around(12, 24, 22.5, () => '<ellipse cx="24" cy="17" rx="1.8" ry="3.6" fill="#FFC93C" stroke="#E0911A" stroke-width="0.6"/>')}
    <circle cx="24" cy="22.5" r="3.8" fill="#7A4A22" stroke="#5C361C" stroke-width="0.6"/>
    <g fill="#A8714A"><circle cx="23" cy="21.5" r="0.6"/><circle cx="25.2" cy="22.2" r="0.6"/><circle cx="23.6" cy="23.8" r="0.6"/></g>`,
  `<g stroke="#3A2418" stroke-width="0.5"><ellipse cx="40" cy="42.5" rx="1.4" ry="2.4" transform="rotate(50 40 42.5)" fill="#3A2418"/><ellipse cx="43.5" cy="39.5" rx="1.4" ry="2.4" transform="rotate(-20 43.5 39.5)" fill="#3A2418"/></g>
    <path d="M39 41.7L41 43.3M43.1 38.2L43.9 40.8" stroke="#FFFFFF" stroke-width="0.6" stroke-linecap="round"/>`),

  seed_tulip: packet('#FF8A3D', '#C9581A', '#FFF3E6', `
    <path d="M24 24V32.5" stroke="#4E9A54" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M24 32Q17 30 18 24Q22 27 24 31Z" fill="#5CC25A" stroke="#3A8F3E" stroke-width="0.6"/>
    <path d="M19.6 17.5Q19 22.5 21 24.5Q24 26.5 27 24.5Q29 22.5 28.4 17.5L26.4 19.6L24 16.4L21.6 19.6Z" fill="#F2456B" stroke="#B82A4C" stroke-width="0.8" stroke-linejoin="round"/>
    <path d="M24 17V25" stroke="#B82A4C" stroke-width="0.6" opacity="0.6"/>`,
  `<path d="M38.5 43.5Q37.5 40.5 40 39Q41.5 38 41 36.8Q43.5 38.5 43 41Q42.5 43.8 38.5 43.5Z" fill="#C98A4E" stroke="#8E5A2C" stroke-width="0.6"/>`),

  seed_lavender: packet('#7A5CD6', '#4F35A3', '#F3EEFF', `
    <g stroke="#5E9B57" stroke-width="1.1" stroke-linecap="round" fill="none"><path d="M24 32.5V18"/><path d="M23.5 32.5Q20 26 18.5 20"/><path d="M24.5 32.5Q28 26 29.5 20"/></g>
    ${[[24, 16.5], [18.2, 18.8], [29.8, 18.8]].map(([x, y]) => [0, 2.2, 4.4, 6.6].map((d) =>
      `<ellipse cx="${x - 0.9}" cy="${y + d}" rx="1.1" ry="1.5" fill="#9B6BE0"/><ellipse cx="${x + 0.9}" cy="${y + d + 1}" rx="1.1" ry="1.5" fill="#B88CFF"/>`).join('')).join('')}`,
  seedDots('#5C4A3A', '#3A2418')),

  seed_succulent: packet('#2FB5A8', '#1F7F76', '#FFF3E6', `
    ${around(7, 24, 25, () => '<path d="M24 25Q20.5 20 24 15.5Q27.5 20 24 25Z" fill="#6FCF97" stroke="#2E8A5E" stroke-width="0.6"/>')}
    ${around(5, 24, 25, () => '<path d="M24 25Q22 21.5 24 18.5Q26 21.5 24 25Z" fill="#9BE3B5" stroke="#2E8A5E" stroke-width="0.5"/><circle cx="24" cy="18.9" r="0.7" fill="#FF7FA8"/>', )}
    <circle cx="24" cy="25" r="1.4" fill="#C8F2D6"/>`,
  `<g fill="#6FCF97" stroke="#2E8A5E" stroke-width="0.6"><ellipse cx="40.5" cy="42" rx="2.6" ry="1.5" transform="rotate(-25 40.5 42)"/></g>`),

  seed_strawberry: packet('#FFC93C', '#D18F12', '#FFFFFF', `
    <path d="M24 17.5Q22 14.5 19.5 15M24 17.5Q26 14.5 28.5 15" stroke="#4E9A54" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M24 31Q17 26.5 17.5 21.5Q18 18 24 18.5Q30 18 30.5 21.5Q31 26.5 24 31Z" fill="#F2454F" stroke="#B5222E" stroke-width="0.8"/>
    <path d="M19.5 18.5L21.5 20.4L24 18.8L26.5 20.4L28.5 18.5L26.5 17.6L24 18.2L21.5 17.6Z" fill="#5CC25A" stroke="#3A8F3E" stroke-width="0.5" stroke-linejoin="round"/>
    <g fill="#FFE08A">${[[21, 22.5], [24, 22], [27, 22.5], [22.5, 25.5], [25.5, 25.5], [24, 28.2], [19.6, 25], [28.4, 25]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="0.5" ry="0.8"/>`).join('')}</g>
    <path d="M20 22Q20.4 20.6 21.6 20.2" stroke="#FFFFFF" stroke-width="0.9" stroke-linecap="round" fill="none" opacity="0.7"/>`,
  seedDots('#F2D3A2', '#C9A06A')),

  // ---------------------------------------------------------------------------------------------- materials
  wood: `${shadow(24, 44, 17)}
    ${[[15.5, 34], [32.5, 34], [24, 20]].map(([x, y]) => `
      <circle cx="${x}" cy="${y}" r="8.6" fill="#8C5A35" stroke="#5C361C" stroke-width="1.1"/>
      <circle cx="${x}" cy="${y}" r="6.6" fill="#F2C98A"/>
      <circle cx="${x}" cy="${y}" r="4.4" fill="none" stroke="#D9A066" stroke-width="1"/>
      <circle cx="${x}" cy="${y}" r="2.2" fill="none" stroke="#D9A066" stroke-width="1"/>
      <path d="M${x - 4.6} ${y - 3.6}A6 6 0 0 1 ${x - 1} ${y - 5.8}" stroke="#FFFFFF" stroke-width="1.1" fill="none" opacity="0.6" stroke-linecap="round"/>`).join('')}
    <path d="M24 11.4Q24.5 7.5 27.5 6" stroke="#4E9A54" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M27 6.5Q31.5 3.5 34 6Q30.5 9 27 6.5Z" fill="#6FC25E" stroke="#3E8A44" stroke-width="0.6"/>`,

  stone: `<defs>${linear('stone-a', ['#A8B3C2', '#76829A'])}${linear('stone-b', ['#C3CCD8', '#8D99AD'])}${linear('stone-c', ['#DCE3EB', '#A6B1C1'])}</defs>${shadow(24, 44, 16)}
    <path d="M8.5 37C8 32 14.5 30 24 30C33.5 30 40 32 39.5 37C39 41.5 32 43 24 43C16 43 9 41.5 8.5 37Z" fill="url(#stone-a)" stroke="#5F6B7E" stroke-width="1.1"/>
    <path d="M12.5 26.5C12.5 22.5 17.5 21 23 21C29 21 34 22.5 34 26.5C34 30.5 29 31.6 23 31.6C17 31.6 12.5 30.5 12.5 26.5Z" fill="url(#stone-b)" stroke="#5F6B7E" stroke-width="1.1"/>
    <path d="M17 17C17 13.5 20.5 12 25 12C29.5 12 32.5 13.5 32.5 17C32.5 20.5 29 22 25 22C20.5 22 17 20.5 17 17Z" fill="url(#stone-c)" stroke="#5F6B7E" stroke-width="1.1"/>
    <g stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" opacity="0.6" fill="none"><path d="M12.5 35Q15 32.6 19 32.2"/><path d="M16 25Q18 23 21.5 22.8"/><path d="M20 15.2Q21.6 13.6 24 13.4"/></g>
    <g fill="#5F6B7E" opacity="0.4"><circle cx="30" cy="38" r="0.9"/><circle cx="34" cy="36" r="0.7"/><circle cx="28" cy="27.5" r="0.8"/><circle cx="28.5" cy="18" r="0.7"/></g>
    <path d="M30 31Q32 29 35 30Q33 32.5 30 31Z" fill="#6FC25E"/>`,

  thread: `<defs>${linear('thread-w', ['#F0C27E', '#C98A4E'], 0, 0, 1, 0)}</defs>${shadow(24, 44, 14)}
    <rect x="15.5" y="12" width="17" height="9" fill="#FF6F91"/>
    <rect x="15.5" y="21" width="17" height="8.5" fill="#FFC93C"/>
    <rect x="15.5" y="29.5" width="17" height="8.5" fill="#4FA8EE"/>
    <g stroke="#FFFFFF" stroke-width="0.7" opacity="0.4">${[14, 16.5, 19, 23, 25.5, 28, 31.5, 34, 36.5].map((y) => `<path d="M15.5 ${y}L32.5 ${y - 1.2}"/>`).join('')}</g>
    <rect x="15.5" y="12" width="17" height="26" fill="none" stroke="#3A2418" stroke-opacity="0.25" stroke-width="1"/>
    <path d="M17.5 14V36" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" opacity="0.45"/>
    <ellipse cx="24" cy="38.5" rx="12" ry="3.6" fill="url(#thread-w)" stroke="#9E6427" stroke-width="1"/>
    <ellipse cx="24" cy="11.5" rx="12" ry="3.6" fill="url(#thread-w)" stroke="#9E6427" stroke-width="1"/>
    <ellipse cx="24" cy="11" rx="2.6" ry="1" fill="#7A4A22"/>
    <path d="M32.5 33Q38 33 39 37.5Q40 41.5 43.5 40" stroke="#4FA8EE" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M37 32L45 22" stroke="#A9B6C6" stroke-width="1.6" stroke-linecap="round"/>
    <ellipse cx="44" cy="23.3" rx="0.6" ry="1.2" transform="rotate(40 44 23.3)" fill="#FFFFFF"/>`,

  soil: `<defs>${linear('soil-s', ['#E3BC87', '#C4945A'], 0, 0, 1, 1)}</defs>${shadow(24, 44.5, 15)}
    <path d="M11.5 19Q8.5 31 11 40Q24 45.5 37 40Q39.5 31 36.5 19Z" fill="url(#soil-s)" stroke="#8E6434" stroke-width="1.2" stroke-linejoin="round"/>
    <g stroke="#A97B45" stroke-width="0.7" opacity="0.5"><path d="M13 24H35M12.5 29H35.5M12.5 34H35.5M18 20V41M24 20V42.5M30 20V41"/></g>
    <rect x="17" y="27" width="14" height="10" rx="2" fill="#FFF6E4" stroke="#8E6434" stroke-width="0.8"/>
    <path d="M24 35V31.5M24 32Q21 30 20.5 28.6Q23 28.6 24 32ZM24 31.5Q27 29.4 27.6 28Q25 28 24 31.5Z" fill="#5CC25A" stroke="#3E8A44" stroke-width="0.6"/>
    <path d="M10.5 18.5Q24 14 37.5 18.5Q37 22.5 24 22.5Q11 22.5 10.5 18.5Z" fill="#D9A15F" stroke="#8E6434" stroke-width="1.1"/>
    <ellipse cx="24" cy="18.6" rx="11" ry="3" fill="#6B4226"/>
    <path d="M15 18.5Q19 15 24 15.5Q29 15 33 18.5Z" fill="#4E2F1A"/>
    <g fill="#8C5A35"><circle cx="19" cy="17.6" r="1"/><circle cx="26" cy="16.8" r="1.1"/><circle cx="30" cy="18.4" r="0.8"/><circle cx="22.5" cy="19" r="0.7"/></g>
    <path d="M24 16V10.5M24 11.5Q20 9.5 19.5 7Q23 7.5 24 11.5ZM24 12.5Q28 11 29 8.5Q25.5 8.5 24 12.5Z" fill="#6FC25E" stroke="#3E8A44" stroke-width="0.7" stroke-linejoin="round"/>`,

  // ---------------------------------------------------------------------------------------------- keepsakes
  heart_pebble: `<defs>${linear('heart_pebble-g', ['#E8DCE2', '#A895A3'], 0, 0, 0.7, 1)}</defs>${shadow(24, 43.5, 14)}
    <path d="M24 41C17 36.5 8.5 31 8.5 22.5C8.5 16.5 13 12.5 18 12.5C21 12.5 23 14 24 16C25 14 27 12.5 30 12.5C35 12.5 39.5 16.5 39.5 22.5C39.5 31 31 36.5 24 41Z" fill="url(#heart_pebble-g)" stroke="#7E6B7C" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M12.5 21C12.8 18 15 16 17.8 15.8" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.75"/>
    <g fill="#7E6B7C" opacity="0.45"><circle cx="29" cy="27" r="1"/><circle cx="33" cy="22.5" r="0.8"/><circle cx="21" cy="30" r="0.9"/><circle cx="26" cy="33.5" r="0.7"/><circle cx="17" cy="24.5" r="0.6"/></g>
    <path d="M24 27.5C22 26 19.8 24.5 19.8 22.4C19.8 21 21 20 22.2 20C23 20 23.6 20.5 24 21.1C24.4 20.5 25 20 25.8 20C27 20 28.2 21 28.2 22.4C28.2 24.5 26 26 24 27.5Z" fill="#FF7FA8" opacity="0.8"/>
    ${twinkle(40, 11, 3.2, '#FFD45E')}`,

  pressed_leaf: `${shadow(24, 44.5, 15)}
    <g transform="rotate(-6 24 24)">
      <rect x="9" y="6.5" width="30" height="36" rx="2" fill="#FBF1DC" stroke="#CDB48A" stroke-width="1"/>
      <path d="M12 38.5H24" stroke="#CDB48A" stroke-width="1" stroke-linecap="round"/>
      <path d="M24 9.5L26.5 15.5L30.3 13.3L29.4 19.5L36 17.4L33.2 22.6L37.2 25.4L29.4 27.4L30.6 31.4L25.4 29.6L24.6 35.8H23.4L22.6 29.6L17.4 31.4L18.6 27.4L10.8 25.4L14.8 22.6L12 17.4L18.6 19.5L17.7 13.3L21.5 15.5Z" fill="#F28C28" stroke="#C2561A" stroke-width="0.9" stroke-linejoin="round"/>
      <g stroke="#C2561A" stroke-width="0.8" stroke-linecap="round" opacity="0.8" fill="none"><path d="M24 33V13"/><path d="M24 27L33.5 19.5"/><path d="M24 27L14.5 19.5"/><path d="M24 29.5L34.5 25"/><path d="M24 29.5L13.5 25"/></g>
      <path d="M24 35.5V40" stroke="#A8451A" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M17 21.5Q19 19.5 20.5 20" stroke="#FFD08A" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.8"/>
      <rect x="7" y="5" width="10" height="4" rx="0.6" fill="#5CC8F0" opacity="0.75" transform="rotate(-35 12 7)"/>
      <rect x="31" y="38.5" width="10" height="4" rx="0.6" fill="#FF86A8" opacity="0.75" transform="rotate(-35 36 40.5)"/>
    </g>`,

  message_bottle: `<defs>${linear('message_bottle-g', ['#C8F2EA', '#6FCFBF'], 0, 0, 1, 1)}</defs>
    <path d="M4 41Q10 37.5 16 41T28 41T40 41T46 40.5V44.5Q40 46 34 44.5T22 44.5T10 44.5T4 44.5Z" fill="#4FA8EE" opacity="0.85"/>
    <path d="M7 40.6Q10 38.8 13 40.4M27 40.6Q30 38.8 33 40.4" stroke="#FFFFFF" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.8"/>
    <g transform="rotate(-38 24 25)">
      <rect x="20.5" y="7.5" width="7" height="10" rx="1.5" fill="url(#message_bottle-g)" stroke="#2E9A8A" stroke-width="1.1"/>
      <rect x="20.8" y="3.5" width="6.4" height="5.5" rx="1.6" fill="#C98A4E" stroke="#8E5A2C" stroke-width="0.9"/>
      <path d="M17 18.5Q17 16 20.5 16H27.5Q31 16 31 18.5V38Q31 41.5 27.5 41.5H20.5Q17 41.5 17 38Z" fill="url(#message_bottle-g)" stroke="#2E9A8A" stroke-width="1.2"/>
      <rect x="19.8" y="22" width="8.4" height="14.5" rx="1.4" fill="#FFF3D6" stroke="#CDB48A" stroke-width="0.8"/>
      <ellipse cx="24" cy="22" rx="4.2" ry="1.2" fill="#F2DFB8" stroke="#CDB48A" stroke-width="0.6"/>
      <rect x="19.8" y="28" width="8.4" height="2.4" fill="#F2545B"/>
      <path d="M21.5 33H26.5M21.5 25.5H26" stroke="#CDB48A" stroke-width="0.7" stroke-linecap="round"/>
      <path d="M19.2 20.5V36.5" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    </g>
    ${twinkle(39, 9, 3.6, '#FFD45E')}${twinkle(9.5, 14, 2.2, '#FFFFFF')}`,
};

// ------------------------------------------------------------------------------------------------ place badges
/** A round badge with ribbon tails, a stitched rim, a star on top and a little scene of the place inside. */
function badge(place: string, ring: string, ring2: string, sky: string, scene: string) {
  const clip = `place_badge-${place}-clip`;
  return `${shadow(24, 45, 11)}
    <path d="M16 31.5L11.5 44.5L16.5 42.2L19.5 46L23 33.5Z" fill="${ring2}"/>
    <path d="M32 31.5L36.5 44.5L31.5 42.2L28.5 46L25 33.5Z" fill="${ring2}"/>
    <circle cx="24" cy="21" r="17" fill="${ring}" stroke="${ring2}" stroke-width="1.4"/>
    <circle cx="24" cy="21" r="15" fill="none" stroke="#FFFFFF" stroke-width="1" stroke-dasharray="2 1.6" opacity="0.75"/>
    <defs><clipPath id="${clip}"><circle cx="24" cy="21" r="12.6"/></clipPath></defs>
    <g clip-path="url(#${clip})"><rect x="10" y="7" width="28" height="28" fill="${sky}"/>${scene}</g>
    <circle cx="24" cy="21" r="12.6" fill="none" stroke="${ring2}" stroke-width="1.2"/>
    <path d="M10.6 15.5A14.5 14.5 0 0 1 18 7.6" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.5"/>
    <path d="${starPath(24, 4.6, 3.6, 1.6)}" fill="#FFD23F" stroke="${ring2}" stroke-width="0.8" stroke-linejoin="round"/>`;
}

const flowerDot = (x: number, y: number, petal: string) =>
  `<circle cx="${x}" cy="${y}" r="1.3" fill="${petal}"/><circle cx="${x}" cy="${y}" r="0.5" fill="#FFD23F"/>`;

/** The seeds sold in Vườn nhà's shop (backend garden_plants.json): one packet each, its colour and what grows from it in
 * the window: a fruit, a flower or a little tree, in the plant's own colours. */
const fruit = (fill: string, stroke: string) => `<circle cx="24" cy="25" r="5.4" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>
  <path d="M24 19.8Q24.6 17.6 26.8 17" stroke="#4E9A54" stroke-width="1.2" fill="none" stroke-linecap="round"/><ellipse cx="22.2" cy="23.2" rx="1.2" ry="0.8" fill="#FFFFFF" opacity="0.6"/>`;
const bloom = (fill: string, heart: string) => `<path d="M24 31V24" stroke="#4E9A54" stroke-width="1.2"/>${around(6, 24, 22, () => `<ellipse cx="24" cy="18.6" rx="1.8" ry="3" fill="${fill}"/>`)}<circle cx="24" cy="22" r="1.8" fill="${heart}"/>`;
const sapling = (crown: string, edge: string, extra = '') => `<path d="M24 31V24" stroke="#8C5A35" stroke-width="1.6" stroke-linecap="round"/><circle cx="24" cy="21.5" r="5.6" fill="${crown}" stroke="${edge}" stroke-width="0.8"/>${extra}`;
const SHOP_SEEDS: Record<string, string> = {
  seed_carrot: packet('#FF9F43', '#C96A12', '#FFF3E6', `<path d="M24 31L21 21.5H27Z" fill="#F08A2C" stroke="#B85E10" stroke-width="0.7"/><path d="M24 21.5V17.5M22.4 21.4L21 18M25.6 21.4L27 18" stroke="#4E9A54" stroke-width="1.1" stroke-linecap="round"/>`, seedDots('#C9A06A', '#8C6A3A')),
  seed_lettuce: packet('#8BD06A', '#4E9A40', '#F2FBEA', `<circle cx="24" cy="25" r="6" fill="#9CCB5F" stroke="#5E9A3A" stroke-width="0.8"/><circle cx="24" cy="24" r="3.4" fill="#C4E47E"/>`, seedDots('#D8CFA8', '#A89A6A')),
  seed_tomato: packet('#F2545B', '#B5222E', '#FFF1EE', fruit('#E53B2F', '#A8231A'), seedDots('#F2E3B8', '#C9B07A')),
  seed_potato: packet('#C9A06A', '#8C6A3A', '#FFF7EA', `<ellipse cx="24" cy="25" rx="6.4" ry="4.6" fill="#D9AE72" stroke="#9A7344" stroke-width="0.8"/><g fill="#9A7344"><circle cx="21.6" cy="24" r="0.6"/><circle cx="26" cy="26.2" r="0.6"/><circle cx="25" cy="23" r="0.5"/></g>`, seedDots('#D9AE72', '#9A7344')),
  seed_blueberry: packet('#5A6FD6', '#36459A', '#EEF1FF', `${[[21.5, 24], [26.5, 24], [24, 27.5], [24, 21]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#4A5FA8" stroke="#2B3466" stroke-width="0.6"/>`).join('')}`, seedDots('#8A7AA8', '#5A4A78')),
  seed_grape: packet('#8E5BC2', '#5E3490', '#F5EEFF', `${[[21, 21], [24, 21], [27, 21], [22.5, 24.2], [25.5, 24.2], [24, 27.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" fill="#7A4A9C" stroke="#4E2A6A" stroke-width="0.5"/>`).join('')}<path d="M24 19V17" stroke="#4E9A54" stroke-width="1.1"/>`, seedDots('#B8946A', '#7A5A3A')),
  seed_pumpkin: packet('#FF8A3D', '#C9581A', '#FFF5E8', `<ellipse cx="24" cy="25.5" rx="6.6" ry="4.8" fill="#EF8A26" stroke="#B85E10" stroke-width="0.8"/><path d="M21 21.5Q20 25.5 21 29.5M27 21.5Q28 25.5 27 29.5M24 21V30" stroke="#C9681A" stroke-width="0.6" fill="none"/><path d="M24 21V18.5" stroke="#6F7A3A" stroke-width="1.5"/>`, seedDots('#F1E3BD', '#C9B07A')),
  seed_cherry_blossom: packet('#F6A8BD', '#C96A88', '#FFF4F7', bloom('#FBC7D4', '#F08AA8'), seedDots('#8A4A3A', '#5A2A1A')),
  seed_golden_apple: packet('#F2C037', '#B8860B', '#FFFBEA', fruit('#F2C037', '#B8860B'), seedDots('#C89A3A', '#8A6A1A')),
  seed_crystal_tree: packet('#6FD0E6', '#2F8FA8', '#EEFBFF', `<path d="M24 17L28 23L24 31L20 23Z" fill="#8FE3F0" stroke="#2F8FA8" stroke-width="0.8"/><path d="M20 23H28M24 17V31" stroke="#FFFFFF" stroke-width="0.6" opacity="0.7"/>${twinkle(29.5, 18.5, 1.6)}`, seedDots('#8FE3F0', '#2F8FA8')),
  seed_blue_rose: packet('#4A7FE0', '#2A4FA0', '#EEF3FF', bloom('#3F6FD6', '#2A4FA0'), seedDots('#6A7A9A', '#3A4A6A')),
  seed_moonflower: packet('#8E9BD6', '#4F5A9A', '#F4F5FF', `${bloom('#F3F1FF', '#FFF2B0')}<path d="M31 16.5A3 3 0 1 1 28.4 21.2A2.4 2.4 0 1 0 31 16.5Z" fill="#FFF2B0"/>`, seedDots('#D9DBE6', '#8A8CA0')),
  seed_mist_tree: packet('#9FC8C8', '#5A8E8E', '#F2FAFA', sapling('#D6ECE6', '#7FA9A2', '<path d="M17 29Q20.5 27.5 24 29T31 29" stroke="#FFFFFF" stroke-width="1.4" fill="none" stroke-linecap="round"/>'), seedDots('#B8CCD2', '#7A9AA2')),
  seed_frost_tree: packet('#8FCBF0', '#3F84B5', '#F0F8FF', `<path d="M24 16L29 24H19Z M24 20.5L30.5 29H17.5Z" fill="#3B7564" stroke="#2A5A4A" stroke-width="0.6"/><path d="M24 16L26 19.3H22Z M24 20.5L26.6 24H21.4Z" fill="#FFFFFF"/>`, seedDots('#CFE9FF', '#6A9AC0')),
  seed_fire_tree: packet('#F2752E', '#B8361F', '#FFF2E8', `<path d="M24 16Q29.5 21.5 27.5 26.5Q26.5 30 24 30Q21.5 30 20.5 26.5Q18.5 21.5 24 16Z" fill="#F2752E" stroke="#B8361F" stroke-width="0.8"/><path d="M24 21Q26.5 24 25.5 27Q24.8 28.6 24 28.6Q23.2 28.6 22.5 27Q21.5 24 24 21Z" fill="#F7C53F"/>`, seedDots('#E2502A', '#9A2A1A')),
  seed_rainbow_flower: packet('#C77DDE', '#8A3FA8', '#FFF6FD', `<path d="M24 31V24" stroke="#4E9A54" stroke-width="1.2"/>${['#E9483F', '#F28A2E', '#F6CF3A', '#5CBF5A', '#3FA0E0', '#A060D0'].map((c, i) => `<g transform="rotate(${i * 60} 24 22)"><ellipse cx="24" cy="18.4" rx="1.9" ry="3.1" fill="${c}"/></g>`).join('')}<circle cx="24" cy="22" r="1.8" fill="#FFF3C4"/>`, seedDots('#D86AC0', '#8A3A78')),
  seed_starlight_tree: packet('#2F5A8E', '#1A3A66', '#EAF2FF', `<path d="${starPath(24, 23.5, 6.4, 2.7)}" fill="#FFD84A" stroke="#C99A12" stroke-width="0.7"/>${twinkle(17.8, 18, 1.3)}${twinkle(30.4, 28, 1.1)}`, seedDots('#FFD84A', '#C99A12')),
  seed_light_tree: packet('#F4D97A', '#B89A2A', '#FFFDF2', `<circle cx="24" cy="23" r="5" fill="#FFF0B0" stroke="#E0C060" stroke-width="0.8"/>${around(8, 24, 23, () => `<path d="M24 15.4V16.8" stroke="#F2C037" stroke-width="1.1" stroke-linecap="round"/>`)}`, seedDots('#FFF1C4', '#C9B07A')),
  seed_time_tree: packet('#C89A4A', '#8A6A2A', '#FFF8EA', `<path d="M20 17H28L24 23.5L28 30H20L24 23.5Z" fill="#BFE6FF" stroke="#8A6A2A" stroke-width="0.9" stroke-linejoin="round"/><path d="M21.6 29H26.4L24 26.4Z" fill="#E8C47A"/><path d="M19 17H29M19 30H29" stroke="#D8A43A" stroke-width="1.6" stroke-linecap="round"/>`, seedDots('#C89A4A', '#8A6A2A')),
  seed_myth_tree: packet('#2FAE8A', '#1A7A5E', '#EEFBF6', sapling('#5FC49A', '#1F7A5A', '<circle cx="21.5" cy="20.5" r="1.2" fill="#F4E9FF"/><circle cx="26.5" cy="22.5" r="1.2" fill="#F6A8D8"/><circle cx="24" cy="18.6" r="1" fill="#7EE0D0"/>'), seedDots('#2FAE8A', '#1A7A5E')),
  seed_galaxy_tree: packet('#5A3FA8', '#35266E', '#F1ECFF', sapling('#7A5CC8', '#35286E', `${twinkle(22, 20, 1.2)}${twinkle(26.4, 22.6, 1)}<circle cx="24.6" cy="19" r="0.6" fill="#FFFFFF"/>`), seedDots('#6A4AC0', '#35266E')),
  seed_ancient_tree: packet('#4F8A5A', '#2F5E3A', '#EEF8EE', `<path d="M22.4 31Q22.6 26 23 24H25Q25.4 26 25.6 31M22.6 30L19.5 31.4M25.4 30L28.5 31.4" stroke="#6A4E36" stroke-width="1.3" fill="none" stroke-linecap="round"/><ellipse cx="24" cy="20.5" rx="7" ry="4.6" fill="#4F9A5A" stroke="#285F3C" stroke-width="0.8"/><circle cx="21" cy="20" r="0.8" fill="#9DFFB0"/><circle cx="27" cy="21" r="0.7" fill="#9DFFB0"/>`, seedDots('#7A5A3A', '#4A3A2A')),
};

const BADGES: Record<string, string> = {
  flower_hills: badge('flower_hills', '#FF7FA8', '#C94A75', '#BFE8FF', `
    <circle cx="30.5" cy="14" r="2.8" fill="#FFD23F"/>
    <path d="M10 27Q17 18.5 26 23.5Q31 20.5 38 22.5V35H10Z" fill="#7BD17F" stroke="#4A9420" stroke-width="0.7"/>
    <path d="M10 30.5Q22 23 38 30V35H10Z" fill="#4DB35C" stroke="#2E7D3A" stroke-width="0.7"/>
    ${flowerDot(16, 24, '#FFFFFF')}${flowerDot(21, 22.6, '#FF5D8A')}${flowerDot(30, 24.2, '#FFFFFF')}${flowerDot(18, 30.4, '#FF5D8A')}${flowerDot(25, 28.4, '#FFFFFF')}${flowerDot(31.5, 30, '#B88CFF')}`),

  seaside: badge('seaside', '#22B5C6', '#14808E', '#FFE3B0', `
    <circle cx="24" cy="24" r="6.4" fill="#FF9F43"/>
    <path d="M14 16.5Q16 15 18 16.5M27 13.5Q29 12 31 13.5" stroke="#FFFFFF" stroke-width="1" fill="none" stroke-linecap="round"/>
    <rect x="10" y="24" width="28" height="11" fill="#2F8FE0"/>
    <path d="M10 27.5Q14 25.5 18 27.5T26 27.5T34 27.5T42 27.5" stroke="#8FD3FF" stroke-width="1.2" fill="none"/>
    <path d="M10 33Q13 28.5 18 30Q21 31 20 33.5Q24 30 28 31Q32 32 38 30V35H10Z" fill="#4FC3F7" stroke="#2672BD" stroke-width="0.7"/>
    <path d="M17 30.6Q19.4 30.6 19.4 32.6" stroke="#FFFFFF" stroke-width="1" fill="none" stroke-linecap="round"/>`),

  pine_forest: badge('pine_forest', '#3FA65A', '#247A3B', '#D8F2E0', `
    <circle cx="16" cy="14" r="2.4" fill="#FFD23F"/>
    <path d="M10 31Q24 27 38 31V35H10Z" fill="#7BB35A"/>
    ${[[17, 17, 0.75], [31, 16.5, 0.8], [24, 11.5, 1]].map(([x, y, s]) => `
      <rect x="${x - 1 * s}" y="${y + 15 * s}" width="${2 * s}" height="${4 * s}" fill="#7A4A22"/>
      <path d="M${x} ${y}L${x - 5 * s} ${y + 7 * s}H${x - 2.5 * s}L${x - 7 * s} ${y + 12.5 * s}H${x - 3.5 * s}L${x - 8 * s} ${y + 16 * s}H${x + 8 * s}L${x + 3.5 * s} ${y + 12.5 * s}H${x + 7 * s}L${x + 2.5 * s} ${y + 7 * s}H${x + 5 * s}Z" fill="#2E9E4A" stroke="#1E6B32" stroke-width="0.7" stroke-linejoin="round"/>`).join('')}`),

  little_town: badge('little_town', '#FF9F43', '#C9671A', '#BFE8FF', `
    <path d="M28 12.5Q28.5 10.5 30.5 11Q31.5 9.5 33.5 10.5Q35.5 10.5 35.5 12.5Z" fill="#FFFFFF"/>
    <path d="M10 31Q24 28.5 38 31V35H10Z" fill="#7BD17F"/>
    <rect x="27.5" y="13" width="2.6" height="5" fill="#A92B33"/>
    <rect x="17" y="19.5" width="14" height="11.5" fill="#FFE0A8" stroke="#C98A4E" stroke-width="0.8"/>
    <path d="M15.2 20.4L24 12.6L32.8 20.4Z" fill="#E5484D" stroke="#A92B33" stroke-width="0.8" stroke-linejoin="round"/>
    <rect x="22" y="24.5" width="4" height="6.5" rx="2" fill="#8C5A35"/>
    <rect x="18.6" y="22" width="2.8" height="2.8" fill="#6EC3F5" stroke="#C98A4E" stroke-width="0.5"/>
    <rect x="26.6" y="22" width="2.8" height="2.8" fill="#6EC3F5" stroke="#C98A4E" stroke-width="0.5"/>
    <circle cx="24" cy="17.8" r="1.2" fill="#FFF3D6"/>`),

  snowy_peak: badge('snowy_peak', '#7A8CE8', '#4A5BB8', '#CFE6FF', `
    <path d="M10 33L21 14L27 23L30.5 18.5L38 29V35H10Z" fill="#6F7FC4" stroke="#4A5BB8" stroke-width="0.7" stroke-linejoin="round"/>
    <path d="M21 14L24.2 19.5L22.2 18.6L20.4 20.4L18.4 18.4Z M30.5 18.5L33 22L31.2 21.4L29.6 22.6L28.6 21.2Z" fill="#FFFFFF"/>
    <path d="M10 31Q18 27.5 26 30.5Q32 28.5 38 30.5V35H10Z" fill="#FFFFFF" stroke="#B9C7E6" stroke-width="0.7"/>
    <g fill="#FFFFFF"><circle cx="14" cy="15" r="0.9"/><circle cx="33" cy="12.5" r="0.8"/><circle cx="16.5" cy="21" r="0.7"/><circle cx="35" cy="17.5" r="0.7"/></g>`),
};

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`;

/** Every item icon by item id (and `place_badge.<place>` for the badges), the walk finds of rewardArt.ts included. */
export const ITEM_ICONS: Record<string, string> = {
  ...REWARD_ART,
  ...Object.fromEntries(Object.entries(PARTS).map(([id, body]) => [id, svg(body)])),
  ...Object.fromEntries(Object.entries(SHOP_SEEDS).map(([id, body]) => [id, svg(body)])),
  ...Object.fromEntries(Object.entries(BADGES).map(([place, body]) => [`place_badge.${place}`, svg(body)])),
};
