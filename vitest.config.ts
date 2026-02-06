import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source'],
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
