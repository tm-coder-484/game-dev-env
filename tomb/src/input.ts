// Swipes, keys and gamepads, all turned into four directions (0 up, 1 right,
// 2 down, 3 left) plus a few commands.

export type Command = 'pause' | 'restart' | 'mute' | 'confirm' | 'back';

export class Input {
  onDir: (d: number) => void = () => {};
  onCommand: (c: Command) => void = () => {};
  /** Called on the first gesture of any kind (to unlock audio). */
  onGesture: () => void = () => {};
  private sx = 0;
  private sy = 0;
  private active = -1;
  private lastDir = -1;
  private pads = new Map<number, { dirs: boolean[]; buttons: boolean[] }>();

  /** Only swipes that start on `surface` steer Clawd. */
  constructor(surface: HTMLElement) {
    surface.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.key(e));
    // iOS still scrolls and zooms on touchmove unless it is cancelled.
    surface.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('touchend', () => this.onGesture(), { passive: true });
    window.addEventListener('click', () => this.onGesture());
  }

  private threshold(): number {
    return Math.max(12, Math.min(28, Math.min(innerWidth, innerHeight) * 0.035));
  }

  private down(e: PointerEvent): void {
    this.onGesture();
    this.active = e.pointerId;
    this.sx = e.clientX;
    this.sy = e.clientY;
    this.lastDir = -1;
    e.preventDefault();
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.active) return;
    const dx = e.clientX - this.sx;
    const dy = e.clientY - this.sy;
    const th = this.threshold();
    if (Math.max(Math.abs(dx), Math.abs(dy)) < th) return;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    // One swipe = one move, but a swipe that bends (an L shape) counts twice.
    if (d !== this.lastDir) {
      this.lastDir = d;
      this.onDir(d);
    }
    this.sx = e.clientX;
    this.sy = e.clientY;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.active) this.active = -1;
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.onGesture();
    const map: Record<string, number> = {
      ArrowUp: 0, KeyW: 0, KeyK: 0,
      ArrowRight: 1, KeyD: 1, KeyL: 1,
      ArrowDown: 2, KeyS: 2, KeyJ: 2,
      ArrowLeft: 3, KeyA: 3, KeyH: 3,
    };
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code in map) {
      e.preventDefault();
      if (!e.repeat) this.onDir(map[e.code]);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') this.onCommand(e.code === 'Escape' ? 'back' : 'pause');
    else if (e.code === 'KeyR') this.onCommand('restart');
    else if (e.code === 'KeyM') this.onCommand('mute');
    else if (e.code === 'Enter' || e.code === 'Space') {
      // Let focused buttons handle their own activation.
      if (tag !== 'BUTTON') {
        e.preventDefault();
        this.onCommand('confirm');
      }
    }
  }

  /** Call once per frame. */
  pollGamepads(): void {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const prev = this.pads.get(p.index) ?? { dirs: [false, false, false, false], buttons: [] };
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const dirs = [btn(12) || ay < -0.6, btn(15) || ax > 0.6, btn(13) || ay > 0.6, btn(14) || ax < -0.6];
      dirs.forEach((on, d) => {
        if (on && !prev.dirs[d]) {
          this.onGesture();
          this.onDir(d);
        }
      });
      const buttons = [btn(0), btn(1), btn(9)];
      if (buttons[0] && !prev.buttons[0]) this.onCommand('confirm');
      if (buttons[1] && !prev.buttons[1]) this.onCommand('back');
      if (buttons[2] && !prev.buttons[2]) this.onCommand('pause');
      this.pads.set(p.index, { dirs, buttons });
    }
  }
}
