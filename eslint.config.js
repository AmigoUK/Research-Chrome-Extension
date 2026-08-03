import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'doc/**', 'coverage/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build-time scripts run in Node, not in the extension — except for the
    // callbacks they hand to Playwright's `evaluate`, which run in the page and
    // legitimately reach for `document` (and `chrome`, declared globally below).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    languageOptions: {
      globals: {
        chrome: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
