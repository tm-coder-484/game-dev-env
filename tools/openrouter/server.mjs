#!/usr/bin/env node
// Tiny AI backend for your game: holds the OpenRouter key server-side so it never
// ships inside a Godot/Web build. Both demo NPCs talk to POST /chat.
//
//   OPENROUTER_API_KEY=sk-or-... node tools/openrouter/server.mjs      (or: make ai-server)
//
//   POST /chat    { messages: [{role, content}], max_tokens?, model? }  ->  { reply, model }
//   GET  /health  ->  { ok: true, model }
//
// Env: PORT (8787), HOST (127.0.0.1), OPENROUTER_NPC_MODEL, AI_ALLOWED_MODELS
// (comma list clients may request; default: only the NPC model), AI_MAX_TOKENS (300).
import { createServer } from 'node:http';
import { chat, DEFAULTS, ensureProxySupport } from './lib.mjs';

ensureProxySupport();

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? 300);
const ALLOWED = new Set((process.env.AI_ALLOWED_MODELS ?? DEFAULTS.npc).split(',').map((s) => s.trim()));

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    // Godot Web exports and the Vite dev server run on other origins.
    'Access-Control-Allow-Origin': process.env.AI_CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, model: DEFAULTS.npc });
    if (req.method !== 'POST' || req.url !== '/chat') return send(res, 404, { error: 'not found' });

    const body = await readJson(req);
    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : null;
    if (!messages?.every((m) => ['system', 'user', 'assistant'].includes(m?.role) && typeof m.content === 'string')) {
      return send(res, 400, { error: 'messages must be [{role, content}]' });
    }
    const model = ALLOWED.has(body.model) ? body.model : DEFAULTS.npc;
    const r = await chat(messages, { model, maxTokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS) });
    console.log(`[chat] ${model} ${r.usage?.total_tokens ?? '?'} tok: ${r.text.slice(0, 80).replace(/\s+/g, ' ')}`);
    send(res, 200, { reply: r.text.trim(), model: r.model });
  } catch (err) {
    console.error('[chat] error:', err.message);
    send(res, err.status ?? 502, { error: err.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`AI server on http://${HOST}:${PORT}  (model ${DEFAULTS.npc}${process.env.OPENROUTER_API_KEY ? '' : ', no OPENROUTER_API_KEY set'})`);
});
