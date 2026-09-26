#!/usr/bin/env node
// MCP server: gives Claude (or any MCP client) "computer use" tools for native
// apps on a virtual display - see screenshots, click, type, press/hold keys.
// Registered for Claude Code in the repo's .mcp.json as "desktop".
//
// Typical loop: desktop_launch("./build/linux/RealisticStarter.x86_64", wait_for="Realistic")
//   -> desktop_screenshot -> desktop_click / desktop_key {keys:"w", hold_seconds:2}
//   -> desktop_screenshot ...
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import sharp from 'sharp';
import { z } from 'zod';
import * as d from './lib.mjs';

const server = new McpServer({ name: 'desktop', version: '1.0.0' });

async function imageContent(shot) {
  // JPEG keeps the payload small; the lossless PNG stays on disk at shot.path.
  const jpg = await sharp(shot.png).jpeg({ quality: 82 }).toBuffer();
  return [
    { type: 'image', data: jpg.toString('base64'), mimeType: 'image/jpeg' },
    { type: 'text', text: `${shot.width}x${shot.height} at (${shot.x},${shot.y}); saved ${shot.path}` },
  ];
}

const text = (v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }];

/** Wrap an action so it can optionally return a screenshot taken `delay` s later. */
function tool(name, description, shape, fn) {
  const withShot = {
    ...shape,
    screenshot: z.boolean().optional().describe('Return a screenshot after the action'),
    delay: z.number().min(0).max(30).optional().describe('Seconds to wait before that screenshot (default 0.5)'),
  };
  server.registerTool(name, { description, inputSchema: withShot }, async (args) => {
    try {
      const result = await fn(args);
      const content = text(result ?? 'ok');
      if (args.screenshot) {
        await d.sleep(args.delay ?? 0.5);
        content.push(...(await imageContent(await d.screenshot())));
      }
      return { content };
    } catch (err) {
      return { content: text(`error: ${err.message ?? err}`), isError: true };
    }
  });
}

server.registerTool(
  'desktop_screenshot',
  {
    description:
      'Screenshot of the virtual display (or one window). Coordinates in the image are screen coordinates ' +
      'for desktop_click/desktop_move when no window is given.',
    inputSchema: { window: z.string().optional().describe('Regex for a window title/class to capture only that window') },
  },
  async ({ window }) => {
    try {
      return { content: await imageContent(await d.screenshot({ window })) };
    } catch (err) {
      return { content: text(`error: ${err.message ?? err}`), isError: true };
    }
  },
);

tool(
  'desktop_launch',
  'Start a program on the virtual display (a Godot export, `godot --path godot`, `blender`, ...). ' +
    'Runs from the repo root. Returns its pid and log path.',
  {
    command: z.string().describe('Shell command, e.g. "./build/linux/RealisticStarter.x86_64 --rendering-driver opengl3"'),
    wait_for: z.string().optional().describe('Regex of the window title to wait for'),
    timeout: z.number().optional().describe('Seconds to wait for the window (default 60)'),
  },
  ({ command, wait_for, timeout }) => d.launch(command, { waitFor: wait_for, timeout }),
);

tool('desktop_click', 'Click at screen coordinates.', {
  x: z.number(), y: z.number(),
  button: z.enum(['left', 'right', 'middle']).optional(),
  double: z.boolean().optional(),
}, ({ x, y, button, double }) => d.click(x, y, { button, double }));

tool('desktop_move', 'Move the mouse to screen coordinates (hover).', { x: z.number(), y: z.number() },
  ({ x, y }) => d.move(x, y));

tool('desktop_look', 'Relative mouse motion - turns the camera in games that capture the mouse (click the game first).',
  { dx: z.number(), dy: z.number() }, ({ dx, dy }) => d.moveRelative(dx, dy));

tool('desktop_drag', 'Drag with a mouse button held.', {
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  button: z.enum(['left', 'right', 'middle']).optional(),
}, ({ x1, y1, x2, y2, button }) => d.drag(x1, y1, x2, y2, { button }));

tool('desktop_scroll', 'Scroll the wheel: positive = down, negative = up.', {
  amount: z.number().int(), x: z.number().optional(), y: z.number().optional(),
}, ({ amount, x, y }) => d.scroll(amount, x, y));

tool('desktop_type', 'Type text into the focused window.', { text: z.string() }, ({ text: t }) => d.type(t));

tool(
  'desktop_key',
  'Press keys (xdotool names): "Return", "Escape", "ctrl+s", "w", "space", "shift". Space-separate combos to press ' +
    'them in sequence. With hold_seconds, all listed keys are held together (e.g. "w shift" to sprint forward).',
  { keys: z.string(), hold_seconds: z.number().min(0).max(60).optional() },
  ({ keys, hold_seconds }) => d.key(keys, { hold: hold_seconds }),
);

tool('desktop_windows', 'List visible windows with ids, titles and geometry.', {}, () => d.windows());
tool('desktop_focus', 'Raise and focus the first window whose title matches the regex.', { window: z.string() },
  ({ window }) => d.focus(window));
tool('desktop_apps', 'List programs started with desktop_launch.', {}, () => d.apps());
tool('desktop_logs', "Tail a launched program's stdout/stderr (script errors, prints).", {
  pid: z.number().int(), lines: z.number().int().optional(),
}, ({ pid, lines }) => d.logs(pid, lines));
tool('desktop_kill', 'Stop a launched program (pid) or all of them (omit pid).', { pid: z.number().int().optional() },
  ({ pid }) => (pid ? d.killApp(pid) : d.apps().map((a) => d.killApp(a.pid))));
tool('desktop_wait', 'Wait some seconds (let a game run, an editor load).', { seconds: z.number().min(0).max(120) },
  async ({ seconds }) => { await d.sleep(seconds); return `waited ${seconds}s`; });
tool('desktop_record', 'Record the screen to an .mp4 for N seconds (blocks). Returns the file path.', {
  seconds: z.number().min(1).max(120),
}, ({ seconds }) => d.record({ seconds }));
tool('desktop_reset', 'Stop everything and restart the virtual display at a given size.', {
  width: z.number().int().optional(), height: z.number().int().optional(),
}, async ({ width, height }) => { d.stop(); return d.start({ width, height }); });

await server.connect(new StdioServerTransport());
