import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `paths` mapping so vitest's transform layer
    // can resolve `@omyxia/shared-types` to the same TS source the
    // NestJS bundler uses. P1.4 — admin tenants API + admin
    // console FE both consume the shared-types package; without
    // this alias, vitest's resolver returns "Failed to load url".
    alias: {
      '@omyxia/shared-types': path.resolve(
        __dirname,
        '../../packages/shared-types/src',
      ),
    },
  },
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