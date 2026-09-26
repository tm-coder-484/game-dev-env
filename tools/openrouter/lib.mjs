// Minimal OpenRouter client (no dependencies). Node >= 20.
// Docs: https://openrouter.ai/docs
import { spawnSync } from 'node:child_process';

export const API = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
export const DEFAULTS = {
  text: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5',
  npc: process.env.OPENROUTER_NPC_MODEL ?? 'deepseek/deepseek-v4.1-flash',
  image: process.env.OPENROUTER_IMAGE_MODEL ?? 'openai/gpt-image-2.5-flare',
};

/**
 * Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1
 * (Node >= 22.21 / 24). Behind a proxy (e.g. Claude Code cloud sessions),
 * re-run this script once with it switched on. No-op everywhere else.
 */
export function ensureProxySupport() {
  const proxied = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxied || process.env.NODE_USE_ENV_PROXY) return;
  const r = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

export function headers() {
  const h = {
    'Content-Type': 'application/json',
    // Optional attribution headers; they show up in your OpenRouter dashboard.
    'HTTP-Referer': process.env.OPENROUTER_APP_URL ?? 'https://github.com/tm-coder-484/game-dev-env',
    'X-Title': process.env.OPENROUTER_APP_NAME ?? 'game-dev-env',
  };
  // No key in the environment is fine when an API credential is configured on the
  // Claude Code cloud environment: the agent proxy attaches it on the way out.
  if (process.env.OPENROUTER_API_KEY) h.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  return h;
}

async function call(path, body, method = 'POST') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { message: text.slice(0, 500) } };
  }
  if (!res.ok || data.error) {
    const msg = data.error?.message ?? res.statusText;
    const hint = res.status === 401 ? ' (set OPENROUTER_API_KEY - see .env.example)' : '';
    throw new Error(`OpenRouter ${res.status}: ${msg}${hint}`);
  }
  return data;
}

/** Chat completion. messages = [{role, content}]. Returns { text, model, usage }. */
export async function chat(messages, { model = DEFAULTS.text, maxTokens = 1024, temperature, json = false } = {}) {
  const data = await call('/chat/completions', {
    model,
    messages,
    max_tokens: maxTokens,
    ...(temperature !== undefined && { temperature }),
    ...(json && { response_format: { type: 'json_object' } }),
  });
  return { text: data.choices?.[0]?.message?.content ?? '', model: data.model, usage: data.usage };
}

/** Public model list (no key needed). */
export async function models({ output } = {}) {
  const data = await call(`/models${output ? `?output_modalities=${output}` : ''}`, null, 'GET');
  return data.data;
}
