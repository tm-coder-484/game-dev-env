// End-to-end check of the built single-file game in headless Chromium:
// plays stage 1 with real touch swipes, mouse drags and arrow keys, then checks
// the result screen, saved progress, the pause menu, endless and daily modes.
//   npm run build && npm run e2e
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(root, 'dist', 'tomb-of-the-token.html')).href;
let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  const fallback = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
  if (!existsSync(fallback)) throw err;
  browser = await chromium.launch({ executablePath: fallback });
}
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
const cdp = await ctx.newCDPSession(page);

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};
const state = () => page.evaluate(() => window.__tott.state());
const idle = () => page.waitForFunction(() => window.__tott.state().game?.state !== 'moving', null, { timeout: 5000 });
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

async function touchSwipe(d) {
  const [dx, dy] = DIRS[d];
  const x = 195, y = 520;
  const pts = (k) => [{ x: x + dx * k, y: y + dy * k, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  for (const k of [10, 25, 45, 70]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function mouseSwipe(d) {
  const [dx, dy] = DIRS[d];
  await page.mouse.move(195, 520);
  await page.mouse.down();
  await page.mouse.move(195 + dx * 80, 520 + dy * 80, { steps: 6 });
  await page.mouse.up();
}

await page.goto(url);
await page.waitForTimeout(800);
check(await page.isVisible('#screen-title'), 'title screen is shown');
check(!(await page.isVisible('#boot')), 'boot spinner is gone');

// Into stage 1 through the menus, like a player.
await page.getByRole('menuitem', { name: /Stages/ }).click();
await page.getByRole('button', { name: /Stage 1, 0 of 3 stars/ }).click();
check(await page.isVisible('#loading'), 'loading spinner shows while the stage is generated');
await page.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 10000 });
check(await page.isVisible('#hud'), 'HUD is shown in play');

const route = (await state()).game.route;
const inputs = ['touch', 'mouse', 'key'];
const used = { touch: 0, mouse: 0, key: 0 };
for (let i = 0; i < route.length; i++) {
  const d = route[i];
  const how = inputs[i % 3];
  const before = await state();
  if (how === 'touch') await touchSwipe(d);
  else if (how === 'mouse') await mouseSwipe(d);
  else await page.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][d]);
  await page.waitForFunction((m) => window.__tott.state().game.moves > m, before.game.moves, { timeout: 3000 }).catch(() => {});
  await idle();
  const after = await state();
  if (after.game.moves > before.game.moves) used[how]++;
  else check(false, `${how} input for direction ${d} did not move Clawd`);
  if (after.game.state === 'won') break;
  await page.waitForTimeout(120);
}
check(used.touch > 0 && used.mouse > 0 && used.key > 0, `touch (${used.touch}), mouse (${used.mouse}) and keyboard (${used.key}) all steer Clawd`);
await page.waitForFunction(() => window.__tott.state().mode === 'result', null, { timeout: 5000 });
const res = await state();
check(res.game.state === 'won', 'stage 1 is won by following the generated route');
check(res.game.stars === 3, `all three stars collected (${res.game.stars})`);
check(/Stage 1 cleared/.test(await page.textContent('#result-head')), 'result screen says "Stage 1 cleared"');
check(res.save.unlocked === 2 && res.save.stars[1] === 3, 'progress saved: stage 2 unlocked, 3 stars on stage 1');

// Progress survives a reload.
await page.reload();
await page.waitForTimeout(600);
const saved = (await state()).save;
check(saved.unlocked === 2 && saved.stars[1] === 3, 'progress is still there after reloading');

// Next stage, pause menu, restart.
await page.evaluate(() => window.__tott.play(2));
await page.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 10000 });
await page.keyboard.press('Escape');
check((await state()).mode === 'pause' && (await page.isVisible('#pause')), 'esc opens the pause menu');
check((await page.textContent('#pause-rows')).includes('/resume'), 'pause menu lists slash commands');
await page.keyboard.press('Escape');
check((await state()).mode === 'play', 'esc resumes');
await page.click('#hud-pause');
await page.getByRole('menuitem', { name: /\/restart/ }).click();
await page.waitForFunction(() => window.__tott.state().mode === 'play' && window.__tott.state().game.moves === 0, null, { timeout: 10000 });
check(true, '/restart reloads the stage');

// Death and retry: slide into nothing useful until a hazard or just check retry wiring via the API.
await page.evaluate(() => window.__tott.endless());
await page.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 10000 });
await page.evaluate(() => window.__tott.autoplay());
await page.waitForTimeout(15000);
const en = (await state()).game;
check(en.height > 15, `endless mode generates more tomb as Clawd climbs (${en.height} m in 15 s)`);

await page.evaluate(() => window.__tott.app.launch({ kind: 'daily' }, true));
await page.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 10000 });
check(/Daily/.test(await page.textContent('#hud-label')), 'daily tomb starts');

await browser.close();
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
console.log(failed ? `${failed} E2E FAILURES` : 'ALL E2E CHECKS PASSED');
process.exit(failed ? 1 : 0);
