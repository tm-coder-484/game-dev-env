// Procedural tomb generator.
//
// The player never walks: a swipe slides Clawd until he hits a wall, so a level
// is really a directed graph whose nodes are the cells where a slide can stop.
// The generator works on that graph directly:
//
//  1. Spine. A walker carves a chain of slides from the entrance to the exit
//     door. Every slide ends against a wall that is locked, so the solution can
//     never be erased by later carving.
//  2. Growth. Spurs, loops, rooms and pillars are added one at a time. After
//     each one the whole slide graph is rebuilt and the change is rolled back
//     unless every reachable stop can still reach the exit (no soft-locks), and
//     the shortest solution has not collapsed.
//  3. Hazards. Wall spikes kill a slide that stops on them; each one is only
//     kept if the level stays solvable and fair without that move. Bugs and
//     laser gates only ever cover cells where a slide cannot stop, so standing
//     still is always safe and they are a timing problem, never a trap.
//  4. Pickups. Stars go on detours chosen along a route that collects all three
//     in order, so all three can always be collected in one run. The rising
//     "context" flood is timed from that route.
//
// Several candidates are generated per seed and the best one by a layout score
// wins. Endless mode uses the same code for 24-row chunks that join through a
// door in the shared row between them.

import { Rng, hash } from './rng.ts';
import {
  W, UP, DOWN, LEFT, DX, DY, opp, IT_DOT, IT_COIN, IT_STAR, IT_SHIELD, IT_MAGNET, IT_FREEZE,
  PAD_SLASH, PAD_BACKSLASH, DEFLECT, SLIDE_LIMIT, moveTime, moveDist,
} from './core.ts';
import {
  type Bug, type Gate, type Trap, type Turret, type Puffer, type Snake, type SawSpec,
  newSaw, onPlayerCell, advanceSaws, emptyHazards, SNAKE_WARN, TRAP_DELAY, TRAP_OUT,
} from './hazards.ts';

export * from './core.ts';
export type { Bug, Gate, Trap, Turret, Puffer, Snake, SawSpec } from './hazards.ts';

/** Slide results: >= 0 is the cell index where the slide stops. */
export const R_NONE = -1;
export const R_GOAL = -2;
export const R_BACK = -3;
export const R_DEATH = -4;
export const R_LOOP = -5;

export interface LevelStats {
  sol: number;
  par: number;
  nodes: number;
  decisions: number;
  floor: number;
  dots: number;
  score: number;
  candidates: number;
  attempts: number;
  ms: number;
}

export interface Level {
  w: number;
  h: number;
  /** 1 = floor. Row 0 holds only the exit door, row h-1 only the entry door (chunks). */
  cells: Uint8Array;
  items: Uint8Array;
  /** Per floor cell: bit d set = a slide that stops here moving in direction d dies. */
  spikes: Uint8Array;
  doorX: number;
  entryX: number;
  startX: number;
  startY: number;
  /** Bounce pad per cell: 0 none, 1 "/", 2 "\\". */
  pads: Uint8Array;
  /** Cells that turn solid once Clawd has passed over them. */
  seals: number[];
  bugs: Bug[];
  gates: Gate[];
  traps: Trap[];
  turrets: Turret[];
  puffers: Puffer[];
  snakes: Snake[];
  saws: SawSpec[];
  /** Rows per second, 0 = no flood. */
  floodSpeed: number;
  floodDelay: number;
  /** Directions of a route from the start that takes all stars and leaves through the door. */
  route: number[];
  stats: LevelStats;
  seed: number;
}

export interface GenParams {
  seed: number;
  /** Interior rows (the level is rows + 2 tall). */
  rows: number;
  /** -1 = stage: start on the bottom row. Otherwise the column of the entry door below. */
  entryX: number;
  /** 0..1 */
  diff: number;
  spikes: number;
  bugs: number;
  gates: number;
  traps: number;
  turrets: number;
  puffers: number;
  snakes: number;
  saws: number;
  seals: number;
  pads: number;
  coins: number;
  powerups: number;
  stars: boolean;
  flood: boolean;
  /** Growth operations to attempt. */
  growth: number;
  candidates: number;
  /** Chance that the spine walker considers a downward slide. */
  down: number;
  /** Exit door needs a column with room for the gate art. */
  gateDoor: boolean;
}

// ---------------------------------------------------------------- grid ----

class Grid {
  readonly w = W;
  readonly h: number;
  readonly entryX: number;
  cells: Uint8Array;
  spikes: Uint8Array;
  lockW: Uint8Array;
  lockF: Uint8Array;
  pads: Uint8Array;
  /** Seal index per cell, -1 for none. */
  sealBit: Int8Array;
  doorX = -1;

  constructor(h: number, entryX: number) {
    this.h = h;
    this.entryX = entryX;
    const n = this.w * h;
    this.cells = new Uint8Array(n);
    this.spikes = new Uint8Array(n);
    this.lockW = new Uint8Array(n);
    this.lockF = new Uint8Array(n);
    this.pads = new Uint8Array(n);
    this.sealBit = new Int8Array(n).fill(-1);
    if (entryX >= 0) {
      const i = (h - 1) * this.w + entryX;
      this.cells[i] = 1;
      this.lockF[i] = 1;
    }
  }

  inside(x: number, y: number): boolean {
    return x >= 1 && x <= this.w - 2 && y >= 1 && y <= this.h - 2;
  }

  floor(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h && this.cells[y * this.w + x] === 1;
  }

  save(): [Uint8Array, Uint8Array, Uint8Array, Uint8Array, number, Uint8Array] {
    return [this.cells.slice(), this.spikes.slice(), this.lockW.slice(), this.lockF.slice(), this.doorX, this.pads.slice()];
  }

  load(s: [Uint8Array, Uint8Array, Uint8Array, Uint8Array, number, Uint8Array]): void {
    this.cells.set(s[0]);
    this.spikes.set(s[1]);
    this.lockW.set(s[2]);
    this.lockF.set(s[3]);
    this.doorX = s[4];
    this.pads.set(s[5]);
  }
}

// Results of the last trace() besides its return value (kept out of the return to avoid allocations).
let trDir = 0;
let trBits = 0;

/**
 * Follows a slide from (x, y) in direction d through bounce pads until something
 * solid. Seals whose bit is set in `mask` are solid. Calls fn for every cell
 * entered, with the direction it was entered in. Returns the stop cell or R_*.
 */
function trace(g: Grid, x: number, y: number, d: number, mask: number, fn?: (c: number, dir: number) => void): number {
  const w = g.w;
  let cx = x;
  let cy = y;
  let dir = d;
  let n = 0;
  let bits = 0;
  for (let steps = 0; ; steps++) {
    if (steps > SLIDE_LIMIT) {
      trDir = dir;
      trBits = bits;
      return R_LOOP;
    }
    const nx = cx + DX[dir];
    const ny = cy + DY[dir];
    if (nx < 0 || nx >= w || ny < 0 || ny >= g.h) break;
    const ni = ny * w + nx;
    if (!g.cells[ni]) break;
    const sb = g.sealBit[ni];
    if (sb >= 0 && (mask >> sb) & 1) break;
    cx = nx;
    cy = ny;
    n++;
    if (fn) fn(ni, dir);
    if (cy === 0 || cy === g.h - 1) {
      trDir = dir;
      trBits = bits;
      return cy === 0 ? R_GOAL : R_BACK;
    }
    if (sb >= 0) bits |= 1 << sb;
    const p = g.pads[ni];
    if (p) dir = DEFLECT[p][dir];
  }
  trDir = dir;
  trBits = bits;
  return n === 0 ? R_NONE : cy * w + cx;
}

/** Where a slide from (x, y) in direction d ends, with spikes. */
function slide(g: Grid, x: number, y: number, d: number): number {
  const r = trace(g, x, y, d, 0);
  return r >= 0 && g.spikes[r] & (1 << trDir) ? R_DEATH : r;
}

/** Calls fn for every cell a slide passes through (not the cell it starts on). */
function walk(g: Grid, u: number, d: number, fn: (i: number, dir: number) => void, mask = 0): void {
  trace(g, u % g.w, (u / g.w) | 0, d, mask, fn);
}

interface Analysis {
  ok: boolean;
  start: number;
  nodes: number[];
  /** res[node * 4 + d] */
  res: Int32Array;
  distS: Int32Array;
  distG: Int32Array;
  sol: number;
}

const target = (r: number, start: number): number => (r === R_BACK ? start : r);

function analyze(g: Grid, start: number): Analysis {
  const n = g.w * g.h;
  const res = new Int32Array(n * 4).fill(R_NONE);
  const distS = new Int32Array(n).fill(-1);
  const distG = new Int32Array(n).fill(-1);
  const nodes = [start];
  distS[start] = 0;
  const w = g.w;
  let loops = false;
  for (let qi = 0; qi < nodes.length; qi++) {
    const u = nodes[qi];
    const ux = u % w;
    const uy = (u / w) | 0;
    for (let d = 0; d < 4; d++) {
      const r = slide(g, ux, uy, d);
      if (r === R_LOOP) loops = true;
      res[u * 4 + d] = r;
      const t = target(r, start);
      if (t >= 0 && distS[t] < 0) {
        distS[t] = distS[u] + 1;
        nodes.push(t);
      }
    }
  }
  // Reverse BFS from the exit over the reachable part of the graph.
  const revHead = new Int32Array(n).fill(-1);
  const revNext: number[] = [];
  const revFrom: number[] = [];
  const queue: number[] = [];
  for (const u of nodes) {
    for (let d = 0; d < 4; d++) {
      const r = res[u * 4 + d];
      if (r === R_GOAL && distG[u] < 0) {
        distG[u] = 1;
        queue.push(u);
      }
      const t = target(r, start);
      if (t >= 0) {
        revFrom.push(u);
        revNext.push(revHead[t]);
        revHead[t] = revFrom.length - 1;
      }
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (let e = revHead[v]; e >= 0; e = revNext[e]) {
      const u = revFrom[e];
      if (distG[u] < 0) {
        distG[u] = distG[v] + 1;
        queue.push(u);
      }
    }
  }
  let ok = distG[start] > 0 && !loops;
  if (ok) for (const u of nodes) if (distG[u] < 0) { ok = false; break; }
  return { ok, start, nodes, res, distS, distG, sol: distG[start] };
}

// --------------------------------------------------------------- spine ----

function carve(g: Grid, x: number, y: number, d: number, len: number, lock: boolean): void {
  const w = g.w;
  for (let i = 1; i <= len; i++) {
    const c = (y + DY[d] * i) * w + x + DX[d] * i;
    g.cells[c] = 1;
    if (lock) g.lockF[c] = 1;
  }
  const sx = x + DX[d] * (len + 1);
  const sy = y + DY[d] * (len + 1);
  if (lock && g.inside(sx, sy)) g.lockW[sy * w + sx] = 1;
}

/**
 * Checks a slide of `len` cells from (x, y). Returns null when longer slides in
 * this direction are impossible too, NaN when only this length fails, or the
 * numbers needed to score it.
 */
function probe(g: Grid, x: number, y: number, d: number, len: number): { fresh: number; adj: number } | null | number {
  const w = g.w;
  let fresh = 0;
  let adj = 0;
  for (let i = 1; i <= len; i++) {
    const cx = x + DX[d] * i;
    const cy = y + DY[d] * i;
    if (!g.inside(cx, cy)) return null;
    const c = cy * w + cx;
    if (g.lockW[c]) return null;
    if (g.cells[c]) continue;
    fresh++;
    for (const p of [(d + 1) & 3, (d + 3) & 3]) if (g.floor(cx + DX[p], cy + DY[p])) adj++;
  }
  const sx = x + DX[d] * (len + 1);
  const sy = y + DY[d] * (len + 1);
  if (sx >= 0 && sx < w && sy >= 0 && sy < g.h) {
    const s = sy * w + sx;
    if (g.cells[s] || g.lockF[s]) return NaN;
  }
  return { fresh, adj };
}

function canFinish(g: Grid, x: number, y: number, gateDoor: boolean): boolean {
  if (gateDoor && (x < 2 || x > g.w - 3)) return false;
  for (let yy = y - 1; yy >= 1; yy--) if (g.lockW[yy * g.w + x]) return false;
  return true;
}

function finish(g: Grid, x: number, y: number): void {
  for (let yy = y - 1; yy >= 0; yy--) {
    g.cells[yy * g.w + x] = 1;
    g.lockF[yy * g.w + x] = 1;
  }
  g.doorX = x;
}

/** Carves the guaranteed route. Returns the start cell or -1. */
function spine(g: Grid, rng: Rng, P: GenParams): number {
  const w = g.w;
  let x: number;
  let y: number;
  let start = -1;
  let first = false;
  if (g.entryX < 0) {
    x = rng.int(2, w - 3);
    y = g.h - 2;
    start = y * w + x;
    g.cells[start] = 1;
    g.lockF[start] = 1;
  } else {
    x = g.entryX;
    y = g.h - 1;
    first = true;
  }
  let last = -1;
  const band = rng.int(2, 4);
  const maxV = P.rows < 30 ? 4 : 6;
  const ds: number[] = [];
  const ls: number[] = [];
  const ws: number[] = [];
  for (let step = 0; step < g.h * 4; step++) {
    if (!first && y <= band && canFinish(g, x, y, P.gateDoor)) {
      finish(g, x, y);
      return start >= 0 ? start : slide(g, g.entryX, g.h - 1, UP);
    }
    ds.length = ls.length = ws.length = 0;
    const nearTop = y <= band + 2;
    for (let d = 0; d < 4; d++) {
      if (first && d !== UP) continue;
      if (last >= 0 && d === opp(last)) continue;
      if (d === DOWN && (nearTop || y > g.h - 6 || !rng.chance(P.down))) continue;
      const vertical = (d & 1) === 0;
      const maxL = vertical ? maxV : w - 3;
      for (let L = 1; L <= maxL; L++) {
        const p = probe(g, x, y, d, L);
        if (p === null) break;
        if (typeof p === 'number') continue;
        // The first slide out of an entry door must not reach the top band.
        if (first && y - L - 1 <= band + 1) continue;
        let s: number;
        if (d === UP) s = 1.1 + 0.3 * L;
        else if (d === DOWN) s = -0.6 - 0.2 * L;
        else s = 0.55 + 0.11 * L;
        if (last >= 0 && (last & 1) !== (d & 1)) s += 0.5;
        if (vertical && L === 1) s -= 0.6;
        s -= 0.75 * p.adj;
        s -= 0.25 * (L - p.fresh);
        if (p.fresh === 0) s -= 2;
        // Near the top, head for a column that can take the exit shaft.
        if (nearTop && !vertical) {
          const ex = x + DX[d] * L;
          if (canFinish(g, ex, y, P.gateDoor)) s += 0.8;
        }
        ds.push(d);
        ls.push(L);
        ws.push(Math.exp(1.7 * s) * (0.35 + rng.next()));
      }
    }
    if (!ds.length) return -1;
    const k = rng.weighted(ws, ws.length);
    carve(g, x, y, ds[k], ls[k], true);
    x += DX[ds[k]] * ls[k];
    y += DY[ds[k]] * ls[k];
    last = ds[k];
    first = false;
  }
  return -1;
}

// -------------------------------------------------------------- growth ----

function sweptCells(g: Grid, an: Analysis): number[] {
  const seen = new Uint8Array(g.w * g.h);
  const out: number[] = [];
  const add = (i: number) => {
    if (!seen[i]) {
      seen[i] = 1;
      out.push(i);
    }
  };
  add(an.start);
  for (const u of an.nodes) {
    for (let d = 0; d < 4; d++) {
      const r = an.res[u * 4 + d];
      if (r === R_NONE || r === R_DEATH) continue;
      walk(g, u, d, (c) => add(c));
    }
  }
  return out;
}

function grow(g: Grid, rng: Rng, P: GenParams, an: Analysis, minSol: number): Analysis {
  const w = g.w;
  let swept = sweptCells(g, an);
  const interior = (w - 2) * (g.h - 2);
  let floorCount = g.cells.reduce((a, b) => a + b, 0);
  const maxFloor = interior * (0.42 + 0.06 * rng.next());
  for (let attempt = 0; attempt < P.growth; attempt++) {
    if (floorCount > maxFloor) break;
    const snap = g.save();
    const op = rng.weighted([5, 2.5, 1.6, 1.2]);
    let changed = false;
    let room: number[] | null = null;
    if (op === 0) {
      // Spur: a new slide out of an existing stop, ending against a locked wall.
      // Every direction and length from one stop is scored and one is drawn.
      const u = rng.pick(an.nodes);
      const ux = u % w;
      const uy = (u / w) | 0;
      const opts: number[] = [];
      const ow: number[] = [];
      for (let d = 0; d < 4; d++) {
        if (g.floor(ux + DX[d], uy + DY[d])) continue;
        const maxL = d & 1 ? w - 3 : 6;
        for (let L = 1; L <= maxL; L++) {
          const p = probe(g, ux, uy, d, L);
          if (p === null) break;
          if (typeof p === 'number' || p.fresh === 0 || p.adj > 2) continue;
          opts.push(d * 16 + L);
          ow.push(Math.exp(0.25 * L - 0.9 * p.adj) * (d === DOWN ? 0.5 : 1));
        }
      }
      if (opts.length) {
        const o = opts[rng.weighted(ow, ow.length)];
        carve(g, ux, uy, o >> 4, o & 15, true);
        changed = true;
      }
    } else if (op === 1) {
      // Loop: punch through 1-2 wall cells between two corridors.
      const f = rng.pick(swept);
      const d = rng.int(0, 3);
      let cx = (f % w) + DX[d];
      let cy = ((f / w) | 0) + DY[d];
      const cut: number[] = [];
      const maxCut = rng.chance(0.35) ? 5 : 2;
      while (cut.length < maxCut && g.inside(cx, cy) && !g.cells[cy * w + cx] && !g.lockW[cy * w + cx]) {
        cut.push(cy * w + cx);
        cx += DX[d];
        cy += DY[d];
      }
      if (cut.length && g.inside(cx, cy) && g.cells[cy * w + cx]) {
        for (const c of cut) g.cells[c] = 1;
        changed = true;
      }
    } else if (op === 2) {
      // Room: a small open area next to a corridor.
      const f = rng.pick(swept);
      const d = rng.int(0, 3);
      const rw = rng.int(2, 4);
      const rh = rng.int(2, 3);
      const fx = f % w;
      const fy = (f / w) | 0;
      let x0: number;
      let y0: number;
      if (d === UP) [x0, y0] = [fx - rng.int(0, rw - 1), fy - rh];
      else if (d === DOWN) [x0, y0] = [fx - rng.int(0, rw - 1), fy + 1];
      else if (d === LEFT) [x0, y0] = [fx - rw, fy - rng.int(0, rh - 1)];
      else [x0, y0] = [fx + 1, fy - rng.int(0, rh - 1)];
      let okRoom = true;
      for (let yy = y0; yy < y0 + rh && okRoom; yy++) {
        for (let xx = x0; xx < x0 + rw; xx++) {
          if (!g.inside(xx, yy) || g.lockW[yy * w + xx]) {
            okRoom = false;
            break;
          }
        }
      }
      if (okRoom) {
        for (let yy = y0; yy < y0 + rh; yy++) for (let xx = x0; xx < x0 + rw; xx++) g.cells[yy * w + xx] = 1;
        changed = true;
        room = [x0, y0, rw, rh];
      }
    } else {
      // Pillar: a wall block inside an open area gives slides more places to stop.
      const f = rng.pick(swept);
      const fx = f % w;
      const fy = (f / w) | 0;
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.floor(fx + dx, fy + dy)) open++;
      if (open >= 7 && !g.lockF[f] && g.inside(fx, fy)) {
        g.cells[f] = 0;
        changed = true;
      }
    }
    if (!changed) continue;
    const next = analyze(g, an.start);
    if (!next.ok || next.sol < minSol) {
      g.load(snap);
      continue;
    }
    const nextSwept = sweptCells(g, next);
    if (room) {
      // Rooms nobody can slide into are wasted floor.
      const [x0, y0, rw, rh] = room;
      let entered = 0;
      for (const c of nextSwept) {
        const cx = c % w;
        const cy = (c / w) | 0;
        if (cx >= x0 && cx < x0 + rw && cy >= y0 && cy < y0 + rh) entered++;
      }
      if (entered < (rw * rh) / 2) {
        g.load(snap);
        continue;
      }
    }
    an = next;
    swept = nextSwept;
    floorCount = g.cells.reduce((a, b) => a + b, 0);
  }
  return an;
}

// ------------------------------------------------------------- hazards ----

function placeSpikes(g: Grid, rng: Rng, an: Analysis, count: number, minSol: number): Analysis {
  if (count <= 0) return an;
  const w = g.w;
  // (stop cell, direction) pairs that some reachable slide ends on.
  const cand: number[] = [];
  const seen = new Set<number>();
  for (const u of an.nodes) {
    for (let d = 0; d < 4; d++) {
      const r = an.res[u * 4 + d];
      if (r < 0 || r === an.start) continue;
      const ry = (r / w) | 0;
      if (ry <= 1) continue;
      const key = r * 4 + d;
      if (!seen.has(key)) {
        seen.add(key);
        cand.push(key);
      }
    }
  }
  rng.shuffle(cand);
  let placed = 0;
  let swept = sweptCells(g, an).length;
  for (const key of cand) {
    if (placed >= count) break;
    const c = key >> 2;
    const d = key & 3;
    g.spikes[c] |= 1 << d;
    const next = analyze(g, an.start);
    const nextSwept = next.ok ? sweptCells(g, next).length : 0;
    if (!next.ok || next.sol < minSol || nextSwept < swept - 2) {
      g.spikes[c] &= ~(1 << d);
      continue;
    }
    an = next;
    swept = nextSwept;
    placed++;
  }
  return an;
}

interface Placement {
  route: number[];
  routeCells: Uint8Array;
  par: number;
}

/** Edge (u, d) -> cells it passes, cached. */
function edgeCells(g: Grid, u: number, d: number, cache: Map<number, number[]>): number[] {
  const key = u * 4 + d;
  let c = cache.get(key);
  if (!c) {
    c = [];
    walk(g, u, d, (i) => c!.push(i));
    cache.set(key, c);
  }
  return c;
}

/** BFS from `from` over the reachable graph; returns distance and parent edge per cell. */
function bfsFrom(g: Grid, an: Analysis, from: number): { dist: Int32Array; par: Int32Array } {
  const n = g.w * g.h;
  const dist = new Int32Array(n).fill(-1);
  const par = new Int32Array(n).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (let d = 0; d < 4; d++) {
      const t = target(an.res[u * 4 + d], an.start);
      if (t >= 0 && dist[t] < 0) {
        dist[t] = dist[u] + 1;
        par[t] = u * 4 + d;
        q.push(t);
      }
    }
  }
  return { dist, par };
}

function pathTo(par: Int32Array, from: number, to: number): number[] {
  const dirs: number[] = [];
  let v = to;
  while (v !== from) {
    const e = par[v];
    dirs.push(e & 3);
    v = e >> 2;
  }
  return dirs.reverse();
}

/** Places stars along a route that can take all of them, then dots, coins and powerups. */
function placeItems(g: Grid, rng: Rng, P: GenParams, an: Analysis, items: Uint8Array): Placement {
  const w = g.w;
  const cache = new Map<number, number[]>();
  const route: number[] = [];
  const routeCells = new Uint8Array(w * g.h);
  let cur = an.start;
  routeCells[cur] = 1;
  const follow = (from: number, dirs: number[]): number => {
    let u = from;
    for (const d of dirs) {
      for (const c of edgeCells(g, u, d, cache)) routeCells[c] = 1;
      route.push(d);
      u = target(an.res[u * 4 + d], an.start);
    }
    return u;
  };
  if (P.stars) {
    const top = 1;
    const starCells: number[] = [];
    const span = g.h - 2;
    // Bands from the bottom up: 0 is the lowest third.
    const bands: [number, number][] = [0, 1, 2].map((s) => [
      g.h - 1 - Math.floor((span * (s + 1)) / 3),
      g.h - 2 - Math.floor((span * s) / 3),
    ]);
    for (let s = 0; s < 3; s++) {
      const [yLo, yHi] = bands[s];
      const { dist, par } = bfsFrom(g, an, cur);
      const base = an.distG[cur];
      const cand: number[] = [];
      const cw: number[] = [];
      const via: number[] = [];
      for (const u of an.nodes) {
        if (dist[u] < 0) continue;
        for (let d = 0; d < 4; d++) {
          const r = an.res[u * 4 + d];
          if (r === R_NONE || r === R_DEATH) continue;
          if (r === R_GOAL && s < 2) continue;
          const t = target(r, an.start);
          const after = r === R_GOAL ? 0 : an.distG[t];
          if (after < 0) continue;
          const extra = dist[u] + 1 + after - base;
          const cells = edgeCells(g, u, d, cache);
          for (let k = 0; k < cells.length; k++) {
            const c = cells[k];
            const cy = (c / w) | 0;
            if (cy < Math.max(top, yLo) || cy > yHi || items[c] || c === an.start || cy === 0) continue;
            if (starCells.some((o) => Math.abs((o % w) - (c % w)) + Math.abs(((o / w) | 0) - cy) < 4)) continue;
            // Prefer the end of a slide (stars tucked into dead ends) and modest detours.
            const atEnd = k === cells.length - 1 ? 1.6 : 1;
            const want = 1 + P.diff * 3;
            const fit = extra <= 0 ? 0.25 : Math.exp(-Math.abs(extra - want) * 0.5) + 0.2;
            cand.push(c);
            cw.push(fit * atEnd);
            via.push(u * 4 + d);
          }
        }
      }
      if (!cand.length) {
        if (yLo > 1 || yHi < g.h - 2) {
          // Nothing reachable in this band: retry the same star over the whole level.
          bands[s] = [1, g.h - 2];
          s--;
        }
        continue;
      }
      const k = rng.weighted(cw, cw.length);
      items[cand[k]] = IT_STAR;
      starCells.push(cand[k]);
      const e = via[k];
      const u = e >> 2;
      const d = e & 3;
      cur = follow(cur, pathTo(par, cur, u));
      for (const c of edgeCells(g, u, d, cache)) routeCells[c] = 1;
      route.push(d);
      const r = an.res[u * 4 + d];
      if (r === R_GOAL) {
        cur = -1;
        break;
      }
      cur = target(r, an.start);
    }
  }
  if (cur >= 0) {
    // Finish: shortest way out from wherever the last star left us.
    let u = cur;
    while (an.distG[u] > 1) {
      let best = -1;
      for (let d = 0; d < 4; d++) {
        const t = target(an.res[u * 4 + d], an.start);
        if (t >= 0 && an.distG[t] === an.distG[u] - 1) {
          best = d;
          break;
        }
      }
      u = follow(u, [best]);
    }
    for (let d = 0; d < 4; d++) {
      if (an.res[u * 4 + d] === R_GOAL) {
        follow(u, [d]);
        break;
      }
    }
  }

  // Dots on every cell a slide can pass.
  const swept = sweptCells(g, an);
  for (const c of swept) {
    if (c === an.start || ((c / w) | 0) === 0 || items[c]) continue;
    items[c] = IT_DOT;
  }
  // Coins and powerups: mostly off the route, where exploring pays.
  const offRoute = swept.filter((c) => !routeCells[c] && items[c] === IT_DOT);
  const anyCell = swept.filter((c) => items[c] === IT_DOT);
  const place = (kind: number) => {
    const pool = offRoute.length && rng.chance(0.75) ? offRoute : anyCell;
    for (let tries = 0; tries < 20 && pool.length; tries++) {
      const c = rng.pick(pool);
      if (items[c] === IT_DOT) {
        items[c] = kind;
        return;
      }
    }
  };
  for (let i = 0; i < P.coins; i++) place(IT_COIN);
  for (let i = 0; i < P.powerups; i++) place(rng.pick([IT_SHIELD, IT_MAGNET, IT_FREEZE]));
  return { route, routeCells, par: route.length };
}

// --------------------------------------------------------- bounce pads ----

/** Bounce pads in open crossings. Each one is kept only if the level stays valid and the pad gets used. */
function placePads(g: Grid, rng: Rng, an: Analysis, count: number, minSol: number): Analysis {
  if (count <= 0) return an;
  const w = g.w;
  let swept = sweptCells(g, an);
  // Never near the doors, so the shafts between endless chunks stay straight.
  const cand = swept.filter((c) => {
    const x = c % w;
    const y = (c / w) | 0;
    if (c === an.start || y < 3 || y > g.h - 4) return false;
    return (g.floor(x - 1, y) || g.floor(x + 1, y)) && (g.floor(x, y - 1) || g.floor(x, y + 1));
  });
  rng.shuffle(cand);
  let placed = 0;
  for (const c of cand) {
    if (placed >= count) break;
    const x = c % w;
    const y = (c / w) | 0;
    let near = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.inside(x + dx, y + dy) && g.pads[(y + dy) * w + x + dx]) near = true;
    if (near) continue;
    for (const pad of rng.chance(0.5) ? [PAD_SLASH, PAD_BACKSLASH] : [PAD_BACKSLASH, PAD_SLASH]) {
      g.pads[c] = pad;
      const next = analyze(g, an.start);
      const ns = next.ok ? sweptCells(g, next) : [];
      if (next.ok && next.sol >= minSol && ns.length >= swept.length * 0.88 && ns.includes(c)) {
        an = next;
        swept = ns;
        placed++;
        break;
      }
      g.pads[c] = 0;
    }
  }
  return an;
}

// ------------------------------------------------------ state space ----

interface Edge {
  /** Cell and seal mask the slide starts from. */
  from: number;
  mask: number;
  cells: number[];
  dirs: number[];
  /** Target state (mask * cells + cell), or -1. */
  to: number;
  kind: number;
}

interface Explore {
  ok: boolean;
  sol: number;
  /** Cells Clawd can stand on in some reachable state. */
  nodeCells: Uint8Array;
  swept: Uint8Array;
  /** Axes slides travel along through each cell: bit 1 vertical, bit 2 horizontal. */
  axis: Uint8Array;
  edges: Edge[];
}

/**
 * Exact reachability over (cell, sealed blocks) states. With seals the maze
 * changes as you play, so every combination you can reach has to be able to
 * reach the exit, not just the starting layout.
 */
function explore(g: Grid, start: number, seals: number[]): Explore {
  const N = g.w * g.h;
  g.sealBit.fill(-1);
  seals.forEach((c, i) => (g.sealBit[c] = i));
  const S = N << seals.length;
  const dist = new Int32Array(S).fill(-1);
  const order = [start];
  dist[start] = 0;
  const edges: Edge[] = [];
  const fromState: number[] = [];
  let ok = true;
  for (let qi = 0; qi < order.length; qi++) {
    const st = order[qi];
    const m = Math.floor(st / N);
    const c = st % N;
    for (let d = 0; d < 4; d++) {
      const cells: number[] = [];
      const dirs: number[] = [];
      const r = trace(g, c % g.w, (c / g.w) | 0, d, m, (ci, di) => {
        cells.push(ci);
        dirs.push(di);
      });
      if (r === R_NONE) continue;
      if (r === R_LOOP) {
        ok = false;
        continue;
      }
      const nm = m | trBits;
      let to = -1;
      let kind = r;
      if (r >= 0) {
        if (g.spikes[r] & (1 << trDir)) kind = R_DEATH;
        else to = nm * N + r;
      } else if (r === R_BACK) to = nm * N + start;
      edges.push({ from: c, mask: m, cells, dirs, to, kind });
      fromState.push(st);
      if (to >= 0 && dist[to] < 0) {
        dist[to] = dist[st] + 1;
        order.push(to);
      }
    }
  }
  // Moves to the exit, backwards from every state with a slide out of the door.
  const goal = new Int32Array(S).fill(-1);
  const rev = new Map<number, number[]>();
  const queue: number[] = [];
  edges.forEach((e, i) => {
    const st = fromState[i];
    if (e.kind === R_GOAL && goal[st] < 0) {
      goal[st] = 1;
      queue.push(st);
    }
    if (e.to >= 0) {
      let l = rev.get(e.to);
      if (!l) rev.set(e.to, (l = []));
      l.push(st);
    }
  });
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (const u of rev.get(v) ?? []) {
      if (goal[u] < 0) {
        goal[u] = goal[v] + 1;
        queue.push(u);
      }
    }
  }
  for (const st of order) if (goal[st] < 0) ok = false;
  const nodeCells = new Uint8Array(N);
  for (const st of order) nodeCells[st % N] = 1;
  const swept = new Uint8Array(N);
  const axis = new Uint8Array(N);
  swept[start] = 1;
  for (const e of edges) {
    if (e.kind === R_DEATH) continue;
    e.cells.forEach((c, k) => {
      swept[c] = 1;
      axis[c] |= e.dirs[k] & 1 ? 2 : 1;
      if (g.pads[c]) axis[c] = 3;
    });
  }
  return { ok, sol: goal[start], nodeCells, swept, axis, edges };
}

/** Plays a route with sealing and checks every slide lands where it did without seals. */
function routeWorks(g: Grid, start: number, route: number[]): boolean {
  let c = start;
  let m = 0;
  for (const d of route) {
    const x = c % g.w;
    const y = (c / g.w) | 0;
    const free = trace(g, x, y, d, 0);
    const real = trace(g, x, y, d, m);
    if (real !== free || real === R_NONE || real === R_LOOP) return false;
    if (real >= 0 && g.spikes[real] & (1 << trDir)) return false;
    m |= trBits;
    if (real === R_GOAL) return true;
    c = real === R_BACK ? start : real;
  }
  return false;
}

/** Seal blocks on cells the star route slides over, kept only if no combination of sealed blocks can strand you. */
function placeSeals(g: Grid, rng: Rng, start: number, route: number[], count: number, items: Uint8Array): { seals: number[]; ex: Explore } {
  let seals: number[] = [];
  let ex = explore(g, start, seals);
  if (count <= 0) return { seals, ex };
  const w = g.w;
  const onRoute: number[] = [];
  let c = start;
  for (const d of route) {
    const r = trace(g, c % w, (c / w) | 0, d, 0, (ci) => onRoute.push(ci));
    if (r < 0) break;
    c = r;
  }
  const cand = [...new Set(onRoute)].filter((ci) => {
    const y = (ci / w) | 0;
    const x = ci % w;
    if (items[ci] > IT_DOT) return false;
    return y >= 2 && y <= g.h - 3 && !ex.nodeCells[ci] && !g.pads[ci] && Math.abs(x - (start % w)) + Math.abs(y - ((start / w) | 0)) > 3;
  });
  rng.shuffle(cand);
  for (const ci of cand) {
    if (seals.length >= count) break;
    if (seals.some((o) => Math.abs((o % w) - (ci % w)) + Math.abs(((o / w) | 0) - ((ci / w) | 0)) < 3)) continue;
    const trial = [...seals, ci];
    const ex2 = explore(g, start, trial);
    if (!ex2.ok || trial.some((o) => ex2.nodeCells[o]) || !routeWorks(g, start, route)) continue;
    seals = trial;
    ex = ex2;
  }
  ex = explore(g, start, seals);
  return { seals, ex };
}

// ------------------------------------------------------------ hazards ----

/**
 * Places every timed hazard under the same fairness rules:
 *  - bugs, gates, dart lines and snakes never cover a cell where Clawd can
 *    stand, so standing still is safe from them;
 *  - bugs and snakes patrol lanes slides only cross at right angles;
 *  - no single slide crosses two different timed hazards (each claims cells);
 *  - spike traps and puffers may reach stops, but every way out of such a stop
 *    is hazard-free, so leaving straight away is always safe.
 */
class Placer {
  readonly g: Grid;
  readonly ex: Explore;
  readonly w: number;
  readonly owner: Int16Array;
  readonly wait: number[] = [];
  readonly used: Uint8Array;
  readonly exits = new Map<number, number[][]>();
  readonly sealSet: Set<number>;
  readonly sx: number;
  readonly sy: number;
  readonly routeCells: Uint8Array;

  constructor(g: Grid, ex: Explore, start: number, seals: number[], routeCells: Uint8Array) {
    this.g = g;
    this.ex = ex;
    this.w = g.w;
    this.owner = new Int16Array(g.w * g.h).fill(-1);
    this.used = new Uint8Array(g.w * g.h);
    this.sealSet = new Set(seals);
    this.sx = start % g.w;
    this.sy = (start / g.w) | 0;
    this.routeCells = routeCells;
    for (const e of ex.edges) {
      if (e.kind === R_DEATH) continue;
      let l = this.exits.get(e.from);
      if (!l) this.exits.set(e.from, (l = []));
      l.push(e.cells);
    }
  }

  nearStart(x: number, y: number): boolean {
    return Math.abs(x - this.sx) <= 3 && Math.abs(y - this.sy) <= 3;
  }

  /** A floor cell a moving hazard may cover: passable, never stood on, no pad or seal. */
  free(x: number, y: number): boolean {
    const g = this.g;
    if (!g.inside(x, y) || y < 2) return false;
    const c = y * this.w + x;
    return this.ex.swept[c] === 1 && !this.ex.nodeCells[c] && !g.pads[c] && !this.sealSet.has(c) && !this.nearStart(x, y);
  }

  /** Claims cells for one hazard unless some slide would then cross two hazards. */
  claim(cells: number[], wait: number, reserveExitsOf: number[] = []): boolean {
    const mine = new Set(cells);
    for (const c of cells) if (this.owner[c] >= 0) return false;
    for (const e of this.ex.edges) {
      if (e.kind === R_DEATH || !e.cells.some((c) => mine.has(c))) continue;
      if (e.cells.some((c) => this.owner[c] >= 0 && !mine.has(c))) return false;
    }
    // Ways out of stops inside the danger zone must be hazard-free now and stay that way.
    const exitCells: number[] = [];
    for (const n of reserveExitsOf) {
      for (const p of this.exits.get(n) ?? []) {
        for (const c of p) {
          if (mine.has(c)) continue;
          if (this.owner[c] >= 0) return false;
          exitCells.push(c);
        }
      }
    }
    const id = this.wait.length;
    this.wait.push(wait);
    for (const c of cells) this.owner[c] = id;
    for (const c of exitCells) this.owner[c] = id;
    return true;
  }

  /** Keeps other hazards off these cells (the stretch of route you flee a saw along). */
  reserve(cells: number[]): void {
    const id = this.wait.length;
    this.wait.push(0);
    for (const c of cells) if (this.owner[c] < 0) this.owner[c] = id;
  }

  routeWeight(cells: number[]): number {
    let on = 0;
    for (const c of cells) on += this.routeCells[c];
    return 1 + (3 * on) / Math.max(1, cells.length);
  }
}

function placeBugs(pl: Placer, rng: Rng, P: GenParams): Bug[] {
  const { g, w, ex } = pl;
  const h = g.h;
  const bugs: Bug[] = [];
  if (P.bugs <= 0) return bugs;
  const segs: { horiz: boolean; line: number; a: number; b: number; wgt: number }[] = [];
  for (const horiz of [true, false]) {
    const lines = horiz ? h : w;
    const len = horiz ? w : h;
    const along = horiz ? 2 : 1;
    for (let line = 1; line < lines - 1; line++) {
      let a = -1;
      for (let k = 0; k <= len; k++) {
        const x = horiz ? k : line;
        const y = horiz ? line : k;
        const ok = k < len && pl.free(x, y) && !(ex.axis[y * w + x] & along) && pl.owner[y * w + x] < 0;
        if (ok && a < 0) a = k;
        if (!ok && a >= 0) {
          const b = k - 1;
          if (b - a >= 2) {
            const cells: number[] = [];
            for (let j = a; j <= b; j++) cells.push(horiz ? line * w + j : j * w + line);
            segs.push({ horiz, line, a, b, wgt: (b - a + 1) * pl.routeWeight(cells) });
          }
          a = -1;
        }
      }
    }
  }
  for (const s of segs) s.wgt *= 0.4 + rng.next();
  segs.sort((p, q) => q.wgt - p.wgt);
  for (const s of segs) {
    if (bugs.length >= P.bugs) break;
    const lane: number[] = [];
    for (let j = s.a; j <= s.b; j++) lane.push(s.horiz ? s.line * w + j : j * w + s.line);
    if (lane.some((c) => pl.used[c])) continue;
    const speed = 2 + 2.2 * P.diff + rng.range(-0.3, 0.4);
    if (!pl.claim(lane, (2 * (s.b - s.a)) / speed / 2 + 0.3)) continue;
    for (let j = s.a - 1; j <= s.b + 1; j++) {
      for (let o = -1; o <= 1; o++) {
        const x = s.horiz ? j : s.line + o;
        const y = s.horiz ? s.line + o : j;
        if (x >= 0 && x < w && y >= 0 && y < h) pl.used[y * w + x] = 1;
      }
    }
    bugs.push({ horiz: s.horiz, line: s.line, a: s.a, b: s.b, speed, phase: rng.next() });
  }
  return bugs;
}

function placeGates(pl: Placer, rng: Rng, P: GenParams): Gate[] {
  const { g, w } = pl;
  const gates: Gate[] = [];
  if (P.gates <= 0) return gates;
  const cand: number[] = [];
  const cw: number[] = [];
  for (let y = 2; y < g.h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      if (!pl.free(x, y) || pl.used[c] || pl.owner[c] >= 0) continue;
      const horiz = !g.floor(x, y - 1) && !g.floor(x, y + 1) && (g.floor(x - 1, y) || g.floor(x + 1, y));
      const vert = !g.floor(x - 1, y) && !g.floor(x + 1, y) && (g.floor(x, y - 1) || g.floor(x, y + 1));
      if (!horiz && !vert) continue;
      cand.push(c);
      cw.push(pl.routeCells[c] ? 3 : 1);
    }
  }
  while (gates.length < P.gates && cand.length) {
    const k = rng.weighted(cw, cw.length);
    const c = cand[k];
    cand.splice(k, 1);
    cw.splice(k, 1);
    const period = rng.range(1.5, 2.3) - P.diff * 0.2;
    const on = rng.range(0.38, 0.48);
    if (pl.used[c] || !pl.claim([c], period * on + 0.2)) continue;
    const x = c % w;
    const y = (c / w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.inside(x + dx, y + dy)) pl.used[(y + dy) * w + x + dx] = 1;
    gates.push({ x, y, horiz: !g.floor(x, y - 1) && !g.floor(x, y + 1), period, on, phase: rng.next() });
  }
  return gates;
}

/** Fish cannons: wall blocks that shoot darts across corridors you slide through. */
function placeTurrets(pl: Placer, rng: Rng, P: GenParams): Turret[] {
  const { g, w } = pl;
  const out: Turret[] = [];
  if (P.turrets <= 0) return out;
  const cand: { x: number; y: number; dir: number; cells: number[]; wgt: number }[] = [];
  for (let y = 2; y < g.h - 2; y++) {
    for (let x = 0; x < w; x++) {
      if (g.floor(x, y)) continue;
      for (let d = 0; d < 4; d++) {
        const cells: number[] = [];
        let cx = x + DX[d];
        let cy = y + DY[d];
        let ok = true;
        while (g.floor(cx, cy)) {
          if (!pl.free(cx, cy) || pl.owner[cy * w + cx] >= 0) ok = false;
          cells.push(cy * w + cx);
          cx += DX[d];
          cy += DY[d];
        }
        if (!ok || !cells.length || cells.length > 8 || cy <= 0) continue;
        cand.push({ x, y, dir: d, cells, wgt: pl.routeWeight(cells) * (0.4 + rng.next()) });
      }
    }
  }
  cand.sort((a, b) => b.wgt - a.wgt);
  for (const c of cand) {
    if (out.length >= P.turrets) break;
    if (c.cells.some((ci) => pl.used[ci]) || pl.used[c.y * w + c.x]) continue;
    const period = rng.range(1.1, 1.6) - 0.15 * P.diff;
    if (!pl.claim(c.cells, period * 0.6)) continue;
    for (const ci of [...c.cells, c.y * w + c.x]) pl.used[ci] = 1;
    out.push({ x: c.x, y: c.y, dir: c.dir, len: c.cells.length, period, phase: rng.next(), speed: 7 + 3 * P.diff });
  }
  return out;
}

/** Puffers: wall blocks that balloon over the 3x3 around them. */
function placePuffers(pl: Placer, rng: Rng, P: GenParams): Puffer[] {
  const { g, w, ex } = pl;
  const out: Puffer[] = [];
  if (P.puffers <= 0) return out;
  const cand: { x: number; y: number; zone: number[]; nodes: number[]; wgt: number }[] = [];
  for (let y = 2; y < g.h - 2; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (g.floor(x, y) || pl.used[y * w + x]) continue;
      const zone: number[] = [];
      const nodes: number[] = [];
      let bad = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const zx = x + dx;
          const zy = y + dy;
          if (!g.floor(zx, zy)) continue;
          const c = zy * w + zx;
          if (pl.nearStart(zx, zy) || zy < 2 || g.pads[c] || pl.sealSet.has(c) || pl.used[c]) bad = true;
          if (ex.swept[c]) zone.push(c);
          if (ex.nodeCells[c]) nodes.push(c);
        }
      }
      if (bad || zone.length < 2) continue;
      cand.push({ x, y, zone, nodes, wgt: pl.routeWeight(zone) * (0.4 + rng.next()) });
    }
  }
  cand.sort((a, b) => b.wgt - a.wgt);
  for (const c of cand) {
    if (out.length >= P.puffers) break;
    if (c.zone.some((ci) => pl.used[ci])) continue;
    const period = rng.range(2.6, 3.4);
    const on = rng.range(0.9, 1.2) / period;
    if (!pl.claim(c.zone, period * on + 0.3, c.nodes)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.inside(c.x + dx, c.y + dy)) pl.used[(c.y + dy) * w + c.x + dx] = 1;
    out.push({ x: c.x, y: c.y, period, on, phase: rng.next() });
  }
  return out;
}

/** Spike-trap blocks: wall cells whose faces fire spikes half a second after you move next to them. */
function placeTraps(pl: Placer, rng: Rng, P: GenParams): Trap[] {
  const { g, w, ex } = pl;
  const out: Trap[] = [];
  if (P.traps <= 0) return out;
  const cand: { x: number; y: number; zone: number[]; nodes: number[]; wgt: number }[] = [];
  for (let y = 2; y < g.h - 2; y++) {
    for (let x = 0; x < w; x++) {
      if (g.floor(x, y) || pl.used[y * w + x]) continue;
      const zone: number[] = [];
      const nodes: number[] = [];
      let bad = false;
      for (let d = 0; d < 4; d++) {
        const zx = x + DX[d];
        const zy = y + DY[d];
        if (!g.floor(zx, zy)) continue;
        const c = zy * w + zx;
        if (pl.nearStart(zx, zy) || zy < 2 || pl.used[c] || g.spikes[c] & (1 << opp(d)) || pl.sealSet.has(c)) bad = true;
        zone.push(c);
        if (ex.nodeCells[c]) nodes.push(c);
      }
      if (bad || !zone.some((c) => ex.swept[c])) continue;
      cand.push({ x, y, zone, nodes, wgt: pl.routeWeight(zone) * (0.4 + rng.next()) * (nodes.length ? 1.5 : 1) });
    }
  }
  cand.sort((a, b) => b.wgt - a.wgt);
  for (const c of cand) {
    if (out.length >= P.traps) break;
    if (c.zone.some((ci) => pl.used[ci])) continue;
    if (!pl.claim(c.zone, TRAP_DELAY + TRAP_OUT + 0.2, c.nodes)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.inside(c.x + dx, c.y + dy)) pl.used[(c.y + dy) * w + c.x + dx] = 1;
    out.push({ x: c.x, y: c.y });
  }
  return out;
}

/** Snakes burst out of one wall and cross corridors (only at right angles to how you slide them). */
function placeSnakes(pl: Placer, rng: Rng, P: GenParams): Snake[] {
  const { g, w, ex } = pl;
  const out: Snake[] = [];
  if (P.snakes <= 0) return out;
  const cand: { horiz: boolean; line: number; a: number; b: number; floor: number[]; wgt: number }[] = [];
  for (const horiz of [true, false]) {
    const lines = horiz ? g.h : w;
    const len = horiz ? w : g.h;
    const along = horiz ? 2 : 1;
    for (let line = horiz ? 3 : 1; line < lines - (horiz ? 3 : 1); line++) {
      const at = (k: number) => (horiz ? line * w + k : k * w + line);
      const lo = horiz ? 0 : 3;
      const hi = horiz ? len - 1 : len - 4;
      for (let a = lo; a <= hi; a++) {
        if (g.cells[at(a)]) continue;
        const floor: number[] = [];
        for (let b = a + 1; b <= Math.min(hi, a + 12); b++) {
          const c = at(b);
          if (g.cells[c]) {
            const x = c % w;
            const y = (c / w) | 0;
            if (!pl.free(x, y) || ex.axis[c] & along || pl.owner[c] >= 0 || pl.used[c]) break;
            floor.push(c);
            continue;
          }
          // b is a wall: a complete burst from wall a to wall b.
          if (floor.length >= 2 && b - a >= 4) {
            let corridors = 0;
            for (let k = a + 1; k <= b; k++) if (g.cells[at(k)] && !g.cells[at(k - 1)]) corridors++;
            if (corridors >= 2) cand.push({ horiz, line, a, b, floor: floor.slice(), wgt: corridors * pl.routeWeight(floor) * (0.4 + rng.next()) });
          }
        }
      }
    }
  }
  cand.sort((p, q) => q.wgt - p.wgt);
  for (const c of cand) {
    if (out.length >= P.snakes) break;
    if (c.floor.some((ci) => pl.used[ci])) continue;
    const speed = 5 + 2 * P.diff;
    const body = 3;
    const travel = (c.b - c.a + body) / speed;
    if (!pl.claim(c.floor, SNAKE_WARN + travel)) continue;
    for (const ci of c.floor) pl.used[ci] = 1;
    const fwd = rng.chance(0.5);
    out.push({
      horiz: c.horiz,
      line: c.line,
      a: fwd ? c.a : c.b,
      b: fwd ? c.b : c.a,
      body,
      speed,
      period: SNAKE_WARN + travel + rng.range(2.4, 3.6),
      phase: rng.next(),
    });
  }
  return out;
}

interface Timeline {
  /** Per route move: time it starts, cells entered with times. */
  moves: { t0: number; cells: number[]; times: number[] }[];
  end: number;
}

/** The star route played at a careful human pace (pause before each slide), with sealing. */
function routeTimeline(g: Grid, start: number, route: number[], pause: number, waitFor: (cells: number[]) => number): Timeline {
  const moves: Timeline['moves'] = [];
  let t = 0;
  let c = start;
  let m = 0;
  for (const d of route) {
    const cells: number[] = [];
    const r = trace(g, c % g.w, (c / g.w) | 0, d, m, (ci) => cells.push(ci));
    t += pause + waitFor(cells);
    const times = cells.map((_, k) => t + moveTime(k + 0.5));
    moves.push({ t0: t, cells, times });
    t += moveTime(cells.length);
    m |= trBits;
    if (r === R_GOAL || r < 0) break;
    c = r;
  }
  return { moves, end: t };
}

/**
 * Saws: dormant in a wall until Clawd crosses their line of sight, then they
 * copy his path. A saw is kept only if the star route, played at a careful pace
 * without waiting for anything, stays ahead of it until it crashes into a seal
 * block or gives up.
 */
function placeSaws(pl: Placer, rng: Rng, P: GenParams, start: number, route: number[], seals: number[]): SawSpec[] {
  const { g, w, ex } = pl;
  const out: SawSpec[] = [];
  if (P.saws <= 0) return out;
  const cand: SawSpec[] = [];
  for (let y = 3; y < g.h - 3; y++) {
    for (let x = 0; x < w; x++) {
      if (g.floor(x, y)) continue;
      for (let d = 0; d < 4; d++) {
        const ex2 = x + DX[d];
        const ey = y + DY[d];
        const c = ey * w + ex2;
        if (!g.floor(ex2, ey) || !ex.swept[c] || pl.nearStart(ex2, ey) || g.pads[c] || pl.sealSet.has(c)) continue;
        cand.push({ hx: x, hy: y, ex: ex2, ey });
      }
    }
  }
  rng.shuffle(cand);
  const tl = routeTimeline(g, start, route, 0.45, () => 0);
  const sealOf = new Map(seals.map((c, i) => [c, i]));
  // Like the original's levels: a saw should wake a few slides before a seal block
  // the route crosses, so leading it over the seal is the way to break it.
  const moveOf = new Map<number, number>();
  tl.moves.forEach((mv, i) => mv.cells.forEach((c) => moveOf.has(c) || moveOf.set(c, i)));
  const sealMoves = seals.map((c) => moveOf.get(c) ?? -99);
  const rank = (sp: SawSpec): number => {
    const i = moveOf.get(sp.ey * w + sp.ex);
    if (i === undefined) return 0;
    return sealMoves.some((j) => j > i && j <= i + 4) ? 2 : 1;
  };
  cand.sort((a, b) => rank(b) - rank(a));
  let tries = 0;
  for (const spec of cand) {
    if (out.length >= P.saws || tries++ > 140) break;
    if (out.some((o) => Math.abs(o.hx - spec.hx) + Math.abs(o.hy - spec.hy) < 6)) continue;
    if (pl.used[spec.hy * w + spec.hx]) continue;
    const chase: number[] = [];
    const verdict = sawFair(g, start, tl, spec, sealOf, pl.owner, chase);
    if (verdict !== 'broken' && !(verdict === 'timeout' && rng.chance(0.35))) continue;
    out.push(spec);
    pl.used[spec.hy * w + spec.hx] = 1;
    // Nothing that makes you wait may sit where you run from the saw.
    pl.reserve(chase);
  }
  return out;
}

/** Plays the route timeline against one saw; also reports which route moves happen during the chase. */
function sawFair(g: Grid, start: number, tl: Timeline, spec: SawSpec, sealOf: Map<number, number>, owner: Int16Array, chase: number[]): string {
  const w = g.w;
  const H = emptyHazards();
  const saw = newSaw(spec);
  H.saws.push(saw);
  let sealed = 0;
  const open = (x: number, y: number): boolean => {
    if (!g.floor(x, y)) return false;
    const b = sealOf.get(y * w + x);
    return b === undefined || !((sealed >> b) & 1);
  };
  const pending: number[] = [];
  let px = start % w;
  let py = (start / w) | 0;
  let t = 0;
  const dt = 1 / 60;
  const stepTo = (until: number, pos: (t: number) => [number, number] | null): boolean => {
    while (t < until) {
      t = Math.min(until, t + dt);
      const p = pos(t);
      if (p) [px, py] = p;
      for (let i = pending.length - 1; i >= 0; i--) {
        const c = pending[i];
        if (Math.abs((c % w) - px) + Math.abs(((c / w) | 0) - py) >= 1) {
          sealed |= 1 << (sealOf.get(c) ?? 0);
          pending.splice(i, 1);
        }
      }
      advanceSaws(H, t, dt, open);
      // The real hit box is 0.6 per axis; keep a wide margin.
      if (saw.mode === 1 && Math.max(Math.abs(saw.x - px), Math.abs(saw.y - py)) < 1.15) return false;
    }
    return true;
  };
  for (const mv of tl.moves) {
    if (!stepTo(mv.t0, () => null)) return 'caught';
    if (saw.mode === 1 && mv.cells.some((c) => owner[c] >= 0)) return 'caught';
    // While a saw chases, the way on must not cross the trail it is following.
    if (saw.mode === 1 && mv.cells.some((c) => chase.includes(c))) return 'crossing';
    if (saw.mode === 1) chase.push(...mv.cells);
    const fx = px;
    const fy = py;
    let k = 0;
    const path = mv.cells;
    const ok = stepTo(mv.t0 + moveTime(path.length), (tt) => {
      const dist = Math.min(path.length, moveDist(tt - mv.t0));
      while (k < path.length && dist >= k + 0.5) {
        const c = path[k];
        onPlayerCell(H, c % w, (c / w) | 0, tt, open);
        if (sealOf.has(c)) pending.push(c);
        k++;
      }
      const i = Math.floor(dist);
      const f = dist - i;
      const a = i === 0 ? [fx, fy] : [path[i - 1] % w, (path[i - 1] / w) | 0];
      const b = i < path.length ? [path[i] % w, (path[i] / w) | 0] : a;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    });
    if (!ok) return 'caught';
  }
  if (saw.mode === 0) return 'asleep';
  if (saw.mode === 1) {
    // Still chasing when the route ends: it would be right behind you at the door.
    return 'caught';
  }
  return saw.endAt - saw.wokeAt < 11.5 ? 'broken' : 'timeout';
}

/** Rows per second at which the flood still leaves the par route comfortable. */
function floodFor(g: Grid, start: number, route: number[], diff: number, delay: number, owner: Int16Array, wait: number[]): number {
  const w = g.w;
  const tl = routeTimeline(g, start, route, 0.55, (cells) => {
    let most = 0;
    for (const c of cells) if (owner[c] >= 0) most = Math.max(most, wait[owner[c]]);
    return most;
  });
  let worst = Infinity;
  for (const mv of tl.moves) {
    let maxY = 0;
    for (const c of mv.cells) maxY = Math.max(maxY, (c / w) | 0);
    const t = mv.t0 + moveTime(mv.cells.length);
    // The flood surface starts at the bottom edge (y = h) and must stay 2.5 rows below the player.
    if (t > delay) worst = Math.min(worst, (g.h - maxY - 2.5) / (t - delay));
  }
  if (!isFinite(worst) || worst <= 0) return 0.3;
  const slack = 0.62 + 0.18 * diff;
  return Math.max(0.3, Math.min(worst * slack, 1.6 + diff));
}

// ------------------------------------------------------------ generate ----

function score(g: Grid, an: Analysis, rows: number): { score: number; decisions: number; floor: number } {
  const w = g.w;
  let floor = 0;
  let open2 = 0;
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      floor += g.cells[c];
      if (y < g.h - 2 && x < w - 2 && g.cells[c] && g.cells[c + 1] && g.cells[c + w] && g.cells[c + w + 1]) open2++;
    }
  }
  let decisions = 0;
  for (const u of an.nodes) {
    const ts = new Set<number>();
    for (let d = 0; d < 4; d++) {
      const r = an.res[u * 4 + d];
      if (r !== R_NONE && r !== R_DEATH) ts.add(r);
    }
    if (ts.size >= 3) decisions++;
  }
  const interior = (w - 2) * rows;
  const ratio = floor / interior;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const s =
    1.6 * clamp(an.sol / (rows * 0.4)) +
    1.0 * clamp(decisions / (rows * 0.35)) +
    0.8 * clamp(an.nodes.length / (rows * 1.3)) -
    5 * Math.max(0, ratio - 0.5) -
    5 * Math.max(0, 0.25 - ratio) -
    (0.6 * open2) / rows;
  return { score: s, decisions, floor };
}

export function generate(P: GenParams): Level {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const h = P.rows + 2;
  let best: { g: Grid; an: Analysis; s: number; decisions: number; floor: number } | null = null;
  let attempts = 0;
  let found = 0;
  for (let k = 0; found < P.candidates && attempts < P.candidates * 12; k++) {
    attempts++;
    const rng = new Rng(hash(P.seed, 'cand', k));
    const g = new Grid(h, P.entryX);
    const start = spine(g, rng, P);
    if (start < 0) continue;
    let an = analyze(g, start);
    if (!an.ok) continue;
    const minSol = Math.max(3, Math.floor(an.sol * 0.7));
    an = grow(g, rng, P, an, minSol);
    found++;
    const sc = score(g, an, P.rows);
    if (!best || sc.score > best.s) best = { g, an, s: sc.score, decisions: sc.decisions, floor: sc.floor };
  }
  if (!best) {
    // Practically unreachable: fall back to a plain zig-zag that is always valid.
    return generate({ ...P, seed: hash(P.seed, 'retry'), candidates: Math.max(1, P.candidates), growth: P.growth >> 1 });
  }
  const { g } = best;
  let { an } = best;
  const rng = new Rng(hash(P.seed, 'decor'));
  an = placePads(g, rng, an, P.pads, Math.max(3, Math.floor(an.sol * 0.8)));
  an = placeSpikes(g, rng, an, P.spikes, Math.max(3, Math.floor(an.sol * 0.85)));
  // Floor that no slide can enter becomes wall again: it changes no reachable slide.
  const passable = new Uint8Array(g.w * g.h);
  for (const c of sweptCells(g, an)) passable[c] = 1;
  // Slides that end on spikes must keep their length, or they would stop somewhere safe instead.
  for (const u of an.nodes) for (let d = 0; d < 4; d++) if (an.res[u * 4 + d] === R_DEATH) walk(g, u, d, (c) => (passable[c] = 1));
  if (P.entryX >= 0) passable[(g.h - 1) * g.w + P.entryX] = 1;
  for (let c = 0; c < g.cells.length; c++) if (g.cells[c] && !passable[c]) g.cells[c] = 0;
  for (let c = 0; c < g.cells.length; c++) if (!g.cells[c]) g.pads[c] = 0;
  const items = new Uint8Array(g.w * g.h);
  const pl = placeItems(g, rng, P, an, items);
  const { seals, ex } = placeSeals(g, rng, an.start, pl.route, P.seals, items);
  // A seal can wall off a few cells that were only reachable by coming back through it.
  for (let c = 0; c < items.length; c++) if (items[c] && items[c] !== IT_STAR && !ex.swept[c]) items[c] = 0;
  const placer = new Placer(g, ex, an.start, seals, pl.routeCells);
  // Saws first (their escape route must stay clear), then the rarer, more dramatic hazards.
  const saws = placeSaws(placer, rng, P, an.start, pl.route, seals);
  const snakes = placeSnakes(placer, rng, P);
  const bugs = placeBugs(placer, rng, P);
  const puffers = placePuffers(placer, rng, P);
  const traps = placeTraps(placer, rng, P);
  const turrets = placeTurrets(placer, rng, P);
  const gates = placeGates(placer, rng, P);
  const floodDelay = 2.5;
  const floodSpeed = P.flood ? floodFor(g, an.start, pl.route, P.diff, floodDelay, placer.owner, placer.wait) : 0;
  let dots = 0;
  for (const it of items) if (it === IT_DOT) dots++;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    w: g.w,
    h: g.h,
    cells: g.cells,
    items,
    spikes: g.spikes,
    pads: g.pads,
    seals,
    doorX: g.doorX,
    entryX: P.entryX,
    startX: an.start % g.w,
    startY: (an.start / g.w) | 0,
    bugs,
    gates,
    traps,
    turrets,
    puffers,
    snakes,
    saws,
    floodSpeed,
    floodDelay,
    route: pl.route,
    seed: P.seed,
    stats: {
      sol: an.sol,
      par: pl.par,
      nodes: an.nodes.length,
      decisions: best.decisions,
      floor: best.floor,
      dots,
      score: best.s,
      candidates: found,
      attempts,
      ms: t1 - t0,
    },
  };
}

// ------------------------------------------------------- difficulty ----

/** Stage where each mechanic first appears (one new thing every stage or two, like the original). */
export const INTRO = {
  spikes: 2,
  powerups: 3,
  bugs: 4,
  flood: 5,
  traps: 6,
  gates: 7,
  seals: 8,
  pads: 10,
  turrets: 12,
  puffers: 14,
  saws: 17,
  snakes: 18,
} as const;

/** Stage n (1-based). After its introduction each hazard shows up in most stages, not all. */
export function stageParams(n: number): GenParams {
  const s = Math.max(1, Math.floor(n));
  const t = Math.min(1, (s - 1) / 59);
  const rows = Math.round(Math.min(22 + s * 1.15, 92) + (s > 60 ? Math.min(26, (s - 60) * 0.4) : 0));
  const mix = new Rng(hash('tomb-of-the-token/mix', s));
  // On its own stage a mechanic is guaranteed; afterwards it appears with probability p.
  const pick = (key: keyof typeof INTRO, p: number, count: number) =>
    s < INTRO[key] ? 0 : s === INTRO[key] ? Math.max(1, count) : mix.chance(p) ? count : 0;
  return {
    seed: hash('tomb-of-the-token/stage', s),
    rows,
    entryX: -1,
    diff: t,
    spikes: s < 2 ? 0 : Math.round(1 + rows * (0.03 + 0.07 * t)),
    bugs: pick('bugs', 0.7, Math.round(1 + rows * (0.01 + 0.03 * t))),
    gates: pick('gates', 0.6, Math.round(1 + rows * (0.006 + 0.02 * t))),
    traps: pick('traps', 0.7, Math.round(1 + rows * (0.012 + 0.03 * t))),
    turrets: pick('turrets', 0.6, Math.round(1 + rows * (0.008 + 0.025 * t))),
    puffers: pick('puffers', 0.55, Math.round(1 + rows * (0.006 + 0.02 * t))),
    snakes: pick('snakes', 0.45, Math.round(rows * (0.012 + 0.015 * t))),
    saws: pick('saws', 0.5, 1 + Math.round(rows * 0.012 * t)),
    seals: s >= INTRO.saws ? 2 + Math.round(2 * t) : pick('seals', 0.6, 2 + Math.round(2 * t)),
    pads: pick('pads', 0.55, Math.round(1 + rows * (0.02 + 0.03 * t))),
    coins: 3 + Math.round(rows / 10),
    powerups: s < INTRO.powerups ? 0 : s < 15 ? 1 : 2,
    stars: true,
    flood: s === INTRO.flood || (s > INTRO.flood && s % 3 !== 1),
    growth: Math.round(rows * (4 + 2 * t)),
    candidates: rows < 50 ? 6 : 4,
    down: 0.04 + 0.12 * t,
    gateDoor: true,
  };
}

export const CHUNK_ROWS = 24;

/** Endless mode chunk k (0 = bottom). Seals and saws are stage-only. */
export function chunkParams(k: number, entryX: number, runSeed: number): GenParams {
  const t = Math.min(1, k / 30);
  const rows = CHUNK_ROWS;
  const mix = new Rng(hash('tomb-of-the-token/endless-mix', runSeed, k));
  const maybe = (from: number, p: number, count: number) => (k >= from && mix.chance(p) ? count : 0);
  return {
    seed: hash('tomb-of-the-token/endless', runSeed, k),
    rows,
    entryX: k === 0 ? -1 : entryX,
    diff: t,
    spikes: k === 0 ? 0 : Math.round(1 + rows * (0.03 + 0.06 * t)),
    bugs: maybe(2, 0.7, Math.round(rows * (0.02 + 0.04 * t))),
    gates: maybe(4, 0.5, Math.round(rows * (0.01 + 0.03 * t))),
    traps: maybe(3, 0.6, Math.round(1 + rows * 0.03 * t)),
    turrets: maybe(5, 0.5, 1 + Math.round(rows * 0.03 * t)),
    puffers: maybe(6, 0.45, 1 + Math.round(rows * 0.02 * t)),
    snakes: maybe(8, 0.35, 1),
    saws: 0,
    seals: 0,
    pads: maybe(3, 0.5, 1 + Math.round(2 * t)),
    coins: 3,
    powerups: k > 0 && k % 2 === 0 ? 1 : 0,
    stars: false,
    flood: false,
    growth: Math.round(rows * 4.5),
    candidates: 3,
    down: 0.05 + 0.1 * t,
    gateDoor: false,
  };
}

/** One long tomb per calendar day, the same for everyone. */
export function dailyParams(dateKey: string): GenParams {
  const p = stageParams(30);
  const mix = new Rng(hash('tomb-of-the-token/daily-mix', dateKey));
  return {
    ...p,
    seed: hash('tomb-of-the-token/daily', dateKey),
    rows: 70,
    flood: true,
    diff: 0.55,
    candidates: 6,
    bugs: 2,
    gates: mix.int(0, 2),
    traps: mix.int(1, 3),
    turrets: mix.int(1, 2),
    puffers: mix.int(0, 2),
    snakes: mix.int(0, 1),
    saws: mix.int(0, 1),
    seals: 3,
    pads: mix.int(1, 3),
  };
}

/** ASCII dump for tests and debugging. */
export function toAscii(L: Level): string {
  const out: string[] = [];
  const ch = ['', '.', 'c', '*', 'S', 'M', 'F'];
  const mark = new Map<number, string>();
  for (const b of L.bugs) for (let j = b.a; j <= b.b; j++) mark.set(b.horiz ? b.line * L.w + j : j * L.w + b.line, 'b');
  for (const g of L.gates) mark.set(g.y * L.w + g.x, '|');
  for (const c of L.seals) mark.set(c, 'o');
  for (const t of L.traps) mark.set(t.y * L.w + t.x, 'T');
  for (const p of L.puffers) mark.set(p.y * L.w + p.x, 'P');
  for (const t of L.turrets) mark.set(t.y * L.w + t.x, '>^<v'[[1, 0, 3, 2].indexOf(t.dir)] ?? 'G');
  for (const s of L.saws) mark.set(s.hy * L.w + s.hx, 'X');
  for (let y = 0; y < L.h; y++) {
    let row = '';
    for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      const m = mark.get(i);
      if (!L.cells[i]) {
        row += m ?? '#';
        continue;
      }
      if (x === L.startX && y === L.startY) row += '@';
      else if (y === 0) row += 'E';
      else if (m) row += m;
      else if (L.pads[i]) row += L.pads[i] === PAD_SLASH ? '/' : '\\';
      else if (L.spikes[i]) row += '^';
      else row += L.items[i] ? ch[L.items[i]] : ' ';
    }
    out.push(row);
  }
  return out.join('\n');
}
