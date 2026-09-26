// Headless browser smoke test + screenshot for any web build (three.js or a
// Godot Web export). Fails (exit 1) on page errors, so it doubles as a CI check.
//
//   node scripts/screenshot.mjs [url|dist[?query]] [out.png] [waitMs]
//   npm run shot          # = "dist": serves web/dist itself (run `npm run build` first)
//   node scripts/screenshot.mjs 'dist?low' shot.png   # skip post-processing (fast, used by CI)
//   node scripts/screenshot.mjs http://127.0.0.1:8060/ godot-web.png 30000   # any URL
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { preview } from 'vite';

let [url = 'dist', out = 'screenshot.png', waitMs = '15000'] = process.argv.slice(2);
let server = null;
if (url.startsWith('dist')) {
  server = await preview({ preview: { port: 4173, host: '127.0.0.1' }, logLevel: 'warn' });
  url = server.resolvedUrls.local[0] + url.slice('dist'.length);
}
// Software WebGL so it works on GPU-less CI runners and cloud containers.
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function launch() {
  try {
    return await chromium.launch({ args });
  } catch (err) {
    // Pre-installed browser whose revision differs from this playwright version
    // (e.g. Claude Code cloud sessions ship one at /opt/pw-browsers/chromium).
    const fallback = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
    if (!existsSync(fallback)) throw err;
    return chromium.launch({ args, executablePath: fallback });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
await page.waitForTimeout(Number(waitMs));
// The three.js build counts frames in window.__frames: make sure it is actually
// rendering before the shot (software GL on CI can manage well under 1 FPS).
if (await page.evaluate(() => !!document.getElementById('hud'))) {
  await page
    .waitForFunction(() => (window.__frames ?? 0) >= 3, null, { timeout: 180_000 })
    .catch(() => errors.push('game never rendered 3 frames'));
}
await page.evaluate(() => document.getElementById('start')?.classList.add('hidden'));
await page.waitForTimeout(500);
// Screenshots wait for the next frame; on CPU-only CI one frame can take >30 s.
await page.screenshot({ path: out, timeout: 180_000 });
const frames = await page.evaluate(() => window.__frames ?? null);
await browser.close();
await server?.close();

console.log(`screenshot -> ${out}${frames !== null ? ` (${frames} frames rendered)` : ''}`);
if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}
