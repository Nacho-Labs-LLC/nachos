import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      prettier: prettier,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': ['error', { endOfLine: 'auto' }],

      // TypeScript specific
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['packages/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['packages/core/admin/frontend/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Example scripts — console output is intentional
  {
    files: ['examples/**/*.ts', 'examples/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  // Migration utility scripts — console output is intentional
  {
    files: ['packages/core/gateway/migrations/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Integration tests — console output acceptable in test context
  {
    files: ['**/*.integration.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      '**/node_modules/',
      'dist/',
      '**/dist/',
      'build/',
      '**/build/',
      'coverage/',
      '*.config.js',
      '*.config.ts',
      '.changeset/',
    ],
  }
);
