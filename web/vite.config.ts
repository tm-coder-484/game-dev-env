import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so dist/ works from any sub-path (itch.io, GitHub Pages, S3...).
  base: './',
  // Textures/HDRIs/models are shared with the Godot project (../godot/assets/shared)
  // and pulled in with `new URL(path, import.meta.url)`, which Vite hashes into dist/.
  assetsInclude: ['**/*.hdr', '**/*.exr', '**/*.glb', '**/*.gltf', '**/*.ktx2'],
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4096 },
});
