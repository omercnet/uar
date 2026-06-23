import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@uar/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@uar/api': path.resolve(__dirname, '../../apps/api/src/index.ts'),
      '@uar/connectors': path.resolve(__dirname, '../../packages/connectors/src/index.ts'),
      '@uar/reporting': path.resolve(__dirname, '../../packages/reporting/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
