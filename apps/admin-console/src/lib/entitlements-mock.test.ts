// @vitest-environment node
//
// Unit tests for the dev-mode entitlements mock (P3.2).
//
// We assert:
//   1. Each plan tier returns the expected feature flags / limits.
//   2. Plan upgrade ordering works (PRO ⊃ FREE; ENTERPRISE ⊃ PRO).
//   3. ENTERPRISE returns null = "unlimited" caps.
//   4. The env override helpers are pure + safe with garbage input.
//   5. The output shape matches `EntitlementsSchema` so the route
//      validator won't reject what we send.
//
// Run on Node so we don't pull jsdom for a pure-data module.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildMockEntitlements,
  readDevPlanOverride,
  readDevTenantOverride,
} from './entitlements-mock';
import { EntitlementsSchema } from '@omyxia/shared-types';

const FIXED_TS = '2026-07-05T12:00:00.000Z';

describe('buildMockEntitlements', () => {
  it('FREE: only email + chat + admin.tenants; small caps', () => {
    const result = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'FREE',
      generatedAt: FIXED_TS,
    });
    expect(EntitlementsSchema.parse(result)).toEqual(result); // round-trip
    expect(result.features['module.email']).toBe(true);
    expect(result.features['module.chat']).toBe(true);
    expect(result.features['module.hr']).toBe(false);
    expect(result.features['module.crm']).toBe(false);
    expect(result.features['module.erp']).toBe(false);
    expect(result.features['module.wms']).toBe(false);
    expect(result.features['module.bi']).toBe(false);
    expect(result.features['module.mas']).toBe(false);
    expect(result.features['admin.tenants']).toBe(true);
    expect(result.features['admin.plans']).toBe(false);
    expect(result.features['admin.audit']).toBe(false);
    expect(result.limits['limit.maxUsers']).toBe(3);
    expect(result.limits['limit.maxStorageGB']).toBe(1);
    expect(result.usage?.['limit.maxUsers']).toBe(2);
    expect(result.usage?.['limit.maxStorageGB']).toBe(0);
    expect(result.planLabel).toBe('Free');
  });

  it('PRO: adds HR + CRM + BI + Plans admin; higher caps', () => {
    const result = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    expect(result.features['module.hr']).toBe(true);
    expect(result.features['module.crm']).toBe(true);
    expect(result.features['module.bi']).toBe(true);
    expect(result.features['module.erp']).toBe(false);
    expect(result.features['module.wms']).toBe(false);
    expect(result.features['module.mas']).toBe(false);
    expect(result.features['admin.plans']).toBe(true);
    expect(result.features['admin.audit']).toBe(false);
    expect(result.limits['limit.maxUsers']).toBe(25);
    expect(result.limits['limit.maxStorageGB']).toBe(100);
    expect(result.usage?.['limit.maxUsers']).toBe(12);
    expect(result.planLabel).toBe('Pro — $99/mo');
  });

  it('ENTERPRISE: all modules, unlimited caps, audit enabled', () => {
    const result = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'ENTERPRISE',
      generatedAt: FIXED_TS,
    });
    expect(result.features['module.email']).toBe(true);
    expect(result.features['module.chat']).toBe(true);
    expect(result.features['module.hr']).toBe(true);
    expect(result.features['module.crm']).toBe(true);
    expect(result.features['module.erp']).toBe(true);
    expect(result.features['module.wms']).toBe(true);
    expect(result.features['module.bi']).toBe(true);
    expect(result.features['module.mas']).toBe(true);
    expect(result.features['admin.audit']).toBe(true);
    // null = unlimited per spec.
    expect(result.limits['limit.maxUsers']).toBeNull();
    expect(result.limits['limit.maxStorageGB']).toBeNull();
    expect(result.planLabel).toBe('Enterprise');
  });

  it('honours the tenantId argument (null for global view)', () => {
    const t = buildMockEntitlements({
      tenantId: 't-xyz',
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    expect(t.tenantId).toBe('t-xyz');

    const g = buildMockEntitlements({
      tenantId: null,
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    expect(g.tenantId).toBeNull();
  });

  it('stamps the provided generatedAt verbatim (deterministic)', () => {
    const a = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    const b = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    expect(a.generatedAt).toBe(FIXED_TS);
    expect(a).toEqual(b);
  });

  it('PRO ⊋ FREE — every FREE feature is also true on PRO', () => {
    const free = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'FREE',
      generatedAt: FIXED_TS,
    });
    const pro = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    for (const [key, value] of Object.entries(free.features)) {
      if (value === true) {
        expect(pro.features[key as keyof typeof pro.features]).toBe(true);
      }
    }
  });

  it('ENTERPRISE ⊋ PRO — every PRO feature is also true on ENTERPRISE', () => {
    const pro = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'PRO',
      generatedAt: FIXED_TS,
    });
    const ent = buildMockEntitlements({
      tenantId: 't-1',
      plan: 'ENTERPRISE',
      generatedAt: FIXED_TS,
    });
    for (const [key, value] of Object.entries(pro.features)) {
      if (value === true) {
        expect(ent.features[key as keyof typeof ent.features]).toBe(true);
      }
    }
  });

  it('rejects an unknown plan slug (defence in depth)', () => {
    expect(() =>
      buildMockEntitlements({
        tenantId: 't-1',
        // @ts-expect-error — intentionally bad to verify runtime guard
        plan: 'ULTRA',
        generatedAt: FIXED_TS,
      })
    ).toThrow();
  });
});

describe('readDevPlanOverride', () => {
  const ORIGINAL = process.env.ADMIN_DEV_PLAN;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_DEV_PLAN;
    else process.env.ADMIN_DEV_PLAN = ORIGINAL;
  });

  it('defaults to PRO when unset', () => {
    delete process.env.ADMIN_DEV_PLAN;
    expect(readDevPlanOverride()).toBe('PRO');
  });

  it('honours FREE / PRO / ENTERPRISE', () => {
    for (const plan of ['FREE', 'PRO', 'ENTERPRISE'] as const) {
      process.env.ADMIN_DEV_PLAN = plan;
      expect(readDevPlanOverride()).toBe(plan);
    }
  });

  it('falls back to PRO for garbage input', () => {
    process.env.ADMIN_DEV_PLAN = 'ULTRA';
    expect(readDevPlanOverride()).toBe('PRO');
    process.env.ADMIN_DEV_PLAN = '';
    expect(readDevPlanOverride()).toBe('PRO');
  });
});

describe('readDevTenantOverride', () => {
  const ORIGINAL = process.env.ADMIN_DEV_TENANT;
  beforeEach(() => {
    delete process.env.ADMIN_DEV_TENANT;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_DEV_TENANT;
    else process.env.ADMIN_DEV_TENANT = ORIGINAL;
  });

  it('defaults to t-demo when unset', () => {
    expect(readDevTenantOverride()).toBe('t-demo');
  });

  it('honours a custom tenant id', () => {
    process.env.ADMIN_DEV_TENANT = 't-enterprise-42';
    expect(readDevTenantOverride()).toBe('t-enterprise-42');
  });
});