/**
 * omyxia v2.0.0 P4.1 — Proration behaviour tests.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRORATION_BEHAVIOR,
  PRORATION_BEHAVIORS,
  isProrationBehavior,
} from './proration';

describe('proration helpers', () => {
  it('exposes the canonical behaviour set', () => {
    expect(PRORATION_BEHAVIORS).toEqual(['create_prorations', 'none', 'always_invoice']);
  });

  it('defaults to create_prorations', () => {
    expect(DEFAULT_PRORATION_BEHAVIOR).toBe('create_prorations');
  });

  it('accepts only the documented values', () => {
    expect(isProrationBehavior('create_prorations')).toBe(true);
    expect(isProrationBehavior('none')).toBe(true);
    expect(isProrationBehavior('always_invoice')).toBe(true);
    expect(isProrationBehavior('unknown')).toBe(false);
    expect(isProrationBehavior(42)).toBe(false);
    expect(isProrationBehavior(null)).toBe(false);
    expect(isProrationBehavior(undefined)).toBe(false);
  });
});
