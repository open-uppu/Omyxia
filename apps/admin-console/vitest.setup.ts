import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

if (typeof globalThis.fetch === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = vi.fn() as any;
}

if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = () => {};
}

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

// jsdom doesn't implement `navigation` for non-href mailto: / external
// links. The upgrade-modal CTA uses mailto:; suppress the noisy
// "Not implemented" warning so the test output stays clean. We're
// asserting impression events, not navigation, in those specs.
const originalJsdomNotImplemented = (
  console as unknown as { error?: (...args: unknown[]) => void }
).error;
if (originalJsdomNotImplemented) {
  console.error = ((msg: unknown, ...rest: unknown[]) => {
    if (typeof msg === 'string' && msg.includes('Not implemented: navigation')) return;
    (originalJsdomNotImplemented as (...args: unknown[]) => void).call(
      console,
      msg,
      ...rest
    );
  }) as typeof console.error;
}