// Stress test for the level generator, independent of the generator's own graph code.
//   npm test                  -> stages 1-200, daily, 3 endless runs of 40 chunks
//   npm test -- --show 1,12   -> also print those stages as ASCII
import {
  generate, stageParams, chunkParams, dailyParams, toAscii, W, DX, DY, DEFLECT,
  IT_STAR, type Level,
} from '../src/gen.ts';

const args = process.argv.slice(2);
const show = (args[args.indexOf('--show') + 1] ?? '').split(',').filter(Boolean).map(Number);
const STAGES = Number(args[args.indexOf('--stages') + 1]) || 200;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures < 40) console.log('FAIL ' + msg);
};

type Slide = { kind: 'node' | 'goal' | 'back' | 'none' | 'death' | 'loop'; stop: number; cells: number[]; dirs: number[]; mask: number };

/** Re-implementation of the slide rules (bounce pads, seals) on the final level data. */
function slideL(L: Level, from: number, d: number, mask: number): Slide {
  const cells: number[] = [];
  const dirs: number[] = [];
  let cx = from % L.w;
  let cy = Math.floor(from / L.w);
  let dir = d;
  let m = mask;
  for (let steps = 0; steps < 500; steps++) {
    const nx = cx + DX[dir];
    const ny = cy + DY[dir];
    const i = ny * L.w + nx;
    if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h || !L.cells[i]) break;
    const sb = L.seals.indexOf(i);
    if (sb >= 0 && (mask >> sb) & 1) break;
    cx = nx;
    cy = ny;
    cells.push(i);
    dirs.push(dir);
    if (cy === 0) return { kind: 'goal', stop: -1, cells, dirs, mask: m };
    if (cy === L.h - 1) return { kind: 'back', stop: -1, cells, dirs, mask: m };
    if (sb >= 0) m |= 1 << sb;
    if (L.pads[i]) dir = DEFLECT[L.pads[i]][dir];
    if (steps === 499) return { kind: 'loop', stop: -1, cells, dirs, mask: m };
  }
  if (!cells.length) return { kind: 'none', stop: -1, cells, dirs, mask: m };
  const s = cy * L.w + cx;
  return { kind: L.spikes[s] & (1 << dir) ? 'death' : 'node', stop: s, cells, dirs, mask: m };
}

function check(L: Level, name: string): void {
  const start = L.startY * L.w + L.startX;
  const N = L.w * L.h;
  // Every reachable (cell, sealed-blocks) state.
  const key = (c: number, m: number) => m * N + c;
  const seen = new Set<number>([key(start, 0)]);
  const order = [key(start, 0)];
  const out = new Map<number, number[]>();
  const slides: Slide[] = [];
  const nodeCells = new Set<number>();
  for (let i = 0; i < order.length; i++) {
    const st = order[i];
    const c = st % N;
    const m = Math.floor(st / N);
    nodeCells.add(c);
    const o: number[] = [];
    for (let d = 0; d < 4; d++) {
      const r = slideL(L, c, d, m);
      if (r.kind === 'loop') fail(`${name}: endless bounce loop`);
      if (r.kind === 'none' || r.kind === 'loop') continue;
      if (r.kind !== 'death') slides.push(r);
      if (r.kind === 'goal') o.push(-2);
      const t = r.kind === 'node' ? key(r.stop, r.mask) : r.kind === 'back' ? key(start, r.mask) : -1;
      if (t >= 0) {
        o.push(t);
        if (!seen.has(t)) {
          seen.add(t);
          order.push(t);
        }
      }
    }
    out.set(st, o);
  }
  // Every reachable state must still be able to reach the exit (no soft-locks, whatever got sealed).
  const canExit = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const st of order) {
      if (canExit.has(st)) continue;
      if (out.get(st)!.some((t) => t === -2 || canExit.has(t))) {
        canExit.add(st);
        grew = true;
      }
    }
  }
  const stuck = order.filter((st) => !canExit.has(st));
  if (!canExit.has(key(start, 0))) fail(`${name}: exit unreachable`);
  else if (stuck.length) fail(`${name}: ${stuck.length} soft-lock states`);
  for (const c of L.seals) if (nodeCells.has(c)) fail(`${name}: a slide can stop on a seal block`);

  // The par route must take every star and leave through the door without dying, sealing as it goes.
  const stars = new Set<number>();
  L.items.forEach((it, i) => it === IT_STAR && stars.add(i));
  let u = start;
  let m = 0;
  const got = new Set<number>();
  let exited = false;
  for (const d of L.route) {
    const r = slideL(L, u, d, m);
    if (r.kind === 'none' || r.kind === 'death' || r.kind === 'loop') {
      fail(`${name}: route makes an invalid move (${r.kind})`);
      break;
    }
    for (const c of r.cells) if (stars.has(c)) got.add(c);
    m = r.mask;
    if (r.kind === 'goal') {
      exited = true;
      break;
    }
    u = r.kind === 'back' ? start : r.stop;
  }
  if (!exited) fail(`${name}: route does not reach the exit`);
  if (got.size !== stars.size) fail(`${name}: route collects ${got.size}/${stars.size} stars`);

  // Hazard cells, by hazard.
  const owner = new Map<number, number>();
  let id = 0;
  const own = (cells: number[], label: string, mayCoverStops: boolean) => {
    const me = id++;
    for (const c of cells) {
      if (!mayCoverStops && nodeCells.has(c)) fail(`${name}: ${label} covers a cell Clawd can stand on`);
      owner.set(c, me);
    }
    return me;
  };
  const along = (c: number, horiz: boolean) =>
    slides.some((s) => s.cells.some((ci, k) => ci === c && !L.pads[ci] && ((s.dirs[k] & 1) === 1) === horiz));
  for (const b of L.bugs) {
    const cells: number[] = [];
    for (let j = b.a; j <= b.b; j++) cells.push(b.horiz ? b.line * L.w + j : j * L.w + b.line);
    for (const c of cells) {
      if (!L.cells[c]) fail(`${name}: bug lane inside a wall`);
      if (along(c, b.horiz)) fail(`${name}: a slide travels along a bug's lane`);
    }
    own(cells, 'bug', false);
  }
  for (const g of L.gates) own([g.y * L.w + g.x], 'gate', false);
  for (const t of L.turrets) {
    if (L.cells[t.y * L.w + t.x]) fail(`${name}: turret on floor`);
    const cells: number[] = [];
    for (let k = 1; k <= t.len; k++) cells.push((t.y + DY[t.dir] * k) * L.w + t.x + DX[t.dir] * k);
    if (cells.some((c) => !L.cells[c])) fail(`${name}: dart line crosses a wall`);
    const after = (t.y + DY[t.dir] * (t.len + 1)) * L.w + t.x + DX[t.dir] * (t.len + 1);
    if (L.cells[after]) fail(`${name}: dart line does not end at a wall`);
    own(cells, 'dart line', false);
  }
  for (const s of L.snakes) {
    const cells: number[] = [];
    const lo = Math.min(s.a, s.b);
    const hi = Math.max(s.a, s.b);
    const at = (k: number) => (s.horiz ? s.line * L.w + k : k * L.w + s.line);
    if (L.cells[at(s.a)] || L.cells[at(s.b)]) fail(`${name}: snake does not start and end in walls`);
    for (let k = lo; k <= hi; k++) if (L.cells[at(k)]) cells.push(at(k));
    for (const c of cells) if (along(c, s.horiz)) fail(`${name}: a slide travels along a snake's path`);
    own(cells, 'snake', false);
  }
  const zoneExitsClear = (zone: number[], label: string) => {
    const me = own(zone, label, true);
    for (const n of zone.filter((c) => nodeCells.has(c))) {
      for (const st of order) {
        if (st % N !== n) continue;
        for (let d = 0; d < 4; d++) {
          const r = slideL(L, n, d, Math.floor(st / N));
          if (r.kind === 'none' || r.kind === 'death') continue;
          for (const c of r.cells) {
            const o = owner.get(c);
            if (o !== undefined && o !== me) fail(`${name}: way out of a ${label} zone crosses another hazard`);
          }
        }
      }
    }
  };
  for (const p of L.puffers) {
    if (L.cells[p.y * L.w + p.x]) fail(`${name}: puffer on floor`);
    const zone: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (L.cells[(p.y + dy) * L.w + p.x + dx]) zone.push((p.y + dy) * L.w + p.x + dx);
    zoneExitsClear(zone, 'puffer');
  }
  for (const t of L.traps) {
    if (L.cells[t.y * L.w + t.x]) fail(`${name}: spike trap on floor`);
    const zone: number[] = [];
    for (let d = 0; d < 4; d++) if (L.cells[(t.y + DY[d]) * L.w + t.x + DX[d]]) zone.push((t.y + DY[d]) * L.w + t.x + DX[d]);
    zoneExitsClear(zone, 'spike trap');
  }
  // One timed hazard per slide at most.
  for (const s of slides) {
    const ids = new Set<number>();
    for (const c of s.cells) {
      const o = owner.get(c);
      if (o !== undefined) ids.add(o);
    }
    if (ids.size > 1) {
      fail(`${name}: one slide crosses ${ids.size} hazards`);
      break;
    }
  }
  for (const sw of L.saws) {
    if (L.cells[sw.hy * L.w + sw.hx] || !L.cells[sw.ey * L.w + sw.ex]) fail(`${name}: saw not in a wall next to floor`);
  }
  // Pickups only where a slide can pass.
  const passable = new Set<number>([start]);
  for (const s of slides) for (const c of s.cells) passable.add(c);
  L.items.forEach((it, i) => {
    if (it && !passable.has(i)) fail(`${name}: item ${it} at unreachable (${i % L.w},${Math.floor(i / L.w)})`);
  });
}

// ------------------------------------------------------------- stages ----
const times: number[] = [];
const totals: Record<string, number> = { pads: 0, seals: 0, traps: 0, turrets: 0, puffers: 0, snakes: 0, saws: 0, bugs: 0, gates: 0 };
for (let n = 1; n <= STAGES; n++) {
  const L = generate(stageParams(n));
  times.push(L.stats.ms);
  check(L, `stage ${n}`);
  const stars = L.items.filter((i) => i === IT_STAR).length;
  if (stars !== 3) fail(`stage ${n}: ${stars} stars`);
  if (L.doorX < 2 || L.doorX > W - 3) fail(`stage ${n}: exit door at column ${L.doorX}`);
  totals.pads += L.pads.filter(Boolean).length;
  for (const k of ['seals', 'traps', 'turrets', 'puffers', 'snakes', 'saws', 'bugs', 'gates'] as const) totals[k] += L[k].length;
  if (show.includes(n)) {
    const s = L.stats;
    console.log(`\nstage ${n}: ${L.h}x${L.w} sol ${s.sol} par ${s.par} nodes ${s.nodes} floor ${(s.floor / ((L.w - 2) * (L.h - 2))).toFixed(2)} ${s.ms.toFixed(0)}ms`);
    console.log(toAscii(L));
  }
}
times.sort((a, b) => a - b);
console.log(`stages 1-${STAGES}: median ${times[times.length >> 1].toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms`);
console.log('placed: ' + Object.entries(totals).map(([k, v]) => `${v} ${k}`).join(', '));

// -------------------------------------------------------------- daily ----
for (const day of ['2026-10-04', '2026-10-05', '2027-01-01']) check(generate(dailyParams(day)), `daily ${day}`);

// ------------------------------------------------------------ endless ----
for (const run of [1, 2, 3]) {
  let entry = -1;
  let worst = 0;
  for (let k = 0; k < 40; k++) {
    const L = generate(chunkParams(k, entry, run));
    worst = Math.max(worst, L.stats.ms);
    check(L, `endless run ${run} chunk ${k}`);
    if (k > 0 && L.entryX !== entry) fail(`chunk ${k} entry mismatch`);
    if (L.seals.length || L.saws.length) fail(`chunk ${k} has stage-only mechanics`);
    entry = L.doorX;
  }
  console.log(`endless run ${run}: 40 chunks, slowest ${worst.toFixed(1)} ms`);
}

// Determinism: the same stage twice is identical.
const a = generate(stageParams(47));
const b = generate(stageParams(47));
if (a.cells.join() !== b.cells.join() || a.items.join() !== b.items.join() || JSON.stringify(a.saws) !== JSON.stringify(b.saws)) fail('stage 47 not deterministic');

console.log(failures ? `\n${failures} FAILURES` : '\nALL GENERATOR CHECKS PASSED');
process.exit(failures ? 1 : 0);
