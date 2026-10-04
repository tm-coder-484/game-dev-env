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

export const W = 15;
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];
export const opp = (d: number): number => (d + 2) & 3;

export const IT_NONE = 0;
export const IT_DOT = 1;
export const IT_COIN = 2;
export const IT_STAR = 3;
export const IT_SHIELD = 4;
export const IT_MAGNET = 5;
export const IT_FREEZE = 6;

/** Slide results: >= 0 is the cell index where the slide stops. */
export const R_NONE = -1;
export const R_GOAL = -2;
export const R_BACK = -3;
export const R_DEATH = -4;

/** Slide motion, shared by the game, the bot and the flood timing. Tiles and seconds. */
export const MOVE = { v0: 12, accel: 220, vmax: 30 };
const T_ACC = (MOVE.vmax - MOVE.v0) / MOVE.accel;
const D_ACC = MOVE.v0 * T_ACC + 0.5 * MOVE.accel * T_ACC * T_ACC;

export function moveDist(t: number): number {
  if (t <= 0) return 0;
  if (t < T_ACC) return MOVE.v0 * t + 0.5 * MOVE.accel * t * t;
  return D_ACC + MOVE.vmax * (t - T_ACC);
}

export function moveTime(len: number): number {
  if (len <= D_ACC) return (-MOVE.v0 + Math.sqrt(MOVE.v0 * MOVE.v0 + 2 * MOVE.accel * len)) / MOVE.accel;
  return T_ACC + (len - D_ACC) / MOVE.vmax;
}

export interface Bug {
  horiz: boolean;
  /** Fixed row (horizontal bug) or column (vertical bug). */
  line: number;
  a: number;
  b: number;
  speed: number;
  phase: number;
}

export interface Gate {
  x: number;
  y: number;
  /** True when the corridor runs left-right (the beam is vertical). */
  horiz: boolean;
  period: number;
  on: number;
  phase: number;
}

export interface Trap {
  x: number;
  y: number;
  face: number;
}

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
  bugs: Bug[];
  gates: Gate[];
  traps: Trap[];
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
  doorX = -1;

  constructor(h: number, entryX: number) {
    this.h = h;
    this.entryX = entryX;
    const n = this.w * h;
    this.cells = new Uint8Array(n);
    this.spikes = new Uint8Array(n);
    this.lockW = new Uint8Array(n);
    this.lockF = new Uint8Array(n);
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

  save(): [Uint8Array, Uint8Array, Uint8Array, Uint8Array, number] {
    return [this.cells.slice(), this.spikes.slice(), this.lockW.slice(), this.lockF.slice(), this.doorX];
  }

  load(s: [Uint8Array, Uint8Array, Uint8Array, Uint8Array, number]): void {
    this.cells.set(s[0]);
    this.spikes.set(s[1]);
    this.lockW.set(s[2]);
    this.lockF.set(s[3]);
    this.doorX = s[4];
  }
}

/** Where a slide from (x, y) in direction d ends. */
function slide(g: Grid, x: number, y: number, d: number): number {
  const w = g.w;
  const dx = DX[d];
  const dy = DY[d];
  let cx = x;
  let cy = y;
  let n = 0;
  for (;;) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= g.h || g.cells[ny * w + nx] === 0) break;
    cx = nx;
    cy = ny;
    n++;
    if (cy === 0) return R_GOAL;
    if (cy === g.h - 1) return R_BACK;
  }
  if (n === 0) return R_NONE;
  const i = cy * w + cx;
  return g.spikes[i] & (1 << d) ? R_DEATH : i;
}

/** Calls fn for every cell a slide passes through (not the cell it starts on). */
function walk(g: Grid, u: number, d: number, fn: (i: number) => void): void {
  const w = g.w;
  let cx = u % w;
  let cy = (u / w) | 0;
  for (;;) {
    const nx = cx + DX[d];
    const ny = cy + DY[d];
    if (nx < 0 || nx >= w || ny < 0 || ny >= g.h || g.cells[ny * w + nx] === 0) return;
    cx = nx;
    cy = ny;
    fn(cy * w + cx);
    if (cy === 0 || cy === g.h - 1) return;
  }
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
  for (let qi = 0; qi < nodes.length; qi++) {
    const u = nodes[qi];
    const ux = u % w;
    const uy = (u / w) | 0;
    for (let d = 0; d < 4; d++) {
      const r = slide(g, ux, uy, d);
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
  let ok = distG[start] > 0;
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
      walk(g, u, d, add);
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

function placeMovers(
  g: Grid,
  rng: Rng,
  P: GenParams,
  an: Analysis,
  pl: Placement,
): { bugs: Bug[]; gates: Gate[]; traps: Trap[]; owner: Int16Array } {
  const w = g.w;
  const h = g.h;
  const isNode = new Uint8Array(w * h);
  for (const u of an.nodes) isNode[u] = 1;
  const swept = new Uint8Array(w * h);
  for (const c of sweptCells(g, an)) swept[c] = 1;
  // Which axes slides travel along through each cell: bit 1 = vertical, bit 2 = horizontal.
  const axis = new Uint8Array(w * h);
  for (const u of an.nodes) {
    for (let d = 0; d < 4; d++) {
      const r = an.res[u * 4 + d];
      if (r === R_NONE || r === R_DEATH) continue;
      const bit = d & 1 ? 2 : 1;
      walk(g, u, d, (c) => {
        axis[c] |= bit;
      });
    }
  }
  const used = new Uint8Array(w * h);
  // Every reachable slide's cells, to keep each slide to one moving hazard at most.
  const paths: number[][] = [];
  for (const u of an.nodes) {
    for (let d = 0; d < 4; d++) {
      const r = an.res[u * 4 + d];
      if (r === R_NONE || r === R_DEATH) continue;
      const cells: number[] = [];
      walk(g, u, d, (c) => cells.push(c));
      paths.push(cells);
    }
  }
  const owner = new Int16Array(w * h).fill(-1);
  let nextOwner = 0;
  const claim = (cells: number[]): boolean => {
    const mine = new Set(cells);
    for (const p of paths) {
      if (!p.some((c) => mine.has(c))) continue;
      if (p.some((c) => owner[c] >= 0 && !mine.has(c))) return false;
    }
    const id = nextOwner++;
    for (const c of cells) owner[c] = id;
    return true;
  };
  const sx = an.start % w;
  const sy = (an.start / w) | 0;
  const nearStart = (x: number, y: number) => Math.abs(x - sx) <= 3 && Math.abs(y - sy) <= 3;
  const free = (x: number, y: number) =>
    g.inside(x, y) && y >= 2 && swept[y * w + x] === 1 && !isNode[y * w + x] && !nearStart(x, y);

  // Bugs patrol lanes that slides only ever cross at right angles, so getting
  // past one is a matter of timing (a slide along a bug's lane could never dodge it).
  const bugs: Bug[] = [];
  if (P.bugs > 0) {
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
          const ok = k < len && free(x, y) && !(axis[y * w + x] & along);
          if (ok && a < 0) a = k;
          if (!ok && a >= 0) {
            const b = k - 1;
            if (b - a >= 2) {
              let onRoute = 0;
              for (let j = a; j <= b; j++) onRoute += pl.routeCells[horiz ? line * w + j : j * w + line];
              segs.push({ horiz, line, a, b, wgt: (b - a + 1) * (1 + (2 * onRoute) / (b - a + 1)) });
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
      let clash = false;
      for (let j = s.a; j <= s.b && !clash; j++) {
        const c = s.horiz ? s.line * w + j : j * w + s.line;
        if (used[c]) clash = true;
      }
      if (clash) continue;
      const lane: number[] = [];
      for (let j = s.a; j <= s.b; j++) lane.push(s.horiz ? s.line * w + j : j * w + s.line);
      if (!claim(lane)) continue;
      for (let j = s.a - 1; j <= s.b + 1; j++) {
        for (let o = -1; o <= 1; o++) {
          const x = s.horiz ? j : s.line + o;
          const y = s.horiz ? s.line + o : j;
          if (x >= 0 && x < w && y >= 0 && y < h) used[y * w + x] = 1;
        }
      }
      bugs.push({
        horiz: s.horiz,
        line: s.line,
        a: s.a,
        b: s.b,
        speed: 2 + 2.2 * P.diff + rng.range(-0.3, 0.4),
        phase: rng.next(),
      });
    }
  }

  // Laser gates across one-wide corridors.
  const gates: Gate[] = [];
  if (P.gates > 0) {
    const cand: number[] = [];
    const cw: number[] = [];
    for (let y = 2; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const c = y * w + x;
        if (!free(x, y) || used[c]) continue;
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
      if (used[c] || !claim([c])) continue;
      const x = c % w;
      const y = (c / w) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (g.inside(x + dx, y + dy)) used[(y + dy) * w + x + dx] = 1;
      gates.push({
        x,
        y,
        horiz: !g.floor(x, y - 1) && !g.floor(x, y + 1),
        period: rng.range(1.5, 2.3) - P.diff * 0.2,
        on: rng.range(0.38, 0.48),
        phase: rng.next(),
      });
    }
  }

  // Pop-out spike traps on stops whose every exit is free of movers, so leaving at once is always safe.
  const traps: Trap[] = [];
  if (P.traps > 0) {
    const cand = an.nodes.filter((u) => {
      const y = (u / w) | 0;
      if (u === an.start || y <= 1 || nearStart(u % w, y)) return false;
      for (let d = 0; d < 4; d++) {
        const r = an.res[u * 4 + d];
        if (r === R_NONE || r === R_DEATH) continue;
        let bad = false;
        walk(g, u, d, (c) => {
          if (used[c]) bad = true;
        });
        if (bad) return false;
      }
      return true;
    });
    const cw = cand.map((u) => (pl.routeCells[u] ? 3 : 1));
    while (traps.length < P.traps && cand.length) {
      const k = rng.weighted(cw, cw.length);
      const u = cand[k];
      cand.splice(k, 1);
      cw.splice(k, 1);
      const x = u % w;
      const y = (u / w) | 0;
      if (traps.some((t) => Math.abs(t.x - x) + Math.abs(t.y - y) < 3)) continue;
      const faces = [0, 1, 2, 3].filter((d) => !g.floor(x + DX[d], y + DY[d]) && !(g.spikes[u] & (1 << d)));
      if (!faces.length) continue;
      traps.push({ x, y, face: rng.pick(faces) });
    }
  }
  return { bugs, gates, traps, owner };
}

/** Rows per second at which the flood still leaves the par route comfortable. */
function floodFor(g: Grid, an: Analysis, route: number[], diff: number, delay: number, owner: Int16Array): number {
  const w = g.w;
  let t = 0;
  let u = an.start;
  let worst = Infinity;
  const pause = 0.55;
  for (const d of route) {
    t += pause;
    let len = 0;
    let maxY = (u / w) | 0;
    let wait = 0;
    walk(g, u, d, (c) => {
      len++;
      maxY = Math.max(maxY, (c / w) | 0);
      if (owner[c] >= 0) wait = 1.6;
    });
    t += wait;
    t += moveTime(len);
    // The flood surface starts at the bottom edge (y = h) and must stay 2.5 rows below the player.
    if (t > delay) worst = Math.min(worst, (g.h - maxY - 2.5) / (t - delay));
    const r = an.res[u * 4 + d];
    if (r === R_GOAL) break;
    u = target(r, an.start);
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
  an = placeSpikes(g, rng, an, P.spikes, Math.max(3, Math.floor(an.sol * 0.85)));
  // Floor that no slide can enter becomes wall again: it changes no reachable slide.
  const passable = new Uint8Array(g.w * g.h);
  for (const c of sweptCells(g, an)) passable[c] = 1;
  // Slides that end on spikes must keep their length, or they would stop somewhere safe instead.
  for (const u of an.nodes) for (let d = 0; d < 4; d++) if (an.res[u * 4 + d] === R_DEATH) walk(g, u, d, (c) => (passable[c] = 1));
  if (P.entryX >= 0) passable[(g.h - 1) * g.w + P.entryX] = 1;
  for (let c = 0; c < g.cells.length; c++) if (g.cells[c] && !passable[c]) g.cells[c] = 0;
  const items = new Uint8Array(g.w * g.h);
  const pl = placeItems(g, rng, P, an, items);
  const movers = placeMovers(g, rng, P, an, pl);
  const floodDelay = 2.5;
  const floodSpeed = P.flood ? floodFor(g, an, pl.route, P.diff, floodDelay, movers.owner) : 0;
  let dots = 0;
  for (const it of items) if (it === IT_DOT) dots++;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    w: g.w,
    h: g.h,
    cells: g.cells,
    items,
    spikes: g.spikes,
    doorX: g.doorX,
    entryX: P.entryX,
    startX: an.start % g.w,
    startY: (an.start / g.w) | 0,
    bugs: movers.bugs,
    gates: movers.gates,
    traps: movers.traps,
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

/** Stage n (1-based). Mechanics are introduced one at a time over the first ten stages. */
export function stageParams(n: number): GenParams {
  const s = Math.max(1, Math.floor(n));
  const t = Math.min(1, (s - 1) / 59);
  const rows = Math.round(Math.min(22 + s * 1.15, 92) + (s > 60 ? Math.min(26, (s - 60) * 0.4) : 0));
  return {
    seed: hash('tomb-of-the-token/stage', s),
    rows,
    entryX: -1,
    diff: t,
    spikes: s < 2 ? 0 : Math.round(1 + rows * (0.03 + 0.07 * t)),
    bugs: s < 4 ? 0 : Math.round(1 + rows * (0.012 + 0.035 * t)),
    gates: s < 7 ? 0 : Math.round(1 + rows * (0.008 + 0.025 * t)),
    traps: s < 10 ? 0 : Math.round(1 + rows * (0.01 + 0.03 * t)),
    coins: 3 + Math.round(rows / 10),
    powerups: s < 3 ? 0 : s < 15 ? 1 : 2,
    stars: true,
    flood: s === 5 || (s > 5 && s % 3 !== 1),
    growth: Math.round(rows * (4 + 2 * t)),
    candidates: rows < 50 ? 6 : 4,
    down: 0.04 + 0.12 * t,
    gateDoor: true,
  };
}

export const CHUNK_ROWS = 24;

/** Endless mode chunk k (0 = bottom). */
export function chunkParams(k: number, entryX: number, runSeed: number): GenParams {
  const t = Math.min(1, k / 30);
  const rows = CHUNK_ROWS;
  return {
    seed: hash('tomb-of-the-token/endless', runSeed, k),
    rows,
    entryX: k === 0 ? -1 : entryX,
    diff: t,
    spikes: k === 0 ? 0 : Math.round(1 + rows * (0.03 + 0.06 * t)),
    bugs: k < 2 ? 0 : Math.round(rows * (0.02 + 0.04 * t)),
    gates: k < 4 ? 0 : Math.round(rows * (0.01 + 0.03 * t)),
    traps: k < 6 ? 0 : Math.round(rows * (0.01 + 0.03 * t)),
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
  return {
    ...p,
    seed: hash('tomb-of-the-token/daily', dateKey),
    rows: 70,
    flood: true,
    diff: 0.55,
    candidates: 6,
  };
}

/** ASCII dump for tests and debugging. */
export function toAscii(L: Level): string {
  const out: string[] = [];
  const ch = ['', '.', 'c', '*', 'S', 'M', 'F'];
  const bugCells = new Set<number>();
  for (const b of L.bugs) for (let j = b.a; j <= b.b; j++) bugCells.add(b.horiz ? b.line * L.w + j : j * L.w + b.line);
  for (let y = 0; y < L.h; y++) {
    let row = '';
    for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (!L.cells[i]) {
        row += '#';
        continue;
      }
      if (x === L.startX && y === L.startY) row += '@';
      else if (y === 0) row += 'E';
      else if (L.gates.some((g) => g.x === x && g.y === y)) row += '|';
      else if (L.traps.some((t) => t.x === x && t.y === y)) row += 'T';
      else if (bugCells.has(i)) row += 'b';
      else if (L.spikes[i]) row += '^';
      else row += L.items[i] ? ch[L.items[i]] : ' ';
    }
    out.push(row);
  }
  return out.join('\n');
}
