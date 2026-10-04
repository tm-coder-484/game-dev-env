// Every hazard's behaviour, as plain functions of the hazard clock `hz` (which
// stops while a pause power-up runs). The game, the generator's fairness checks
// and the bot's look-ahead all use these, so they can never disagree.
//
// Behaviour follows Tomb of the Mask (per the fan wiki): bats patrol, spike
// traps fire ~0.5 s after you move next to them, fish cannons shoot every ~1.1 s
// until a dart hits something solid, fish balloon from 1x1 to 3x3, saws wake when
// they see you and copy your moves until they crash into a sealed block, and
// snakes burst out of a flashing wall and cross the corridors.

import { DX, DY } from './core.ts';

export const BUG_HIT = 0.62;
export const GATE_HIT = 0.5;
export const DART_HIT = 0.45;
export const SNAKE_HIT = 0.6;
export const SAW_HIT = 0.6;
/** A puffed-up puffer covers its 3x3 block; this is the reach from its centre. */
export const PUFF_REACH = 1.72;
export const TRAP_DELAY = 0.5;
export const TRAP_OUT = 0.8;
export const SAW_SPEED = 6.5;
export const SAW_TIMEOUT = 12;
export const SNAKE_WARN = 1.0;
export const TURRET_WARN = 0.3;
export const PUFF_WARN = 0.45;

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

/** A spike-trap block (a wall cell). Spikes come out of every face that has floor next to it. */
export interface Trap {
  x: number;
  y: number;
}

/** A wall block that shoots darts in direction `dir` along `len` floor cells. */
export interface Turret {
  x: number;
  y: number;
  dir: number;
  len: number;
  period: number;
  phase: number;
  speed: number;
}

/** A puffer: a solid block that balloons over its 3x3 neighbourhood for `on` of each period. */
export interface Puffer {
  x: number;
  y: number;
  period: number;
  on: number;
  phase: number;
}

/** A snake that bursts from wall cell `a` and travels to wall cell `b` along a row or column. */
export interface Snake {
  horiz: boolean;
  line: number;
  a: number;
  b: number;
  body: number;
  speed: number;
  period: number;
  phase: number;
}

/** A dormant saw sits in wall cell (hx, hy) and comes out through floor cell (ex, ey). */
export interface SawSpec {
  hx: number;
  hy: number;
  ex: number;
  ey: number;
}

export interface TrapState extends Trap {
  armedAt: number;
}

export interface SawState extends SawSpec {
  /** 0 dormant, 1 chasing, 2 broken or timed out. */
  mode: number;
  x: number;
  y: number;
  /** Cells still to visit, as x, y pairs: the player's path with turn-backs cut out. */
  q: number[];
  wokeAt: number;
  endAt: number;
}

export interface Hazards {
  bugs: Bug[];
  gates: Gate[];
  turrets: Turret[];
  puffers: Puffer[];
  snakes: Snake[];
  traps: TrapState[];
  saws: SawState[];
}

export const emptyHazards = (): Hazards => ({ bugs: [], gates: [], turrets: [], puffers: [], snakes: [], traps: [], saws: [] });

/** Position in a repeating cycle, 0..1. */
export const cyc = (hz: number, period: number, phase: number): number => (((hz / period + phase) % 1) + 1) % 1;

export function bugPos(b: Bug, hz: number): number {
  const span = b.b - b.a;
  if (span <= 0) return b.a;
  const u = cyc(hz, (2 * span) / b.speed, b.phase);
  return b.a + (u < 0.5 ? u * 2 : 2 - u * 2) * span;
}

export function bugXY(b: Bug, hz: number): [number, number] {
  const p = bugPos(b, hz);
  return b.horiz ? [p, b.line] : [b.line, p];
}

export const gateOn = (g: Gate, hz: number): boolean => cyc(hz, g.period, g.phase) < g.on;

export const pufferOn = (p: Puffer, hz: number): boolean => cyc(hz, p.period, p.phase) < p.on;

/** 0..1 while a puffer is about to inflate, else 0. */
export function pufferWarn(p: Puffer, hz: number): number {
  const left = (1 - cyc(hz, p.period, p.phase)) * p.period;
  return left < PUFF_WARN ? 1 - left / PUFF_WARN : 0;
}

/** Distances (in cells from the muzzle face) of every dart in flight. */
export function darts(t: Turret, hz: number, out: number[] = []): number[] {
  out.length = 0;
  const flight = t.len / t.speed;
  // Shot k leaves at (k - phase) * period.
  for (let k = Math.floor(hz / t.period + t.phase); k >= 0; k--) {
    const age = hz - (k - t.phase) * t.period;
    if (age > flight) break;
    if (age >= 0) out.push(age * t.speed);
  }
  return out;
}

export function dartXY(t: Turret, s: number): [number, number] {
  return [t.x + DX[t.dir] * (0.5 + s), t.y + DY[t.dir] * (0.5 + s)];
}

/** 0..1 while a turret is about to fire, else 0. */
export function turretWarn(t: Turret, hz: number): number {
  const left = (1 - cyc(hz, t.period, t.phase)) * t.period;
  return left < TURRET_WARN ? 1 - left / TURRET_WARN : 0;
}

/**
 * A snake's state: `warn` while its wall flashes, then the head's distance
 * travelled from cell a (body segments trail it one cell apart), or null when
 * it's out of sight.
 */
export function snakeState(s: Snake, hz: number): { warn: number; head: number } | null {
  const t = cyc(hz, s.period, s.phase) * s.period;
  if (t < SNAKE_WARN) return { warn: t / SNAKE_WARN, head: -1 };
  const head = (t - SNAKE_WARN) * s.speed;
  if (head - (s.body - 1) > Math.abs(s.b - s.a)) return null;
  return { warn: 0, head };
}

export function snakeSegment(s: Snake, along: number): [number, number] {
  const p = s.a + Math.sign(s.b - s.a) * along;
  return s.horiz ? [p, s.line] : [s.line, p];
}

export const trapOut = (t: TrapState, hz: number): boolean =>
  t.armedAt >= 0 && hz - t.armedAt >= TRAP_DELAY && hz - t.armedAt < TRAP_DELAY + TRAP_OUT;

/** What would kill Clawd at (px, py), or null. */
export function hazardAt(H: Hazards, px: number, py: number, hz: number, tmp: number[] = []): string | null {
  for (const b of H.bugs) {
    const [bx, by] = bugXY(b, hz);
    if (Math.abs(bx - px) < BUG_HIT && Math.abs(by - py) < BUG_HIT) return 'bug';
  }
  for (const g of H.gates) {
    if (Math.abs(g.x - px) < GATE_HIT && Math.abs(g.y - py) < GATE_HIT && gateOn(g, hz)) return 'gate';
  }
  for (const t of H.turrets) {
    // Cheap reject: the dart line is one row or column.
    const onLine = t.dir & 1 ? Math.abs(py - t.y) < DART_HIT : Math.abs(px - t.x) < DART_HIT;
    if (!onLine) continue;
    for (const s of darts(t, hz, tmp)) {
      const [dx, dy] = dartXY(t, s);
      if (Math.abs(dx - px) < DART_HIT && Math.abs(dy - py) < DART_HIT) return 'dart';
    }
  }
  for (const p of H.puffers) {
    if (Math.abs(p.x - px) < PUFF_REACH && Math.abs(p.y - py) < PUFF_REACH && pufferOn(p, hz)) return 'puffer';
  }
  for (const s of H.snakes) {
    const onLine = s.horiz ? Math.abs(py - s.line) < SNAKE_HIT : Math.abs(px - s.line) < SNAKE_HIT;
    if (!onLine) continue;
    const st = snakeState(s, hz);
    if (!st || st.head < 0) continue;
    const span = Math.abs(s.b - s.a);
    for (let i = 0; i < s.body; i++) {
      const along = st.head - i;
      if (along < 0 || along > span) continue;
      const [sx, sy] = snakeSegment(s, along);
      if (Math.abs(sx - px) < SNAKE_HIT && Math.abs(sy - py) < SNAKE_HIT) return 'snake';
    }
  }
  for (const t of H.traps) {
    if (!trapOut(t, hz)) continue;
    const dx = Math.abs(px - t.x);
    const dy = Math.abs(py - t.y);
    if ((dx < 1.45 && dy < 0.45) || (dy < 1.45 && dx < 0.45)) return 'trap';
  }
  for (const s of H.saws) {
    if (s.mode === 1 && Math.abs(s.x - px) < SAW_HIT && Math.abs(s.y - py) < SAW_HIT) return 'saw';
  }
  return null;
}

/** Can a dormant saw see the cell (cx, cy)? Same row or column, nothing solid between. */
function sees(s: SawSpec, cx: number, cy: number, open: (x: number, y: number) => boolean): boolean {
  if (cx !== s.ex && cy !== s.ey) return false;
  const dx = Math.sign(cx - s.ex);
  const dy = Math.sign(cy - s.ey);
  let x = s.ex;
  let y = s.ey;
  while (x !== cx || y !== cy) {
    if (!open(x, y)) return false;
    x += dx;
    y += dy;
  }
  return open(cx, cy);
}

/**
 * Clawd's centre has moved into cell (cx, cy): spike traps next to it arm,
 * dormant saws that can see it wake, and chasing saws extend their trail.
 */
export function onPlayerCell(H: Hazards, cx: number, cy: number, hz: number, open: (x: number, y: number) => boolean): string[] {
  const events: string[] = [];
  for (const t of H.traps) {
    if (Math.abs(cx - t.x) + Math.abs(cy - t.y) !== 1) continue;
    if (t.armedAt < 0 || hz - t.armedAt >= TRAP_DELAY + TRAP_OUT) {
      t.armedAt = hz;
      events.push('trap');
    }
  }
  for (const s of H.saws) {
    if (s.mode === 0) {
      if (!sees(s, cx, cy, open)) continue;
      s.mode = 1;
      s.wokeAt = hz;
      s.x = s.hx;
      s.y = s.hy;
      s.q = [s.ex, s.ey];
      const dx = Math.sign(cx - s.ex);
      const dy = Math.sign(cy - s.ey);
      let x = s.ex;
      let y = s.ey;
      while (x !== cx || y !== cy) {
        x += dx;
        y += dy;
        s.q.push(x, y);
      }
      events.push('saw');
    } else if (s.mode === 1) {
      const n = s.q.length;
      if (n >= 2 && s.q[n - 2] === cx && s.q[n - 1] === cy) continue;
      // Clawd turned back: the saw cuts the corner instead of following him out and back.
      if (n >= 4 && s.q[n - 4] === cx && s.q[n - 3] === cy) s.q.length = n - 2;
      else s.q.push(cx, cy);
    }
  }
  return events;
}

/** Moves chasing saws along their trails. A saw breaks on a cell that has turned solid. */
export function advanceSaws(H: Hazards, hz: number, dt: number, open: (x: number, y: number) => boolean): string[] {
  const events: string[] = [];
  for (const s of H.saws) {
    if (s.mode !== 1) continue;
    if (hz - s.wokeAt > SAW_TIMEOUT) {
      s.mode = 2;
      s.endAt = hz;
      events.push('sawout');
      continue;
    }
    let left = SAW_SPEED * dt;
    while (left > 1e-9 && s.q.length) {
      const tx = s.q[0];
      const ty = s.q[1];
      if (!open(tx, ty)) {
        s.mode = 2;
        s.endAt = hz;
        events.push('sawbreak');
        break;
      }
      const d = Math.abs(tx - s.x) + Math.abs(ty - s.y);
      if (d <= left) {
        s.x = tx;
        s.y = ty;
        s.q.splice(0, 2);
        left -= d;
      } else {
        s.x += Math.sign(tx - s.x) * Math.min(left, Math.abs(tx - s.x));
        s.y += Math.sign(ty - s.y) * Math.min(left, Math.abs(ty - s.y));
        left = 0;
      }
    }
  }
  return events;
}

/** Deep copy of the parts of the hazard state that react to the player. */
export function cloneDynamic(H: Hazards): Hazards {
  return {
    ...H,
    traps: H.traps.map((t) => ({ ...t })),
    saws: H.saws.map((s) => ({ ...s, q: s.q.slice() })),
  };
}

export const newSaw = (s: SawSpec): SawState => ({ ...s, mode: 0, x: s.hx, y: s.hy, q: [], wokeAt: 0, endAt: 0 });
