import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/Sunday-Football/
  base: './',
  server: {
    // Allow importing shared data from ../data
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
