#!/usr/bin/env node
// Game-asset generator on OpenRouter image models: HUD mockups and HUD kits,
// icons, sprites, tileable PBR textures, skies, concept art, image edits.
// Works with ANY OpenRouter image model: --model takes a full id or a fragment
// ("sunburst", "gpt-image-2.5-flare", "seedream 5 pro", "nano banana").
//
//   node tools/openrouter/assets.mjs models [filter] [--transparent]
//   node tools/openrouter/assets.mjs concept "misty pine valley at dawn" --aspect 16:9
//   node tools/openrouter/assets.mjs hud "gritty survival game" --ref build/shots/godot.png
//   node tools/openrouter/assets.mjs ui-kit [--ref concept/hud.png] [--only slot,crosshair] [--placeholder]
//   node tools/openrouter/assets.mjs icon "iron sword, healing potion, rope" [--dir godot/assets/ui/icons]
//   node tools/openrouter/assets.mjs sprite "hooded wanderer, full body, facing right" --size 512
//   node tools/openrouter/assets.mjs texture "mossy cobblestone" --pbr [--size 1024]
//   node tools/openrouter/assets.mjs sky "stormy sunset over mountains" --model seedream
//   node tools/openrouter/assets.mjs edit concept/hud.png "make the bars thinner and more minimal"
//
// Common options: --model <id|fragment>  --out <file>  --style "<text>"  --ref a.png,b.png
//   --aspect W:H  --resolution 1K|2K|4K  --quality low|medium|high|max  --seed N  --n N
//   --key green|magenta (chroma colour when a model has no transparency)  --dry-run
// Env: OPENROUTER_API_KEY, OPENROUTER_IMAGE_MODEL (default model), ASSET_STYLE (default style text)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULTS, ensureProxySupport } from './lib.mjs';
import { capabilities, generate, imageModels } from './imagegen.mjs';
import * as ops from './imageops.mjs';
import { PLACEHOLDERS } from './placeholders.mjs';

ensureProxySupport();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opts = {};
const pos = [];
const BOOL = new Set(['pbr', 'transparent', 'opaque', 'placeholder', 'dry-run', 'no-seamless']);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    opts[k] = BOOL.has(k) || argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
  } else pos.push(argv[i]);
}
const [cmd, ...rest] = pos;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'asset';
const refs = () => (opts.ref ? String(opts.ref).split(',').map((p) => p.trim()).filter(Boolean) : []);
const style = (fallback = '') => opts.style ?? process.env.ASSET_STYLE ?? fallback;
const common = () => ({
  model: opts.model ?? DEFAULTS.image,
  resolution: opts.resolution,
  quality: opts.quality ?? 'high',
  seed: opts.seed !== undefined ? Number(opts.seed) : undefined,
  n: opts.n ? Number(opts.n) : 1,
  key: opts.key ?? 'green',
  dryRun: !!opts['dry-run'],
});
let spent = 0;

function save(path, bytes) {
  const abs = resolve(ROOT, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  console.log(`  wrote ${abs.replace(ROOT + '/', '')}`);
  return abs;
}

/** Generate, report, and return PNG buffers (chroma-keyed if needed). SVG passes through. */
async function run(label, params) {
  const r = await generate({ ...common(), ...params });
  console.log(`> ${label}  [${r.model}]${r.notes?.length ? '  (' + r.notes.join('; ') + ')' : ''}`);
  if (params.dryRun ?? common().dryRun) {
    console.log('  ' + JSON.stringify(r.request));
    return [];
  }
  if (r.cost) spent += r.cost;
  const out = [];
  for (const img of r.images) {
    if (img.mediaType === 'image/svg+xml') out.push({ svg: img.bytes });
    else out.push({ png: r.keyed ? await ops.chromaKey(img.bytes, r.keyed) : await sharp(img.bytes).png().toBuffer() });
  }
  return out;
}

function outPath(defaultPath, i, n) {
  const p = opts.out ?? defaultPath;
  return n > 1 ? p.replace(/(\.\w+)$/, `-${i + 1}$1`) : p;
}

async function writeImages(results, defaultPath, post = (b) => b) {
  for (const [i, r] of results.entries()) {
    if (r.svg) save(outPath(defaultPath, i, results.length).replace(/\.\w+$/, '.svg'), r.svg);
    else save(outPath(defaultPath, i, results.length), await post(r.png));
  }
}

// ----------------------------------------------------------------- commands --
async function cmdModels() {
  const filter = (rest.join(' ') || '').toLowerCase();
  const list = (await imageModels()).filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(filter));
  console.log('model'.padEnd(46) + 'transp  refs  aspects');
  for (const m of list) {
    const c = capabilities(m);
    if (opts.transparent && !c.transparent) continue;
    const extra = c.formats.includes('svg') ? '  (SVG)' : '';
    console.log(`${m.id.padEnd(46)}${(c.transparent ? 'yes' : '-').padEnd(8)}${String(c.maxRefs).padEnd(6)}${c.aspects.join(' ')}${extra}`);
  }
  console.log(`\ndefault: ${DEFAULTS.image}  (set OPENROUTER_IMAGE_MODEL or pass --model)`);
}

async function cmdConcept() {
  const prompt = `${rest.join(' ')}. ${style('Cinematic, realistic game concept art, dramatic lighting.')}`;
  const res = await run('concept', { prompt, aspect: opts.aspect ?? '16:9', refs: refs() });
  await writeImages(res, `concept/${slug(rest.join(' '))}.png`);
}

async function cmdHud() {
  const game = rest.join(' ') || 'first-person survival game';
  const r = refs();
  const prompt = r.length
    ? `Paint a polished, production-quality in-game HUD overlay onto this screenshot of a ${game}. Keep the 3D scene ` +
      'exactly as it is and add: health and stamina bars bottom-left, a 5-slot item hotbar bottom-centre, a small ' +
      `crosshair in the centre, and a compass strip top-centre. ${style('Grounded, realistic, minimal, readable UI.')}`
    : `A full-screen in-game screenshot mockup of a ${game} showing a polished HUD: health and stamina bars ` +
      'bottom-left, a 5-slot item hotbar bottom-centre, a small crosshair, and a compass strip top-centre. ' +
      style('Grounded, realistic, minimal, readable UI.');
  const res = await run('hud mockup', { prompt, aspect: '16:9', refs: r });
  await writeImages(res, `concept/hud-${slug(game)}.png`);
  if (res.length) console.log('next: node tools/openrouter/assets.mjs ui-kit --ref ' + (opts.out ?? `concept/hud-${slug(game)}.png`));
}

function finishElement(el, png) {
  const [w, h] = el.size;
  return el.fit === 'stretch' ? ops.trimAndStretch(png, w, h) : ops.trimAndFit(png, w, h, { pad: Math.round(w * 0.04) });
}

async function cmdUiKit() {
  const kit = JSON.parse(readFileSync(join(ROOT, 'tools/openrouter/presets/hud-kit.json'), 'utf8'));
  const only = opts.only ? String(opts.only).split(',').map((s) => s.trim()) : null;
  const elements = kit.elements.filter((e) => !only || only.some((o) => e.file.includes(o)));
  const outDir = opts.dir ?? kit.out;
  if (opts.placeholder) {
    for (const el of elements) {
      const [w, h] = el.size;
      save(join(outDir, el.file), await sharp(Buffer.from(PLACEHOLDERS[el.file](w, h))).png().toBuffer());
    }
    return;
  }
  const kitStyle = style(kit.style);
  let styleRefs = refs(); // e.g. a HUD mockup: every element is drawn to match it
  for (const el of elements) {
    const prompt = `${el.prompt} ${el.icon ? kit.iconStyle : ''} ${el.useStyle === false ? '' : kitStyle}`.replace(/\s+/g, ' ');
    const res = await run(el.file, { prompt, aspect: el.aspect, transparent: true, key: el.key ?? opts.key ?? 'green', refs: styleRefs, n: 1 });
    if (!res.length) continue;
    const file = save(join(outDir, el.file), await finishElement(el, res[0].png));
    // First generated element becomes the style anchor for the rest (consistency).
    if (!refs().length && !styleRefs.length && el.useStyle !== false) styleRefs = [file];
  }
}

async function cmdIcons() {
  const items = rest.join(' ').split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new Error('usage: assets.mjs icon "sword, potion, rope"');
  const size = Number(opts.size ?? 128);
  const dir = opts.dir ?? 'godot/assets/ui/icons';
  const iconStyle = style('Painterly realistic game inventory icon, single object centred, three-quarter view, soft rim light.');
  let styleRefs = refs();
  for (const item of items) {
    const res = await run(`icon: ${item}`, { prompt: `Game inventory icon of ${item}. ${iconStyle}`, aspect: '1:1', transparent: true, refs: styleRefs });
    if (!res.length) continue;
    const file = save(join(dir, `${slug(item)}.png`), await ops.trimAndFit(res[0].png, size, size, { pad: Math.round(size * 0.04) }));
    if (!styleRefs.length) styleRefs = [file];
  }
}

async function cmdSprite() {
  const size = Number(opts.size ?? 512);
  const prompt = `${rest.join(' ')}. ${style('Game sprite, clean silhouette, consistent lighting from top-left.')}`;
  const res = await run('sprite', { prompt, aspect: opts.aspect ?? '1:1', transparent: true, refs: refs() });
  await writeImages(res, `godot/assets/sprites/${slug(rest.join(' '))}.png`, (png) => ops.trimAndFit(png, size, size));
}

async function cmdTexture() {
  const what = rest.join(' ');
  const size = Number(opts.size ?? 1024);
  const prompt =
    `Seamless tileable texture of ${what}. Orthographic, straight top-down photo, flat even diffuse lighting, ` +
    'no shadows or highlights baked in, no perspective, no vignette, no text, edges wrap perfectly. ' + style('');
  const res = await run('texture', { prompt, aspect: '1:1', refs: refs() });
  const dir = opts.dir ?? `godot/assets/textures/${slug(what)}`;
  for (const [i, r] of res.entries()) {
    const sub = res.length > 1 ? `${dir}-${i + 1}` : dir;
    const albedo = opts['no-seamless'] ? await sharp(r.png).resize(size, size).png().toBuffer() : await ops.makeSeamless(r.png, size);
    save(join(sub, 'diff.png'), albedo);
    save(join(sub, 'preview_2x2.png'), await ops.tilePreview(albedo, 256));
    if (opts.pbr) {
      const maps = await ops.pbrFromAlbedo(albedo);
      save(join(sub, 'nor_gl.png'), maps.normal);
      save(join(sub, 'rough.png'), maps.roughness);
      save(join(sub, 'height.png'), maps.height);
    }
  }
}

async function cmdSky() {
  const prompt =
    `Seamless 360-degree equirectangular panorama (2:1) of ${rest.join(' ')}, for use as a game skybox. ` +
    'Horizon exactly at the vertical centre, left and right edges wrap seamlessly, no people, no text. ' + style('');
  const res = await run('sky', { prompt, aspect: '2:1', refs: refs() });
  await writeImages(res, `godot/assets/sky/${slug(rest.join(' '))}.png`, (png) =>
    sharp(png).resize(4096, 2048, { fit: 'fill' }).png().toBuffer());
}

async function cmdEdit() {
  const [image, ...words] = rest;
  if (!image || !words.length) throw new Error('usage: assets.mjs edit <image> "<instruction>"');
  const meta = await sharp(image).metadata();
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(meta.width, meta.height);
  const aspect = `${meta.width / g}:${meta.height / g}`;
  const res = await run('edit', { prompt: words.join(' '), refs: [image, ...refs()], aspect, transparent: !!opts.transparent });
  const ext = extname(image);
  await writeImages(res, join(dirname(image), `${basename(image, ext)}-edit.png`));
}

const COMMANDS = { models: cmdModels, concept: cmdConcept, hud: cmdHud, 'ui-kit': cmdUiKit, icon: cmdIcons, icons: cmdIcons,
  sprite: cmdSprite, texture: cmdTexture, sky: cmdSky, edit: cmdEdit };

try {
  if (!COMMANDS[cmd]) {
    console.log('usage: assets.mjs <models|concept|hud|ui-kit|icon|sprite|texture|sky|edit> ... (see header of tools/openrouter/assets.mjs)');
    process.exit(cmd ? 1 : 0);
  }
  if (cmd !== 'models' && cmd !== 'ui-kit' && cmd !== 'edit' && !rest.length) throw new Error(`usage: assets.mjs ${cmd} "<description>"`);
  await COMMANDS[cmd]();
  if (spent) console.log(`cost: $${spent.toFixed(4)}`);
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
