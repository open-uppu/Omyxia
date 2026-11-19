import { describe, expect, it } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { ServiceForbiddenException } from './service-forbidden.exception';
import type { ServiceAccessDecision } from '@omyxia/shared-types';

describe('ServiceForbiddenException', () => {
  it('formats 403 Forbidden payload for un-entitled microservice', () => {
    const decision: ServiceAccessDecision = {
      allowed: false,
      serviceId: 'erp',
      tenantId: 'tenant-test-1',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE', 'FINANCIAL_LEDGERS'],
      upgradeUrl: '/admin/plans?highlight=erp',
    };

    const exception = new ServiceForbiddenException(decision);
    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);

    const payload = exception.getPayload();
    expect(payload).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: "Tenant is not entitled to use the 'erp' microservice",
      serviceId: 'erp',
      tenantId: 'tenant-test-1',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['ERP_CORE', 'FINANCIAL_LEDGERS'],
      requiredFeature: 'ERP_CORE',
      upgradeUrl: '/admin/plans?highlight=erp',
    });
  });

  it('formats payload for suspended tenant with reactivation URL', () => {
    const decision: ServiceAccessDecision = {
      allowed: false,
      serviceId: 'crm',
      tenantId: 'tenant-suspended-2',
      reason: 'TENANT_SUSPENDED',
      upgradeUrl: '/billing/reactivate',
    };

    const exception = new ServiceForbiddenException(decision);
    expect(exception.getStatus()).toBe(403);

    const payload = exception.getPayload();
    expect(payload.reason).toBe('TENANT_SUSPENDED');
    expect(payload.message).toBe('Tenant account is suspended');
    expect(payload.upgradeUrl).toBe('/billing/reactivate');
    expect(payload.requiredFeatures).toEqual([]);
    expect(payload.requiredFeature).toBeUndefined();
  });

  it('allows message override if provided', () => {
    const decision: ServiceAccessDecision = {
      allowed: false,
      serviceId: 'wms',
      tenantId: 'tenant-wms',
      reason: 'SERVICE_NOT_ENTITLED',
      requiredFeatures: ['WMS_CORE'],
      upgradeUrl: '/admin/plans?highlight=wms',
    };

    const exception = new ServiceForbiddenException(decision, 'Custom message: WMS module required');
    expect(exception.getPayload().message).toBe('Custom message: WMS module required');
  });
});
