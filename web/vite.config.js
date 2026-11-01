import { defineConfig } from 'vite';
import { resolve } from 'path';

// Relative base so the build works on GitHub Pages (/repo/) and file:// or any subpath.
export default defineConfig({
  base: './',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 8080,
    strictPort: true,
  },
});
