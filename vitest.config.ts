import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@living-bugs/sim-core': resolve(__dirname, 'packages/sim-core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
  },
});
