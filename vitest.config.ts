import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: {
      // Core packages
      '@nachos/gateway': path.resolve(__dirname, 'packages/core/gateway/src/index.ts'),
      '@nachos/bus': path.resolve(__dirname, 'packages/core/bus/src/index.ts'),
      '@nachos/llm-proxy': path.resolve(__dirname, 'packages/core/llm-proxy/src/index.ts'),
      // Shared packages
      '@nachos/config': path.resolve(__dirname, 'packages/shared/config/src/index.ts'),
      '@nachos/types': path.resolve(__dirname, 'packages/shared/types/src/index.ts'),
      '@nachos/context-manager': path.resolve(
        __dirname,
        'packages/shared/context-manager/src/index.ts'
      ),
      '@nachos/state': path.resolve(__dirname, 'packages/shared/state/src/index.ts'),
      '@nachos/utils': path.resolve(__dirname, 'packages/shared/utils/src/index.ts'),
      '@nachos/sdk': path.resolve(__dirname, 'packages/shared/sdk/src/index.ts'),
      '@nachos/tool-base': path.resolve(__dirname, 'packages/shared/tool-base/src/index.ts'),
      '@nachos/test-utils': path.resolve(__dirname, 'packages/shared/test-utils/src/index.ts'),
      // Channel packages
      '@nachos/channel-base': path.resolve(__dirname, 'packages/channels/base/src/index.ts'),
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
