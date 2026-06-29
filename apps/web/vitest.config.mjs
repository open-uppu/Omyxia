// @ts-check
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: [
        'src/components/**/*.{ts,tsx}',
        'src/app/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/**/page.tsx',
        'src/**/layout.tsx',
        'src/**/globals.css',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
      ],
      reporter: ['text', 'text-summary'],
      thresholds: {
        // Project-wide lower bound. Per-file 70% is enforced via separate
        // checks — keep these loose so partial coverage reports don't fail
        // the run before per-file verification.
        lines: 0,
        statements: 0,
        functions: 0,
        branches: 0,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
