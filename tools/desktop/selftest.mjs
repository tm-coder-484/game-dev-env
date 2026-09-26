#!/usr/bin/env node
// End-to-end check of the desktop MCP server: speaks real MCP to it, launches
// the exported Linux game, clicks into it, holds W, and verifies the view
// changed. Run `make export-linux` first.   node tools/desktop/selftest.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GAME = join(ROOT, 'build/linux/RealisticStarter.x86_64');
if (!existsSync(GAME)) {
  console.error(`missing ${GAME} - run: make export-linux`);
  process.exit(1);
}

const client = new Client({ name: 'selftest', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'tools/desktop/mcp-launch.mjs')] }));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content.map((c) => c.text).join(' ')}`);
  return r;
}
const image = (r) => Buffer.from(r.content.find((c) => c.type === 'image').data, 'base64');

async function diff(a, b) {
  const [x, y] = await Promise.all([a, b].map((img) => sharp(img).resize(160, 90).greyscale().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length; // mean abs difference, 0-255
}

let ok = false;
try {
  const { tools } = await client.listTools();
  console.log(`tools: ${tools.length} (${tools.map((t) => t.name).slice(0, 4).join(', ')}, ...)`);
  await call('desktop_launch', {
    command: `${GAME} --rendering-driver opengl3 --audio-driver Dummy`,
    wait_for: 'Realistic',
  });
  await call('desktop_wait', { seconds: 3 });
  const before = image(await call('desktop_screenshot'));
  await call('desktop_click', { x: 640, y: 360 }); // capture the mouse
  await call('desktop_look', { dx: 250, dy: 0 });
  const after = image(await call('desktop_key', { keys: 'w', hold_seconds: 2, screenshot: true, delay: 1 }));
  const d = await diff(before, after);
  console.log(`view changed by ${d.toFixed(1)} (mean abs pixel diff)`);
  ok = d > 8;
} finally {
  await call('desktop_kill').catch(() => {});
  await client.close();
}
console.log(ok ? 'PASS: input reached the game and the view changed' : 'FAIL: view did not change');
process.exit(ok ? 0 : 1);
