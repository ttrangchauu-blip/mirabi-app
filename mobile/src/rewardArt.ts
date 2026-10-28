/**
 * Pictures of the items a pet brings back from its walk (backend companion.REWARD_ITEMS), keyed by item id.
 * Plain SVG markup on a 48x48 canvas so the same art renders in the app (SvgXml) and in static previews.
 * Gradient ids are prefixed with the item id so several pictures can share a page.
 */

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

const PARTS: Record<string, string> = {
  shell: `<defs>${linear('shell-g', ['#FFE3EA', '#F7A8BE', '#E9849F'])}</defs>${shadow(24, 44, 12)}
    <rect x="18.5" y="36" width="11" height="6.5" rx="2.5" fill="#E9849F"/>
    <path d="M24 41L13.5 37C7.5 31 6 21 11 14.5C15 9 20 7 24 7C28 7 33 9 37 14.5C42 21 40.5 31 34.5 37Z" fill="url(#shell-g)"/>
    <g stroke="#D96F8D" stroke-width="1.3" stroke-linecap="round" opacity="0.55" fill="none">
      <path d="M24 40L10.5 25"/><path d="M24 40L13.5 15.5"/><path d="M24 40L19 9.5"/><path d="M24 40L29 9.5"/><path d="M24 40L34.5 15.5"/><path d="M24 40L37.5 25"/>
    </g>
    <path d="M13 17C15.5 12.5 19 10 22.5 9.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.8"/>
    ${twinkle(39, 9, 4, '#FFD45E')}${twinkle(8.5, 33, 2.5, '#FFFFFF')}`,

  clover: `<defs>${linear('clover-g', ['#9BDB8E', '#4FA85A'])}</defs>${shadow(24, 44, 9)}
    <path d="M24 23Q27 33 21.5 42.5" stroke="#4E9A54" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    ${[0, 90, 180, 270].map((deg) => `<path transform="rotate(${deg} 24 22)" d="M24 22C18.5 18.5 14.5 13.5 17.5 9.5C20 6.5 23.3 7.8 24 10.6C24.7 7.8 28 6.5 30.5 9.5C33.5 13.5 29.5 18.5 24 22Z" fill="url(#clover-g)"/>
    <path transform="rotate(${deg} 24 22)" d="M24 21L24 12" stroke="#E3F7D9" stroke-width="1" stroke-linecap="round" opacity="0.5"/>`).join('')}
    <circle cx="24" cy="22" r="2.2" fill="#3F8E49"/>
    ${twinkle(39.5, 9, 3.5, '#FFD45E')}`,

  flower: `<defs>${linear('flower-c', ['#FFC25C', '#F08A2E'])}</defs>${shadow(24, 44, 8)}
    <path d="M24 26Q22.5 35 24.5 43" stroke="#5DAE5F" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M23.6 36C19 33.5 14.5 34.5 13 37.5C17 39.5 21 39 23.6 36Z" fill="#7CC47A"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => `<ellipse transform="rotate(${deg} 24 18)" cx="24" cy="9.5" rx="4" ry="7" fill="${deg % 90 ? '#FFE98F' : '#FFF4BF'}"/>`).join('')}
    <circle cx="24" cy="18" r="5.6" fill="url(#flower-c)"/>
    <circle cx="22.2" cy="16.3" r="1.6" fill="#FFFFFF" opacity="0.65"/>`,

  acorn: `<defs>${linear('acorn-n', ['#E2A563', '#B06B32'], 0, 0, 1, 1)}${linear('acorn-c', ['#A06B42', '#74472A'])}</defs>${shadow(24, 44.5, 9)}
    <path d="M14.5 23C14.5 34 20 40.5 24 43C28 40.5 33.5 34 33.5 23Z" fill="url(#acorn-n)"/>
    <path d="M18.5 27C18.5 33 20.5 37 22.5 39" stroke="#F6CF9B" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.8"/>
    <path d="M24 12.5Q24.5 7 29 5" stroke="#6E4527" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M10.5 23.5C10.5 16 16.5 11.5 24 11.5C31.5 11.5 37.5 16 37.5 23.5C37.5 25.5 36 26.5 34 26.5L14 26.5C12 26.5 10.5 25.5 10.5 23.5Z" fill="url(#acorn-c)"/>
    <g fill="#C08A5C" opacity="0.7">${[[16, 20], [20.5, 17], [25, 15.5], [29.5, 17], [33, 20.5], [18.5, 23.5], [23.5, 21], [28.5, 21.5], [24, 18]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25"/>`).join('')}</g>`,

  feather: `<defs>${linear('feather-g', ['#FF8FA3', '#FFC56B', '#FFE77A', '#7FD7A8', '#7EC4F2', '#A99BF0'], 0, 1, 1, 0)}</defs>${shadow(22, 44, 11)}
    <path d="M13.5 39C10 28 18 13.5 37.5 7.5C39 20 31 33.5 13.5 39Z" fill="url(#feather-g)"/>
    <g stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round" opacity="0.7">
      <path d="M17.5 33L15 31"/><path d="M22 27.5L19 25.5"/><path d="M26.5 22.5L24 19.5"/><path d="M27.5 27L30.5 28"/><path d="M32 20.5L35 21"/>
    </g>
    <path d="M9 43.5Q22 27 37 8.5" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.95"/>
    <path d="M8 44.5L12.5 39" stroke="#C9A27A" stroke-width="2.2" stroke-linecap="round"/>
    ${twinkle(39.5, 31, 3.5, '#FFD45E')}`,

  pebble: `<defs>${linear('pebble-g', ['#DCE3E9', '#9AA6B2'], 0, 0, 0.6, 1)}</defs>${shadow(24, 42.5, 15)}
    <path d="M8.5 30C7.5 22 15 16 25 16C35 16 41.5 22 40.5 30C39.5 37 32.5 40.5 24 40.5C15 40.5 9.3 36.5 8.5 30Z" fill="url(#pebble-g)"/>
    <ellipse cx="18.5" cy="23" rx="6.5" ry="3" fill="#FFFFFF" opacity="0.55"/>
    <g fill="#7F8C99" opacity="0.55"><circle cx="29" cy="31" r="1.2"/><circle cx="33" cy="27" r="0.9"/><circle cx="20" cy="33" r="1"/><circle cx="26" cy="35.5" r="0.8"/></g>`,

  star: `<defs><linearGradient id="star-t" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF2B3"/><stop offset="1" stop-color="#FFE08A" stop-opacity="0"/></linearGradient>${linear('star-g', ['#FFEB99', '#F5B83D'], 0, 0, 1, 1)}</defs>
    <path d="M24.5 22L4.5 41.5Q5.5 44 8 43.5L28.5 27Z" fill="url(#star-t)"/>
    <path d="M21 19L9 27.5Q9.5 29.5 11.5 29L23.5 23Z" fill="url(#star-t)" opacity="0.6"/>
    <path d="${starPath(31, 17, 12.5, 5.6)}" fill="url(#star-g)" stroke="#E7A12E" stroke-width="1" stroke-linejoin="round"/>
    <path d="M27 12.5L30 11" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
    ${twinkle(42, 33, 3, '#FFD45E')}${twinkle(13, 9, 2.5, '#FFE9A8')}`,

  crystal: `${shadow(24, 44.5, 11)}
    <path d="M14 13L34 13L41 22L24 43L7 22Z" fill="#7FD0F5"/>
    <path d="M14 13L19 22L7 22Z" fill="#BDE9FC"/>
    <path d="M14 13L34 13L29 22L19 22Z" fill="#9EDDF8"/>
    <path d="M34 13L29 22L41 22Z" fill="#56B6E8"/>
    <path d="M7 22L19 22L24 43Z" fill="#62C3EF"/>
    <path d="M19 22L29 22L24 43Z" fill="#41A8DE"/>
    <path d="M29 22L41 22L24 43Z" fill="#2B8DC8"/>
    <path d="M17 15.5L20.5 15.5" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
    ${twinkle(39.5, 8.5, 4)}${twinkle(9, 10, 2.5, '#BDE9FC')}`,

  seedling: `<defs>${linear('seedling-s', ['#B07C55', '#7E5233'])}${linear('seedling-l', ['#A5DE95', '#5FB565'], 0, 0, 1, 1)}</defs>
    <path d="M8 41C11 33.5 37 33.5 40 41C40 42.5 39 43 37.5 43L10.5 43C9 43 8 42.5 8 41Z" fill="url(#seedling-s)"/>
    <ellipse cx="18" cy="38" rx="3" ry="1.2" fill="#C99A72" opacity="0.6"/>
    <path d="M24 37C24 30.5 23 26.5 24 21" stroke="#5DAE5F" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M24 25C18 26 11 22 10 14.5C17 12.5 23 16.5 24 25Z" fill="url(#seedling-l)"/>
    <path d="M24 21.5C26 13 33 9 40 11C39 19.5 31 23.5 24 21.5Z" fill="url(#seedling-l)"/>
    <path d="M22 23.5Q16.5 20 12.5 16" stroke="#E6F7DE" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.9"/>
    <path d="M26 20Q32 15.5 37.5 13" stroke="#E6F7DE" stroke-width="1.1" stroke-linecap="round" fill="none" opacity="0.9"/>`,

  small_pot: `<defs>${linear('pot-g', ['#EDA77A', '#C46F42'], 0, 0, 1, 1)}${linear('pot-l', ['#9AD98B', '#4FA85A'], 0, 0, 1, 1)}</defs>${shadow(24, 45, 10)}
    <path d="M24 23C21.5 16 16.5 11.5 11 11.5C12 18 17 22 24 23Z" fill="url(#pot-l)"/>
    <path d="M24 23C26.5 16 31.5 11.5 37 11.5C36 18 31 22 24 23Z" fill="url(#pot-l)"/>
    <path d="M24 23C20.5 17 21.5 9.5 24 5C26.5 9.5 27.5 17 24 23Z" fill="#7CC47A"/>
    <path d="M13.5 26.5L34.5 26.5L31.8 41.8C31.5 43.2 30.4 44 29 44L19 44C17.6 44 16.5 43.2 16.2 41.8Z" fill="url(#pot-g)"/>
    <rect x="11" y="21.5" width="26" height="6.5" rx="2.5" fill="#F2B58C"/>
    <path d="M18 30.5L19.2 40" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" opacity="0.45"/>
    <g fill="#B85F35" opacity="0.45"><circle cx="24" cy="35" r="1.3"/><circle cx="28.5" cy="33" r="1"/></g>`,

  moon_lantern: `<defs>${linear('lantern-g', ['#FF9B88', '#E0483E'], 0, 0, 1, 1)}
      <radialGradient id="lantern-glow"><stop offset="0" stop-color="#FFD27A" stop-opacity="0.55"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>
    <circle cx="24" cy="25" r="22" fill="url(#lantern-glow)"/>
    <path d="M24 2L24 9" stroke="#B98A4E" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="18" y="8" width="12" height="4.5" rx="1.6" fill="#C9862F"/>
    <ellipse cx="24" cy="25" rx="15" ry="13.5" fill="url(#lantern-g)"/>
    <g fill="none" stroke="#B8322B" stroke-width="1" opacity="0.4"><ellipse cx="24" cy="25" rx="8.5" ry="13.5"/><ellipse cx="24" cy="25" rx="3" ry="13.5"/></g>
    <path d="M27 19A6 6 0 0 0 27 31A8 8 0 0 1 27 19Z" fill="#FFE9A8"/>
    ${twinkle(31.5, 21, 1.8, '#FFE9A8')}
    <path d="M13.5 20C15 16 18 13.5 21 12.8" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" fill="none" opacity="0.55"/>
    <rect x="19" y="37.5" width="10" height="3.5" rx="1.5" fill="#C9862F"/>
    <path d="M24 41L24 46.5" stroke="#E0483E" stroke-width="2.4" stroke-linecap="round"/>`,
};

export const REWARD_ART: Record<string, string> = Object.fromEntries(Object.entries(PARTS).map(([id, body]) =>
  [id, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`]));
