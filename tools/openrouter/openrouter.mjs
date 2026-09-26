#!/usr/bin/env node
// OpenRouter CLI for game text: dialogue, quests, lore, item tables.
// One key, hundreds of models (Claude, GPT, Gemini, ...).
//
//   node tools/openrouter/openrouter.mjs chat "Write 3 barks for a nervous guard"
//   node tools/openrouter/openrouter.mjs json "10 fantasy swords with name, damage, rarity, lore" --out data/swords.json
//   node tools/openrouter/openrouter.mjs models [filter]
//
// Images (concept art, HUDs, icons, textures, skies...) live in assets.mjs.
//
// Options: --model <id>  --system <text>  --max-tokens <n>  --out <file>
// Env: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_IMAGE_MODEL (see .env.example)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chat, DEFAULTS, ensureProxySupport, models } from './lib.mjs';

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
  console.log(`usage: openrouter.mjs <chat|json|models> [prompt] [--model id] [--out file]
  default text model: ${DEFAULTS.text}   (images: node tools/openrouter/assets.mjs)`);
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
    case 'texture':
      console.error(`images moved to assets.mjs, e.g.: node tools/openrouter/assets.mjs ${cmd === 'image' ? 'concept' : 'texture'} "${prompt}"`);
      process.exit(1);
      break;
    case 'models': {
      const list = await models();
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
