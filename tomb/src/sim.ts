// Game rules, independent of rendering and the DOM so tests can play whole
// stages headlessly. Coordinates are tiles; a tile's centre is at an integer.

import {
  W, DX, DY, UP, DOWN, IT_NONE, IT_DOT, IT_COIN, IT_STAR, IT_SHIELD, IT_MAGNET, IT_FREEZE,
  moveDist, moveTime, generate, stageParams, chunkParams, dailyParams, CHUNK_ROWS,
  type Level, type Bug, type Gate, type Trap,
} from './gen.ts';
import { hash } from './rng.ts';

export const TRAP_DELAY = 0.55;
export const TRAP_OUT = 0.55;
export const BUG_HIT = 0.62;
export const GATE_HIT = 0.5;
export const MAGNET_R = 2.6;
export const POWER_TIME = { magnet: 8, freeze: 5 };

export type Mode = 'stage' | 'endless' | 'daily';

export type GameEvent =
  | { type: 'move'; dir: number }
  | { type: 'stop'; dir: number; x: number; y: number; len: number }
  | { type: 'bump'; dir: number }
  | { type: 'pick'; item: number; x: number; y: number; combo: number; magnet: boolean }
  | { type: 'death'; cause: string }
  | { type: 'shield'; cause: string }
  | { type: 'trap'; x: number; y: number }
  | { type: 'win' }
  | { type: 'chunk'; k: number };

export interface WTrap extends Trap {
  armedAt: number;
}

export function bugPos(b: Bug, hz: number): number {
  const span = b.b - b.a;
  if (span <= 0) return b.a;
  const period = (2 * span) / b.speed;
  const u = (((hz / period + b.phase) % 1) + 1) % 1;
  return b.a + (u < 0.5 ? u * 2 : 2 - u * 2) * span;
}

export function bugXY(b: Bug, hz: number): [number, number] {
  const p = bugPos(b, hz);
  return b.horiz ? [p, b.line] : [b.line, p];
}

export function gateOn(g: Gate, hz: number): boolean {
  const u = (((hz / g.period + g.phase) % 1) + 1) % 1;
  return u < g.on;
}

/** The world: one stage, or the endless tower built chunk by chunk. */
export class World {
  readonly w = W;
  readonly cells = new Map<number, Uint8Array>();
  readonly items = new Map<number, Uint8Array>();
  readonly spikes = new Map<number, Uint8Array>();
  bugs: Bug[] = [];
  gates: Gate[] = [];
  traps: WTrap[] = [];
  chunks: { level: Level; base: number; k: number }[] = [];
  top = 0;
  bottom = 0;
  doorX = -1;
  doorY = -1;
  dotsTotal = 0;
  starsTotal = 0;
  /** Bumped whenever cells change, so renderers can rebuild caches. */
  version = 0;

  cell(x: number, y: number): number {
    if (x < 0 || x >= this.w) return 0;
    const r = this.cells.get(y);
    return r ? r[x] : 0;
  }

  item(x: number, y: number): number {
    const r = this.items.get(y);
    return r && x >= 0 && x < this.w ? r[x] : IT_NONE;
  }

  take(x: number, y: number): number {
    const r = this.items.get(y);
    if (!r) return IT_NONE;
    const it = r[x];
    r[x] = IT_NONE;
    return it;
  }

  spike(x: number, y: number): number {
    const r = this.spikes.get(y);
    return r && x >= 0 && x < this.w ? r[x] : 0;
  }

  /** Adds a generated level whose local row 0 sits at world row `base`. */
  add(level: Level, base: number, k: number, ownBottomRow: boolean): void {
    const rows = ownBottomRow ? level.h : level.h - 1;
    for (let y = 0; y < rows; y++) {
      const wy = base + y;
      this.cells.set(wy, level.cells.slice(y * level.w, (y + 1) * level.w));
      this.items.set(wy, level.items.slice(y * level.w, (y + 1) * level.w));
      this.spikes.set(wy, level.spikes.slice(y * level.w, (y + 1) * level.w));
    }
    for (const b of level.bugs) {
      this.bugs.push(b.horiz ? { ...b, line: b.line + base } : { ...b, a: b.a + base, b: b.b + base });
    }
    for (const g of level.gates) this.gates.push({ ...g, y: g.y + base });
    for (const t of level.traps) this.traps.push({ ...t, y: t.y + base, armedAt: -1 });
    for (const it of level.items) {
      if (it === IT_DOT) this.dotsTotal++;
      if (it === IT_STAR) this.starsTotal++;
    }
    this.chunks.push({ level, base, k });
    if (this.chunks.length === 1) {
      this.top = base;
      this.bottom = base + level.h - 1;
    } else {
      this.top = Math.min(this.top, base);
      this.bottom = Math.max(this.bottom, base + rows - 1);
    }
    this.version++;
  }

  /** Forget rows below `y` (endless mode, far under the flood). */
  dropBelow(y: number): void {
    for (const m of [this.cells, this.items, this.spikes]) for (const k of m.keys()) if (k > y) m.delete(k);
    this.bugs = this.bugs.filter((b) => (b.horiz ? b.line : b.a) <= y);
    this.gates = this.gates.filter((g) => g.y <= y);
    this.traps = this.traps.filter((t) => t.y <= y);
    this.chunks = this.chunks.filter((c) => c.base <= y);
    this.bottom = Math.min(this.bottom, y);
  }

  /** End of a slide from (x, y). */
  slide(x: number, y: number, d: number): { x: number; y: number; len: number } {
    let cx = x;
    let cy = y;
    let len = 0;
    while (this.cell(cx + DX[d], cy + DY[d])) {
      cx += DX[d];
      cy += DY[d];
      len++;
    }
    return { x: cx, y: cy, len };
  }
}

export interface GameOptions {
  mode: Mode;
  stage?: number;
  /** Endless run seed or daily date key. */
  seed?: number;
  dateKey?: string;
  shields?: number;
}

export class Game {
  readonly mode: Mode;
  readonly stage: number;
  readonly world = new World();
  readonly runSeed: number;
  level: Level;
  events: GameEvent[] = [];

  t = 0;
  hz = 0;
  started = false;
  startedAt = 0;
  state: 'idle' | 'moving' | 'dead' | 'won' = 'idle';
  deathCause = '';
  x: number;
  y: number;
  /** Direction Clawd last slid in: his feet point at that wall. */
  facing = DOWN;
  dir = UP;
  private fromX = 0;
  private fromY = 0;
  private len = 0;
  private moveT = 0;
  private picked = 0;
  queued = -1;
  lastStop = 0;
  moves = 0;

  stars = 0;
  coins = 0;
  dots = 0;
  combo = 0;
  private lastPick = -1;
  shields: number;
  magnet = 0;
  freeze = 0;
  invuln = 0;

  floodY = Infinity;
  floodSpeed = 0;
  floodDelay = 0;
  startY: number;
  bestY: number;
  private nextChunk = 0;
  private chunkEntry = -1;

  constructor(opts: GameOptions) {
    this.mode = opts.mode;
    this.stage = opts.stage ?? 1;
    this.runSeed = opts.seed ?? 1;
    this.shields = opts.shields ?? 0;
    if (this.mode === 'endless') {
      this.level = this.addChunk();
      this.addChunk();
      this.floodSpeed = 0.7;
      this.floodDelay = 4;
    } else {
      this.level = generate(this.mode === 'daily' ? dailyParams(opts.dateKey ?? 'today') : stageParams(this.stage));
      this.world.add(this.level, 0, 0, true);
      this.world.doorX = this.level.doorX;
      this.world.doorY = 0;
      this.floodSpeed = this.level.floodSpeed;
      this.floodDelay = this.level.floodDelay;
    }
    this.x = this.level.startX;
    this.y = this.level.startY;
    this.startY = this.y;
    this.bestY = this.y;
    if (this.floodSpeed > 0) this.floodY = this.world.bottom + 0.5;
  }

  private addChunk(): Level {
    const k = this.nextChunk++;
    const level = generate(chunkParams(k, this.chunkEntry, this.runSeed));
    // Chunk k's bottom row is chunk k-1's door row, so they overlap by one row.
    const prev = this.world.chunks[this.world.chunks.length - 1];
    const base = prev ? prev.base - (level.h - 1) : 0;
    this.world.add(level, base, k, !prev);
    this.chunkEntry = level.doorX;
    this.events.push({ type: 'chunk', k });
    return level;
  }

  get moving(): boolean {
    return this.state === 'moving';
  }

  /** Height climbed in endless mode, in rows. */
  get height(): number {
    return this.startY - this.bestY;
  }

  input(d: number): void {
    if (this.state === 'dead' || this.state === 'won') return;
    if (this.state === 'moving') {
      this.queued = d;
      return;
    }
    const r = this.world.slide(this.x, this.y, d);
    if (r.len === 0) {
      this.events.push({ type: 'bump', dir: d });
      return;
    }
    if (!this.started) {
      this.started = true;
      this.startedAt = this.t;
    }
    this.state = 'moving';
    this.dir = d;
    this.facing = d;
    this.fromX = this.x;
    this.fromY = this.y;
    this.len = r.len;
    this.moveT = 0;
    this.picked = 0;
    this.moves++;
    this.events.push({ type: 'move', dir: d });
  }

  update(dt: number): void {
    // Fixed small steps keep fast slides and collisions exact at any frame rate.
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const step = Math.min(left, 1 / 120);
      this.step(step);
      left -= step;
    }
  }

  private step(dt: number): void {
    if (this.state === 'won') return;
    this.t += dt;
    if (this.state === 'dead') return;
    if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - dt);
    else this.hz += dt;
    if (this.magnet > 0) this.magnet = Math.max(0, this.magnet - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    if (this.state === 'moving') {
      this.moveT += dt;
      const dist = Math.min(moveDist(this.moveT), this.len);
      this.x = this.fromX + DX[this.dir] * dist;
      this.y = this.fromY + DY[this.dir] * dist;
      const reach = Math.min(this.len, Math.floor(dist + 0.5));
      while (this.picked < reach) {
        this.picked++;
        this.collect(this.fromX + DX[this.dir] * this.picked, this.fromY + DY[this.dir] * this.picked, false);
      }
      if (dist >= this.len) this.arrive();
    }
    if (this.magnet > 0) this.magnetPull();
    this.bestY = Math.min(this.bestY, Math.round(this.y));
    this.updateFlood(dt);
    if (this.state === 'idle' || this.state === 'moving') this.hazards();
    if (this.mode === 'endless') {
      while (this.world.top > this.y - 40) this.addChunk();
      const drop = Math.ceil(this.floodY) + 30;
      if (isFinite(drop) && drop < this.world.bottom) this.world.dropBelow(drop);
    }
  }

  private arrive(): void {
    const x = Math.round(this.fromX + DX[this.dir] * this.len);
    const y = Math.round(this.fromY + DY[this.dir] * this.len);
    this.x = x;
    this.y = y;
    this.state = 'idle';
    this.lastStop = this.t;
    this.events.push({ type: 'stop', dir: this.dir, x, y, len: this.len });
    if (this.world.spike(x, y) & (1 << this.dir)) {
      if (!this.hit('spikes')) return;
    }
    if (this.mode !== 'endless' && x === this.world.doorX && y === this.world.doorY) {
      this.state = 'won';
      this.events.push({ type: 'win' });
      return;
    }
    for (const tr of this.world.traps) {
      if (tr.x === x && tr.y === y) {
        tr.armedAt = this.hz;
        this.events.push({ type: 'trap', x, y });
      }
    }
    if (this.queued >= 0) {
      const q = this.queued;
      this.queued = -1;
      this.input(q);
    }
  }

  private collect(x: number, y: number, magnet: boolean): void {
    const it = this.world.take(x, y);
    if (it === IT_NONE) return;
    if (it === IT_DOT) {
      this.dots++;
      this.combo = this.t - this.lastPick < 0.25 ? this.combo + 1 : 0;
      this.lastPick = this.t;
    } else if (it === IT_COIN) this.coins++;
    else if (it === IT_STAR) this.stars++;
    else if (it === IT_SHIELD) this.shields++;
    else if (it === IT_MAGNET) this.magnet = POWER_TIME.magnet;
    else if (it === IT_FREEZE) this.freeze = POWER_TIME.freeze;
    this.events.push({ type: 'pick', item: it, x, y, combo: this.combo, magnet });
  }

  private magnetPull(): void {
    const r = Math.ceil(MAGNET_R);
    const cx = Math.round(this.x);
    const cy = Math.round(this.y);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const it = this.world.item(x, y);
        if (it !== IT_DOT && it !== IT_COIN) continue;
        if ((x - this.x) ** 2 + (y - this.y) ** 2 <= MAGNET_R * MAGNET_R) this.collect(x, y, true);
      }
    }
  }

  private updateFlood(dt: number): void {
    if (this.floodSpeed <= 0 || !this.started || this.freeze > 0) return;
    if (this.t - this.startedAt < this.floodDelay) return;
    let v = this.floodSpeed;
    if (this.mode === 'endless') {
      // Gets faster with height, and catches up if you outrun it by a lot.
      v = Math.min(0.7 + this.height * 0.004, 2.4);
      const gap = this.floodY - this.y;
      if (gap > 18) v *= 1 + (gap - 18) * 0.25;
    }
    this.floodY -= v * dt;
  }

  private hazards(): void {
    if (this.floodY < this.y + 0.15) {
      this.die('context');
      return;
    }
    if (this.invuln > 0) return;
    for (const b of this.world.bugs) {
      const [bx, by] = bugXY(b, this.hz);
      if (Math.abs(bx - this.x) < BUG_HIT && Math.abs(by - this.y) < BUG_HIT) {
        if (!this.hit('bug')) return;
        break;
      }
    }
    for (const g of this.world.gates) {
      if (Math.abs(g.x - this.x) < GATE_HIT && Math.abs(g.y - this.y) < GATE_HIT && gateOn(g, this.hz)) {
        if (!this.hit('gate')) return;
        break;
      }
    }
    if (this.state === 'idle') {
      for (const tr of this.world.traps) {
        if (tr.armedAt < 0 || tr.x !== this.x || tr.y !== this.y) continue;
        const since = this.hz - tr.armedAt;
        if (since >= TRAP_DELAY && since < TRAP_DELAY + TRAP_OUT) {
          tr.armedAt = -1;
          if (!this.hit('trap')) return;
        }
      }
    }
  }

  /** Returns true if Clawd survives (a shield took the hit). */
  private hit(cause: string): boolean {
    if (this.invuln > 0) return true;
    if (this.shields > 0) {
      this.shields--;
      this.invuln = 1.3;
      this.events.push({ type: 'shield', cause });
      return true;
    }
    this.die(cause);
    return false;
  }

  private die(cause: string): void {
    this.state = 'dead';
    this.deathCause = cause;
    this.events.push({ type: 'death', cause });
  }

  /** How long a trap at the player's cell has before it fires (for drawing). */
  trapAt(x: number, y: number): WTrap | undefined {
    return this.world.traps.find((t) => t.x === x && t.y === y);
  }

  /**
   * Would sliding in direction d after waiting `wait` seconds be safe? Used by
   * the bot (attract mode and tests). Mirrors step() with the same clocks.
   */
  safeMove(d: number, wait: number): boolean {
    if (this.state !== 'idle') return false;
    const r = this.world.slide(this.x, this.y, d);
    if (r.len === 0) return false;
    if (this.world.spike(r.x, r.y) & (1 << d) && this.shields === 0) return false;
    const hzAt = (dt: number) => this.hz + Math.max(0, dt - this.freeze);
    const floodAt = (dt: number) => {
      if (this.floodSpeed <= 0) return Infinity;
      const v = this.mode === 'endless' ? Math.min(0.7 + this.height * 0.004, 2.4) * (this.floodY - this.y > 18 ? 3 : 1) : this.floodSpeed;
      const startT = this.started ? this.startedAt + this.floodDelay : this.t + wait + this.floodDelay;
      const active = Math.max(0, this.t + Math.max(0, dt - this.freeze) - Math.max(startT, this.t));
      return this.floodY - v * active;
    };
    const danger = (x: number, y: number, dt: number) => {
      if (floodAt(dt) < y + 0.6) return true;
      if (this.invuln > dt) return false;
      const hz = hzAt(dt);
      for (const b of this.world.bugs) {
        const [bx, by] = bugXY(b, hz);
        if (Math.abs(bx - x) < BUG_HIT + 0.08 && Math.abs(by - y) < BUG_HIT + 0.08) return true;
      }
      for (const g of this.world.gates) {
        if (Math.abs(g.x - x) < GATE_HIT + 0.05 && Math.abs(g.y - y) < GATE_HIT + 0.05 && gateOn(g, hz)) return true;
      }
      return false;
    };
    // Standing still while waiting.
    const tr = this.trapAt(this.x, this.y);
    if (tr && tr.armedAt >= 0 && this.hz + wait - tr.armedAt > TRAP_DELAY - 0.05) return false;
    for (let t = 0; t <= wait; t += 1 / 60) if (danger(this.x, this.y, t)) return false;
    // The slide itself, sampled finer than the simulation step.
    const T = moveTime(r.len);
    for (let t = 0; t <= T + 1 / 240; t += 1 / 240) {
      const dist = Math.min(moveDist(t), r.len);
      if (danger(this.x + DX[d] * dist, this.y + DY[d] * dist, wait + t)) return false;
    }
    // A moment of standing at the destination.
    for (let t = 0; t <= 0.35; t += 1 / 30) if (danger(r.x, r.y, wait + T + t)) return false;
    return true;
  }
}

/** Today's date key for the daily tomb, in the player's local time. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newRunSeed(): number {
  return hash('run', Date.now(), Math.random());
}

export { UP, CHUNK_ROWS, IT_SHIELD, IT_MAGNET, IT_FREEZE };
