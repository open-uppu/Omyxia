import { defineConfig } from '@prisma/eslint-config';

export default defineConfig({
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier', // Prettier must be last
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './apps/*/tsconfig.json', './packages/*/tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import', 'unused-imports'],
  rules: {
    '@typescript-eslint/no-empty-function': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'import/order': [
      'warn',
      {
        groups: [
          'builtin', // Node.js built-in modules
          'external', // npm install packages
          'internal', // internal modules
          'parent', // folders up
          'sibling', // folders down
          'index', // the index file
          'object', // object type
          'type', // type alias
        ],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'unused-imports/no-unused-imports': 'error',
  },
  ignorePatterns: [
    'node_modules/',
    '.*.js',
    '*.d.ts',
    'dist/',
    '*.mjs',
    '.openclw-generated/',
    'generated/',
  ],
});