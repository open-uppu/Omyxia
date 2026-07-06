import { describe, expect, it } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { FeatureForbiddenException } from './feature-forbidden.exception';

describe('FeatureForbiddenException', () => {
  it('returns HTTP 403', () => {
    const exc = new FeatureForbiddenException({
      code: 'FEATURE_NOT_INCLUDED',
      message: 'Feature not included',
      feature: 'module.crm',
      tenantId: 'tenant-1',
      upgradeUrl: 'https://admin.omyxia.app/upgrade?feature=module.crm',
      currentPlan: 'FREE',
      recommendedPlan: 'PRO',
    });

    expect(exc.getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it('exposes the structured payload via .payload and .toClientJson()', () => {
    const payload = {
      code: 'FEATURE_NOT_INCLUDED' as const,
      message: 'Feature not included',
      feature: 'module.crm' as const,
      tenantId: 'tenant-1',
      upgradeUrl: 'https://admin.omyxia.app/upgrade?feature=module.crm',
      currentPlan: 'FREE',
      recommendedPlan: 'PRO' as const,
    };
    const exc = new FeatureForbiddenException(payload);
    expect(exc.payload).toEqual(payload);
    expect(exc.toClientJson()).toEqual(payload);
  });

  it('distinguishes FEATURE_LIMIT_EXCEEDED from FEATURE_NOT_INCLUDED', () => {
    const exc = new FeatureForbiddenException({
      code: 'FEATURE_LIMIT_EXCEEDED',
      message: 'Quota reached',
      feature: 'limit.maxEmployees',
      tenantId: 'tenant-1',
      upgradeUrl: 'https://admin.omyxia.app/upgrade?feature=limit.maxEmployees',
      currentPlan: 'PRO',
      recommendedPlan: 'PRO',
      currentLimit: 25,
      requiredMax: 50,
    });
    expect(exc.payload.code).toBe('FEATURE_LIMIT_EXCEEDED');
    expect(exc.payload.currentLimit).toBe(25);
    expect(exc.payload.requiredMax).toBe(50);
  });

  it('accepts an optional debug context (x-request-id etc.) without breaking JSON shape', () => {
    const exc = new FeatureForbiddenException(
      {
        code: 'FEATURE_NOT_INCLUDED',
        message: 'Feature not included',
        feature: 'module.crm',
        tenantId: 'tenant-1',
        upgradeUrl: 'https://admin.omyxia.app/upgrade?feature=module.crm',
        currentPlan: 'PRO',
        recommendedPlan: 'PRO',
      },
      { traceId: 'trace-abc', route: '/crm/pipelines' },
    );
    const body = exc.getResponse() as Record<string, unknown>;
    expect((body as any).__debug).toBeDefined();
    expect((body as any).__debug.traceId).toBe('trace-abc');
  });
});
