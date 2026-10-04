import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs so dist/ works from any sub-path (GitHub Pages, itch.io, a USB stick...).
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 100_000, cssCodeSplit: false },
});
