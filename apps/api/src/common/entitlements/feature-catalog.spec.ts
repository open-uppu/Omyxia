import { describe, expect, it } from 'vitest';
import {
  ADMIN_FEATURES,
  ALL_FEATURES,
  FEATURE_LABELS,
  FEATURE_RECOMMENDED_PLAN,
  LIMIT_FEATURES,
  MODULE_FEATURES,
  classifyFeature,
} from './feature-catalog';

describe('feature-catalog', () => {
  it('exposes a non-empty list of module / limit / admin keys', () => {
    expect(MODULE_FEATURES.length).toBeGreaterThan(0);
    expect(LIMIT_FEATURES.length).toBeGreaterThan(0);
    expect(ADMIN_FEATURES.length).toBeGreaterThan(0);
  });

  it('every feature has a label and a recommended plan', () => {
    for (const key of ALL_FEATURES) {
      expect(FEATURE_LABELS[key], `label for ${key}`).toBeTruthy();
      expect(FEATURE_RECOMMENDED_PLAN[key], `recommended plan for ${key}`).not.toBeUndefined();
    }
  });

  it('ALL_FEATURES is the strict union of the three lists', () => {
    const union = new Set<string>([
      ...MODULE_FEATURES,
      ...LIMIT_FEATURES,
      ...ADMIN_FEATURES,
    ]);
    expect(ALL_FEATURES.length).toBe(union.size);
  });

  describe('classifyFeature', () => {
    it('detects module.* keys', () => {
      expect(classifyFeature('module.crm')).toBe('module');
      expect(classifyFeature('module.hr')).toBe('module');
    });
    it('detects limit.* keys', () => {
      expect(classifyFeature('limit.maxUsers')).toBe('limit');
      expect(classifyFeature('limit.maxStorageGB')).toBe('limit');
    });
    it('detects admin.* keys', () => {
      expect(classifyFeature('admin.tenants')).toBe('admin');
      expect(classifyFeature('admin.audit')).toBe('admin');
    });
    it('returns "unknown" for typos and unknown names', () => {
      expect(classifyFeature('module.cm')).toBe('unknown');
      expect(classifyFeature('featurish.foo')).toBe('unknown');
      expect(classifyFeature('')).toBe('unknown');
    });
  });
});
