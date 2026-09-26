#!/usr/bin/env node
// Entry point for the desktop MCP server (the one .mcp.json runs): installs the
// tools/ packages if they're missing, then starts mcp-server.mjs. In a fresh
// cloud session Claude Code starts MCP servers at the same time as the
// SessionStart hook, before the hook's `npm install` has run, so starting
// mcp-server.mjs directly dies with ERR_MODULE_NOT_FOUND and the session has
// no desktop_* tools.
//
//   node tools/desktop/mcp-launch.mjs           install if needed, then serve MCP on stdio
//   node tools/desktop/mcp-launch.mjs --check   load the packages and report (used by make doctor)
//
// stdout is the MCP channel, so everything npm prints goes to stderr.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPS = ['@modelcontextprotocol/sdk/server/mcp.js', 'sharp', 'zod'];
const log = (msg) => console.error(`[desktop-mcp] ${msg}`);

function missing() {
  return DEPS.filter((dep) => {
    try {
      import.meta.resolve(dep);
      return false;
    } catch {
      return true;
    }
  });
}

if (process.argv.includes('--check')) {
  const failed = [];
  for (const dep of DEPS) {
    try {
      await import(dep);
    } catch (err) {
      failed.push(`${dep} (${err.code ?? err.message})`);
    }
  }
  if (failed.length) console.log(`cannot load ${failed.join(', ')}`);
  process.exit(failed.length ? 1 : 0);
}

const absent = missing();
if (absent.length) {
  log(`missing ${absent.join(', ')} - running npm install in tools/`);
  // The SessionStart hook installs tools/ under the same lock, so the two npm runs never overlap.
  const npm = ['npm', 'install', '--no-fund', '--no-audit', '--no-update-notifier', '--loglevel=error'];
  const hasFlock = process.platform === 'linux' && spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;
  const [cmd, ...args] = hasFlock ? ['flock', '.npm-install.lock', ...npm] : npm;
  const r = spawnSync(cmd, args, { cwd: TOOLS, stdio: ['ignore', 2, 2], shell: process.platform === 'win32' });
  if (r.status !== 0 || missing().length) {
    log(`npm install failed (exit ${r.status ?? r.error?.code}). Fix it with: cd tools && npm install`);
    process.exit(1);
  }
  log('packages installed');
}

await import('./mcp-server.mjs');
