// Stress test for the level generator, independent of the generator's own graph code.
//   npm test                  -> stages 1-200, daily, 3 endless runs of 40 chunks
//   npm test -- --show 1,12   -> also print those stages as ASCII
import {
  generate, stageParams, chunkParams, dailyParams, toAscii, W, DX, DY,
  IT_STAR, IT_DOT, type Level,
} from '../src/gen.ts';

const args = process.argv.slice(2);
const show = (args[args.indexOf('--show') + 1] ?? '').split(',').filter(Boolean).map(Number);
const STAGES = Number(args[args.indexOf('--stages') + 1]) || 200;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log('FAIL ' + msg);
};

/** Re-implementation of the slide rules on the final level data. */
function slideL(L: Level, x: number, y: number, d: number): { stop: number; kind: 'node' | 'goal' | 'back' | 'none' | 'death'; cells: number[] } {
  const cells: number[] = [];
  let cx = x;
  let cy = y;
  for (;;) {
    const nx = cx + DX[d];
    const ny = cy + DY[d];
    if (nx < 0 || nx >= L.w || ny < 0 || ny >= L.h || !L.cells[ny * L.w + nx]) break;
    cx = nx;
    cy = ny;
    cells.push(cy * L.w + cx);
    if (cy === 0) return { stop: -1, kind: 'goal', cells };
    if (cy === L.h - 1) return { stop: -1, kind: 'back', cells };
  }
  if (!cells.length) return { stop: -1, kind: 'none', cells };
  const s = cy * L.w + cx;
  if (L.spikes[s] & (1 << d)) return { stop: s, kind: 'death', cells };
  return { stop: s, kind: 'node', cells };
}

function check(L: Level, name: string): { nodes: number } {
  const start = L.startY * L.w + L.startX;
  // Forward reachability.
  const seen = new Set<number>([start]);
  const order = [start];
  const edges = new Map<number, number[]>();
  let goal = false;
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    const out: number[] = [];
    for (let d = 0; d < 4; d++) {
      const r = slideL(L, u % L.w, Math.floor(u / L.w), d);
      if (r.kind === 'goal') {
        goal = true;
        out.push(-2);
      }
      const t = r.kind === 'node' ? r.stop : r.kind === 'back' ? start : -1;
      if (t >= 0) {
        out.push(t);
        if (!seen.has(t)) {
          seen.add(t);
          order.push(t);
        }
      }
    }
    edges.set(u, out);
  }
  if (!goal) fail(`${name}: exit unreachable`);
  // Every reachable stop must still be able to reach the exit (no soft-locks).
  const canExit = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of order) {
      if (canExit.has(u)) continue;
      if (edges.get(u)!.some((t) => t === -2 || canExit.has(t))) {
        canExit.add(u);
        grew = true;
      }
    }
  }
  const stuck = order.filter((u) => !canExit.has(u));
  if (stuck.length) fail(`${name}: ${stuck.length} soft-lock stops, e.g. (${stuck[0] % L.w},${Math.floor(stuck[0] / L.w)})`);

  // The par route must take every star and leave through the door without dying.
  const stars = new Set<number>();
  L.items.forEach((it, i) => it === IT_STAR && stars.add(i));
  let u = start;
  const got = new Set<number>();
  let exited = false;
  for (const d of L.route) {
    const r = slideL(L, u % L.w, Math.floor(u / L.w), d);
    if (r.kind === 'none' || r.kind === 'death') {
      fail(`${name}: route makes an invalid move (${r.kind})`);
      break;
    }
    for (const c of r.cells) if (stars.has(c)) got.add(c);
    if (r.kind === 'goal') {
      exited = true;
      break;
    }
    u = r.kind === 'back' ? start : r.stop;
  }
  if (!exited) fail(`${name}: route does not reach the exit`);
  if (got.size !== stars.size) fail(`${name}: route collects ${got.size}/${stars.size} stars`);

  // Movers only on cells where nothing can stop.
  for (const b of L.bugs) {
    for (let j = b.a; j <= b.b; j++) {
      const c = b.horiz ? b.line * L.w + j : j * L.w + b.line;
      if (seen.has(c)) fail(`${name}: bug covers a stop`);
      if (!L.cells[c]) fail(`${name}: bug inside a wall`);
    }
  }
  for (const g of L.gates) if (seen.has(g.y * L.w + g.x)) fail(`${name}: gate on a stop`);
  for (const t of L.traps) if (!seen.has(t.y * L.w + t.x)) fail(`${name}: trap on a cell nobody stops at`);
  // Dots only where a slide can pass.
  const passable = new Set<number>([start]);
  for (const s of order) {
    for (let d = 0; d < 4; d++) {
      const r = slideL(L, s % L.w, Math.floor(s / L.w), d);
      if (r.kind !== 'death') r.cells.forEach((c) => passable.add(c));
    }
  }
  L.items.forEach((it, i) => {
    if (it && !passable.has(i)) fail(`${name}: item ${it} at unreachable (${i % L.w},${Math.floor(i / L.w)})`);
  });
  return { nodes: order.length };
}

// ------------------------------------------------------------- stages ----
const times: number[] = [];
let starTotal = 0;
for (let n = 1; n <= STAGES; n++) {
  const L = generate(stageParams(n));
  times.push(L.stats.ms);
  check(L, `stage ${n}`);
  starTotal += L.items.filter((i) => i === IT_STAR).length;
  if (L.items.filter((i) => i === IT_STAR).length !== 3) fail(`stage ${n}: ${L.items.filter((i) => i === IT_STAR).length} stars`);
  if (L.doorX < 2 || L.doorX > W - 3) fail(`stage ${n}: exit door at column ${L.doorX}`);
  if (show.includes(n)) {
    const s = L.stats;
    console.log(`\nstage ${n}: ${L.h}x${L.w} sol ${s.sol} par ${s.par} nodes ${s.nodes} decisions ${s.decisions} floor ${(s.floor / ((L.w - 2) * (L.h - 2))).toFixed(2)} dots ${s.dots} bugs ${L.bugs.length} gates ${L.gates.length} traps ${L.traps.length} flood ${L.floodSpeed.toFixed(2)} cand ${s.candidates}/${s.attempts} ${s.ms.toFixed(0)}ms`);
    console.log(toAscii(L));
  }
}
times.sort((a, b) => a - b);
console.log(`stages 1-${STAGES}: median ${times[times.length >> 1].toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms, ${starTotal} stars`);

// -------------------------------------------------------------- daily ----
for (const day of ['2026-10-04', '2026-10-05', '2027-01-01']) {
  const L = generate(dailyParams(day));
  check(L, `daily ${day}`);
}

// ------------------------------------------------------------ endless ----
for (const run of [1, 2, 3]) {
  let entry = -1;
  let worst = 0;
  for (let k = 0; k < 40; k++) {
    const L = generate(chunkParams(k, entry, run));
    worst = Math.max(worst, L.stats.ms);
    check(L, `endless run ${run} chunk ${k}`);
    if (k > 0 && L.entryX !== entry) fail(`chunk ${k} entry mismatch`);
    // The entry door column of the next chunk is this chunk's exit door.
    entry = L.doorX;
    if (show.includes(-k - 1) && run === 1) console.log(`\nchunk ${k}\n` + toAscii(L));
  }
  console.log(`endless run ${run}: 40 chunks, slowest ${worst.toFixed(1)} ms`);
}

// Determinism: the same stage twice is identical.
const a = generate(stageParams(17));
const b = generate(stageParams(17));
if (a.cells.join() !== b.cells.join() || a.items.join() !== b.items.join()) fail('stage 17 not deterministic');
void IT_DOT;

console.log(failures ? `\n${failures} FAILURES` : '\nALL GENERATOR CHECKS PASSED');
process.exit(failures ? 1 : 0);
