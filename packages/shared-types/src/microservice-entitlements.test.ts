import { describe, it, expect } from 'vitest';
import {
  MicroserviceIdSchema,
  ServiceAccessContextSchema,
  ServiceEntitlementHeaderSchema,
  evaluateServiceAccess,
  ServiceAccessContext,
} from './microservice-entitlements';

describe('Microservice Entitlements & Access Control Contracts', () => {
  const baseContext: ServiceAccessContext = {
    tenantId: 'tenant-123',
    userId: 'user-456',
    role: 'ADMIN',
    planTier: 'STARTER',
    entitledServices: ['hrm'],
    enabledFeatures: ['EMPLOYEE_MANAGEMENT'],
    isSuspended: false,
  };

  it('validates microservice IDs correctly', () => {
    expect(MicroserviceIdSchema.parse('hrm')).toBe('hrm');
    expect(MicroserviceIdSchema.parse('erp')).toBe('erp');
    expect(MicroserviceIdSchema.parse('core')).toBe('core');
    expect(() => MicroserviceIdSchema.parse('invalid-service')).toThrow();
  });

  it('validates ServiceAccessContext schema', () => {
    const parsed = ServiceAccessContextSchema.parse(baseContext);
    expect(parsed.tenantId).toBe('tenant-123');
    expect(parsed.entitledServices).toContain('hrm');
  });

  it('validates Gateway ServiceEntitlementHeader schema', () => {
    const validHeader = {
      'x-tenant-id': 'tenant-123',
      'x-user-id': 'user-456',
      'x-user-role': 'ADMIN',
      'x-tenant-plan': 'STARTER',
      'x-entitled-services': 'core,hrm,crm',
    };
    const parsed = ServiceEntitlementHeaderSchema.parse(validHeader);
    expect(parsed['x-tenant-id']).toBe('tenant-123');
    expect(parsed['x-entitled-services']).toBe('core,hrm,crm');
  });

  describe('evaluateServiceAccess', () => {
    it('blocks all access when tenant is suspended', () => {
      const suspendedContext: ServiceAccessContext = {
        ...baseContext,
        isSuspended: true,
      };

      const decision = evaluateServiceAccess(suspendedContext, 'core');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('TENANT_SUSPENDED');
      expect(decision.upgradeUrl).toBe('/billing/reactivate');
    });

    it('always permits core service for active tenants', () => {
      const emptyContext: ServiceAccessContext = {
        ...baseContext,
        entitledServices: [],
        enabledFeatures: [],
      };

      const decision = evaluateServiceAccess(emptyContext, 'core');
      expect(decision.allowed).toBe(true);
      expect(decision.serviceId).toBe('core');
    });

    it('permits service present in entitledServices', () => {
      const decision = evaluateServiceAccess(baseContext, 'hrm');
      expect(decision.allowed).toBe(true);
      expect(decision.serviceId).toBe('hrm');
    });

    it('permits service when matching feature flag is present', () => {
      const contextWithFeature: ServiceAccessContext = {
        ...baseContext,
        entitledServices: [], // Not explicitly listed
        enabledFeatures: ['ERP_CORE'], // But has ERP feature flag
      };

      const decision = evaluateServiceAccess(contextWithFeature, 'erp');
      expect(decision.allowed).toBe(true);
      expect(decision.serviceId).toBe('erp');
    });

    it('denies access and provides upgrade guidance when unentitled', () => {
      const decision = evaluateServiceAccess(baseContext, 'wms');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('SERVICE_NOT_ENTITLED');
      expect(decision.requiredFeatures).toContain('WMS_CORE');
      expect(decision.upgradeUrl).toBe('/admin/plans?highlight=wms');
    });
  });
});
