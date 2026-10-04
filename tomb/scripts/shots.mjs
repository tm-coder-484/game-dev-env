// Renders screenshots of every screen with headless Chromium and fails on page errors.
//   node scripts/shots.mjs [outDir]      (run `npm run build` first)
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, '..', 'build', 'shots', 'tomb');
mkdirSync(out, { recursive: true });
const url = pathToFileURL(join(root, 'dist', 'tomb-of-the-token.html')).href;

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    const fallback = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
    if (!existsSync(fallback)) throw err;
    return chromium.launch({ executablePath: fallback });
  }
}

const browser = await launch();
const errors = [];
async function page(viewport, dpr, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
  return p;
}
const shot = async (p, name) => {
  await p.screenshot({ path: join(out, name) });
  console.log('shot', name);
};
const state = (p) => p.evaluate(() => window.__tott.state());

// Phone
const p = await page({ width: 390, height: 844 }, 3, true);
await p.goto(url);
await p.waitForTimeout(2500);
await shot(p, 'title.png');
await p.evaluate(() => window.__tott.app.show('stages'));
await p.waitForTimeout(600);
await shot(p, 'stages.png');
await p.evaluate(() => window.__tott.app.launch({ kind: 'stage', n: 12 }));
await p.waitForTimeout(500);
await shot(p, 'loading.png');
await p.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 15000 });
await p.waitForTimeout(400);
await shot(p, 'stage12-start.png');
// Play a few moves of the star route with real key presses.
const st = await state(p);
for (const d of st.game.route.slice(0, 4)) {
  await p.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][d]);
  await p.waitForFunction(() => window.__tott.state().game.state !== 'moving', null, { timeout: 5000 });
  await p.waitForTimeout(250);
}
await shot(p, 'stage12-moves.png');
await p.evaluate(() => window.__tott.play(26));
await p.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 15000 });
await p.evaluate(() => window.__tott.autoplay());
await p.waitForTimeout(6000);
await shot(p, 'stage26-flood.png');
await p.waitForFunction(() => window.__tott.state().mode === 'result', null, { timeout: 120000 });
await p.waitForTimeout(500);
await shot(p, 'result.png');
await p.evaluate(() => window.__tott.app.show('skins'));
await p.waitForTimeout(400);
await shot(p, 'skins.png');
await p.evaluate(() => window.__tott.endless());
await p.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 15000 });
await p.evaluate(() => window.__tott.autoplay());
await p.waitForTimeout(9000);
await shot(p, 'endless.png');

// Desktop
const d = await page({ width: 1280, height: 720 }, 1, false);
await d.goto(url + '#stage-35');
await d.waitForFunction(() => window.__tott.state().mode === 'play', null, { timeout: 15000 });
await d.evaluate(() => window.__tott.autoplay());
await d.waitForTimeout(5000);
await shot(d, 'desktop-stage35.png');
await d.goto(url);
await d.waitForTimeout(2000);
await shot(d, 'desktop-title.png');

await browser.close();
if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('no page errors');
