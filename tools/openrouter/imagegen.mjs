// Image generation through OpenRouter's Image API, with ANY image model.
// Reads each model's capabilities from /images/models and adapts the request:
// nearest supported aspect ratio, native transparent backgrounds when the
// model has them (otherwise a chroma-key background that imageops removes),
// reference-image limits, quality/resolution/seed only where supported.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { API, DEFAULTS, headers } from './lib.mjs';

let catalog = null;

/** All image models with their supported_parameters (public, no key needed). */
export async function imageModels() {
  if (catalog) return catalog;
  const res = await fetch(`${API}/images/models`, { headers: headers() });
  if (!res.ok) throw new Error(`could not list image models: HTTP ${res.status}`);
  const body = await res.json();
  catalog = body.data ?? body;
  return catalog;
}

/**
 * Resolve a full id ("openai/gpt-image-2.5-sunburst") or any unique fragment
 * ("sunburst", "gpt-image-2.5-flare", "nano banana pro") to a model.
 */
export async function resolveModel(query = DEFAULTS.image) {
  const models = await imageModels();
  const q = query.toLowerCase().trim();
  const exact = models.find((m) => m.id.toLowerCase() === q);
  if (exact) return exact;
  const words = q.split(/\s+/);
  const hits = models.filter((m) => words.every((w) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(w)));
  const suffix = hits.filter((m) => m.id.toLowerCase().endsWith(`/${q}`) || m.id.toLowerCase().endsWith(q));
  const stable = hits.filter((m) => !/preview|beta/i.test(m.id)); // prefer GA over -preview twins
  const pick = hits.length === 1 ? hits : suffix.length === 1 ? suffix : stable.length === 1 ? stable : null;
  if (pick) return pick[0];
  if (!hits.length) throw new Error(`no image model matches "${query}" - try: assets.mjs models`);
  throw new Error(`"${query}" is ambiguous: ${hits.map((m) => m.id).join(', ')}`);
}

export function capabilities(model) {
  const sp = model.supported_parameters ?? {};
  const values = (k) => sp[k]?.values ?? [];
  return {
    aspects: values('aspect_ratio').filter((a) => a !== 'auto'),
    resolutions: values('resolution'),
    qualities: values('quality'),
    formats: values('output_format'),
    transparent: values('background').includes('transparent'),
    maxRefs: sp.input_references?.max ?? 0,
    maxN: sp.n?.max ?? 1,
    seed: !!sp.seed,
  };
}

const ratio = (a) => {
  const [w, h] = a.split(':').map(Number);
  return w / h;
};
/** Closest supported aspect ratio (log distance), or the request if none listed. */
export function nearestAspect(want, supported) {
  if (!supported.length || supported.includes(want)) return want;
  return supported.reduce((best, a) =>
    Math.abs(Math.log(ratio(a) / ratio(want))) < Math.abs(Math.log(ratio(best) / ratio(want))) ? a : best);
}

function dataUrl(path) {
  const ext = extname(path).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${readFileSync(path).toString('base64')}`;
}

export const KEY_COLORS = { green: '#00FF00', magenta: '#FF00FF' };

/**
 * Generate images. Returns { model, request, images: [{bytes, mediaType}], keyed, cost }.
 * `keyed` is the chroma colour the caller must remove when native transparency
 * wasn't available (null otherwise).
 */
export async function generate({
  prompt, model: modelQuery, aspect = '1:1', resolution, quality, n = 1, seed,
  transparent = false, key = 'green', refs = [], format, dryRun = false,
}) {
  const model = await resolveModel(modelQuery);
  const caps = capabilities(model);
  const body = { model: model.id, prompt, n: Math.min(n, caps.maxN) };
  const notes = [];

  const ar = nearestAspect(aspect, caps.aspects);
  if (ar !== aspect) notes.push(`aspect ${aspect} -> ${ar} (model limit)`);
  body.aspect_ratio = ar;
  if (resolution && caps.resolutions.includes(resolution)) body.resolution = resolution;
  else if (!resolution && caps.resolutions.includes('1K')) body.resolution = '1K';
  if (quality && caps.qualities.includes(quality)) body.quality = quality;
  if (seed !== undefined && caps.seed) body.seed = seed;
  if (format && (caps.formats.includes(format) || !caps.formats.length)) body.output_format = format;

  let keyed = null;
  if (transparent) {
    if (caps.transparent) {
      body.background = 'transparent';
      if (!format) body.output_format = 'png';
    } else {
      keyed = key;
      body.prompt +=
        ` Isolated on a perfectly flat, uniform, pure ${key} (${KEY_COLORS[key]}) chroma-key background` +
        ` that fills the whole canvas edge to edge. No shadow, gradient, vignette or texture on the background,` +
        ` and no ${key} anywhere in the subject.`;
      notes.push(`no native transparency: ${key}-screen + chroma key`);
    }
  }
  if (refs.length) {
    const use = refs.slice(0, caps.maxRefs);
    if (use.length < refs.length) notes.push(`model takes ${caps.maxRefs} reference image(s); dropped ${refs.length - use.length}`);
    if (use.length) body.input_references = use.map((p) => ({ type: 'image_url', image_url: { url: /^https?:|^data:/.test(p) ? p : dataUrl(p) } }));
  }

  const printable = { ...body, input_references: body.input_references?.map(() => '<image>') };
  if (dryRun) return { model: model.id, request: printable, images: [], keyed, notes };

  const res = await fetch(`${API}/images`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { message: text.slice(0, 300) } };
  }
  if (!res.ok || data.error) {
    const hint = res.status === 401 ? ' (set OPENROUTER_API_KEY - see .env.example)' : '';
    throw new Error(`OpenRouter ${res.status}: ${data.error?.message ?? res.statusText}${hint}`);
  }
  const images = (data.data ?? []).map((d) => ({
    bytes: Buffer.from(d.b64_json, 'base64'),
    mediaType: d.media_type ?? 'image/png',
  }));
  if (!images.length) throw new Error('model returned no images');
  return { model: model.id, request: printable, images, keyed, notes, cost: data.usage?.cost };
}
