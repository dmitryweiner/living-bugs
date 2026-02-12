import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@living-bugs/sim-core': resolve(__dirname, '../../packages/sim-core/src/index.ts'),
    },
  },
  base: './',
  build: {
    outDir: resolve(__dirname, '../../docs'),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  },
});
