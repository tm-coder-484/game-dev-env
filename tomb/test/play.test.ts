// Plays generated levels with the bot through the real game rules (hazards,
// flood, timing) and reports any stage it cannot finish with all three stars.
//   node --experimental-strip-types test/play.test.ts [--stages 120] [--endless 3]
import { Game } from '../src/sim.ts';
import { Bot } from '../src/bot.ts';
import { todayKey } from '../src/sim.ts';

const args = process.argv.slice(2);
const arg = (name: string, def: number) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const STAGES = arg('--stages', 120);
const ENDLESS = arg('--endless', 3);
const DT = 1 / 60;

let failures = 0;
const causes: Record<string, number> = {};

function play(game: Game, limit: number): void {
  const bot = new Bot(game, 0.3);
  while (game.state !== 'dead' && game.state !== 'won' && game.t < limit) {
    bot.update(DT);
    game.update(DT);
    game.events.length = 0;
  }
}

const t0 = Date.now();
let totalTime = 0;
for (let n = 1; n <= STAGES; n++) {
  const game = new Game({ mode: 'stage', stage: n });
  play(game, 400);
  totalTime += game.t;
  const ok = game.state === 'won' && game.stars === 3;
  if (!ok) {
    failures++;
    const why = game.state === 'dead' ? `died (${game.deathCause})` : game.state === 'won' ? `won with ${game.stars} stars` : 'timed out';
    causes[why] = (causes[why] ?? 0) + 1;
    console.log(`FAIL stage ${n}: ${why} at (${game.x.toFixed(1)},${game.y.toFixed(1)}) t=${game.t.toFixed(1)}s moves=${game.moves} flood=${game.level.floodSpeed.toFixed(2)}`);
  }
}
console.log(`stages 1-${STAGES}: ${STAGES - failures}/${STAGES} cleared with 3 stars, avg ${(totalTime / STAGES).toFixed(1)} s of play each`);

const daily = new Game({ mode: 'daily', dateKey: todayKey(new Date(2026, 9, 4)) });
play(daily, 600);
if (daily.state !== 'won') {
  failures++;
  console.log(`FAIL daily: ${daily.state} ${daily.deathCause}`);
} else console.log(`daily: cleared in ${daily.t.toFixed(1)} s, ${daily.stars} stars`);

for (let run = 1; run <= ENDLESS; run++) {
  const game = new Game({ mode: 'endless', seed: run });
  play(game, 240);
  console.log(`endless run ${run}: climbed ${game.height} rows in ${game.t.toFixed(0)} s (${game.state}${game.deathCause ? ': ' + game.deathCause : ''}), chunks ${game.world.chunks.length} live`);
  if (game.height < 150) {
    failures++;
    console.log(`FAIL endless run ${run}: only ${game.height} rows`);
  }
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s wall time)`);
console.log(failures ? `${failures} FAILURES ${JSON.stringify(causes)}` : 'ALL PLAY TESTS PASSED');
process.exit(failures ? 1 : 0);
