import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@uar/core': new URL('../../packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
