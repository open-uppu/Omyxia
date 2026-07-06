import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const _req = createRequire(typeof __filename !== 'undefined' ? __filename : '');

export default defineConfig({
  test: {
    globals: true,
    include: [
      'scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      'node_modules/',
      'dist/',
    ],
  },
  resolve: {
    alias: {
      '@aws-sdk/client-s3': _req.resolve('@aws-sdk/client-s3'),
      '@prisma/client':      _req.resolve('@prisma/client'),
    },
  },
});
