// Post-processing for generated game art (sharp; works on Windows/macOS/Linux).
import sharp from 'sharp';

const clamp = (v, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

async function rgba(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const toPng = (data, w, h, channels = 4) => sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();

/**
 * Remove a flat chroma-key background ('green' or 'magenta') with soft edges
 * and spill suppression. Returns a PNG with alpha.
 */
export async function chromaKey(input, key = 'green', { tolerance = 90, softness = 70 } = {}) {
  const { data, w, h } = await rgba(input);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // "How much more key-coloured than the other channels": robust to shading.
    const excess = key === 'green' ? g - Math.max(r, b) : Math.min(r, b) - g;
    const a = clamp(255 * (1 - (excess - (tolerance - softness)) / softness));
    if (a < 255 && excess > 0) {
      // Spill suppression on edges: subtract the key-coloured excess.
      if (key === 'green') data[i + 1] = g - excess;
      else {
        data[i] = r - excess;
        data[i + 2] = b - excess;
      }
    }
    data[i + 3] = Math.min(data[i + 3], a);
  }
  return toPng(data, w, h);
}

/** Crop transparent borders, then fit inside size x size (or w x h), centred. */
export async function trimAndFit(input, width, height = width, { pad = 0 } = {}) {
  let img = sharp(input).ensureAlpha();
  try {
    img = sharp(await img.trim({ threshold: 1 }).toBuffer());
  } catch {
    /* fully transparent or nothing to trim */
  }
  return img
    .resize(width - pad * 2, height - pad * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Foliage card: crop transparent borders, fit inside w x h with the plant's base on the bottom edge,
 * centred horizontally. Instanced grass/flower meshes put the card's bottom at ground level.
 */
export async function fitBottom(input, w, h) {
  let img = sharp(input).ensureAlpha();
  try {
    img = sharp(await img.trim({ threshold: 1 }).toBuffer());
  } catch {
    /* nothing to trim */
  }
  const fitted = await img
    .resize(w, h, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = fitted.info;
  const left = Math.floor((w - width) / 2);
  return sharp(fitted.data)
    .extend({ top: h - height, bottom: 0, left, right: w - width - left, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Place PNG cells side by side into one atlas row (all cells w x h). */
export async function atlasRow(cells, w, h) {
  return sharp({ create: { width: w * cells.length, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: i * w, top: 0 })))
    .png()
    .toBuffer();
}

/** Crop transparent borders, then stretch to exactly w x h - for bars, frames, slots. */
export async function trimAndStretch(input, w, h) {
  let buf = await sharp(input).ensureAlpha().png().toBuffer();
  try {
    buf = await sharp(buf).trim({ threshold: 1 }).toBuffer();
  } catch {
    /* nothing to trim */
  }
  return sharp(buf).resize(w, h, { fit: 'fill' }).png().toBuffer();
}

/**
 * Make any texture tile seamlessly: blend it with a half-offset copy of itself,
 * using the original in the middle and the (already wrapped) copy at the edges.
 */
export async function makeSeamless(input, size) {
  const src = size ? await sharp(input).resize(size, size, { fit: 'cover' }).toBuffer() : input;
  const { data, w, h } = await rgba(src);
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = (((y + (h >> 1)) % h) * w + ((x + (w >> 1)) % w)) * 4;
      // weight 1 in the centre, 0 at the borders (smooth in both axes)
      const wx = 1 - Math.abs((2 * x) / (w - 1) - 1);
      const wy = 1 - Math.abs((2 * y) / (h - 1) - 1);
      let t = Math.min(wx, wy) * 2.2;
      t = t >= 1 ? 1 : t * t * (3 - 2 * t);
      for (let c = 0; c < 4; c++) out[i + c] = Math.round(data[i + c] * t + data[j + c] * (1 - t));
    }
  }
  return toPng(out, w, h);
}

/**
 * Derive PBR maps from an albedo texture (a good starting point for AI
 * textures, which only come as colour): height from luminance, an OpenGL-style
 * normal map (what Godot and three.js expect), and a roughness guess.
 * Sampling wraps, so tileable input gives tileable maps.
 */
export async function pbrFromAlbedo(input, { strength = 2.5, blur = 1.2 } = {}) {
  const grey = await sharp(input).greyscale().blur(blur).normalise().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = grey.info;
  const H = grey.data;
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)] / 255;
  const normal = Buffer.alloc(w * h * 3);
  const rough = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1; // +Y up (OpenGL)
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * w + x) * 3;
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      // cavities (dark/low) read rougher, raised highlights a bit smoother
      rough[y * w + x] = Math.round(clamp(255 * (0.95 - 0.35 * at(x, y)), 0, 255));
    }
  }
  return {
    height: await sharp(H, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(),
    normal: await toPng(normal, w, h, 3),
    roughness: await sharp(rough, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(),
  };
}

/** 2x2 tiling preview - the quickest way to spot seams. */
export async function tilePreview(input, size = 512) {
  const tile = await sharp(input).resize(size, size).png().toBuffer();
  return sharp({ create: { width: size * 2, height: size * 2, channels: 4, background: '#000' } })
    .composite([0, 1, 2, 3].map((k) => ({ input: tile, left: (k % 2) * size, top: (k >> 1) * size })))
    .png()
    .toBuffer();
}
