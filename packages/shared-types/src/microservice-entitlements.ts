import { z } from 'zod';
import { TenantRoleSchema } from './index';

// ============================================================================
// Microservice Identifiers & Constants
// ============================================================================

export const MicroserviceIdSchema = z.enum([
  'core',
  'hrm',
  'erp',
  'crm',
  'wms',
  'workspace',
  'analytics',
  'governance',
]);

export type MicroserviceId = z.infer<typeof MicroserviceIdSchema>;

/**
 * Feature keys required to unlock a specific microservice.
 * An empty list signifies a base/foundational service accessible to all active tenants.
 * Includes both v3 microservice keys (*_CORE) and v2 dot-notation aliases (module.*)
 * for backward compatibility with existing PlanFeature seeds and @RequiresFeature guards.
 */
export const SERVICE_FEATURE_MAPPING: Record<MicroserviceId, string[]> = {
  core: [],
  hrm: ['HRM_CORE', 'EMPLOYEE_MANAGEMENT', 'module.hr'],
  erp: ['ERP_CORE', 'FINANCIAL_LEDGERS', 'module.erp'],
  crm: ['CRM_CORE', 'PIPELINE_MANAGEMENT', 'module.crm'],
  wms: ['WMS_CORE', 'INVENTORY_TRACKING', 'module.wms'],
  workspace: ['WORKSPACE_BASE', 'module.email', 'module.chat'],
  analytics: ['ANALYTICS_BI', 'ADVANCED_REPORTS', 'module.bi'],
  governance: ['PDPA_COMPLIANCE', 'AUDIT_LOG_STREAMING', 'module.mas'],
};

// ============================================================================
// Access Control & Entitlement Schemas
// ============================================================================

export const ServicePlanTierSchema = z.enum([
  'FREE',
  'STARTER',
  'GROWTH',
  'PRO',
  'ENTERPRISE',
]);

export type ServicePlanTier = z.infer<typeof ServicePlanTierSchema>;

export const ServiceAccessContextSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  role: TenantRoleSchema,
  planTier: ServicePlanTierSchema,
  entitledServices: z.array(MicroserviceIdSchema).default([]),
  enabledFeatures: z.array(z.string()).default([]),
  isSuspended: z.boolean().default(false),
});

export type ServiceAccessContext = z.infer<typeof ServiceAccessContextSchema>;

export const ServiceAccessDecisionSchema = z.object({
  allowed: z.boolean(),
  serviceId: MicroserviceIdSchema,
  tenantId: z.string(),
  reason: z.string().optional(),
  requiredFeatures: z.array(z.string()).optional(),
  upgradeUrl: z.string().optional(),
});

export type ServiceAccessDecision = z.infer<typeof ServiceAccessDecisionSchema>;

// ============================================================================
// Gateway Trusted Ingress Headers
// ============================================================================

export const ServiceEntitlementHeaderSchema = z.object({
  'x-tenant-id': z.string().min(1),
  'x-user-id': z.string().min(1),
  'x-user-role': z.string().min(1),
  'x-tenant-plan': z.string().min(1),
  'x-entitled-services': z.string(), // comma-delimited microservice IDs
  'x-trace-id': z.string().optional(),
});

export type ServiceEntitlementHeader = z.infer<typeof ServiceEntitlementHeaderSchema>;

// ============================================================================
// Access Evaluation Helper
// ============================================================================

/**
 * Pure evaluation function used by API Gateway & Micro-frontend App Shell
 * to decide whether a tenant request or UI module should be granted access.
 */
export function evaluateServiceAccess(
  context: ServiceAccessContext,
  targetService: MicroserviceId,
): ServiceAccessDecision {
  const { tenantId, isSuspended, entitledServices, enabledFeatures } = context;

  // 1. Suspended tenants cannot access any microservice
  if (isSuspended) {
    return {
      allowed: false,
      serviceId: targetService,
      tenantId,
      reason: 'TENANT_SUSPENDED',
      upgradeUrl: '/billing/reactivate',
    };
  }

  // 2. Core foundational service is always accessible
  if (targetService === 'core') {
    return {
      allowed: true,
      serviceId: targetService,
      tenantId,
    };
  }

  // 3. Explicit service entitlement grant (e.g. via direct Plan mapping or Add-on)
  if (entitledServices.includes(targetService)) {
    return {
      allowed: true,
      serviceId: targetService,
      tenantId,
    };
  }

  // 4. Feature-flag matching check
  const requiredFeatures = SERVICE_FEATURE_MAPPING[targetService] || [];
  const hasMatchingFeature = requiredFeatures.some((feat) => enabledFeatures.includes(feat));

  if (hasMatchingFeature) {
    return {
      allowed: true,
      serviceId: targetService,
      tenantId,
    };
  }

  // 5. Access denied - suggest upgrade
  return {
    allowed: false,
    serviceId: targetService,
    tenantId,
    reason: 'SERVICE_NOT_ENTITLED',
    requiredFeatures,
    upgradeUrl: `/admin/plans?highlight=${targetService}`,
  };
}
