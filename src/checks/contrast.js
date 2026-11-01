// Color parsing and the WCAG 2.1 contrast ratio (SC 1.4.3, "relative luminance" definition).
// Colors we cannot read with certainty (unknown names, transparency, CSS variables) return null,
// and the caller skips that element rather than guessing.

const NAMED = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00',
  orange: 'ffa500', purple: '800080', gray: '808080', grey: '808080', silver: 'c0c0c0', maroon: '800000',
  navy: '000080', teal: '008080', olive: '808000', lime: '00ff00', aqua: '00ffff', cyan: '00ffff',
  fuchsia: 'ff00ff', magenta: 'ff00ff', pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', beige: 'f5f5dc',
  ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lightgray: 'd3d3d3', lightgrey: 'd3d3d3',
  darkgray: 'a9a9a9', darkgrey: 'a9a9a9', dimgray: '696969', dimgrey: '696969', gainsboro: 'dcdcdc',
  whitesmoke: 'f5f5f5', lightyellow: 'ffffe0', lightblue: 'add8e6', lightgreen: '90ee90', lightpink: 'ffb6c1',
  darkblue: '00008b', darkred: '8b0000', darkgreen: '006400', orangered: 'ff4500', tomato: 'ff6347',
  coral: 'ff7f50', salmon: 'fa8072', skyblue: '87ceeb', steelblue: '4682b4', slategray: '708090',
  slategrey: '708090', crimson: 'dc143c', indigo: '4b0082', violet: 'ee82ee', tan: 'd2b48c',
  aliceblue: 'f0f8ff', azure: 'f0ffff', honeydew: 'f0fff0', mintcream: 'f5fffa', snow: 'fffafa',
  linen: 'faf0e6', seashell: 'fff5ee', ghostwhite: 'f8f8ff', floralwhite: 'fffaf0', oldlace: 'fdf5e6',
};

// Returns [r, g, b] (0-255) or null when the value is not an opaque color we can read.
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/\s*!important$/, '');
  if (NAMED[v]) return hexToRgb(NAMED[v]);
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8) {
      if (h.slice(6) !== 'ff') return null; // translucent: the result depends on what is behind it
      h = h.slice(0, 6);
    }
    return h.length === 6 ? hexToRgb(h) : null;
  }
  m = v.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    if (m[4] !== undefined && !/^(1|1\.0+|100%)$/.test(m[4])) return null;
    const rgb = [m[1], m[2], m[3]].map(Number);
    return rgb.every((c) => c <= 255) ? rgb : null;
  }
  return null;
}

// Word stores colors as 6 hex digits ("FF0000") or "auto".
export function parseHexColor(value) {
  return typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value) ? hexToRgb(value.toLowerCase()) : null;
}

function hexToRgb(h) {
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// SC 1.4.3: 4.5:1 for normal text, 3:1 for large text (at least 18pt, or 14pt bold).
// 18pt = 24 CSS px; 14pt = 18.66 CSS px.
export function requiredRatio(fontSizePx, bold) {
  if (fontSizePx !== null && (fontSizePx >= 24 || (bold && fontSizePx >= 18.66))) return 3;
  return 4.5;
}

export const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
