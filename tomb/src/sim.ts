// Game rules, independent of rendering and the DOM so tests can play whole
// stages headlessly. Coordinates are tiles; a tile's centre is at an integer.

import {
  W, DX, DY, DOWN, IT_NONE, IT_DOT, IT_COIN, IT_STAR, IT_SHIELD, IT_MAGNET, IT_FREEZE,
  DEFLECT, SLIDE_LIMIT, moveDist, moveTime,
} from './core.ts';
import { generate, stageParams, chunkParams, dailyParams, CHUNK_ROWS, type Level } from './gen.ts';
import {
  type Hazards, emptyHazards, hazardAt, onPlayerCell, advanceSaws, cloneDynamic, newSaw, darts,
  pufferOn, snakeState, TRAP_DELAY, SAW_TIMEOUT,
} from './hazards.ts';
import { hash } from './rng.ts';

export const MAGNET_R = 2.6;
export const POWER_TIME = { magnet: 8, freeze: 5 };
export { TRAP_DELAY };

export type Mode = 'stage' | 'endless' | 'daily';

export type GameEvent =
  | { type: 'move'; dir: number }
  | { type: 'stop'; dir: number; x: number; y: number; len: number }
  | { type: 'bump'; dir: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'pick'; item: number; x: number; y: number; combo: number; magnet: boolean }
  | { type: 'seal'; x: number; y: number }
  | { type: 'death'; cause: string }
  | { type: 'shield'; cause: string }
  | { type: 'hazard'; kind: 'trap' | 'spring' | 'fire' | 'puff' | 'snake' | 'sawwake' | 'sawbreak' | 'sawout'; x: number; y: number }
  | { type: 'win' }
  | { type: 'chunk'; k: number };

/** Key for a world cell (rows can be negative in endless mode). */
export const cellKey = (x: number, y: number): number => y * 64 + x;

export interface Trace {
  /** x, y pairs: the start cell, then every cell entered. */
  cells: number[];
  /** Direction each cell was entered in. */
  dirs: number[];
  x: number;
  y: number;
  /** Direction of travel at the end (after any bounce pad). */
  dir: number;
  len: number;
}

/** The world: one stage, or the endless tower built chunk by chunk. */
export class World {
  readonly w = W;
  readonly cells = new Map<number, Uint8Array>();
  readonly items = new Map<number, Uint8Array>();
  readonly spikes = new Map<number, Uint8Array>();
  readonly pads = new Map<number, Uint8Array>();
  /** Seal blocks by cellKey: 1 = still open, 2 = sealed solid. */
  readonly seals = new Map<number, number>();
  hz: Hazards = emptyHazards();
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

  pad(x: number, y: number): number {
    const r = this.pads.get(y);
    return r && x >= 0 && x < this.w ? r[x] : 0;
  }

  seal(x: number, y: number): number {
    return this.seals.get(cellKey(x, y)) ?? 0;
  }

  /** Turns an open seal block solid. */
  close(x: number, y: number): void {
    this.seals.set(cellKey(x, y), 2);
    const r = this.cells.get(y);
    if (r) r[x] = 0;
    this.version++;
  }

  /** Adds a generated level whose local row 0 sits at world row `base`. */
  add(level: Level, base: number, k: number, ownBottomRow: boolean): void {
    const rows = ownBottomRow ? level.h : level.h - 1;
    const w = level.w;
    for (let y = 0; y < rows; y++) {
      const wy = base + y;
      this.cells.set(wy, level.cells.slice(y * w, (y + 1) * w));
      this.items.set(wy, level.items.slice(y * w, (y + 1) * w));
      this.spikes.set(wy, level.spikes.slice(y * w, (y + 1) * w));
      this.pads.set(wy, level.pads.slice(y * w, (y + 1) * w));
    }
    for (const c of level.seals) this.seals.set(cellKey(c % w, Math.floor(c / w) + base), 1);
    const H = this.hz;
    for (const b of level.bugs) H.bugs.push(b.horiz ? { ...b, line: b.line + base } : { ...b, a: b.a + base, b: b.b + base });
    for (const g of level.gates) H.gates.push({ ...g, y: g.y + base });
    for (const t of level.turrets) H.turrets.push({ ...t, y: t.y + base });
    for (const p of level.puffers) H.puffers.push({ ...p, y: p.y + base });
    for (const s of level.snakes) H.snakes.push(s.horiz ? { ...s, line: s.line + base } : { ...s, a: s.a + base, b: s.b + base });
    for (const t of level.traps) H.traps.push({ x: t.x, y: t.y + base, armedAt: -1 });
    for (const s of level.saws) H.saws.push(newSaw({ ...s, hy: s.hy + base, ey: s.ey + base }));
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
    for (const m of [this.cells, this.items, this.spikes, this.pads]) for (const k of m.keys()) if (k > y) m.delete(k);
    const H = this.hz;
    H.bugs = H.bugs.filter((b) => (b.horiz ? b.line : b.a) <= y);
    H.gates = H.gates.filter((g) => g.y <= y);
    H.turrets = H.turrets.filter((t) => t.y <= y);
    H.puffers = H.puffers.filter((p) => p.y <= y);
    H.snakes = H.snakes.filter((s) => (s.horiz ? s.line : Math.min(s.a, s.b)) <= y);
    H.traps = H.traps.filter((t) => t.y <= y);
    this.chunks = this.chunks.filter((c) => c.base <= y);
    this.bottom = Math.min(this.bottom, y);
  }

  /** A slide from (x, y) in direction d, through bounce pads, until something solid. */
  trace(x: number, y: number, d: number): Trace {
    const cells = [x, y];
    const dirs: number[] = [];
    let cx = x;
    let cy = y;
    let dir = d;
    let n = 0;
    for (let steps = 0; steps < SLIDE_LIMIT; steps++) {
      const nx = cx + DX[dir];
      const ny = cy + DY[dir];
      if (!this.cell(nx, ny)) break;
      cx = nx;
      cy = ny;
      n++;
      cells.push(cx, cy);
      dirs.push(dir);
      const p = this.pad(cx, cy);
      if (p) dir = DEFLECT[p][dir];
    }
    return { cells, dirs, x: cx, y: cy, dir, len: n };
  }

  /** Same as cell(), as a closure for the hazard code. */
  readonly open = (x: number, y: number): boolean => this.cell(x, y) === 1;
}

export interface GameOptions {
  mode: Mode;
  stage?: number;
  /** Endless run seed or daily date key. */
  seed?: number;
  dateKey?: string;
  shields?: number;
}

/** Position along a traced path after travelling `dist` cells. */
export function along(tr: Trace, dist: number): [number, number] {
  const i = Math.max(0, Math.min(tr.len, Math.floor(dist)));
  const f = Math.min(1, dist - i);
  const ax = tr.cells[i * 2];
  const ay = tr.cells[i * 2 + 1];
  if (i >= tr.len) return [ax, ay];
  return [ax + (tr.cells[i * 2 + 2] - ax) * f, ay + (tr.cells[i * 2 + 3] - ay) * f];
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
  /** Current direction of travel (changes at bounce pads). */
  dir = 0;
  private path: Trace | null = null;
  private moveT = 0;
  private entered = 0;
  private pendingSeals: [number, number][] = [];
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
  private tmp: number[] = [];

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
    const tr = this.world.trace(this.x, this.y, d);
    if (tr.len === 0) {
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
    this.path = tr;
    this.moveT = 0;
    this.entered = 0;
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
    const prevHz = this.hz;
    let hzStep = dt;
    if (this.freeze > 0) {
      this.freeze = Math.max(0, this.freeze - dt);
      hzStep = 0;
    }
    this.hz += hzStep;
    if (this.magnet > 0) this.magnet = Math.max(0, this.magnet - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    if (this.state === 'moving' && this.path) {
      const tr = this.path;
      this.moveT += dt;
      const dist = Math.min(moveDist(this.moveT), tr.len);
      [this.x, this.y] = along(tr, dist);
      while (this.entered < tr.len && dist >= this.entered + 0.5) {
        this.entered++;
        const cx = tr.cells[this.entered * 2];
        const cy = tr.cells[this.entered * 2 + 1];
        this.enter(cx, cy);
        if (this.world.pad(cx, cy)) this.events.push({ type: 'bounce', x: cx, y: cy });
      }
      this.dir = tr.dirs[Math.min(tr.len - 1, Math.floor(dist))] ?? this.dir;
      if (dist >= tr.len) this.arrive();
    }
    this.closeSeals();
    if (this.magnet > 0) this.magnetPull();
    this.bestY = Math.min(this.bestY, Math.round(this.y));
    this.updateFlood(dt);
    if (hzStep > 0) this.tickHazards(prevHz);
    if (this.state === 'idle' || this.state === 'moving') this.hazards();
    if (this.mode === 'endless') {
      while (this.world.top > this.y - 40) this.addChunk();
      const drop = Math.ceil(this.floodY) + 30;
      if (isFinite(drop) && drop < this.world.bottom) this.world.dropBelow(drop);
    }
  }

  /** Clawd's centre has crossed into a new cell. */
  private enter(cx: number, cy: number): void {
    this.collect(cx, cy, false);
    if (this.world.seal(cx, cy) === 1) this.pendingSeals.push([cx, cy]);
    for (const e of onPlayerCell(this.world.hz, cx, cy, this.hz, this.world.open)) {
      this.events.push({ type: 'hazard', kind: e === 'saw' ? 'sawwake' : 'trap', x: cx, y: cy });
    }
  }

  /** Seal blocks turn solid once Clawd is a whole cell past them. */
  private closeSeals(): void {
    for (let i = this.pendingSeals.length - 1; i >= 0; i--) {
      const [sx, sy] = this.pendingSeals[i];
      if (Math.abs(sx - this.x) + Math.abs(sy - this.y) < 0.999) continue;
      this.pendingSeals.splice(i, 1);
      this.world.close(sx, sy);
      this.events.push({ type: 'seal', x: sx, y: sy });
    }
  }

  /** Moves saws and reports hazards that just went off near Clawd (for sound and effects). */
  private tickHazards(prevHz: number): void {
    const H = this.world.hz;
    const hz = this.hz;
    for (const e of advanceSaws(H, hz, hz - prevHz, this.world.open)) {
      const s = H.saws.find((sw) => sw.mode === 2 && sw.endAt === hz);
      this.events.push({ type: 'hazard', kind: e as 'sawbreak' | 'sawout', x: s?.x ?? this.x, y: s?.y ?? this.y });
    }
    const near = (y: number) => Math.abs(y - this.y) < 14;
    for (const t of H.traps) {
      if (t.armedAt >= 0 && prevHz < t.armedAt + TRAP_DELAY && hz >= t.armedAt + TRAP_DELAY && near(t.y)) {
        this.events.push({ type: 'hazard', kind: 'spring', x: t.x, y: t.y });
      }
    }
    for (const t of H.turrets) {
      if (!near(t.y)) continue;
      if (Math.floor(hz / t.period + t.phase) !== Math.floor(prevHz / t.period + t.phase)) this.events.push({ type: 'hazard', kind: 'fire', x: t.x, y: t.y });
    }
    for (const p of H.puffers) {
      if (near(p.y) && pufferOn(p, hz) && !pufferOn(p, prevHz)) this.events.push({ type: 'hazard', kind: 'puff', x: p.x, y: p.y });
    }
    for (const s of H.snakes) {
      const a = snakeState(s, prevHz);
      const b = snakeState(s, hz);
      if (b && b.head >= 0 && (!a || a.head < 0) && near(s.horiz ? s.line : s.a)) {
        this.events.push({ type: 'hazard', kind: 'snake', x: s.horiz ? s.a : s.line, y: s.horiz ? s.line : s.a });
      }
    }
  }

  private arrive(): void {
    const tr = this.path!;
    const x = tr.x;
    const y = tr.y;
    this.x = x;
    this.y = y;
    this.dir = tr.dir;
    this.facing = tr.dir;
    this.state = 'idle';
    this.path = null;
    this.lastStop = this.t;
    this.events.push({ type: 'stop', dir: tr.dir, x, y, len: tr.len });
    if (this.world.spike(x, y) & (1 << tr.dir)) {
      if (!this.hit('spikes')) return;
    }
    if (this.mode !== 'endless' && x === this.world.doorX && y === this.world.doorY) {
      this.state = 'won';
      this.events.push({ type: 'win' });
      return;
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

  /** Current rise speed of the context window (rows per second). */
  floodRateNow(): number {
    return this.floodRate();
  }

  private floodRate(): number {
    let v = this.floodSpeed;
    if (this.mode === 'endless') {
      // Gets faster with height, and catches up if you outrun it by a lot.
      v = Math.min(0.7 + this.height * 0.004, 2.4);
      const gap = this.floodY - this.y;
      if (gap > 18) v *= 1 + (gap - 18) * 0.25;
    }
    return v;
  }

  private updateFlood(dt: number): void {
    if (this.floodSpeed <= 0 || !this.started || this.freeze > 0) return;
    if (this.t - this.startedAt < this.floodDelay) return;
    this.floodY -= this.floodRate() * dt;
  }

  private hazards(): void {
    if (this.floodY < this.y + 0.15) {
      this.die('context');
      return;
    }
    if (this.invuln > 0) return;
    const cause = hazardAt(this.world.hz, this.x, this.y, this.hz, this.tmp);
    if (cause) this.hit(cause);
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

  /**
   * Would sliding in direction d after waiting `wait` seconds be safe? Used by
   * the bot (attract mode and tests). It replays the next moments on a copy of
   * every hazard, including the traps and saws this very slide would set off.
   * Next to a puffer it also checks that the following slide (`next`, after the
   * bot's usual pause) still fits before the puffer inflates.
   */
  safeMove(d: number, wait: number, next = -1, pause = 0.3): boolean {
    if (this.state !== 'idle') return false;
    const p = this.probe();
    if (!p.wait(wait)) return false;
    const dest = p.move(d);
    if (!dest) return false;
    const nearPuffer = this.world.hz.puffers.some((pf) => Math.abs(pf.x - dest[0]) < 2 && Math.abs(pf.y - dest[1]) < 2);
    if (!nearPuffer || next < 0) return p.wait(0.4);
    for (let w2 = pause; w2 <= pause + 1.2; w2 += 0.1) {
      const q = p.fork();
      if (q.wait(w2) && q.move(next) && q.wait(0.35)) return true;
    }
    return false;
  }

  /** A throwaway copy of the moving parts of the game, for looking ahead. */
  private probe(): Probe {
    return new Probe(this);
  }

  /** True while any saw is chasing (the bot must not dawdle). */
  get chased(): boolean {
    return this.world.hz.saws.some((s) => s.mode === 1 && this.hz - s.wokeAt < SAW_TIMEOUT);
  }

  /** Live darts, for drawing. */
  dartsOf(i: number): number[] {
    return darts(this.world.hz.turrets[i], this.hz, this.tmp);
  }
}

/** Today's date key for the daily tomb, in the player's local time. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newRunSeed(): number {
  return hash('run', Date.now(), Math.random());
}

export { CHUNK_ROWS, IT_SHIELD, IT_MAGNET, IT_FREEZE };

/** Look-ahead state for the bot: position, clocks and copies of the reactive hazards. */
class Probe {
  private g: Game;
  x: number;
  y: number;
  hz: number;
  freeze: number;
  floodY: number;
  elapsed = 0;
  H: Hazards;
  sealed: Set<number>;
  private tmp: number[] = [];

  constructor(g: Game, from?: Probe) {
    this.g = g;
    if (from) {
      this.x = from.x;
      this.y = from.y;
      this.hz = from.hz;
      this.freeze = from.freeze;
      this.floodY = from.floodY;
      this.elapsed = from.elapsed;
      this.H = cloneDynamic(from.H);
      this.sealed = new Set(from.sealed);
    } else {
      this.x = g.x;
      this.y = g.y;
      this.hz = g.hz;
      this.freeze = g.freeze;
      this.floodY = g.floodY;
      this.H = cloneDynamic(g.world.hz);
      this.sealed = new Set();
    }
  }

  fork(): Probe {
    return new Probe(this.g, this);
  }

  private readonly open = (x: number, y: number): boolean => this.g.world.cell(x, y) === 1 && !this.sealed.has(cellKey(x, y));

  /** Advances the clocks and the flood; returns how far the hazard clock moved. */
  private clock(dt: number): number {
    const g = this.g;
    this.elapsed += dt;
    let step = dt;
    if (this.freeze > 0) {
      this.freeze -= dt;
      step = 0;
    }
    this.hz += step;
    const startFlood = g.started ? g.startedAt + g.floodDelay : g.t + this.elapsed + g.floodDelay;
    if (g.floodSpeed > 0 && step > 0 && g.t + this.elapsed > startFlood) {
      this.floodY -= g.floodRateNow() * (g.mode === 'endless' ? 1.15 : 1) * dt;
    }
    return step;
  }

  private danger(x: number, y: number): boolean {
    if (this.floodY < y + 0.6) return true;
    if (this.g.invuln > this.elapsed) return false;
    const H = this.H;
    const hz = this.hz;
    // Saws react to Clawd's path, so give them extra room rather than extra time.
    for (const s of H.saws) if (s.mode === 1 && Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < 0.9) return true;
    // A frame of slack either way, because the real game samples on frame boundaries.
    return !!(hazardAt(H, x, y, hz, this.tmp) || hazardAt(H, x, y, hz + 0.03, this.tmp) || hazardAt(H, x, y, Math.max(0, hz - 0.03), this.tmp));
  }

  /** Stand still for `secs`; false if something gets Clawd. */
  wait(secs: number): boolean {
    const dt = 1 / 120;
    for (let t = 0; t < secs; t += dt) {
      const step = this.clock(dt);
      if (step > 0) advanceSaws(this.H, this.hz, step, this.open);
      if (this.danger(this.x, this.y)) return false;
    }
    return true;
  }

  /** Slide in direction d; returns where it ends, or null if it's deadly or blocked. */
  move(d: number): [number, number] | null {
    const w = this.g.world;
    const tr = w.trace(this.x, this.y, d);
    if (tr.len === 0) return null;
    // Cells sealed earlier in this look-ahead are solid for the slide too.
    for (let k = 1; k <= tr.len; k++) {
      if (this.sealed.has(cellKey(tr.cells[k * 2], tr.cells[k * 2 + 1]))) return null;
    }
    if (w.spike(tr.x, tr.y) & (1 << tr.dir) && this.g.shields === 0) return null;
    const dt = 1 / 120;
    const T = moveTime(tr.len);
    let k = 0;
    const pending: [number, number][] = [];
    for (let t = dt; t <= T + dt; t += dt) {
      // Same order as Game.step: clock, movement and trail, sealing, saws, collisions.
      const step = this.clock(dt);
      const dist = Math.min(moveDist(t), tr.len);
      while (k < tr.len && dist >= k + 0.5) {
        k++;
        const cx = tr.cells[k * 2];
        const cy = tr.cells[k * 2 + 1];
        onPlayerCell(this.H, cx, cy, this.hz, this.open);
        if (w.seal(cx, cy) === 1) pending.push([cx, cy]);
      }
      const [px, py] = along(tr, dist);
      for (let i = pending.length - 1; i >= 0; i--) {
        if (Math.abs(pending[i][0] - px) + Math.abs(pending[i][1] - py) >= 0.999) {
          this.sealed.add(cellKey(pending[i][0], pending[i][1]));
          pending.splice(i, 1);
        }
      }
      if (step > 0) advanceSaws(this.H, this.hz, step, this.open);
      if (this.danger(px, py)) return null;
    }
    this.x = tr.x;
    this.y = tr.y;
    return [tr.x, tr.y];
  }
}
