import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: {
      '@nachos/gateway': path.resolve(__dirname, 'packages/core/gateway/src/index.ts'),
      '@nachos/config': path.resolve(__dirname, 'packages/shared/config/src/index.ts'),
      '@nachos/types': path.resolve(__dirname, 'packages/shared/types/src/index.ts'),
      '@nachos/bus': path.resolve(__dirname, 'packages/core/bus/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/node_modules/**',
        'dist/',
        'build/',
        '**/*.config.{js,ts}',
        '**/*.d.ts',
        '**/index.ts',
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
});
