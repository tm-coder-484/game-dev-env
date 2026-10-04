// Autopilot: plays the title-screen demo and the headless play-tests.
// Stages follow the generator's star route; endless mode climbs greedily.
// Before every slide it looks ahead with Game.safeMove and waits for a gap.

import { DX, DY } from './gen.ts';
import type { Game } from './sim.ts';

export class Bot {
  private plan: number[] = [];
  private wait = 0;
  private stuck = 0;

  readonly game: Game;
  /** Seconds to "think" before each slide. */
  readonly pause: number;

  constructor(game: Game, pause = 0.25) {
    this.game = game;
    this.pause = pause;
    if (game.mode !== 'endless') this.plan = [...game.level.route];
  }

  update(dt: number): void {
    const g = this.game;
    if (g.state !== 'idle') return;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) return;
    }
    if (!this.plan.length) this.replan(-1);
    const d = this.plan[0];
    if (d === undefined) return;
    // Think before each slide, except with a saw on your tail.
    if (g.t - g.lastStop < (g.chased ? 0.1 : this.pause) && g.moves > 0) return;
    for (let w = 0; w <= 8; w += 0.05) {
      if (g.safeMove(d, w, this.plan[1] ?? -1, this.pause)) {
        if (w < 0.03) {
          this.plan.shift();
          this.stuck = 0;
          g.input(d);
        } else {
          this.wait = w;
        }
        return;
      }
    }
    // Nothing safe for eight seconds: find another way.
    this.stuck++;
    this.replan(this.stuck < 3 ? d : -1);
    this.wait = 0.2;
  }

  /** Breadth-first search over slides from Clawd's position. */
  private replan(avoidFirst: number): void {
    const g = this.game;
    const w = g.world;
    const key = (x: number, y: number) => (y + 1_000_000) * 16 + x;
    const start = key(g.x, g.y);
    const parent = new Map<number, number>([[start, -1]]);
    const queue: [number, number][] = [[g.x, g.y]];
    let best = start;
    let bestY = g.y;
    let goal = -1;
    for (let qi = 0; qi < queue.length && qi < 4000; qi++) {
      const [x, y] = queue[qi];
      const k = key(x, y);
      for (let d = 0; d < 4; d++) {
        if (k === start && d === avoidFirst) continue;
        const r = w.trace(x, y, d);
        if (r.len === 0 || w.spike(r.x, r.y) & (1 << r.dir)) continue;
        const nk = key(r.x, r.y);
        if (parent.has(nk)) continue;
        parent.set(nk, k * 4 + d);
        queue.push([r.x, r.y]);
        if (g.mode !== 'endless' && r.x === w.doorX && r.y === w.doorY) goal = nk;
        if (r.y < bestY) {
          bestY = r.y;
          best = nk;
        }
      }
      if (goal >= 0) break;
    }
    let v = goal >= 0 ? goal : best;
    const dirs: number[] = [];
    while (v !== start) {
      const e = parent.get(v)!;
      dirs.push(e & 3);
      v = Math.floor(e / 4);
    }
    this.plan = dirs.reverse();
    if (!this.plan.length) {
      // Already at the highest stop we know: take any slide that goes somewhere.
      for (let d = 0; d < 4; d++) if (w.cell(g.x + DX[d], g.y + DY[d])) this.plan = [d];
    }
  }
}
