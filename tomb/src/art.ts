// Pixel art, palettes and the bitmap font. Everything is drawn from code so
// the whole game ships as one file. 1 unit = 1 art pixel; tiles are 12x12.

export const T = 12;

/** Anthropic brand palette (from anthropics/skills brand-guidelines). */
export const C = {
  dark: '#141413',
  light: '#faf9f5',
  mid: '#b0aea5',
  lightGray: '#e8e6dc',
  clay: '#d97757',
  shimmer: '#eb9f7f',
  blue: '#6a9bcc',
  green: '#788c5d',
  kraft: '#d4a27f',
};

export interface Theme {
  name: string;
  bg: string;
  deep: string;
  wall: string;
  wallDark: string;
  wallLight: string;
  glyph: string;
  dot: string;
  hazard: string;
  hazardDark: string;
  flood: string;
  floodText: string;
  floodEdge: string;
  /** CSS colour for the page around the board. */
  page: string;
  light: boolean;
}

export const THEMES: Theme[] = [
  {
    name: 'Terminal',
    bg: '#141413', deep: '#1d1c1a', wall: '#3a3935', wallDark: '#2c2b28', wallLight: '#b0aea5', glyph: '#5f5d57',
    dot: '#b0664d', hazard: '#6a9bcc', hazardDark: '#2f4a66',
    flood: '#f0eee6', floodText: '#b0aea5', floodEdge: '#d97757', page: '#0e0e0d', light: false,
  },
  {
    name: 'Blueprint',
    bg: '#10151b', deep: '#151c24', wall: '#25384b', wallDark: '#1b2a39', wallLight: '#6a9bcc', glyph: '#3b5876',
    dot: '#b0664d', hazard: '#f0eee6', hazardDark: '#7d7b74',
    flood: '#e8e6dc', floodText: '#9c9a92', floodEdge: '#d97757', page: '#0a0e12', light: false,
  },
  {
    name: 'Sage',
    bg: '#12140f', deep: '#181b14', wall: '#33402a', wallDark: '#28321f', wallLight: '#a3b58a', glyph: '#4f6040',
    dot: '#b0664d', hazard: '#6a9bcc', hazardDark: '#2f4a66',
    flood: '#f0eee6', floodText: '#b0aea5', floodEdge: '#d97757', page: '#0b0c09', light: false,
  },
  {
    name: 'Ivory',
    bg: '#faf9f5', deep: '#f1efe8', wall: '#e3e0d4', wallDark: '#d3d0c2', wallLight: '#3d3d3a', glyph: '#b0aea5',
    dot: '#e29a7f', hazard: '#2f4a66', hazardDark: '#141413',
    flood: '#1f1e1d', floodText: '#5f5d57', floodEdge: '#d97757', page: '#e8e6dc', light: true,
  },
  {
    name: 'Kraft',
    bg: '#17120e', deep: '#1e1813', wall: '#4a3a2c', wallDark: '#3a2d22', wallLight: '#d4a27f', glyph: '#6b5440',
    dot: '#b0664d', hazard: '#6a9bcc', hazardDark: '#2f4a66',
    flood: '#f0eee6', floodText: '#b0aea5', floodEdge: '#d97757', page: '#0f0c09', light: false,
  },
];

export const themeForStage = (n: number): Theme => THEMES[Math.floor((Math.max(1, n) - 1) / 10) % THEMES.length];

// ---------------------------------------------------------------- skins ----

export interface Skin {
  id: string;
  name: string;
  body: string;
  eye: string;
  price: number;
  /** Optional second colour for a slow shimmer. */
  alt?: string;
}

export const SKINS: Skin[] = [
  { id: 'clay', name: 'Clay', body: C.clay, eye: C.dark, price: 0 },
  { id: 'ivory', name: 'Ivory', body: C.light, eye: C.dark, price: 60 },
  { id: 'sky', name: 'Sky', body: C.blue, eye: C.dark, price: 90 },
  { id: 'sage', name: 'Sage', body: '#8fa66f', eye: C.dark, price: 120 },
  { id: 'kraft', name: 'Kraft', body: C.kraft, eye: C.dark, price: 150 },
  { id: 'shimmer', name: 'Shimmer', body: C.clay, alt: '#f2c2a8', eye: C.dark, price: 250 },
  { id: 'midnight', name: 'Midnight', body: '#2a2927', eye: C.clay, price: 400 },
];

// ---------------------------------------------------------------- Clawd ----

export interface Pose {
  /** Body width and height (the classic sprite is 8 x 6). */
  bw: number;
  bh: number;
  leg: number;
  /** Arm offset: -1 raised, 0 normal, 1 lowered. */
  arm: number;
  armLen: number;
  eyes: 'open' | 'closed' | 'wide';
  /** Eye shift in sprite space. */
  lookX: number;
  /** 0..3: which legs are lifted for the tiny dance. */
  step: number;
}

export const POSE_IDLE: Pose = { bw: 8, bh: 6, leg: 2, arm: 0, armLen: 1, eyes: 'open', lookX: 0, step: 0 };

/**
 * Clawd's pixels in sprite space: origin at the middle of his feet, +y towards
 * the feet. Based on the 10x8 sprite: 8x6 body, arms on rows 2-3, eyes on row
 * 2, four legs two rows long.
 */
export function clawdPixels(p: Pose): { x: number; y: number; eye: boolean }[] {
  const out: { x: number; y: number; eye: boolean }[] = [];
  const left = -Math.floor(p.bw / 2);
  const top = -(p.leg + p.bh);
  const eyeRow = top + Math.min(2, p.bh - 2);
  const eyeL = left + 1 + p.lookX;
  const eyeR = left + p.bw - 2 + p.lookX;
  for (let y = 0; y < p.bh; y++) {
    for (let x = 0; x < p.bw; x++) {
      const px = left + x;
      const py = top + y;
      const isEye = p.eyes !== 'closed' && py === eyeRow && (px === eyeL || px === eyeR);
      const wideEye = p.eyes === 'wide' && py === eyeRow - 1 && (px === eyeL || px === eyeR);
      out.push({ x: px, y: py, eye: isEye || wideEye });
    }
  }
  // Arms: two rows tall, starting at body row 2.
  const armTop = top + Math.min(2, p.bh - 2) + p.arm;
  for (let a = 0; a < p.armLen; a++) {
    for (let r = 0; r < 2; r++) {
      out.push({ x: left - 1 - a, y: armTop + r, eye: false });
      out.push({ x: left + p.bw + a, y: armTop + r, eye: false });
    }
  }
  // Legs at body columns 0, 2, bw-3, bw-1.
  const cols = p.bw >= 6 ? [0, 2, p.bw - 3, p.bw - 1] : [0, p.bw - 1];
  cols.forEach((c, i) => {
    const lifted = p.step > 0 && i % 2 === (p.step - 1) % 2;
    const len = Math.max(1, p.leg - (lifted ? 1 : 0));
    for (let y = 0; y < len; y++) out.push({ x: left + c, y: -p.leg + y, eye: false });
  });
  return out;
}

/** Maps sprite space to the screen for feet pointing in direction f (0 up, 1 right, 2 down, 3 left). */
export function orient(f: number, x: number, y: number): [number, number] {
  // Rotate pixel centres so a quarter turn never mirrors the sprite.
  const cx = x + 0.5;
  const cy = y + 0.5;
  let rx: number;
  let ry: number;
  if (f === 2) [rx, ry] = [cx, cy];
  else if (f === 0) [rx, ry] = [-cx, -cy];
  else if (f === 3) [rx, ry] = [-cy, cx];
  else [rx, ry] = [cy, -cx];
  return [Math.round(rx - 0.5), Math.round(ry - 0.5)];
}

export function drawClawd(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  feet: number,
  pose: Pose,
  body: string,
  eye: string,
  scale = 1,
): void {
  for (const p of clawdPixels(pose)) {
    const [x, y] = orient(feet, p.x, p.y);
    ctx.fillStyle = p.eye ? eye : body;
    ctx.fillRect(ax + x * scale, ay + y * scale, scale, scale);
  }
}

// ------------------------------------------------------------- bitmaps ----

function bitmap(rows: string[]): number[][] {
  const out: number[][] = [];
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] !== '.') out.push([x, y, r[x] === 'o' ? 1 : 0]);
  });
  return out;
}

/** The Claude Code spinner, · ✢ ✳ ✶ ✻ ✽, as 7x7 coin frames. */
export const SPINNER = [
  ['.......', '.......', '.......', '...#...', '.......', '.......', '.......'],
  ['.......', '.......', '...#...', '..###..', '...#...', '.......', '.......'],
  ['.......', '...#...', '.#.#.#.', '..###..', '.#.#.#.', '...#...', '.......'],
  ['...#...', '.#.#.#.', '..###..', '###o###', '..###..', '.#.#.#.', '...#...'],
  ['#..#..#', '.#.#.#.', '..###..', '###o###', '..###..', '.#.#.#.', '#..#..#'],
  ['#..#..#', '.#####.', '.##o##.', '###o###', '.##o##.', '.#####.', '#..#..#'],
].map(bitmap);

/** Spinner frame for a time in seconds, ping-ponging like Claude Code's. */
export function spinnerFrame(t: number, fps = 8): number {
  const n = SPINNER.length;
  const k = Math.floor(t * fps) % (2 * n - 2);
  return k < n ? k : 2 * n - 2 - k;
}

/** Glyph characters matching SPINNER, for the DOM. */
export const SPINNER_CHARS = ['·', '✢', '✳', '✶', '✻', '✽'];

/** The star you collect: a nine-ray spark. Two frames twinkle. */
export const SPARK = [
  bitmap([
    '....#....',
    '.#..#..#.',
    '..#.#.#..',
    '...###...',
    '####o####',
    '...###...',
    '..#.#.#..',
    '.#..#..#.',
    '....#....',
  ]),
  bitmap([
    '....#....',
    '....#....',
    '.##.#.##.',
    '..#####..',
    '####o####',
    '..#####..',
    '.##.#.##.',
    '....#....',
    '....#....',
  ]),
];

export const BUG = [
  bitmap([
    '.#.#.#...',
    '.######.#',
    '#######o.',
    '#######..',
    '#######o.',
    '.######.#',
    '.#.#.#...',
  ]),
  bitmap([
    '..#.#.#..',
    '.######.#',
    '#######o.',
    '#######..',
    '#######o.',
    '.######.#',
    '..#.#.#..',
  ]),
];

export const POWER_ICONS: Record<number, number[][]> = {
  4: bitmap(['.#####.', '#######', '###o###', '##ooo##', '.##o##.', '..###..', '...#...']),
  5: bitmap(['##...##', '##...##', '##...##', '##...##', '###.###', '.#####.', '..###..']),
  6: bitmap(['.......', '.##.##.', '.##.##.', '.##.##.', '.##.##.', '.##.##.', '.......']),
};

export const GLYPHS = [
  bitmap(['#....', '.#...', '..#..', '.#...', '#.###']), // >_
  bitmap(['..##.', '..#..', '.#...', '..#..', '..##.']), // {
  bitmap(['.##..', '..#..', '...#.', '..#..', '.##..']), // }
  bitmap(['#.#.#', '.###.', '##.##', '.###.', '#.#.#']), // ✻
  bitmap(['...#.', '..#..', '..#..', '.#...', '.#...']), // /
  bitmap(['#.###', '#.#.#', '#.#.#', '#.#.#', '#.###']), // 10
];

export function drawBitmap(
  ctx: CanvasRenderingContext2D,
  bm: number[][],
  x: number,
  y: number,
  color: string,
  accent?: string,
  scale = 1,
): void {
  for (const [px, py, a] of bm) {
    ctx.fillStyle = a && accent ? accent : color;
    ctx.fillRect(x + px * scale, y + py * scale, scale, scale);
  }
}

/** Rotates a bitmap of size w x h (facing right) to face direction d. */
export function drawBitmapFacing(
  ctx: CanvasRenderingContext2D,
  bm: number[][],
  w: number,
  h: number,
  cx: number,
  cy: number,
  d: number,
  color: string,
  accent: string,
): void {
  for (const [px, py, a] of bm) {
    // Centre-relative, facing right.
    const lx = px - (w - 1) / 2;
    const ly = py - (h - 1) / 2;
    let rx = lx;
    let ry = ly;
    if (d === 3) [rx, ry] = [-lx, ly];
    else if (d === 0) [rx, ry] = [ly, -lx];
    else if (d === 2) [rx, ry] = [ly, lx];
    ctx.fillStyle = a ? accent : color;
    ctx.fillRect(Math.round(cx + rx - 0.5), Math.round(cy + ry - 0.5), 1, 1);
  }
}

// ----------------------------------------------------------- 5x7 font ----

const FONT_SRC: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.....|..#..',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  ':': '.....|..#..|..#..|.....|..#..|..#..|.....',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....',
  x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#',
};

const FONT: Record<string, number[][]> = {};
for (const [k, v] of Object.entries(FONT_SRC)) FONT[k] = bitmap(v.split('|'));

export function textWidth(s: string, scale = 1): number {
  return s.length ? (s.length * 6 - 1) * scale : 0;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  shadow?: string,
): void {
  const up = s.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const g = FONT[s[i] === 'x' ? 'x' : up[i]] ?? FONT['?'];
    const gx = x + i * 6 * scale;
    if (shadow) drawBitmap(ctx, g, gx, y + scale, shadow, undefined, scale);
    drawBitmap(ctx, g, gx, y, color, undefined, scale);
  }
}

/** Canvas sprite of a pixel bitmap, scaled for DOM <img> use (icons in the HUD). */
export function iconURL(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number, scale = 4): string {
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  draw(ctx);
  return c.toDataURL();
}

/** Small deterministic hash for tile decoration. */
export function cellHash(x: number, y: number): number {
  let h = Math.imul(x + 0x632be5ab, 0x9e3779b1) ^ Math.imul(y + 0x85157af5, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
