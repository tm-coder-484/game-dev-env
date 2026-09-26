// Player HUD: health/stamina bars, crosshair, 5-slot hotbar (1-5 / mouse wheel).
// Uses the same images as the Godot HUD (godot/assets/ui/). Regenerate them
// with any image model:  node tools/openrouter/assets.mjs ui-kit
const ui = {
  frame: new URL('../../godot/assets/ui/hud/bar_frame.png', import.meta.url).href,
  health: new URL('../../godot/assets/ui/hud/bar_fill_health.png', import.meta.url).href,
  stamina: new URL('../../godot/assets/ui/hud/bar_fill_stamina.png', import.meta.url).href,
  slot: new URL('../../godot/assets/ui/hud/slot.png', import.meta.url).href,
  slotSelected: new URL('../../godot/assets/ui/hud/slot_selected.png', import.meta.url).href,
  crosshair: new URL('../../godot/assets/ui/hud/crosshair.png', import.meta.url).href,
};
const ICONS: Record<string, string> = {
  sword: new URL('../../godot/assets/ui/icons/sword.png', import.meta.url).href,
  pickaxe: new URL('../../godot/assets/ui/icons/pickaxe.png', import.meta.url).href,
  torch: new URL('../../godot/assets/ui/icons/torch.png', import.meta.url).href,
  potion: new URL('../../godot/assets/ui/icons/potion.png', import.meta.url).href,
  map: new URL('../../godot/assets/ui/icons/map.png', import.meta.url).href,
};
const ITEMS = Object.keys(ICONS);

const CSS = `
#hud-bars { position: fixed; left: 24px; bottom: 24px; display: grid; gap: 4px; pointer-events: none; }
.hud-bar { position: relative; width: 282px; height: 35px; background: url(${ui.frame}) center / 100% 100% no-repeat; }
.hud-bar > div { position: absolute; left: 6.6px; top: 6.6px; width: 268.4px; height: 22px; overflow: hidden; }
.hud-bar > div > img { width: 268.4px; height: 22px; display: block; }
#hud-crosshair { position: fixed; left: 50%; top: 50%; width: 32px; height: 32px; margin: -16px 0 0 -16px; pointer-events: none; }
#hud-hotbar { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; gap: 8px; pointer-events: none; }
.hud-slot { width: 72px; height: 72px; background: center / 100% 100% no-repeat; display: grid; place-items: center; }
.hud-slot img { width: 52px; height: 52px; }
#hud-item { position: fixed; left: 50%; bottom: 104px; transform: translateX(-50%); color: #fff; font: 600 18px system-ui;
  text-shadow: 0 0 4px #000, 0 0 2px #000; pointer-events: none; transition: opacity .5s; }`;

export class Hud {
  private readonly healthFill: HTMLDivElement;
  private readonly staminaFill: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly itemLabel: HTMLDivElement;
  private selected = 0;
  private labelTimer = 0;

  constructor() {
    document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`);
    const bar = (fill: string) => {
      const el = document.createElement('div');
      el.className = 'hud-bar';
      el.innerHTML = `<div><img src="${fill}" alt=""></div>`;
      return el;
    };
    const bars = document.createElement('div');
    bars.id = 'hud-bars';
    const h = bar(ui.health);
    const s = bar(ui.stamina);
    bars.append(h, s);
    this.healthFill = h.firstElementChild as HTMLDivElement;
    this.staminaFill = s.firstElementChild as HTMLDivElement;

    const cross = Object.assign(document.createElement('img'), { id: 'hud-crosshair', src: ui.crosshair, alt: '' });
    const hotbar = document.createElement('div');
    hotbar.id = 'hud-hotbar';
    for (const item of ITEMS) {
      const slot = document.createElement('div');
      slot.className = 'hud-slot';
      slot.innerHTML = `<img src="${ICONS[item]}" alt="${item}">`;
      hotbar.append(slot);
      this.slots.push(slot);
    }
    this.itemLabel = Object.assign(document.createElement('div'), { id: 'hud-item' });
    document.body.append(bars, cross, hotbar, this.itemLabel);

    addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= ITEMS.length) this.select(n - 1);
    });
    addEventListener('wheel', (e) => this.select((this.selected + (e.deltaY > 0 ? 1 : ITEMS.length - 1)) % ITEMS.length));
    this.select(0);
  }

  select(i: number): void {
    this.selected = i;
    this.slots.forEach((s, k) => (s.style.backgroundImage = `url(${k === i ? ui.slotSelected : ui.slot})`));
    this.itemLabel.textContent = ITEMS[i][0].toUpperCase() + ITEMS[i].slice(1);
    this.itemLabel.style.opacity = '1';
    this.labelTimer = 1.5;
  }

  update(dt: number, stats: { health: number; maxHealth: number; stamina: number; maxStamina: number }): void {
    this.healthFill.style.width = `${(268.4 * stats.health) / stats.maxHealth}px`;
    this.staminaFill.style.width = `${(268.4 * stats.stamina) / stats.maxStamina}px`;
    this.labelTimer -= dt;
    if (this.labelTimer < 0.5) this.itemLabel.style.opacity = String(Math.max(0, this.labelTimer / 0.5));
  }
}
