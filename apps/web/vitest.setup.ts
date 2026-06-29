import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Provide a minimal fetch polyfill for jsdom — node 22 has global fetch,
// but jsdom's fetch implementation is incomplete (no Request/Response constructors
// without setup). We make it explicit so component code using fetch works.
if (typeof globalThis.fetch === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = vi.fn() as any;
}

// jsdom does not implement scrollTo by default — Radix dialog components
// (and similar) call window.scrollTo during measurements.
if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = () => {};
}

// jsdom does not implement matchMedia by default — used by some hooks.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
