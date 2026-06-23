import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@uar/connectors': fileURLToPath(new URL('../../packages/connectors/src/index.ts', import.meta.url)),
      '@uar/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@uar/reporting': fileURLToPath(new URL('../../packages/reporting/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
