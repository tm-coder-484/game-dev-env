// Progress lives in this browser's localStorage. Storage can be missing or
// throw (private windows, blocked site data), so every access is guarded and
// the game works without it.

export interface SaveData {
  v: 1;
  unlocked: number;
  stars: Record<string, number>;
  coins: number;
  shields: number;
  endlessBest: number;
  daily: Record<string, { stars: number; time: number }>;
  skins: string[];
  skin: string;
  seen: string[];
  settings: { sfx: boolean; music: boolean; shake: boolean; haptics: boolean };
}

const KEY = 'tomb-of-the-token/v1';

export function defaults(): SaveData {
  return {
    v: 1,
    unlocked: 1,
    stars: {},
    coins: 0,
    shields: 1,
    endlessBest: 0,
    daily: {},
    skins: ['clay'],
    skin: 'clay',
    seen: [],
    settings: { sfx: true, music: true, shake: true, haptics: true },
  };
}

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw) as Partial<SaveData>;
    const d = defaults();
    return { ...d, ...data, settings: { ...d.settings, ...(data.settings ?? {}) } } as SaveData;
  } catch {
    return defaults();
  }
}

export function store(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: progress lasts for this visit only.
  }
}

export function totalStars(s: SaveData): number {
  return Object.values(s.stars).reduce((a, b) => a + b, 0);
}
