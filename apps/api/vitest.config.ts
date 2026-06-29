import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'test/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      'node_modules/',
      'dist/',
      // WIP — search service spec pending v0.3.0 wiring
      'src/search/search.service.spec.ts',
    ],
  },
});