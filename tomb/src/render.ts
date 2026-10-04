// Draws a Game into a low-resolution art canvas, then scales it up with
// nearest-neighbour filtering. Static walls are cached in 16-row bands.

import {
  W, DX, DY, UP, DOWN, IT_DOT, IT_COIN, IT_STAR, IT_SHIELD, IT_MAGNET, IT_FREEZE,
} from './gen.ts';
import { Game, bugXY, bugPos, gateOn, TRAP_DELAY, TRAP_OUT, MAGNET_R, type GameEvent } from './sim.ts';
import {
  T, C, type Theme, type Skin, type Pose, POSE_IDLE, clawdPixels, orient, drawClawd, drawBitmap,
  drawBitmapFacing, drawText, textWidth, SPINNER, spinnerFrame, SPARK, BUG, POWER_ICONS, GLYPHS, cellHash,
} from './art.ts';

const BAND = 16;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  drag: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

export interface FrameOpts {
  /** Dim the board (title screen demo). */
  dim?: number;
  /** Extra art pixels to keep clear at the top for the HUD. */
  hudTop?: number;
  reducedMotion?: boolean;
  shake?: boolean;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private art: HTMLCanvasElement;
  private a: CanvasRenderingContext2D;
  scale = 4;
  artW = 180;
  artH = 320;
  boardX = 0;
  camY = 0;
  private camInit = false;
  theme: Theme;
  skin: Skin;
  private bands = new Map<number, { c: HTMLCanvasElement; v: number; provisional: boolean }>();
  private bandWorld: unknown = null;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private shakeT = 0;
  private shakeMag = 0;
  private flashT = 0;
  private time = 0;
  // Clawd animation state.
  private landT = 9;
  private landDir = DOWN;
  private nextBlink = 2;
  private blinkT = 0;
  private danceT = 0;
  private nextDance = 5;
  private trail: [number, number, number][] = [];
  private winT = -1;
  private deathShown = false;

  constructor(canvas: HTMLCanvasElement, theme: Theme, skin: Skin) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.art = document.createElement('canvas');
    this.a = this.art.getContext('2d', { alpha: false })!;
    this.theme = theme;
    this.skin = skin;
  }

  /** Fits the board to the screen; returns the art scale (device px per art px). */
  resize(cssW: number, cssH: number, dpr: number): void {
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    const board = W * T;
    let s = Math.min(pw / board, ph / (17 * T));
    // Whole-number scales keep pixels even; accept a slightly smaller board for that.
    if (s >= 2 && Math.floor(s) / s > 0.84) s = Math.floor(s);
    this.scale = Math.max(1, s);
    this.artW = Math.ceil(pw / this.scale);
    this.artH = Math.ceil(ph / this.scale);
    this.boardX = Math.floor((this.artW - board) / 2);
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.bands.clear();
    this.art.width = this.artW;
    this.art.height = this.artH;
    this.ctx.imageSmoothingEnabled = false;
  }

  setTheme(theme: Theme): void {
    if (theme !== this.theme) {
      this.theme = theme;
      this.bands.clear();
    }
  }

  reset(): void {
    this.bands.clear();
    this.particles = [];
    this.floaters = [];
    this.trail = [];
    this.camInit = false;
    this.winT = -1;
    this.deathShown = false;
    this.landT = 9;
  }

  /** Converts a CSS-pixel height into art pixels. */
  cssToArt(px: number, dpr: number): number {
    return (px * dpr) / this.scale;
  }

  // ------------------------------------------------------------ events ----

  onEvent(e: GameEvent, game: Game, fx: { reducedMotion: boolean; shake: boolean }): void {
    const cx = (x: number) => this.boardX + x * T + T / 2;
    const cy = (y: number) => y * T + T / 2;
    const many = fx.reducedMotion ? 0.4 : 1;
    if (e.type === 'stop') {
      this.landT = 0;
      this.landDir = e.dir;
      if (fx.shake && e.len >= 4) this.shake(0.08, 1);
      const px = cx(e.x) + (DX[e.dir] * T) / 2;
      const py = cy(e.y) + (DY[e.dir] * T) / 2;
      for (let i = 0; i < 5 * many; i++) {
        const side = (i % 2 ? 1 : -1) * (0.6 + Math.random());
        this.spawn(px, py, DY[e.dir] * side * 25 - DX[e.dir] * 12, DX[e.dir] * side * 25 - DY[e.dir] * 12, 0.25, this.theme.wallLight, 1, 6);
      }
    } else if (e.type === 'pick') {
      const x = cx(e.x);
      const y = cy(e.y);
      if (e.item === IT_DOT) {
        if (Math.random() < 0.5 * many) this.spawn(x, y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.2, this.theme.dot, 1, 5);
      } else if (e.item === IT_COIN) {
        this.burst(x, y, 8 * many, C.clay, 40);
        this.floaters.push({ x, y: y - 4, text: '+1', color: C.clay, t: 0 });
      } else if (e.item === IT_STAR) {
        this.burst(x, y, 22 * many, C.clay, 70);
        this.burst(x, y, 10 * many, C.light, 50);
        this.floaters.push({ x, y: y - 6, text: `${game.stars}/3`, color: C.light, t: 0 });
        this.flashT = 0.08;
      } else {
        this.burst(x, y, 14 * many, C.blue, 50);
        const label = e.item === IT_SHIELD ? 'SHIELD' : e.item === IT_MAGNET ? 'MAGNET' : 'PAUSE';
        this.floaters.push({ x, y: y - 6, text: label, color: C.light, t: 0 });
      }
    } else if (e.type === 'death') {
      const ax = cx(game.x);
      const ay = cy(game.y);
      if (e.cause === 'context') {
        this.burst(ax, ay, 30 * many, this.theme.flood, 60);
      }
      // Clawd comes apart into his own pixels.
      const pose = this.pose(game);
      const [fx0, fy0] = this.anchorOffset(game.facing);
      for (const p of clawdPixels(pose)) {
        const [ox, oy] = orient(game.facing, p.x, p.y);
        const x = ax + fx0 + ox;
        const y = ay + fy0 + oy;
        const dx = x - ax;
        const dy = y - ay;
        const n = Math.hypot(dx, dy) || 1;
        this.spawn(x, y, (dx / n) * (30 + Math.random() * 50), (dy / n) * (30 + Math.random() * 50), 0.9 + Math.random() * 0.5, p.eye ? this.skin.eye : this.skin.body, 1, 2.5);
      }
      if (fx.shake) this.shake(0.3, 3);
      this.flashT = 0.12;
      this.deathShown = true;
    } else if (e.type === 'shield') {
      this.burst(cx(game.x), cy(game.y), 18, C.blue, 60);
      if (fx.shake) this.shake(0.15, 2);
    } else if (e.type === 'win') {
      this.winT = 0;
      this.burst(cx(game.x), cy(game.y), 30 * many, C.clay, 80);
      this.burst(cx(game.x), cy(game.y), 16 * many, C.light, 60);
    } else if (e.type === 'chunk') {
      // New rows above: bands that touched the old top edge need redrawing.
      for (const [k, b] of this.bands) if (b.provisional) this.bands.delete(k);
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, color: string, size: number, drag: number): void {
    if (this.particles.length > 600) return;
    this.particles.push({ x, y, vx, vy, life, max: life, color, size, drag });
  }

  private burst(x: number, y: number, n: number, color: string, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.4, color, Math.random() < 0.3 ? 2 : 1, 4);
    }
  }

  shake(t: number, mag: number): void {
    this.shakeT = Math.max(this.shakeT, t);
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  // ------------------------------------------------------------- frame ----

  frame(game: Game, dt: number, opts: FrameOpts = {}): void {
    this.time += dt;
    const a = this.a;
    const th = this.theme;
    if (this.bandWorld !== game.world) {
      this.bands.clear();
      this.bandWorld = game.world;
    }
    this.updateCamera(game, dt, opts.hudTop ?? 0);
    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (opts.shake !== false && !opts.reducedMotion) {
        sx = Math.round((Math.random() - 0.5) * 2 * this.shakeMag);
        sy = Math.round((Math.random() - 0.5) * 2 * this.shakeMag);
      }
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    const cam = Math.round(this.camY) + sy;
    a.setTransform(1, 0, 0, 1, sx, -cam);
    a.fillStyle = th.page;
    a.fillRect(-4, cam - 4, this.artW + 8, this.artH + 8);

    // Walls and spikes from the band cache.
    const r0 = Math.floor(cam / T) - 1;
    const r1 = Math.ceil((cam + this.artH) / T) + 1;
    for (let b = Math.floor(r0 / BAND); b <= Math.floor(r1 / BAND); b++) {
      a.drawImage(this.band(game, b), 0, b * BAND * T);
    }
    if (this.bands.size > 24) {
      for (const k of this.bands.keys()) if (Math.abs(k - r0 / BAND) > 6) this.bands.delete(k);
    }
    if (game.mode !== 'endless') this.drawExit(game);
    this.drawItems(game, r0, r1);
    this.drawGates(game, r0, r1);
    this.drawTraps(game, r0, r1);
    this.drawBugs(game, r0, r1);
    this.drawPlayer(game, dt);
    this.drawParticles(dt);
    this.drawFlood(game, cam);
    if (game.freeze > 0) {
      a.globalAlpha = 0.12 + 0.04 * Math.sin(this.time * 6);
      a.fillStyle = C.blue;
      a.fillRect(0, cam, this.artW, this.artH);
      a.globalAlpha = 1;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      a.globalAlpha = Math.max(0, this.flashT * 3);
      a.fillStyle = C.light;
      a.fillRect(0, cam, this.artW, this.artH);
      a.globalAlpha = 1;
    }
    if (opts.dim) {
      a.globalAlpha = opts.dim;
      a.fillStyle = th.page;
      a.fillRect(0, cam, this.artW, this.artH);
      a.globalAlpha = 1;
    }
    a.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.art, 0, 0, this.artW, this.artH, 0, 0, this.artW * this.scale, this.artH * this.scale);
  }

  private updateCamera(game: Game, dt: number, hudTop: number): void {
    const w = game.world;
    const py = game.y * T + T / 2;
    let target = py - this.artH * 0.56;
    const topLimit = (game.mode === 'endless' ? -1e9 : (w.top - 3) * T) - hudTop;
    const bottomLimit = (w.bottom + 1) * T - this.artH + T * 0.5;
    if (bottomLimit < topLimit) target = (topLimit + bottomLimit) / 2;
    else target = Math.max(topLimit, Math.min(bottomLimit, target));
    if (!this.camInit) {
      this.camY = target;
      this.camInit = true;
    }
    this.camY += (target - this.camY) * (1 - Math.exp(-dt * 7));
  }

  // ------------------------------------------------------------ walls ----

  private band(game: Game, b: number): HTMLCanvasElement {
    const w = game.world;
    const cached = this.bands.get(b);
    if (cached) return cached.c;
    const c = document.createElement('canvas');
    c.width = this.artW;
    c.height = BAND * T;
    const g = c.getContext('2d')!;
    const th = this.theme;
    g.fillStyle = th.page;
    g.fillRect(0, 0, c.width, c.height);
    const y0 = b * BAND;
    // Columns outside the board continue the tomb as solid rock.
    const xMin = -Math.ceil(this.boardX / T) - 1;
    const xMax = W + Math.ceil(this.boardX / T) + 1;
    for (let y = y0; y < y0 + BAND; y++) {
      for (let x = xMin; x < xMax; x++) {
        const ox = this.boardX + x * T;
        const oy = (y - y0) * T;
        if (x >= 0 && x < W && w.cell(x, y)) {
          g.fillStyle = th.bg;
          g.fillRect(ox, oy, T, T);
          continue;
        }
        this.wallTile(g, w, x, y, ox, oy);
      }
    }
    // Spikes and gate emitters are static, so they live in the band too.
    for (let y = y0; y < y0 + BAND; y++) {
      for (let x = 0; x < W; x++) {
        const s = w.spike(x, y);
        if (!s) continue;
        for (let d = 0; d < 4; d++) if (s & (1 << d)) this.teeth(g, this.boardX + x * T, (y - y0) * T, d, 4, th.hazard, th.light ? th.hazardDark : C.light);
      }
    }
    for (const gt of w.gates) {
      if (gt.y < y0 || gt.y >= y0 + BAND) continue;
      const ox = this.boardX + gt.x * T;
      const oy = (gt.y - y0) * T;
      g.fillStyle = th.hazard;
      if (gt.horiz) {
        g.fillRect(ox + 3, oy, 6, 2);
        g.fillRect(ox + 3, oy + T - 2, 6, 2);
        g.fillStyle = th.hazardDark;
        g.fillRect(ox + 5, oy + 1, 2, 1);
        g.fillRect(ox + 5, oy + T - 2, 2, 1);
      } else {
        g.fillRect(ox, oy + 3, 2, 6);
        g.fillRect(ox + T - 2, oy + 3, 2, 6);
        g.fillStyle = th.hazardDark;
        g.fillRect(ox + 1, oy + 5, 1, 2);
        g.fillRect(ox + T - 2, oy + 5, 1, 2);
      }
    }
    // A band touching the edge of what has been generated is redrawn when more arrives.
    const provisional = game.mode === 'endless' && y0 <= w.top + 1;
    this.bands.set(b, { c, v: w.version, provisional });
    return c;
  }

  private wallTile(g: CanvasRenderingContext2D, w: Game['world'], x: number, y: number, ox: number, oy: number): void {
    const th = this.theme;
    const inBoard = (xx: number) => xx >= 0 && xx < W;
    const fl = (dx: number, dy: number) => inBoard(x + dx) && w.cell(x + dx, y + dy) === 1;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (fl(dx, dy)) { near = true; break; }
    if (!near) {
      g.fillStyle = th.page;
      g.fillRect(ox, oy, T, T);
      g.fillStyle = th.deep;
      const h = cellHash(x, y);
      // Sparse rubble so deep rock is not a flat void.
      g.fillRect(ox + 2 + Math.floor(h * 7), oy + 3 + Math.floor(((h * 13) % 1) * 6), 1, 1);
      if (h > 0.6) g.fillRect(ox + 1 + Math.floor(((h * 31) % 1) * 9), oy + 1 + Math.floor(((h * 53) % 1) * 9), 2, 1);
      return;
    }
    g.fillStyle = th.wall;
    g.fillRect(ox, oy, T, T);
    const h = cellHash(x, y);
    g.fillStyle = th.wallDark;
    if (h < 0.11) {
      drawBitmap(g, GLYPHS[Math.floor(h * 100) % GLYPHS.length], ox + 3, oy + 3, th.glyph);
    } else if (h < 0.55) {
      // Masonry: two courses of blocks with staggered joints.
      g.fillRect(ox, oy + 5, T, 1);
      g.fillRect(ox, oy + 11, T, 1);
      g.fillRect(ox + 3 + (h < 0.3 ? 2 : 0), oy, 1, 5);
      g.fillRect(ox + 8 - (h < 0.3 ? 2 : 0), oy + 6, 1, 5);
    } else if (h < 0.8) {
      // A cut diagonal, echoing the arcade original's triangle tiles.
      for (let i = 0; i < T; i++) g.fillRect(ox + i, oy + T - 1 - i, 1, 1);
      g.fillRect(ox, oy + 11, T, 1);
    } else {
      g.fillRect(ox + 2, oy + 2, 8, 1);
      g.fillRect(ox + 2, oy + 9, 8, 1);
      g.fillRect(ox + 2, oy + 2, 1, 8);
      g.fillRect(ox + 9, oy + 2, 1, 8);
    }
    // Bright rim on every face that looks onto floor, with a dark bevel inside it.
    g.fillStyle = th.wallLight;
    const up = fl(0, -1);
    const down = fl(0, 1);
    const left = fl(-1, 0);
    const right = fl(1, 0);
    if (up) g.fillRect(ox, oy, T, 1);
    if (down) g.fillRect(ox, oy + T - 1, T, 1);
    if (left) g.fillRect(ox, oy, 1, T);
    if (right) g.fillRect(ox + T - 1, oy, 1, T);
    g.fillStyle = th.wallDark;
    if (up) g.fillRect(ox + (left ? 1 : 0), oy + 1, T - (left ? 1 : 0) - (right ? 1 : 0), 1);
    if (down) g.fillRect(ox + (left ? 1 : 0), oy + T - 2, T - (left ? 1 : 0) - (right ? 1 : 0), 1);
    if (left) g.fillRect(ox + 1, oy + (up ? 1 : 0), 1, T - (up ? 1 : 0) - (down ? 1 : 0));
    if (right) g.fillRect(ox + T - 2, oy + (up ? 1 : 0), 1, T - (up ? 1 : 0) - (down ? 1 : 0));
    // Inner corners where only a diagonal neighbour is open.
    g.fillStyle = th.wallLight;
    if (!up && !left && fl(-1, -1)) g.fillRect(ox, oy, 1, 1);
    if (!up && !right && fl(1, -1)) g.fillRect(ox + T - 1, oy, 1, 1);
    if (!down && !left && fl(-1, 1)) g.fillRect(ox, oy + T - 1, 1, 1);
    if (!down && !right && fl(1, 1)) g.fillRect(ox + T - 1, oy + T - 1, 1, 1);
  }

  /** Three teeth growing out of the wall on side d of the floor tile at (ox, oy). */
  private teeth(g: CanvasRenderingContext2D, ox: number, oy: number, d: number, depth: number, color: string, tip: string): void {
    const put = (u: number, v: number, c: string) => {
      g.fillStyle = c;
      // u runs along the wall face, v grows out of it into the tile.
      if (d === UP) g.fillRect(ox + u, oy + v, 1, 1);
      else if (d === DOWN) g.fillRect(ox + u, oy + T - 1 - v, 1, 1);
      else if (d === 3) g.fillRect(ox + v, oy + u, 1, 1);
      else g.fillRect(ox + T - 1 - v, oy + u, 1, 1);
    };
    // Two triangular teeth, 6 wide at the wall and 2 at the tip.
    for (let k = 0; k < 2; k++) {
      const u0 = k * 6;
      for (let v = 0; v < depth; v++) {
        const inset = Math.min(2, Math.floor((v * 3) / Math.max(1, depth)));
        const c = v === depth - 1 && depth > 1 ? tip : color;
        for (let u = inset; u < 6 - inset; u++) put(u0 + u, v, c);
      }
    }
  }

  // ------------------------------------------------------------ stuff ----

  private drawExit(game: Game): void {
    const a = this.a;
    const w = game.world;
    const x = this.boardX + w.doorX * T;
    const y = w.doorY * T;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
    // Doorway two tiles tall, cut into the ceiling.
    a.fillStyle = '#0b0a09';
    a.fillRect(x, y - T, T, 2 * T);
    a.globalAlpha = 0.35 + 0.35 * pulse;
    a.fillStyle = C.clay;
    for (let i = 0; i < 6; i++) a.fillRect(x + 1, y - T + 2 + i * 4, T - 2, 1);
    a.globalAlpha = 1;
    // Frame and lintel.
    a.fillStyle = C.light;
    a.fillRect(x - 3, y - T - 3, T + 6, 2);
    a.fillRect(x - 3, y - T - 1, 2, 2 * T + 1);
    a.fillRect(x + T + 1, y - T - 1, 2, 2 * T + 1);
    a.fillStyle = this.theme.wallDark;
    a.fillRect(x - 2, y - T - 1, 1, 2 * T);
    a.fillRect(x + T + 2, y - T - 1, 1, 2 * T);
    // The spark over the door glows once you hold all three stars.
    const lit = game.stars >= 3;
    drawBitmap(a, SPARK[Math.floor(this.time * 2.5) % 2], x + 1, y - T - 14, lit ? C.clay : this.theme.wallLight, lit ? C.light : this.theme.wall);
  }

  private drawItems(game: Game, r0: number, r1: number): void {
    const a = this.a;
    const w = game.world;
    const th = this.theme;
    const spin = SPINNER[spinnerFrame(this.time)];
    const twinkle = SPARK[Math.floor(this.time * 2.5) % 2];
    const bob = Math.round(Math.sin(this.time * 4));
    for (let y = r0; y <= r1; y++) {
      const row = w.items.get(y);
      if (!row) continue;
      for (let x = 0; x < W; x++) {
        const it = row[x];
        if (!it) continue;
        const ox = this.boardX + x * T;
        const oy = y * T;
        if (it === IT_DOT) {
          a.fillStyle = th.dot;
          a.fillRect(ox + 5, oy + 5, 2, 2);
        } else if (it === IT_COIN) {
          drawBitmap(a, spin, ox + 2, oy + 2, C.clay, C.light);
        } else if (it === IT_STAR) {
          a.globalAlpha = 0.18 + 0.1 * Math.sin(this.time * 5);
          a.fillStyle = C.clay;
          a.fillRect(ox - 1, oy - 1 + bob, T + 2, T + 2);
          a.globalAlpha = 1;
          drawBitmap(a, twinkle, ox + 1, oy + 1 + bob, C.clay, C.light);
        } else if (it === IT_SHIELD || it === IT_MAGNET || it === IT_FREEZE) {
          const on = Math.floor(this.time * 3) % 2 === 0;
          a.fillStyle = on ? C.blue : th.hazardDark;
          a.fillRect(ox, oy, T, 1);
          a.fillRect(ox, oy + T - 1, T, 1);
          a.fillRect(ox, oy, 1, T);
          a.fillRect(ox + T - 1, oy, 1, T);
          drawBitmap(a, POWER_ICONS[it], ox + 2, oy + 2 + (on ? 0 : 0), C.light, C.blue);
        }
      }
    }
  }

  private drawGates(game: Game, r0: number, r1: number): void {
    const a = this.a;
    const th = this.theme;
    for (const g of game.world.gates) {
      if (g.y < r0 || g.y > r1) continue;
      const ox = this.boardX + g.x * T;
      const oy = g.y * T;
      const on = gateOn(g, game.hz);
      const u = (((game.hz / g.period + g.phase) % 1) + 1) % 1;
      const warn = !on && u > 1 - 0.28 / g.period;
      if (on) {
        a.fillStyle = Math.floor(this.time * 30) % 2 ? th.hazard : C.light;
        if (g.horiz) a.fillRect(ox + 5, oy + 2, 2, T - 4);
        else a.fillRect(ox + 2, oy + 5, T - 4, 2);
        a.globalAlpha = 0.3;
        a.fillStyle = th.hazard;
        if (g.horiz) a.fillRect(ox + 3, oy + 2, 6, T - 4);
        else a.fillRect(ox + 2, oy + 3, T - 4, 6);
        a.globalAlpha = 1;
      } else {
        a.fillStyle = warn && Math.floor(this.time * 16) % 2 ? th.hazard : th.hazardDark;
        for (let i = 2; i < T - 2; i += 2) {
          if (g.horiz) a.fillRect(ox + 5 + ((i / 2) % 2), oy + i, 1, 1);
          else a.fillRect(ox + i, oy + 5 + ((i / 2) % 2), 1, 1);
        }
      }
    }
  }

  private drawTraps(game: Game, r0: number, r1: number): void {
    const th = this.theme;
    for (const t of game.world.traps) {
      if (t.y < r0 || t.y > r1) continue;
      const ox = this.boardX + t.x * T;
      const oy = t.y * T;
      const since = t.armedAt >= 0 ? game.hz - t.armedAt : -1;
      if (since >= TRAP_DELAY && since < TRAP_DELAY + TRAP_OUT) {
        this.teeth(this.a, ox, oy, t.face, 5, th.hazard, C.light);
      } else {
        // Retracted: a dark slot in the wall with two nubs that rattle once armed.
        const armed = since >= 0 && since < TRAP_DELAY;
        const col = armed && Math.floor(this.time * 20) % 2 ? C.light : th.hazard;
        const jit = armed ? Math.round(Math.sin(this.time * 60)) : 0;
        const a = this.a;
        const put = (u: number, v: number, c: string) => {
          a.fillStyle = c;
          if (t.face === UP) a.fillRect(ox + u, oy + v, 1, 1);
          else if (t.face === DOWN) a.fillRect(ox + u, oy + T - 1 - v, 1, 1);
          else if (t.face === 3) a.fillRect(ox + v, oy + u, 1, 1);
          else a.fillRect(ox + T - 1 - v, oy + u, 1, 1);
        };
        for (let u = 1; u < T - 1; u++) put(u, 0, th.hazardDark);
        for (const u of [2, 3, 8, 9]) put(u + jit, 1, col);
      }
    }
  }

  private drawBugs(game: Game, r0: number, r1: number): void {
    const a = this.a;
    const th = this.theme;
    const frame = BUG[Math.floor(game.hz * 10) % 2];
    for (const b of game.world.bugs) {
      const [bx, by] = bugXY(b, game.hz);
      if (by < r0 - 1 || by > r1 + 1) continue;
      const ahead = bugPos(b, game.hz + 0.02) - bugPos(b, game.hz);
      const d = b.horiz ? (ahead >= 0 ? 1 : 3) : ahead >= 0 ? 2 : 0;
      const cx = this.boardX + bx * T + T / 2;
      const cy = by * T + T / 2;
      drawBitmapFacing(a, frame, 9, 7, cx, cy, d, th.hazard, this.theme.light ? C.light : C.dark);
      // A faint trace of the lane it patrols.
      a.globalAlpha = 0.25;
      a.fillStyle = th.hazard;
      if (b.horiz) {
        a.fillRect(this.boardX + b.a * T + T / 2, b.line * T + T - 2, (b.b - b.a) * T + 1, 1);
      } else {
        a.fillRect(this.boardX + b.line * T + T - 2, b.a * T + T / 2, 1, (b.b - b.a) * T + 1);
      }
      a.globalAlpha = 1;
    }
  }

  private anchorOffset(feet: number): [number, number] {
    return [(DX[feet] * T) / 2, (DY[feet] * T) / 2];
  }

  /** Clawd's pose for the current moment. */
  private pose(game: Game): Pose {
    if (game.state === 'moving') {
      return { bw: 6, bh: 7, leg: 3, arm: -1, armLen: 1, eyes: 'wide', lookX: 0, step: 0 };
    }
    if (this.landT < 0.08) return { bw: 10, bh: 4, leg: 1, arm: 1, armLen: 1, eyes: 'closed', lookX: 0, step: 0 };
    if (this.landT < 0.15) return { bw: 8, bh: 7, leg: 2, arm: -1, armLen: 1, eyes: 'open', lookX: 0, step: 0 };
    const p: Pose = { ...POSE_IDLE };
    if (this.blinkT > 0) p.eyes = 'closed';
    if (this.danceT > 0) {
      p.step = 1 + (Math.floor(this.danceT * 8) % 2);
      p.arm = Math.floor(this.danceT * 8) % 2 ? -1 : 0;
    } else {
      if (Math.floor(this.time * 1.5) % 4 === 0) p.arm = -1;
      // Glances one way, then the other, every few seconds.
      const look = Math.floor(this.time / 1.7) % 5;
      p.lookX = look === 1 ? 1 : look === 3 ? -1 : 0;
    }
    if (game.state === 'won') {
      p.arm = -1;
      p.eyes = 'wide';
    }
    return p;
  }

  private drawPlayer(game: Game, dt: number): void {
    const a = this.a;
    if (game.state === 'dead' && this.deathShown) return;
    this.landT += dt;
    if (this.blinkT > 0) this.blinkT -= dt;
    else if ((this.nextBlink -= dt) <= 0) {
      this.blinkT = 0.12;
      this.nextBlink = 2 + Math.random() * 3;
    }
    if (game.state === 'idle') {
      if (this.danceT > 0) this.danceT -= dt;
      else if ((this.nextDance -= dt) <= 0) {
        this.danceT = 0.9;
        this.nextDance = 4 + Math.random() * 4;
      }
    } else {
      this.danceT = 0;
      this.nextDance = 3;
    }
    const cx = this.boardX + game.x * T + T / 2;
    const cy = game.y * T + T / 2;
    const feet = game.state === 'moving' ? game.dir : this.landT < 9 ? this.landDir : game.facing;
    const [fx, fy] = this.anchorOffset(feet);
    const ax = Math.round(cx + fx);
    const ay = Math.round(cy + fy);
    const skin = this.skin;
    let body = skin.body;
    if (skin.alt && Math.floor(this.time * 3) % 3 === 0) body = skin.alt;
    const pose = this.pose(game);

    if (game.state === 'moving') this.trail.push([ax, ay, feet]);
    else this.trail.length = 0;
    if (this.trail.length > 8) this.trail.shift();
    for (let i = 0; i < this.trail.length - 1; i += 2) {
      const [tx, ty, tf] = this.trail[i];
      a.globalAlpha = 0.1 + (i / this.trail.length) * 0.25;
      drawClawd(a, tx, ty, tf, pose, body, body);
    }
    a.globalAlpha = 1;

    if (game.state === 'won') {
      this.winT += dt;
      if (this.winT > 0.45) return;
    }
    if (game.invuln > 0 && Math.floor(this.time * 14) % 2) return;
    drawClawd(a, ax, ay, feet, pose, body, skin.eye);

    if (game.shields > 0) {
      a.globalAlpha = 0.55 + 0.25 * Math.sin(this.time * 5);
      a.fillStyle = C.blue;
      const r = 8;
      for (let i = 0; i < 28; i++) {
        const t = (i / 28) * Math.PI * 2;
        a.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1);
      }
      a.globalAlpha = 1;
    }
    if (game.magnet > 0) {
      a.fillStyle = C.light;
      for (let i = 0; i < 3; i++) {
        const t = this.time * 4 + (i * Math.PI * 2) / 3;
        a.fillRect(Math.round(cx + Math.cos(t) * MAGNET_R * T * 0.45), Math.round(cy + Math.sin(t) * MAGNET_R * T * 0.45), 1, 1);
      }
    }
  }

  private drawParticles(dt: number): void {
    const a = this.a;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.vx *= Math.exp(-p.drag * dt);
      p.vy *= Math.exp(-p.drag * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      a.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      a.fillStyle = p.color;
      a.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    a.globalAlpha = 1;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > 0.9) {
        this.floaters.splice(i, 1);
        continue;
      }
      a.globalAlpha = Math.min(1, (0.9 - f.t) * 3);
      drawText(a, f.text, Math.round(f.x - textWidth(f.text) / 2), Math.round(f.y - f.t * 14), f.color, 1, this.theme.light ? C.lightGray : C.dark);
    }
    a.globalAlpha = 1;
  }

  /** The rising "context window": a page of text that fills the tomb. */
  private drawFlood(game: Game, cam: number): void {
    if (!isFinite(game.floodY)) return;
    const a = this.a;
    const th = this.theme;
    const surface = Math.round((game.floodY + 0.5) * T);
    const bottom = cam + this.artH + 4;
    if (surface > bottom) return;
    a.fillStyle = th.flood;
    a.fillRect(0, surface, this.artW, bottom - surface);
    // Lines of "text" scrolling upwards inside it.
    a.fillStyle = th.floodText;
    const lineH = 4;
    const scroll = Math.floor(this.time * 6);
    for (let y = surface + 5; y < bottom; y += lineH) {
      const row = Math.floor((y + scroll) / lineH);
      let x = this.boardX + 3;
      const end = this.boardX + W * T - 3;
      let k = 0;
      while (x < end) {
        const len = 2 + Math.floor(cellHash(row, k++) * 9);
        a.fillRect(x, y, Math.min(len, end - x), 1);
        x += len + 2;
        if (cellHash(k, row) > 0.86) break;
      }
    }
    // Wavy edge in Claude orange.
    a.fillStyle = th.floodEdge;
    for (let x = 0; x < this.artW; x++) {
      const wv = Math.round(Math.sin(x * 0.35 + this.time * 5) * 1);
      a.fillRect(x, surface + wv, 1, 2);
    }
    const label = 'CONTEXT';
    drawText(a, label, this.boardX + W * T - textWidth(label) - 3, surface + 4, th.floodEdge);
  }
}
