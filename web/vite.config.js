import { defineConfig } from 'vite';
import { resolve } from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Relative base so the build works on GitHub Pages (/repo/) and any subpath.
export default defineConfig({
  base: './',
  root: '.',
  publicDir: 'public',
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'crypto', 'stream', 'events'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  define: {
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 8080,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['buffer', 'process'],
  },
});
