// @vitest-environment node
//
// Schema tests for admin-upgrade-modal (P3.4). Pure zod, no DOM, no fetch.

import { describe, it, expect } from 'vitest';
import {
  FeatureDeniedSchema,
  UpgradeImpressionSchema,
  UpgradeCatalogRowSchema,
  AddOnSlugSchema,
} from './admin-upgrade-modal';

const SAMPLE_DENIED = {
  statusCode: 403 as const,
  error: 'FEATURE_NOT_INCLUDED' as const,
  feature: 'module.crm',
  featureLabel: 'CRM',
  currentPlan: 'FREE' as const,
  recommendedPlan: 'PRO' as const,
  requiredAddOns: [],
  priceDeltaCents: 9900,
  currency: 'USD',
  upgradeAdminEmail: 'admin@omyxia.app',
  upgradeUrl: '/upgrade?feature=module.crm',
  from: '/tenants',
};

describe('AddOnSlugSchema', () => {
  it('accepts addon.<lowercase>', () => {
    expect(AddOnSlugSchema.safeParse('addon.crm').success).toBe(true);
    expect(AddOnSlugSchema.safeParse('addon.mas_v2').success).toBe(true);
    expect(AddOnSlugSchema.safeParse('module.crm').success).toBe(false);
    expect(AddOnSlugSchema.safeParse('addon.CRM').success).toBe(false);
    expect(AddOnSlugSchema.safeParse('addon.').success).toBe(false);
  });
});

describe('UpgradeCatalogRowSchema', () => {
  it('accepts a well-formed catalog row', () => {
    expect(() =>
      UpgradeCatalogRowSchema.parse({
        plan: 'PRO',
        planLabel: 'Pro',
        monthlyCents: 9900,
        includes: ['25 users', '100 GB'],
        addOns: [],
      })
    ).not.toThrow();
  });

  it('defaults addOns to []', () => {
    const result = UpgradeCatalogRowSchema.parse({
      plan: 'FREE',
      planLabel: 'Free',
      monthlyCents: 0,
      includes: ['1 user'],
    });
    expect(result.addOns).toEqual([]);
  });
});

describe('FeatureDeniedSchema', () => {
  it('accepts the canonical 403 payload', () => {
    expect(() => FeatureDeniedSchema.parse(SAMPLE_DENIED)).not.toThrow();
  });

  it('rejects a non-403 status', () => {
    expect(() =>
      FeatureDeniedSchema.parse({ ...SAMPLE_DENIED, statusCode: 401 })
    ).toThrow();
  });

  it('rejects a different error code', () => {
    expect(() =>
      FeatureDeniedSchema.parse({ ...SAMPLE_DENIED, error: 'forbidden' })
    ).toThrow();
  });

  it('rejects a malformed email', () => {
    expect(() =>
      FeatureDeniedSchema.parse({ ...SAMPLE_DENIED, upgradeAdminEmail: 'no-at-sign' })
    ).toThrow();
  });

  it('defaults requiredAddOns, currency, and upgradeUrl', () => {
    const { requiredAddOns: _a, currency: _c, upgradeUrl: _u, ...rest } = SAMPLE_DENIED;
    void _a;
    void _c;
    void _u;
    const parsed = FeatureDeniedSchema.parse(rest);
    expect(parsed.requiredAddOns).toEqual([]);
    expect(parsed.currency).toBe('USD');
    expect(parsed.upgradeUrl).toBe('/upgrade');
  });

  it('accepts a null priceDeltaCents (contact-us features)', () => {
    expect(() =>
      FeatureDeniedSchema.parse({ ...SAMPLE_DENIED, priceDeltaCents: null })
    ).not.toThrow();
  });
});

describe('UpgradeImpressionSchema', () => {
  it('accepts a shown impression', () => {
    expect(() =>
      UpgradeImpressionSchema.parse({
        kind: 'shown',
        feature: 'module.crm',
        shownAt: '2026-07-04T12:00:00.000Z',
        at: '2026-07-04T12:00:01.000Z',
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
      })
    ).not.toThrow();
  });

  it('accepts a cta_clicked impression with mailto target', () => {
    expect(() =>
      UpgradeImpressionSchema.parse({
        kind: 'cta_clicked',
        feature: 'module.crm',
        shownAt: '2026-07-04T12:00:00.000Z',
        at: '2026-07-04T12:00:05.000Z',
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
        ctaTarget: 'mailto',
      })
    ).not.toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      UpgradeImpressionSchema.parse({
        kind: 'exploded',
        feature: 'module.crm',
        shownAt: '2026-07-04T12:00:00.000Z',
        at: '2026-07-04T12:00:01.000Z',
        currentPlan: 'FREE',
        recommendedPlan: 'PRO',
      })
    ).toThrow();
  });
});