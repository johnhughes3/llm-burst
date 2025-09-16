import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['docs/tmp/**']
  },
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
  },
  {
    files: ['chrome_ext/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
