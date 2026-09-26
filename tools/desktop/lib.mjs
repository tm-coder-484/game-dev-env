// Desktop "computer use" for native apps (Godot game builds, the Godot editor,
// Blender's GUI, ...) on a virtual X11 display: screenshots, mouse, keyboard,
// windows, video capture. Linux only; needs Xvfb, openbox, xdotool, ffmpeg
// (setup/install-toolchain.sh installs them).
//
// Uses its own display (:99 by default) so it never touches your real desktop.
// Set DESKTOP_DISPLAY=:0 explicitly if you *want* to drive a real session.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
export const DISPLAY = process.env.DESKTOP_DISPLAY ?? ':99';
const STATE_DIR = process.env.DESKTOP_STATE_DIR ?? '/tmp/gamedev-desktop';
const STATE_FILE = join(STATE_DIR, `state${DISPLAY.replace(/[^0-9]/g, '')}.json`);
const SHOTS_DIR = join(ROOT, 'build', 'shots', 'desktop');

const env = () => ({ ...process.env, DISPLAY });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

function x(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
const xdo = (...args) => x('xdotool', args.map(String)).trim();

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { apps: {} };
  }
}
function saveState(s) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function displayUp() {
  try {
    x('xdpyinfo', ['-display', DISPLAY]);
    return true;
  } catch {
    return false;
  }
}

function detached(cmd, args, logName, cwd = ROOT) {
  mkdirSync(join(STATE_DIR, 'logs'), { recursive: true });
  const log = join(STATE_DIR, 'logs', `${logName}.log`);
  const fd = openSync(log, 'a');
  const child = spawn(cmd, args, { env: env(), cwd, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  return { pid: child.pid, log };
}

/** Start the virtual display + window manager (no-op if already running). */
export async function start({ width = 1280, height = 720 } = {}) {
  if (displayUp()) return { display: DISPLAY, ...screenSize(), started: false };
  for (const tool of ['Xvfb', 'xdotool', 'ffmpeg']) {
    try {
      execFileSync('which', [tool], { stdio: 'ignore' });
    } catch {
      throw new Error(`${tool} not found - run: bash setup/install-toolchain.sh`);
    }
  }
  const xvfb = detached('Xvfb', [DISPLAY, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp', '-ac'], 'Xvfb');
  for (let i = 0; i < 50 && !displayUp(); i++) await sleep(0.1);
  if (!displayUp()) throw new Error(`Xvfb failed to start on ${DISPLAY} (see ${xvfb.log})`);
  // openbox: focus handling + every app maximized without title bars (see openbox-rc.xml).
  let wm = null;
  try {
    execFileSync('which', ['openbox'], { stdio: 'ignore' });
    wm = detached('openbox', ['--config-file', join(HERE, 'openbox-rc.xml')], 'openbox');
    await sleep(0.5);
  } catch {
    /* works without a WM, just with rougher focus behaviour */
  }
  saveState({ width, height, xvfbPid: xvfb.pid, wmPid: wm?.pid ?? null, apps: {} });
  return { display: DISPLAY, width, height, started: true };
}

/** Kill every launched app, the window manager and the display. */
export function stop() {
  const s = loadState();
  for (const pid of Object.keys(s.apps ?? {})) killApp(Number(pid));
  for (const pid of [s.wmPid, s.xvfbPid]) {
    try {
      if (pid) process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  saveState({ apps: {} });
  return { stopped: true };
}

export function screenSize() {
  const m = x('xdpyinfo', ['-display', DISPLAY]).match(/dimensions:\s+(\d+)x(\d+)/);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Launch a command on the virtual display. Optionally wait for its window. */
export async function launch(command, { waitFor, timeout = 60, cwd = ROOT } = {}) {
  await start();
  const name = (command.split(/\s+/)[0].split('/').pop() || 'app').replace(/[^\w.-]/g, '_');
  const app = detached('bash', ['-c', `exec ${command}`], `${name}-${Date.now()}`, cwd);
  const s = loadState();
  s.apps[app.pid] = { command, log: app.log, started: new Date().toISOString() };
  saveState(s);
  let window = null;
  if (waitFor) {
    const deadline = Date.now() + timeout * 1000;
    while (!window && Date.now() < deadline) {
      window = findWindow(waitFor);
      if (!window) await sleep(0.5);
    }
    if (!window) throw new Error(`no window matching /${waitFor}/ after ${timeout}s - log: ${tail(app.log, 15)}`);
    await sleep(1); // let it draw its first frames
  }
  return { pid: app.pid, log: app.log, window };
}

export function killApp(pid) {
  const s = loadState();
  try {
    process.kill(-pid, 'SIGTERM'); // whole process group
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  delete s.apps[pid];
  saveState(s);
  return { killed: pid };
}

export function apps() {
  const s = loadState();
  return Object.entries(s.apps ?? {}).map(([pid, a]) => {
    let alive = true;
    try {
      process.kill(Number(pid), 0);
    } catch {
      alive = false;
    }
    return { pid: Number(pid), alive, ...a };
  });
}

function tail(file, n = 40) {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
}

/** Last lines of a launched app's stdout/stderr (errors, prints). */
export function logs(pid, n = 40) {
  const a = loadState().apps?.[pid];
  if (!a) throw new Error(`unknown pid ${pid}; known: ${Object.keys(loadState().apps ?? {}).join(', ') || 'none'}`);
  return tail(a.log, n);
}

function geometry(id) {
  const g = Object.fromEntries(
    xdo('getwindowgeometry', '--shell', id)
      .split('\n')
      .map((l) => l.split('='))
      .filter((p) => p.length === 2),
  );
  return { x: Number(g.X), y: Number(g.Y), width: Number(g.WIDTH), height: Number(g.HEIGHT) };
}

/** Visible windows with names and geometry. */
export function windows() {
  if (!displayUp()) return [];
  let ids = [];
  try {
    ids = xdo('search', '--onlyvisible', '--name', '.').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return ids
    .map((id) => {
      try {
        return { id, name: xdo('getwindowname', id), ...geometry(id) };
      } catch {
        return null;
      }
    })
    .filter((w) => w && w.width > 1 && w.height > 1);
}

/** First visible window whose title (or class) matches the regex. */
export function findWindow(pattern) {
  for (const flag of ['--name', '--class']) {
    try {
      const id = xdo('search', '--onlyvisible', flag, pattern).split('\n').filter(Boolean)[0];
      if (id) return { id, name: xdo('getwindowname', id), ...geometry(id) };
    } catch {
      /* no match */
    }
  }
  return null;
}

export function focus(pattern) {
  const w = findWindow(pattern);
  if (!w) throw new Error(`no window matching /${pattern}/`);
  xdo('windowactivate', '--sync', w.id);
  return w;
}

/** PNG of the whole screen, or of one window. Saved under build/shots/desktop/. */
export async function screenshot({ window, out } = {}) {
  if (!displayUp()) throw new Error('display not running - launch an app first (or run: desk start)');
  let region = { x: 0, y: 0, ...screenSize() };
  if (window) {
    const w = findWindow(window);
    if (!w) throw new Error(`no window matching /${window}/`);
    region = { x: Math.max(0, w.x), y: Math.max(0, w.y), width: w.width & ~1, height: w.height & ~1 };
  }
  const png = execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'x11grab', '-video_size', `${region.width}x${region.height}`,
      '-i', `${DISPLAY}+${region.x},${region.y}`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
    { env: env(), maxBuffer: 64 << 20 },
  );
  const path = resolve(out ?? join(SHOTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return { png, path, ...region };
}

/** Record the screen to an .mp4 (blocks for `seconds`). */
export function record({ seconds = 5, fps = 15, out } = {}) {
  const { width, height } = screenSize();
  const path = resolve(out ?? join(SHOTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`));
  mkdirSync(dirname(path), { recursive: true });
  x('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-framerate', String(fps), '-video_size', `${width}x${height}`,
    '-i', DISPLAY, '-t', String(seconds), '-pix_fmt', 'yuv420p', path], { timeout: (seconds + 30) * 1000 });
  return { path, seconds };
}

// ------------------------------------------------------------ mouse & keys --
const BUTTONS = { left: 1, middle: 2, right: 3 };

export function move(xp, yp) {
  xdo('mousemove', '--sync', xp, yp);
  return { x: xp, y: yp };
}

/** Relative motion - this is what mouse-look in a captured-mouse game reads. */
export async function moveRelative(dx, dy, steps = 10) {
  for (let i = 0; i < steps; i++) {
    xdo('mousemove_relative', '--', Math.round(dx / steps), Math.round(dy / steps));
    await sleep(0.02);
  }
  return { dx, dy };
}

export function click(xp, yp, { button = 'left', double = false } = {}) {
  if (xp !== undefined && yp !== undefined) move(xp, yp);
  xdo('click', '--repeat', double ? 2 : 1, '--delay', 80, BUTTONS[button] ?? button);
  return { x: xp, y: yp, button, double };
}

export async function drag(x1, y1, x2, y2, { button = 'left', steps = 20 } = {}) {
  move(x1, y1);
  xdo('mousedown', BUTTONS[button] ?? button);
  for (let i = 1; i <= steps; i++) {
    xdo('mousemove', Math.round(x1 + ((x2 - x1) * i) / steps), Math.round(y1 + ((y2 - y1) * i) / steps));
    await sleep(0.02);
  }
  xdo('mouseup', BUTTONS[button] ?? button);
  return { from: [x1, y1], to: [x2, y2] };
}

/** Positive = scroll down, negative = up. */
export function scroll(amount, xp, yp) {
  if (xp !== undefined && yp !== undefined) move(xp, yp);
  xdo('click', '--repeat', Math.abs(amount), '--delay', 40, amount > 0 ? 5 : 4);
  return { amount };
}

export function type(text) {
  xdo('type', '--delay', 25, '--', text);
  return { typed: text.length };
}

/**
 * Press keys. `keys` is xdotool syntax: "Return", "ctrl+s", "w", "space",
 * "shift+Tab"; several space-separated combos are pressed in sequence.
 * With `hold` (seconds) the listed keys are held down together instead -
 * e.g. key("w shift", { hold: 2 }) sprints forward for 2 s in a game.
 */
export async function key(keys, { hold } = {}) {
  const list = keys.trim().split(/\s+/);
  if (hold) {
    xdo('keydown', ...list);
    await sleep(hold);
    xdo('keyup', ...list.reverse());
  } else {
    xdo('key', '--delay', 60, '--', ...list);
  }
  return { keys, hold: hold ?? 0 };
}

export { sleep };
