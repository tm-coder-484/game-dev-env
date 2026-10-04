// Tomb of the Token: screens, HUD, input routing and the main loop.

import './style.css';
import { Game, todayKey, newRunSeed, type GameEvent } from './sim.ts';
import { Bot } from './bot.ts';
import { Renderer } from './render.ts';
import { Sound } from './audio.ts';
import { Input, type Command } from './input.ts';
import { load, store, defaults, totalStars, type SaveData } from './save.ts';
import {
  THEMES, themeForStage, SKINS, C, SPARK, SPINNER, SPINNER_CHARS, spinnerFrame, POWER_ICONS,
  drawBitmap, drawClawd, drawText, iconURL, POSE_IDLE, type Pose, type Theme,
} from './art.ts';
import { IT_DOT, IT_COIN, IT_STAR, IT_SHIELD, IT_MAGNET, IT_FREEZE } from './gen.ts';

type ScreenId = 'title' | 'stages' | 'endless' | 'daily' | 'skins' | 'settings';
type Mode = 'menu' | 'loading' | 'play' | 'pause' | 'result';
type Launch = { kind: 'stage'; n: number } | { kind: 'endless' } | { kind: 'daily' };

// Spinner verbs from Claude Code itself, plus a few for tombs.
const VERBS = [
  'Excavating', 'Entombing', 'Clauding', 'Burrowing', 'Architecting', 'Combobulating', 'Forging', 'Hatching',
  'Meandering', 'Noodling', 'Spelunking', 'Crafting', 'Conjuring', 'Bootstrapping', 'Choreographing', 'Germinating',
  'Flibbertigibbeting', 'Reticulating', 'Hyperspacing', 'Moseying',
];

const TIPS = [
  'Clawd only stops when he hits a wall. Plan where each slide ends.',
  'All three stars sit on one route, so you can always collect them in one run.',
  'Spikes only hurt if you stop on them. Sliding past is fine.',
  'Bugs and gates never cover a spot where you can stop. Wait there for a gap.',
  'Traps spring half a second after you land. Keep moving.',
  'Swipe in an L shape to queue a second slide.',
  'Each stage is generated from its number, so your friends get the same tomb.',
  'The pause power-up stops the context window too.',
];

const CAUSES: Record<string, [string, string]> = {
  spikes: ['Stopped on spikes', 'Spikes only hurt when you stop on them. Sliding past is fine.'],
  bug: ['Bitten by a bug', 'Bugs cross corridors. Standing still is safe, so wait for the gap.'],
  gate: ['Zapped by a gate', 'Gates blink before they switch on. Slide through while the line is dotted.'],
  trap: ['A trap sprang shut', 'Traps fire half a second after you land. Keep moving.'],
  context: ['Context limit reached', 'The context window caught up with Clawd. Keep climbing.'],
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

declare global {
  interface Window {
    __tott?: unknown;
    claude?: { hot?: { ready?: (fn: (d: Record<string, unknown>) => void) => void; data?: Record<string, unknown>; snapshot?: (fn: () => unknown) => void } };
  }
}

class App {
  save: SaveData = load();
  sound = new Sound();
  input: Input;
  renderer: Renderer;
  canvas = $<HTMLCanvasElement>('view');
  mode: Mode = 'menu';
  screen: ScreenId = 'title';
  game: Game | null = null;
  launchSpec: Launch | null = null;
  autoplay: Bot | null = null;
  demo: { game: Game; bot: Bot; over: number } | null = null;
  private last = performance.now();
  private time = 0;
  private resultAt = -1;
  private hud = { coins: -1, stars: -1, height: -1, ctx: '', powers: '', shields: -1 };
  private icons: Record<string, string> = {};
  private toastTimer = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private resetArmed = 0;
  private endlessTheme = 0;

  constructor() {
    const skin = SKINS.find((s) => s.id === this.save.skin) ?? SKINS[0];
    this.renderer = new Renderer(this.canvas, THEMES[0], skin);
    this.input = new Input(this.canvas);
    this.sound.sfxOn = this.save.settings.sfx;
    this.sound.musicOn = this.save.settings.music;
    this.makeIcons();
    this.bind();
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.mode === 'play') this.pause();
        this.sound.stopMusic();
      } else this.music();
    });
  }

  // ----------------------------------------------------------- setup ----

  private makeIcons(): void {
    const ic = this.icons;
    ic.coin = iconURL((c) => drawBitmap(c, SPINNER[4], 0, 0, C.clay, C.light), 7, 7, 6);
    ic.starOn = iconURL((c) => drawBitmap(c, SPARK[0], 0, 0, C.clay, C.light), 9, 9, 6);
    ic.starOff = iconURL((c) => drawBitmap(c, SPARK[0], 0, 0, '#3d3c38', '#55534e'), 9, 9, 6);
    ic.shield = iconURL((c) => drawBitmap(c, POWER_ICONS[IT_SHIELD], 0, 0, C.blue, C.light), 7, 7, 6);
    ic.magnet = iconURL((c) => drawBitmap(c, POWER_ICONS[IT_MAGNET], 0, 0, C.light, C.blue), 7, 7, 6);
    ic.freeze = iconURL((c) => drawBitmap(c, POWER_ICONS[IT_FREEZE], 0, 0, C.light, C.blue), 7, 7, 6);
    $<HTMLImageElement>('hud-coin-icon').src = ic.coin;
    $<HTMLImageElement>('hud-shield-icon').src = ic.shield;
  }

  private bind(): void {
    this.input.onGesture = () => {
      const was = this.sound.ready;
      this.sound.unlock();
      if (!was) setTimeout(() => this.music(), 50);
    };
    this.input.onDir = (d) => this.dir(d);
    this.input.onCommand = (c) => this.command(c);
    document.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sound.click();
        this.show(b.dataset.go as ScreenId);
      }),
    );
    $('hud-pause').addEventListener('click', () => this.pause());
    $('hud-shield').addEventListener('click', () => this.useShield());
    $('endless-go').addEventListener('click', () => this.launch({ kind: 'endless' }));
    $('daily-go').addEventListener('click', () => this.launch({ kind: 'daily' }));
  }

  resize(): void {
    const app = $('app');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.renderer.resize(app.clientWidth, app.clientHeight, dpr);
  }

  private music(): void {
    if (!this.sound.ready || document.hidden) return;
    if (!this.save.settings.music) return;
    const world = this.mode === 'play' || this.mode === 'pause' || this.mode === 'result'
      ? THEMES.indexOf(this.renderer.theme)
      : 0;
    this.sound.startMusic(Math.max(0, world));
  }

  private persist(): void {
    store(this.save);
  }

  // ---------------------------------------------------------- routing ----

  show(id: ScreenId): void {
    this.screen = id;
    this.mode = 'menu';
    this.game = null;
    this.autoplay = null;
    for (const s of ['title', 'stages', 'endless', 'daily', 'skins', 'settings']) $(`screen-${s}`).hidden = s !== id;
    $('hud').hidden = true;
    $('pause').hidden = true;
    $('result').hidden = true;
    $('loading').hidden = true;
    this.hideToast();
    if (id === 'title') this.renderTitle();
    if (id === 'stages') this.renderStages();
    if (id === 'endless') this.renderEndless();
    if (id === 'daily') this.renderDaily();
    if (id === 'skins') this.renderSkins();
    if (id === 'settings') this.renderSettings();
    if (!this.demo) this.newDemo();
    else this.renderer.setTheme(themeForStage(this.demo.game.stage));
    this.renderer.reset();
    this.sound.startMusic(0);
    if (!this.save.settings.music) this.sound.stopMusic();
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(`#screen-${id} .row, #screen-${id} .node.next, #screen-${id} .cta`);
      if (first && matchMedia('(hover: hover)').matches) first.focus({ preventScroll: true });
    });
  }

  private newDemo(): void {
    const stage = 2 + Math.floor(Math.random() * 38);
    const game = new Game({ mode: 'stage', stage });
    this.demo = { game, bot: new Bot(game, 0.35), over: 0 };
    this.renderer.setTheme(themeForStage(stage));
    this.renderer.reset();
  }

  private dir(d: number): void {
    if (this.mode === 'play' && this.game) {
      if (!this.autoplay) this.game.input(d);
      return;
    }
    // In menus the arrows move focus between buttons.
    const scope = this.mode === 'pause' ? $('pause') : this.mode === 'result' ? $('result') : $(`screen-${this.screen}`);
    if (this.mode === 'loading') return;
    const items = [...scope.querySelectorAll<HTMLElement>('button:not([disabled])')].filter((b) => b.offsetParent);
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement as HTMLElement);
    if (this.screen === 'stages' && this.mode === 'menu' && cur >= 0 && (d === 1 || d === 3)) {
      items[Math.max(0, Math.min(items.length - 1, cur + (d === 1 ? 1 : -1)))].focus();
      return;
    }
    if (d === 3 && this.mode === 'menu' && this.screen !== 'title') {
      this.show('title');
      return;
    }
    const next = cur < 0 ? 0 : (cur + (d === 2 || d === 1 ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
    this.sound.tick();
  }

  private command(c: Command): void {
    if (c === 'mute') {
      const on = !(this.save.settings.sfx || this.save.settings.music);
      this.save.settings.sfx = on;
      this.save.settings.music = on;
      this.sound.sfxOn = on;
      this.sound.setMusic(on);
      if (on) this.music();
      this.persist();
      this.toast(on ? 'Sound on' : 'Sound off', 1200);
      return;
    }
    if (this.mode === 'play') {
      if (c === 'pause' || c === 'back') this.pause();
      if (c === 'restart' && this.launchSpec) this.launch(this.launchSpec, true);
    } else if (this.mode === 'pause') {
      if (c === 'pause' || c === 'back') this.resume();
      if (c === 'restart' && this.launchSpec) this.launch(this.launchSpec, true);
      if (c === 'confirm') (document.activeElement as HTMLElement | null)?.click();
    } else if (this.mode === 'result') {
      if (c === 'confirm' || c === 'restart') {
        const first = document.querySelector<HTMLButtonElement>('#result-actions button');
        if (c === 'restart' && this.launchSpec) this.launch(this.launchSpec, true);
        else first?.click();
      }
      if (c === 'back') this.show(this.launchSpec?.kind === 'stage' ? 'stages' : 'title');
    } else if (this.mode === 'menu') {
      if (c === 'back' && this.screen !== 'title') this.show('title');
      if (c === 'confirm') {
        const f = document.activeElement as HTMLElement | null;
        if (f && f.tagName === 'BUTTON') f.click();
        else document.querySelector<HTMLButtonElement>(`#screen-${this.screen} .row, #screen-${this.screen} .cta`)?.click();
      }
    }
  }

  // ----------------------------------------------------------- screens ----

  private row(label: string, meta: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `row ${cls}`;
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<span class="label"></span><span class="meta"></span>`;
    (b.firstChild as HTMLElement).textContent = label;
    (b.lastChild as HTMLElement).textContent = meta;
    b.addEventListener('click', () => {
      this.sound.click();
      onClick();
    });
    b.addEventListener('focus', () => b.classList.add('sel'));
    b.addEventListener('blur', () => b.classList.remove('sel'));
    return b;
  }

  private renderTitle(): void {
    const rows = $('title-rows');
    rows.replaceChildren(
      this.row('Stages', `✻ ${totalStars(this.save)} · stage ${this.save.unlocked}`, () => this.show('stages')),
      this.row('Endless climb', this.save.endlessBest ? `best ${this.save.endlessBest} m` : 'new', () => this.show('endless')),
      this.row('Daily tomb', new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), () => this.show('daily')),
      this.row('Skins', plural(this.save.coins, 'coin'), () => this.show('skins')),
      this.row('Settings & help', '', () => this.show('settings')),
    );
    const touch = matchMedia('(pointer: coarse)').matches;
    $('title-hint').textContent = touch ? 'swipe to slide · tap a row to start' : 'arrow keys or WASD to slide · enter to choose · esc for menu';
  }

  private renderStages(): void {
    $('stages-stars').textContent = `✻ ${totalStars(this.save)}`;
    const list = $('stages-list');
    list.replaceChildren();
    const worlds = Math.max(2, Math.ceil((this.save.unlocked + 4) / 10));
    let next: HTMLElement | null = null;
    for (let w = 0; w < worlds; w++) {
      const theme = THEMES[w % THEMES.length];
      const sec = document.createElement('section');
      sec.className = 'world';
      const h = document.createElement('h2');
      h.innerHTML = `<i></i><span></span>`;
      (h.firstChild as HTMLElement).style.background = theme.wall;
      (h.firstChild as HTMLElement).style.borderColor = theme.wallLight;
      (h.lastChild as HTMLElement).textContent = `World ${w + 1} · ${theme.name} · stages ${w * 10 + 1}-${w * 10 + 10}`;
      const grid = document.createElement('div');
      grid.className = 'nodes';
      for (let i = 0; i < 10; i++) {
        const n = w * 10 + i + 1;
        const r = Math.floor(i / 3);
        const col = r % 2 === 0 ? i % 3 : 2 - (i % 3);
        const b = document.createElement('button');
        b.type = 'button';
        const stars = this.save.stars[n] ?? 0;
        const locked = n > this.save.unlocked;
        b.className = 'node';
        if (locked) b.classList.add('locked');
        if (stars > 0) b.classList.add('done');
        if (n === this.save.unlocked && !stars) {
          b.classList.add('next');
          next = b;
        }
        if (i < 9) b.classList.add(Math.floor((i + 1) / 3) !== r ? 'to-down' : r % 2 === 0 ? 'to-right' : 'to-left');
        b.style.gridRow = String(r + 1);
        b.style.gridColumn = String(col + 1);
        b.setAttribute('aria-label', locked ? `Stage ${n}, locked` : `Stage ${n}, ${stars} of 3 stars`);
        b.innerHTML = locked
          ? `<b>🔒︎</b><span class="st">✻✻✻</span>`
          : `<b>${n}</b><span class="st">${[0, 1, 2].map((k) => `<span class="${k < stars ? 'on' : ''}">✻</span>`).join('')}</span>`;
        if (locked) b.disabled = true;
        else b.addEventListener('click', () => this.launch({ kind: 'stage', n }));
        grid.append(b);
      }
      sec.append(h, grid);
      list.append(sec);
    }
    requestAnimationFrame(() => (next ?? list.querySelector('.node.done:last-of-type'))?.scrollIntoView({ block: 'center' }));
  }

  private renderEndless(): void {
    $('endless-best').textContent = `${this.save.endlessBest} m`;
    $('endless-coins').textContent = plural(this.save.coins, 'coin');
  }

  private renderDaily(): void {
    const key = todayKey();
    const d = new Date();
    $('daily-date').textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    $('daily-title').textContent = `Tomb for ${key}`;
    const best = this.save.daily[key];
    $('daily-best').textContent = best ? `${best.stars}/3 stars · ${fmtTime(best.time)}` : 'not played yet';
  }

  private renderSkins(): void {
    $('skins-coins').textContent = plural(this.save.coins, 'coin');
    const shop = $('shop-shield');
    shop.innerHTML = `<img alt="" src="${this.icons.shield}"><div class="txt"><b>Shield</b><p>Tap it during a stage to survive one hit. You have ${this.save.shields}.</p></div>`;
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'cta';
    buy.textContent = '30 coins';
    buy.disabled = this.save.coins < 30;
    buy.addEventListener('click', () => {
      if (this.save.coins < 30) return;
      this.save.coins -= 30;
      this.save.shields++;
      this.persist();
      this.sound.coin();
      this.renderSkins();
    });
    shop.append(buy);
    const grid = $('skins-grid');
    grid.replaceChildren();
    for (const s of SKINS) {
      const card = document.createElement('div');
      card.className = 'skin' + (this.save.skin === s.id ? ' on' : '');
      const cv = document.createElement('canvas');
      cv.width = 20;
      cv.height = 16;
      const ctx = cv.getContext('2d')!;
      drawClawd(ctx, 10, 13, 2, POSE_IDLE, s.body, s.eye);
      const owned = this.save.skins.includes(s.id);
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = s.name;
      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = owned ? (this.save.skin === s.id ? 'wearing' : 'owned') : `${s.price} coins`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cta' + (owned ? ' ghost' : '');
      btn.textContent = owned ? (this.save.skin === s.id ? 'Equipped' : 'Wear') : 'Buy';
      btn.disabled = (owned && this.save.skin === s.id) || (!owned && this.save.coins < s.price);
      btn.addEventListener('click', () => {
        if (!owned) {
          if (this.save.coins < s.price) return;
          this.save.coins -= s.price;
          this.save.skins.push(s.id);
          this.sound.star();
        } else this.sound.click();
        this.save.skin = s.id;
        this.renderer.skin = s;
        this.persist();
        this.renderSkins();
      });
      card.append(cv, name, price, btn);
      grid.append(card);
    }
  }

  private renderSettings(): void {
    const list = $('settings-list');
    const st = this.save.settings;
    const toggle = (label: string, key: keyof SaveData['settings'], after?: (v: boolean) => void) => {
      const b = this.row(label, st[key] ? 'on' : 'off', () => {
        st[key] = !st[key];
        after?.(st[key]);
        this.persist();
        this.renderSettings();
      }, 'toggle');
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', String(st[key]));
      return b;
    };
    const reset = this.row(
      this.resetArmed > performance.now() ? 'Tap again to erase all progress' : 'Reset progress',
      '',
      () => {
        if (this.resetArmed > performance.now()) {
          const keep = this.save.settings;
          this.save = defaults();
          this.save.settings = keep;
          this.persist();
          this.resetArmed = 0;
          this.toast('Progress erased', 1500);
        } else this.resetArmed = performance.now() + 3000;
        this.renderSettings();
      },
      'danger',
    );
    list.replaceChildren(
      toggle('Sound effects', 'sfx', (v) => (this.sound.sfxOn = v)),
      toggle('Music', 'music', (v) => {
        this.sound.setMusic(v);
        if (v) this.music();
        else this.sound.stopMusic();
      }),
      toggle('Screen shake', 'shake'),
      toggle('Vibration', 'haptics'),
      reset,
    );
  }

  // ------------------------------------------------------------ playing ----

  launch(spec: Launch, quick = false): void {
    this.launchSpec = spec;
    this.mode = 'loading';
    this.game = null;
    this.autoplay = null;
    this.resultAt = -1;
    for (const s of ['title', 'stages', 'endless', 'daily', 'skins', 'settings']) $(`screen-${s}`).hidden = true;
    $('pause').hidden = true;
    $('result').hidden = true;
    $('hud').hidden = true;
    this.hideToast();
    const loading = $('loading');
    loading.hidden = false;
    const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
    $('load-verb').textContent = `${verb}…`;
    $('load-meta').textContent = '';
    const lines = $('load-lines');
    lines.replaceChildren();
    const t0 = performance.now();
    // Two frames so the spinner is on screen before the generator blocks.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const g0 = performance.now();
        const game =
          spec.kind === 'stage'
            ? new Game({ mode: 'stage', stage: spec.n })
            : spec.kind === 'daily'
              ? new Game({ mode: 'daily', dateKey: todayKey() })
              : new Game({ mode: 'endless', seed: newRunSeed() });
        const ms = performance.now() - g0;
        const L = game.level;
        let spikes = 0;
        for (const s of L.spikes) for (let b = s; b; b &= b - 1) spikes++;
        const hz = [
          plural(spikes, 'spike'),
          plural(L.bugs.length, 'bug'),
          plural(L.gates.length, 'gate'),
          plural(L.traps.length, 'trap'),
        ].filter((x) => !x.startsWith('0 '));
        const info: string[] =
          spec.kind === 'endless'
            ? [
                `Generated ${game.world.chunks.length} chunks of ${L.h - 2} rows · more as you climb`,
                'The context window starts rising 4 s after your first move',
                `Tip: ${TIPS[Math.floor(Math.random() * TIPS.length)]}`,
              ]
            : [
                `Carved ${L.h - 2} rows · ${L.stats.sol} slides to the door, ${L.route.length} for all three stars`,
                `${L.stats.nodes} places to stop · ${L.stats.decisions} forks · ${L.stats.dots} tokens`,
                hz.length ? hz.join(' · ') : 'No hazards in this one',
                ...(L.floodSpeed > 0 ? [`Context window rising at ${L.floodSpeed.toFixed(1)} rows/s`] : []),
                `Tip: ${TIPS[Math.floor(Math.random() * TIPS.length)]}`,
              ];
        const title = spec.kind === 'stage' ? `stage ${spec.n}` : spec.kind === 'daily' ? `daily ${todayKey()}` : 'endless';
        $('load-meta').textContent = `(${(ms / 1000).toFixed(2)}s · ${title} · seed ${L.seed.toString(16).padStart(8, '0')})`;
        const step = quick ? 0 : 160;
        info.forEach((text, i) =>
          setTimeout(() => {
            if (this.mode !== 'loading') return;
            const div = document.createElement('div');
            div.textContent = text;
            lines.append(div);
          }, step * i),
        );
        const wait = quick ? 250 : Math.max(900, step * info.length + 250) - (performance.now() - t0);
        setTimeout(() => {
          if (this.mode === 'loading' && this.launchSpec === spec) this.begin(game);
        }, Math.max(0, wait));
      }),
    );
  }

  private begin(game: Game): void {
    this.game = game;
    this.mode = 'play';
    $('loading').hidden = true;
    $('hud').hidden = false;
    this.hud = { coins: -1, stars: -1, height: -1, ctx: '', powers: '', shields: -1 };
    const theme: Theme =
      game.mode === 'stage' ? themeForStage(game.stage) : game.mode === 'daily' ? THEMES[new Date().getDay() % THEMES.length] : THEMES[0];
    this.endlessTheme = 0;
    this.renderer.setTheme(theme);
    this.renderer.reset();
    const isEndless = game.mode === 'endless';
    $('hud-stars').hidden = isEndless;
    $('hud-height').hidden = !isEndless;
    $('hud-label').textContent =
      game.mode === 'stage' ? `Stage ${game.stage} · ${theme.name}` : game.mode === 'daily' ? `Daily · ${todayKey()}` : 'Endless climb';
    this.music();
    this.tutorial(game);
    if (location.hash.includes('autoplay')) this.autoplay = new Bot(game, 0.2);
  }

  private tutorial(game: Game): void {
    const L = game.level;
    const has = (k: string) => !this.save.seen.includes(k);
    const tips: [string, boolean, string][] = [
      ['move', true, '<b>Swipe</b> to slide. Clawd only stops when he hits a wall.'],
      ['spikes', L.spikes.some((s) => s > 0), '<b>Spikes</b> only hurt if you stop on them.'],
      ['power', L.items.some((i) => i >= IT_SHIELD), '<b>Power-ups:</b> shield, magnet and pause. Slide over one to use it.'],
      ['bugs', L.bugs.length > 0, '<b>Bugs</b> cross corridors. Standing still is safe; go when there is a gap.'],
      ['flood', game.floodSpeed > 0, 'The <b>context window</b> is rising. Reach the door before it fills up.'],
      ['gates', L.gates.length > 0, '<b>Gates</b> blink, then switch on. Slide through while the line is dotted.'],
      ['traps', L.traps.length > 0, '<b>Traps</b> spring half a second after you land on them.'],
    ];
    const t = tips.find(([k, on]) => on && has(k));
    if (!t) return;
    this.save.seen.push(t[0]);
    this.persist();
    this.toast(t[2], 5000);
  }

  pause(): void {
    if (this.mode !== 'play' || !this.game) return;
    this.mode = 'pause';
    const g = this.game;
    $('pause-label').textContent = g.mode === 'stage' ? `stage ${g.stage}` : g.mode;
    const rows = $('pause-rows');
    rows.replaceChildren(
      this.row('/resume', 'esc', () => this.resume(), 'cmd'),
      this.row('/restart', 'r', () => this.launchSpec && this.launch(this.launchSpec, true), 'cmd'),
      this.row(this.save.settings.music ? '/music off' : '/music on', '', () => {
        this.save.settings.music = !this.save.settings.music;
        this.sound.setMusic(this.save.settings.music);
        if (this.save.settings.music) this.music();
        else this.sound.stopMusic();
        this.persist();
        this.mode = 'play';
        this.pause();
      }, 'cmd'),
      this.row(g.mode === 'stage' ? '/stages' : '/menu', '', () => this.show(g.mode === 'stage' ? 'stages' : 'title'), 'cmd'),
    );
    $('pause').hidden = false;
    requestAnimationFrame(() => rows.querySelector<HTMLElement>('.row')?.focus({ preventScroll: true }));
  }

  resume(): void {
    if (this.mode !== 'pause') return;
    this.mode = 'play';
    $('pause').hidden = true;
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private useShield(): void {
    if (this.mode !== 'play' || !this.game || this.save.shields <= 0 || this.game.shields > 0) return;
    this.save.shields--;
    this.game.shields++;
    this.persist();
    this.sound.power();
  }

  private handle(e: GameEvent, g: Game): void {
    const fx = { reducedMotion: this.reduced, shake: this.save.settings.shake };
    this.renderer.onEvent(e, g, fx);
    const s = this.sound;
    switch (e.type) {
      case 'move':
        s.move();
        break;
      case 'stop':
        s.land(e.len);
        break;
      case 'bump':
        s.bump();
        break;
      case 'pick':
        if (e.item === IT_DOT) s.dot(e.combo);
        else if (e.item === IT_COIN) s.coin();
        else if (e.item === IT_STAR) {
          s.star();
          this.buzz(30);
        } else s.power();
        break;
      case 'shield':
        s.shield();
        this.buzz(40);
        break;
      case 'trap':
        s.trap();
        break;
      case 'death':
        s.death(e.cause);
        this.buzz(120);
        this.resultAt = this.time + 1.0;
        break;
      case 'win':
        s.win();
        this.buzz(50);
        this.resultAt = this.time + 1.1;
        break;
    }
  }

  private buzz(ms: number): void {
    if (this.save.settings.haptics) navigator.vibrate?.(ms);
  }

  private finish(): void {
    const g = this.game;
    if (!g) return;
    this.mode = 'result';
    this.autoplay = null;
    const won = g.state === 'won';
    const sv = this.save;
    sv.coins += g.coins;
    const head = $('result-head');
    const body = $('result-body');
    const actions = $('result-actions');
    body.replaceChildren();
    actions.replaceChildren();
    const line = (html: string, cont = false) => {
      const d = document.createElement('div');
      if (cont) d.className = 'cont';
      d.innerHTML = html;
      body.append(d);
    };
    const btn = (label: string, fn: () => void, ghost = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cta' + (ghost ? ' ghost' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.sound.click();
        fn();
      });
      actions.append(b);
      return b;
    };
    const starsHtml = `<span class="stars">${[0, 1, 2].map((k) => `<span class="${k < g.stars ? '' : 'off'}">✻</span>`).join('')}</span>`;
    const tokens = `<span>tokens</span><span class="v">${g.dots}/${g.world.dotsTotal}</span>`;
    const time = fmtTime(g.t - g.startedAt);
    if (g.mode === 'endless') {
      const best = Math.max(sv.endlessBest, g.height);
      const record = g.height > sv.endlessBest;
      sv.endlessBest = best;
      const [title, why] = CAUSES[g.deathCause] ?? ['Run over', ''];
      head.innerHTML = `<span class="dot bad">⏺</span> ${title}`;
      line(`<span>height</span><span class="v">${g.height} m${record ? ' · new best' : ''}</span>`);
      line(`<span>best</span><span class="v">${best} m</span>`, true);
      line(`<span>coins</span><span class="v">+${g.coins}</span>`, true);
      line(`<span>tokens</span><span class="v">${g.dots}</span>`, true);
      if (why) line(`<span class="dim">${why}</span>`);
      btn('Climb again', () => this.launch({ kind: 'endless' }, true));
      btn('Menu', () => this.show('title'), true);
      btn('Skins', () => this.show('skins'), true);
    } else if (won) {
      let extra = '';
      if (g.mode === 'stage') {
        const prev = sv.stars[g.stage] ?? 0;
        if (g.stars > prev) sv.stars[g.stage] = g.stars;
        if (g.stage >= sv.unlocked) {
          sv.unlocked = g.stage + 1;
          if (g.stage % 10 === 0) extra = `World ${g.stage / 10 + 1} unlocked: ${themeForStage(g.stage + 1).name}`;
        }
      } else {
        const key = todayKey();
        const prev = sv.daily[key];
        if (!prev || g.stars > prev.stars || (g.stars === prev.stars && g.t - g.startedAt < prev.time)) {
          sv.daily[key] = { stars: g.stars, time: g.t - g.startedAt };
        }
      }
      head.innerHTML = `<span class="dot">⏺</span> ${g.mode === 'stage' ? `Stage ${g.stage} cleared` : 'Daily tomb cleared'}`;
      line(`${starsHtml}<span class="v">${g.stars}/3 stars</span>`);
      line(tokens, true);
      line(`<span>coins</span><span class="v">+${g.coins}</span>`, true);
      line(`<span>time</span><span class="v">${time} · ${g.moves} slides (best route ${g.level.route.length})</span>`, true);
      if (extra) line(`<span class="v">${extra}</span>`);
      if (g.mode === 'stage') {
        const n = g.stage;
        btn(`Next: stage ${n + 1} ›`, () => this.launch({ kind: 'stage', n: n + 1 }));
        btn('Replay', () => this.launch({ kind: 'stage', n }, true), true);
        btn('Stages', () => this.show('stages'), true);
      } else {
        btn('Play again', () => this.launch({ kind: 'daily' }, true));
        btn('Menu', () => this.show('title'), true);
        btn('Stages', () => this.show('stages'), true);
      }
    } else {
      const [title, why] = CAUSES[g.deathCause] ?? ['Clawd fell', ''];
      head.innerHTML = `<span class="dot bad">⏺</span> ${title}`;
      line(`<span class="dim">${why}</span>`);
      line(`${starsHtml}<span class="v">${g.stars}/3 stars</span>`, true);
      line(tokens, true);
      line(`<span>coins kept</span><span class="v">+${g.coins}</span>`, true);
      btn('Try again', () => this.launchSpec && this.launch(this.launchSpec, true));
      btn(g.mode === 'stage' ? 'Stages' : 'Menu', () => this.show(g.mode === 'stage' ? 'stages' : 'title'), true);
      btn('Skins', () => this.show('skins'), true);
    }
    this.persist();
    $('hud').hidden = true;
    $('result').hidden = false;
    requestAnimationFrame(() => actions.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }));
  }

  // -------------------------------------------------------------- HUD ----

  private updateHud(g: Game): void {
    const h = this.hud;
    if (g.coins !== h.coins) {
      h.coins = g.coins;
      $('hud-coins').textContent = String(g.coins);
    }
    if (g.mode !== 'endless' && g.stars !== h.stars) {
      h.stars = g.stars;
      const box = $('hud-stars');
      box.replaceChildren(
        ...[0, 1, 2].map((k) => {
          const img = document.createElement('img');
          img.alt = k < g.stars ? 'star' : 'missing star';
          img.src = k < g.stars ? this.icons.starOn : this.icons.starOff;
          if (k === g.stars - 1) img.className = 'got';
          return img;
        }),
      );
    }
    if (g.mode === 'endless' && g.height !== h.height) {
      h.height = g.height;
      $('hud-height').textContent = `${g.height} m`;
      const world = Math.floor(g.height / 150) % THEMES.length;
      if (world !== this.endlessTheme) {
        this.endlessTheme = world;
        this.renderer.setTheme(THEMES[world]);
        $('hud-label').textContent = `Endless · ${THEMES[world].name}`;
      }
    }
    // Context window meter: how much room is left before the flood reaches Clawd.
    let ctx = '';
    if (g.floodSpeed > 0) {
      const gap = isFinite(g.floodY) ? g.floodY - g.y : 99;
      const pct = Math.max(0, Math.min(1, gap / 14));
      ctx = `${Math.round(pct * 100)}`;
    }
    if (ctx !== h.ctx) {
      h.ctx = ctx;
      const el = $('hud-context');
      el.hidden = ctx === '';
      if (ctx) {
        el.classList.toggle('low', Number(ctx) < 35);
        $('hud-context-bar').style.setProperty('--p', `${ctx}%`);
        $('hud-context-pct').textContent = `${ctx}% left`;
      }
    }
    const shields = this.save.shields * 10 + Math.min(9, g.shields);
    if (shields !== h.shields) {
      h.shields = shields;
      const b = $<HTMLButtonElement>('hud-shield');
      $('hud-shield-n').textContent = String(this.save.shields);
      b.disabled = this.save.shields <= 0 && g.shields <= 0;
      b.classList.toggle('active', g.shields > 0);
      b.setAttribute('aria-label', g.shields > 0 ? 'Shield active' : `Use a shield (${this.save.shields} left)`);
    }
    const powers = `${g.magnet > 0 ? Math.ceil(g.magnet) : ''}|${g.freeze > 0 ? Math.ceil(g.freeze) : ''}`;
    if (powers !== h.powers) {
      h.powers = powers;
      const box = $('hud-powers');
      box.replaceChildren();
      const add = (icon: string, secs: number, label: string) => {
        const d = document.createElement('div');
        d.className = 'power';
        d.innerHTML = `<img alt="" src="${icon}"><span>${label} ${secs}s</span>`;
        box.append(d);
      };
      if (g.magnet > 0) add(this.icons.magnet, Math.ceil(g.magnet), 'magnet');
      if (g.freeze > 0) add(this.icons.freeze, Math.ceil(g.freeze), 'paused');
    }
  }

  // ------------------------------------------------------------- toast ----

  toast(html: string, ms: number): void {
    const t = $('toast');
    t.innerHTML = html;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), ms);
  }

  private hideToast(): void {
    clearTimeout(this.toastTimer);
    $('toast').hidden = true;
  }

  // -------------------------------------------------------------- loop ----

  frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.input.pollGamepads();
    const glyph = SPINNER_CHARS[spinnerFrame(this.time, 9)];
    document.querySelectorAll('.spin').forEach((el) => {
      if (el.textContent !== glyph) el.textContent = glyph;
    });

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (this.game && (this.mode === 'play' || this.mode === 'result' || this.mode === 'pause')) {
      const g = this.game;
      if (this.mode !== 'pause') {
        this.autoplay?.update(dt);
        g.update(dt);
        for (const e of g.events) this.handle(e, g);
        g.events.length = 0;
      }
      if (this.mode === 'play') this.updateHud(g);
      if (this.resultAt > 0 && this.time >= this.resultAt && this.mode === 'play') {
        this.resultAt = -1;
        this.finish();
      }
      const hudTop = this.renderer.cssToArt(($('hud').querySelector('.hud-top') as HTMLElement).offsetHeight || 64, dpr);
      this.renderer.frame(g, dt, {
        hudTop: this.mode === 'play' ? hudTop : 0,
        reducedMotion: this.reduced,
        shake: this.save.settings.shake,
        dim: this.mode === 'pause' ? 0.35 : 0,
      });
    } else if (this.demo) {
      const d = this.demo;
      d.bot.update(dt);
      d.game.update(dt);
      for (const e of d.game.events) this.renderer.onEvent(e, d.game, { reducedMotion: true, shake: false });
      d.game.events.length = 0;
      if (d.game.state === 'won' || d.game.state === 'dead') {
        d.over += dt;
        if (d.over > 1.5) this.newDemo();
      }
      const dim = this.mode === 'loading' ? 0.75 : this.screen === 'title' ? 0.45 : 0.62;
      this.renderer.frame(this.demo.game, dt, { dim, reducedMotion: true, shake: false });
    }
    if (this.mode === 'menu' && this.screen === 'title') this.drawLogo();
    requestAnimationFrame((t) => this.frame(t));
  }

  private drawLogo(): void {
    const cv = $<HTMLCanvasElement>('logo');
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, cv.width, cv.height);
    const shadow = '#7a3a24';
    drawText(c, 'T', 11, 2, C.clay, 3, shadow);
    drawText(c, 'M', 52, 2, C.clay, 3, shadow);
    drawText(c, 'B', 70, 2, C.clay, 3, shadow);
    drawText(c, 'OF THE', 30, 27, C.light);
    drawText(c, 'TOKEN', 4, 37, C.clay, 3, shadow);
    // Clawd is the O in TOMB.
    const t = this.time;
    const pose: Pose = { ...POSE_IDLE };
    if (t % 3.7 < 0.14) pose.eyes = 'closed';
    const beat = Math.floor(t * 4) % 16;
    if (beat >= 8 && beat < 12) {
      pose.arm = beat % 2 ? -1 : 0;
      pose.step = 1 + (beat % 2);
    }
    pose.lookX = Math.floor(t / 2.3) % 3 === 1 ? 1 : Math.floor(t / 2.3) % 3 === 2 ? -1 : 0;
    const skin = this.renderer.skin;
    drawClawd(c, 39, 23, 2, pose, skin.body, skin.eye, 2);
  }

  start(): void {
    $('boot').hidden = true;
    const hash = location.hash.replace('#', '');
    const params = new URLSearchParams(location.search);
    const stageArg = Number(params.get('stage') ?? (/^stage-?(\d+)$/.exec(hash)?.[1] ?? NaN));
    if (stageArg > 0) {
      this.show('stages');
      this.launch({ kind: 'stage', n: Math.floor(stageArg) });
    } else if (hash.startsWith('endless') || params.has('endless')) {
      this.show('endless');
      this.launch({ kind: 'endless' });
    } else if (hash.startsWith('daily') || params.has('daily')) {
      this.show('daily');
      this.launch({ kind: 'daily' });
    } else if (['stages', 'skins', 'settings'].includes(hash)) this.show(hash as ScreenId);
    else this.show('title');
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function boot(): void {
  const app = new App();
  window.__tott = {
    app,
    play: (n: number) => app.launch({ kind: 'stage', n }, true),
    endless: () => app.launch({ kind: 'endless' }, true),
    autoplay: () => {
      if (app.game) app.autoplay = new Bot(app.game, 0.15);
    },
    state: () => {
      const g = app.game;
      return {
        mode: app.mode,
        screen: app.screen,
        game: g && { state: g.state, x: g.x, y: g.y, stars: g.stars, dots: g.dots, coins: g.coins, moves: g.moves, route: g.level.route, cause: g.deathCause, height: g.height },
        save: app.save,
      };
    },
  };
  window.claude?.hot?.snapshot?.(() => ({ save: app.save }));
  app.start();
}

if (window.claude?.hot?.ready) window.claude.hot.ready(() => boot());
else boot();
