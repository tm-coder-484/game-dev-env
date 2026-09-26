// Vector placeholder art for the HUD kit, so the games have a working HUD
// before any image model is called. `assets.mjs ui-kit --placeholder` writes
// these; `assets.mjs ui-kit` replaces them with AI-generated art (same files,
// same sizes), so nothing in the games needs to change.
const brass = '#b89560';
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const barFill = (top, bottom) => (w, h) =>
  svg(w, h, `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" rx="${h / 2 - 2}" fill="url(#f)"/>
    <rect x="${h / 2}" y="5" width="${w - h}" height="${h * 0.16}" rx="3" fill="#fff" opacity=".28"/>`);

const slot = (border, glow) => (w, h) =>
  svg(w, h, `${glow ? `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="18" fill="none" stroke="${border}" stroke-width="10" opacity=".35"/>` : ''}
    <rect x="8" y="8" width="${w - 16}" height="${h - 16}" rx="14" fill="#0b0e12" fill-opacity=".62"
      stroke="${border}" stroke-width="${glow ? 5 : 3}"/>
    <rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="10" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>`);

const icon = (body) => (w, h) => svg(w, h, `<g transform="scale(${w / 128})">${body}</g>`);

export const PLACEHOLDERS = {
  'hud/bar_frame.png': (w, h) =>
    svg(w, h, `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="${h / 2 - 3}" fill="#07090c" fill-opacity=".72"
      stroke="${brass}" stroke-width="3"/>
      <rect x="7" y="7" width="${w - 14}" height="${h - 14}" rx="${h / 2 - 7}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="2"/>`),
  'hud/bar_fill_health.png': barFill('#f0525a', '#8c1120'),
  'hud/bar_fill_stamina.png': barFill('#f7cf5c', '#b07b12'),
  'hud/slot.png': slot(brass, false),
  'hud/slot_selected.png': slot('#ffd27a', true),
  'hud/crosshair.png': (w, h) =>
    svg(w, h, `<g stroke="#000" stroke-opacity=".7" stroke-width="5" stroke-linecap="round">
      <path d="M32 10v10M32 44v10M10 32h10M44 32h10"/></g>
      <g stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M32 10v10M32 44v10M10 32h10M44 32h10"/></g>
      <circle cx="32" cy="32" r="3" fill="#fff" stroke="#000" stroke-opacity=".7" stroke-width="1.5"/>`),
  'icons/sword.png': icon(`<path d="M96 14l18 0 0 18-54 54-18-18z" fill="#cfd6de" stroke="#5b6570" stroke-width="3"/>
      <path d="M100 18L62 56" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>
      <path d="M30 66l32 32-8 8-32-32z" fill="${brass}" stroke="#5a4020" stroke-width="3"/>
      <path d="M36 84l-16 16" stroke="#5a3a1c" stroke-width="10" stroke-linecap="round"/>
      <circle cx="16" cy="104" r="7" fill="${brass}" stroke="#5a4020" stroke-width="3"/>`),
  'icons/pickaxe.png': icon(`<path d="M34 104L88 50" stroke="#7a5230" stroke-width="10" stroke-linecap="round"/>
      <path d="M44 30c30-8 58 6 70 30-18-12-40-18-62-12z" fill="#9aa3ad" stroke="#4d555e" stroke-width="3"/>
      <path d="M44 30c-8 16-10 28-10 40 10-16 18-24 30-30" fill="#838c96" stroke="#4d555e" stroke-width="3"/>`),
  'icons/torch.png': icon(`<path d="M58 60h12l-4 58h-4z" fill="#7a5230" stroke="#4a3018" stroke-width="3"/>
      <rect x="54" y="56" width="20" height="10" rx="3" fill="#5c5c5c" stroke="#333" stroke-width="2"/>
      <path d="M64 10c14 18 20 28 10 42-4 6-16 6-20 0-8-12 0-20 10-42z" fill="#ff8a1e"/>
      <path d="M64 26c8 10 10 16 4 24-2 3-6 3-8 0-4-8 0-12 4-24z" fill="#ffe27a"/>`),
  'icons/potion.png': icon(`<rect x="54" y="14" width="20" height="14" rx="3" fill="#a07a4a" stroke="#5a4020" stroke-width="3"/>
      <path d="M56 28h16v18c16 6 28 20 28 38 0 22-16 34-36 34s-36-12-36-34c0-18 12-32 28-38z" fill="#c9e3f0" fill-opacity=".35" stroke="#dfeef5" stroke-width="3"/>
      <path d="M34 82c10-6 20 4 30 0s20-8 30-2c0 20-14 30-30 30s-30-10-30-28z" fill="#d8283a"/>
      <ellipse cx="50" cy="70" rx="6" ry="12" fill="#fff" opacity=".45"/>`),
  'icons/map.png': icon(`<path d="M14 28l32-10 36 10 32-10v82l-32 10-36-10-32 10z" fill="#e3cf9f" stroke="#7a6038" stroke-width="3"/>
      <path d="M46 18v82M82 28v82" stroke="#7a6038" stroke-opacity=".5" stroke-width="2"/>
      <path d="M26 86c14-4 12-26 30-28s18 22 34 10 8-30 16-36" fill="none" stroke="#c0242c" stroke-width="3.5" stroke-dasharray="6 5"/>
      <path d="M98 30l8 8m0-8l-8 8" stroke="#c0242c" stroke-width="3.5"/>`),
};
