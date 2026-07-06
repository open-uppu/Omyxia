import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, findNavByHref } from './constants';

describe('NAV_ITEMS', () => {
  it('contains exactly the five required shell sections in order', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual([
      'dashboard',
      'tenants',
      'plans',
      'audit',
      'settings',
    ]);
  });

  it('every item has a href starting with /', () => {
    for (const item of NAV_ITEMS) {
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('every href is unique', () => {
    const set = new Set(NAV_ITEMS.map((i) => i.href));
    expect(set.size).toBe(NAV_ITEMS.length);
  });

  it('every item has an icon component', () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.icon).toBe('object'); // forwardRef / React component
    }
  });
});

describe('findNavByHref', () => {
  it('returns the matching item for an exact href', () => {
    expect(findNavByHref('/tenants')?.key).toBe('tenants');
    expect(findNavByHref('/dashboard')?.key).toBe('dashboard');
  });

  it('returns the parent for nested routes', () => {
    expect(findNavByHref('/tenants/abc-123')?.key).toBe('tenants');
    expect(findNavByHref('/plans/edit/xyz')?.key).toBe('plans');
  });

  it('returns undefined for unknown routes', () => {
    expect(findNavByHref('/random')).toBeUndefined();
    expect(findNavByHref('/')).toBeUndefined();
    expect(findNavByHref('/tenant')).toBeUndefined(); // not a prefix match
  });
});