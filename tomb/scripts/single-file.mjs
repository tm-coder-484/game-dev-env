// Inlines the Vite build into one self-contained HTML file.
//   dist/tomb-of-the-token.html  - double-click to play offline (fonts fall back to system monospace)
//   dist/artifact.html           - the same page without <html>/<head>/<body>, for hosts that add their own
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) => {
  const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => {
  return `<style>${readFileSync(join(dist, href), 'utf8')}</style>`;
});
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('an asset was not inlined');
writeFileSync(join(dist, 'tomb-of-the-token.html'), html);

const fragment = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .trim();
writeFileSync(join(dist, 'artifact.html'), fragment + '\n');
console.log(`single file: dist/tomb-of-the-token.html (${(html.length / 1024).toFixed(0)} KB), dist/artifact.html`);
