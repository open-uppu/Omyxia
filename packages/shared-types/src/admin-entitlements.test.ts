// @vitest-environment node
//
// Schema tests for admin-entitlements (P3.2). Pure zod, no DOM, no fetch.
// Run on Node so we can also import the regex-based key shapes via
// `JSON.parse`-style round-trips if needed.

import { describe, it, expect } from 'vitest';
import {
  EntitlementsSchema,
  UpgradeHintSchema,
  ModuleFeatureKeySchema,
  LimitFeatureKeySchema,
  AdminFeatureKeySchema,
  FeatureKeySchema,
} from './admin-entitlements';

const FIXED_ENTITLEMENTS = {
  tenantId: 't-1',
  plan: 'PRO' as const,
  planLabel: 'Pro — $99/mo',
  generatedAt: '2026-07-04T12:00:00.000Z',
  features: {
    'module.email': true,
    'module.hr': true,
    'module.crm': false,
    'module.erp': false,
    'module.wms': false,
    'module.bi': false,
    'module.mas': false,
    'module.chat': true,
    'admin.tenants': true,
    'admin.plans': true,
    'admin.audit': true,
  },
  limits: {
    'limit.maxUsers': 25,
    'limit.maxStorageGB': 100,
  },
  usage: {
    'limit.maxUsers': 12,
    'limit.maxStorageGB': 42,
  },
};

describe('EntitlementsSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(() => EntitlementsSchema.parse(FIXED_ENTITLEMENTS)).not.toThrow();
  });

  it('accepts null tenantId for global super_admin view', () => {
    const payload = { ...FIXED_ENTITLEMENTS, tenantId: null };
    expect(() => EntitlementsSchema.parse(payload)).not.toThrow();
  });

  it('accepts a payload with empty features / limits', () => {
    const payload = {
      tenantId: 't-1',
      plan: 'FREE' as const,
      planLabel: 'Free',
      generatedAt: '2026-07-04T00:00:00.000Z',
      features: {},
      limits: {},
    };
    expect(() => EntitlementsSchema.parse(payload)).not.toThrow();
  });

  it('rejects an unknown plan slug', () => {
    const payload = { ...FIXED_ENTITLEMENTS, plan: 'ULTRA' };
    expect(() => EntitlementsSchema.parse(payload)).toThrow();
  });

  it('rejects a negative limit', () => {
    const payload = {
      ...FIXED_ENTITLEMENTS,
      limits: { 'limit.maxUsers': -1 },
    };
    expect(() => EntitlementsSchema.parse(payload)).toThrow();
  });

  it('accepts null limit (unlimited)', () => {
    const payload = {
      ...FIXED_ENTITLEMENTS,
      plan: 'ENTERPRISE' as const,
      limits: { 'limit.maxUsers': null, 'limit.maxStorageGB': null },
    };
    expect(() => EntitlementsSchema.parse(payload)).not.toThrow();
  });

  it('rejects a feature value that is not boolean', () => {
    const payload = {
      ...FIXED_ENTITLEMENTS,
      features: { ...FIXED_ENTITLEMENTS.features, 'module.crm': 'yes' },
    };
    expect(() => EntitlementsSchema.parse(payload)).toThrow();
  });

  it('rejects a malformed feature key (uppercase / spaces)', () => {
    const payload = {
      ...FIXED_ENTITLEMENTS,
      features: { ...FIXED_ENTITLEMENTS.features, 'Module.crm': true },
    };
    expect(() => EntitlementsSchema.parse(payload)).toThrow();
  });

  it('accepts a missing usage map (optional)', () => {
    const { usage: _usage, ...rest } = FIXED_ENTITLEMENTS;
    void _usage;
    expect(() => EntitlementsSchema.parse(rest)).not.toThrow();
  });
});

describe('Feature key shape regexes', () => {
  it('module keys follow module.<name>', () => {
    expect(ModuleFeatureKeySchema.safeParse('module.crm').success).toBe(true);
    expect(ModuleFeatureKeySchema.safeParse('module.hr').success).toBe(true);
    expect(ModuleFeatureKeySchema.safeParse('module.cdp_v2').success).toBe(true);
    expect(ModuleFeatureKeySchema.safeParse('admin.crm').success).toBe(false);
    expect(ModuleFeatureKeySchema.safeParse('Module.crm').success).toBe(false);
    expect(ModuleFeatureKeySchema.safeParse('module.').success).toBe(false);
  });

  it('limit keys follow limit.<name>', () => {
    expect(LimitFeatureKeySchema.safeParse('limit.maxUsers').success).toBe(true);
    expect(LimitFeatureKeySchema.safeParse('limit.maxStorageGB').success).toBe(true);
    expect(LimitFeatureKeySchema.safeParse('module.maxUsers').success).toBe(false);
    expect(LimitFeatureKeySchema.safeParse('limit.maxUsers').success).toBe(true);
    expect(LimitFeatureKeySchema.safeParse('limit.MAX').success).toBe(true);
    expect(LimitFeatureKeySchema.safeParse('limit.').success).toBe(false);
  });

  it('admin keys follow admin.<name>', () => {
    expect(AdminFeatureKeySchema.safeParse('admin.tenants').success).toBe(true);
    expect(AdminFeatureKeySchema.safeParse('admin.audit').success).toBe(true);
    expect(AdminFeatureKeySchema.safeParse('module.tenants').success).toBe(false);
  });

  it('FeatureKeySchema is the union of the three', () => {
    expect(FeatureKeySchema.safeParse('module.crm').success).toBe(true);
    expect(FeatureKeySchema.safeParse('limit.maxUsers').success).toBe(true);
    expect(FeatureKeySchema.safeParse('admin.tenants').success).toBe(true);
    expect(FeatureKeySchema.safeParse('random.key').success).toBe(false);
  });
});

describe('UpgradeHintSchema', () => {
  it('accepts a hint referencing an admin.* feature', () => {
    expect(() =>
      UpgradeHintSchema.parse({
        feature: 'admin.plans',
        featureLabel: 'Plans',
        from: '/plans',
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
      })
    ).not.toThrow();
  });

  it('rejects an untyped currentPlan', () => {
    expect(() =>
      UpgradeHintSchema.parse({
        feature: 'admin.plans',
        featureLabel: 'Plans',
        currentPlan: 'ULTRA',
        recommendedPlan: 'PRO',
      })
    ).toThrow();
  });
});