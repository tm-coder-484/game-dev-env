#!/usr/bin/env node
// OpenRouter CLI for game content: dialogue, quests, lore, item tables, concept
// art and textures. One key, hundreds of models (Claude, GPT, Gemini, ...).
//
//   node tools/openrouter/openrouter.mjs chat "Write 3 barks for a nervous guard"
//   node tools/openrouter/openrouter.mjs json "10 fantasy swords with name, damage, rarity, lore" --out data/swords.json
//   node tools/openrouter/openrouter.mjs image "misty pine valley at dawn, concept art" --aspect 16:9 --out concept.png
//   node tools/openrouter/openrouter.mjs texture "mossy cobblestone" --out godot/assets/cobble.png
//   node tools/openrouter/openrouter.mjs models [filter] [--images]
//
// Options: --model <id>  --system <text>  --max-tokens <n>  --out <file>
// Env: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_IMAGE_MODEL (see .env.example)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { chat, DEFAULTS, ensureProxySupport, image, models } from './lib.mjs';

ensureProxySupport();

const argv = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    opts[key] = next === undefined || next.startsWith('--') ? true : (i++, next);
  } else pos.push(argv[i]);
}
const [cmd, ...rest] = pos;
const prompt = rest.join(' ');

function save(path, data) {
  mkdirSync(dirname(path) || '.', { recursive: true });
  writeFileSync(path, data);
  console.error(`saved ${path}`);
}

function usage() {
  console.log(`usage: openrouter.mjs <chat|json|image|texture|models> [prompt] [--model id] [--out file]
  defaults: text=${DEFAULTS.text}  image=${DEFAULTS.image}`);
  process.exit(1);
}

try {
  switch (cmd) {
    case 'chat': {
      if (!prompt) usage();
      const messages = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: prompt });
      const r = await chat(messages, { model: opts.model, maxTokens: Number(opts['max-tokens'] ?? 2048) });
      opts.out ? save(opts.out, r.text) : console.log(r.text);
      console.error(`[${r.model}] ${r.usage?.total_tokens ?? '?'} tokens`);
      break;
    }
    case 'json': {
      if (!prompt) usage();
      const system =
        (opts.system ? `${opts.system}\n` : '') +
        'You generate game data. Reply with a single valid JSON object only - no prose, no code fences. ' +
        'Put lists under a descriptive top-level key.';
      const r = await chat(
        [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        { model: opts.model, maxTokens: Number(opts['max-tokens'] ?? 4096), json: true },
      );
      const cleaned = r.text.replace(/^```(?:json)?\s*|\s*```$/g, '');
      const pretty = JSON.stringify(JSON.parse(cleaned), null, 2) + '\n';
      opts.out ? save(opts.out, pretty) : console.log(pretty);
      break;
    }
    case 'image':
    case 'texture': {
      if (!prompt) usage();
      const fullPrompt =
        cmd === 'texture'
          ? `Seamless tileable PBR albedo texture of ${prompt}. Orthographic top-down view, flat even lighting, ` +
            'no shadows, no perspective, no text, edges wrap perfectly.'
          : prompt;
      const images = await image(fullPrompt, {
        model: opts.model,
        aspectRatio: cmd === 'texture' ? '1:1' : (opts.aspect ?? '1:1'),
        resolution: opts.resolution,
        n: Number(opts.n ?? 1),
      });
      if (!images.length) throw new Error('model returned no images');
      const out = opts.out ?? `${cmd}-${Date.now()}.png`;
      images.forEach((img, i) => {
        const ext = '.' + (img.mediaType.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const base = out.slice(0, out.length - extname(out).length);
        save(images.length > 1 ? `${base}-${i + 1}${ext}` : base + ext, img.bytes);
      });
      break;
    }
    case 'models': {
      const list = await models({ output: opts.images ? 'image' : undefined });
      const filter = (prompt || '').toLowerCase();
      for (const m of list.filter((m) => m.id.toLowerCase().includes(filter))) {
        const p = m.pricing ?? {};
        const price = p.prompt ? `$${(p.prompt * 1e6).toFixed(2)}/$${(p.completion * 1e6).toFixed(2)} per M tok` : '';
        console.log(`${m.id.padEnd(48)} ${price}`);
      }
      break;
    }
    default:
      usage();
  }
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
