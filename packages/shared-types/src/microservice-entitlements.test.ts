import { describe, it, expect } from 'vitest';
import {
  MicroserviceIdSchema,
  ServicePlanTierSchema,
  SERVICE_FEATURE_MAPPING,
  ServiceAccessContextSchema,
  ServiceEntitlementHeaderSchema,
  evaluateServiceAccess,
  ServiceAccessContext,
  MicroserviceId,
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

  describe('Schema Validation', () => {
    it('validates microservice IDs correctly', () => {
      const validServices: MicroserviceId[] = [
        'core',
        'hrm',
        'erp',
        'crm',
        'wms',
        'workspace',
        'analytics',
        'governance',
      ];
      for (const service of validServices) {
        expect(MicroserviceIdSchema.parse(service)).toBe(service);
      }
      expect(() => MicroserviceIdSchema.parse('invalid-service')).toThrow();
    });

    it('validates subscription plan tiers correctly', () => {
      const validTiers = ['FREE', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'] as const;
      for (const tier of validTiers) {
        expect(ServicePlanTierSchema.parse(tier)).toBe(tier);
      }
      expect(() => ServicePlanTierSchema.parse('ULTRA_VIP')).toThrow();
    });

    it('verifies SERVICE_FEATURE_MAPPING contains all microservices', () => {
      const expectedServices: MicroserviceId[] = [
        'core',
        'hrm',
        'erp',
        'crm',
        'wms',
        'workspace',
        'analytics',
        'governance',
      ];
      for (const service of expectedServices) {
        expect(SERVICE_FEATURE_MAPPING).toHaveProperty(service);
        expect(Array.isArray(SERVICE_FEATURE_MAPPING[service])).toBe(true);
      }
      expect(SERVICE_FEATURE_MAPPING.core).toEqual([]);
      expect(SERVICE_FEATURE_MAPPING.erp).toContain('ERP_CORE');
      expect(SERVICE_FEATURE_MAPPING.crm).toContain('CRM_CORE');
      expect(SERVICE_FEATURE_MAPPING.wms).toContain('WMS_CORE');
    });

    it('validates ServiceAccessContext schema', () => {
      const parsed = ServiceAccessContextSchema.parse(baseContext);
      expect(parsed.tenantId).toBe('tenant-123');
      expect(parsed.entitledServices).toContain('hrm');
      expect(parsed.enabledFeatures).toContain('EMPLOYEE_MANAGEMENT');
      expect(parsed.isSuspended).toBe(false);
    });

    it('validates Gateway ServiceEntitlementHeader schema with and without trace id', () => {
      const validHeaderWithoutTrace = {
        'x-tenant-id': 'tenant-123',
        'x-user-id': 'user-456',
        'x-user-role': 'ADMIN',
        'x-tenant-plan': 'STARTER',
        'x-entitled-services': 'core,hrm,crm',
      };
      const parsedWithoutTrace = ServiceEntitlementHeaderSchema.parse(validHeaderWithoutTrace);
      expect(parsedWithoutTrace['x-tenant-id']).toBe('tenant-123');
      expect(parsedWithoutTrace['x-entitled-services']).toBe('core,hrm,crm');
      expect(parsedWithoutTrace['x-trace-id']).toBeUndefined();

      const validHeaderWithTrace = {
        ...validHeaderWithoutTrace,
        'x-trace-id': 'trace-uuid-789',
      };
      const parsedWithTrace = ServiceEntitlementHeaderSchema.parse(validHeaderWithTrace);
      expect(parsedWithTrace['x-trace-id']).toBe('trace-uuid-789');
    });

    it('rejects invalid or missing headers in ServiceEntitlementHeader schema', () => {
      expect(() =>
        ServiceEntitlementHeaderSchema.parse({
          'x-tenant-id': '',
          'x-user-id': 'user-456',
          'x-user-role': 'ADMIN',
          'x-tenant-plan': 'STARTER',
          'x-entitled-services': 'core',
        }),
      ).toThrow();

      expect(() =>
        ServiceEntitlementHeaderSchema.parse({
          'x-user-id': 'user-456',
        }),
      ).toThrow();
    });
  });

  describe('evaluateServiceAccess', () => {
    it('blocks all access when tenant is suspended', () => {
      const suspendedContext: ServiceAccessContext = {
        ...baseContext,
        isSuspended: true,
      };

      const services: MicroserviceId[] = ['core', 'hrm', 'erp', 'crm', 'wms'];
      for (const service of services) {
        const decision = evaluateServiceAccess(suspendedContext, service);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('TENANT_SUSPENDED');
        expect(decision.upgradeUrl).toBe('/billing/reactivate');
      }
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

    it('permits service when secondary feature flag is present', () => {
      const contextWithSecondaryFeature: ServiceAccessContext = {
        ...baseContext,
        entitledServices: [],
        enabledFeatures: ['FINANCIAL_LEDGERS'],
      };

      const decision = evaluateServiceAccess(contextWithSecondaryFeature, 'erp');
      expect(decision.allowed).toBe(true);
      expect(decision.serviceId).toBe('erp');
    });

    it('permits service when legacy dot-notation feature flag is present', () => {
      const contextWithLegacyFlag: ServiceAccessContext = {
        ...baseContext,
        entitledServices: [],
        enabledFeatures: ['module.erp'],
      };

      const decision = evaluateServiceAccess(contextWithLegacyFlag, 'erp');
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

    it('denies access to analytics and governance when neither service nor feature flag is granted', () => {
      const analyticsDecision = evaluateServiceAccess(baseContext, 'analytics');
      expect(analyticsDecision.allowed).toBe(false);
      expect(analyticsDecision.requiredFeatures).toContain('ANALYTICS_BI');

      const governanceDecision = evaluateServiceAccess(baseContext, 'governance');
      expect(governanceDecision.allowed).toBe(false);
      expect(governanceDecision.requiredFeatures).toContain('PDPA_COMPLIANCE');
    });
  });
});

