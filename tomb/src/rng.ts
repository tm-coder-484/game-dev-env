// Small deterministic PRNG (mulberry32) plus helpers. Every level is a pure
// function of its seed, so stage 12 is the same tomb on every device.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [a, b] (inclusive). */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Index chosen with probability proportional to weights[i]. */
  weighted(weights: ArrayLike<number>, count = weights.length): number {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += weights[i];
    let r = this.next() * sum;
    for (let i = 0; i < count; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return count - 1;
  }
}

/** Stable 32-bit hash of any mix of strings and numbers (FNV-1a + avalanche). */
export function hash(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? `#${p}` : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
