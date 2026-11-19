import type { MicroserviceId } from '@omyxia/shared-types';

const SERVICE_PATH_PREFIXES: Record<string, MicroserviceId> = {
  // Direct microservice prefixes
  '/api/v1/core': 'core',
  '/api/core': 'core',
  '/core': 'core',

  '/api/v1/hrm': 'hrm',
  '/api/hrm': 'hrm',
  '/hrm': 'hrm',
  '/api/attendance': 'hrm',
  '/attendance': 'hrm',
  '/api/positions': 'hrm',
  '/positions': 'hrm',
  '/api/leave': 'hrm',
  '/leave': 'hrm',
  '/api/payroll': 'hrm',
  '/payroll': 'hrm',
  '/api/employees': 'hrm',
  '/employees': 'hrm',
  '/api/departments': 'hrm',
  '/departments': 'hrm',

  '/api/v1/erp': 'erp',
  '/api/erp': 'erp',
  '/erp': 'erp',
  '/api/journals': 'erp',
  '/journals': 'erp',
  '/api/accounts': 'erp',
  '/accounts': 'erp',
  '/api/ap': 'erp',
  '/ap': 'erp',
  '/api/ar': 'erp',
  '/ar': 'erp',
  '/api/tax': 'erp',
  '/tax': 'erp',
  '/api/fiscal-periods': 'erp',
  '/fiscal-periods': 'erp',

  '/api/v1/crm': 'crm',
  '/api/crm': 'crm',
  '/crm': 'crm',
  '/api/leads': 'crm',
  '/leads': 'crm',

  '/api/v1/wms': 'wms',
  '/api/wms': 'wms',
  '/wms': 'wms',

  '/api/v1/workspace': 'workspace',
  '/api/workspace': 'workspace',
  '/workspace': 'workspace',
  '/api/chat': 'workspace',
  '/chat': 'workspace',
  '/api/files': 'workspace',
  '/files': 'workspace',
  '/api/email': 'workspace',
  '/email': 'workspace',
  '/api/mail': 'workspace',
  '/mail': 'workspace',
  '/api/projects': 'workspace',
  '/projects': 'workspace',
  '/api/docs/templates': 'workspace',
  '/docs/templates': 'workspace',

  '/api/v1/analytics': 'analytics',
  '/api/analytics': 'analytics',
  '/analytics': 'analytics',
  '/api/bi': 'analytics',
  '/bi': 'analytics',

  '/api/v1/governance': 'governance',
  '/api/governance': 'governance',
  '/governance': 'governance',
  '/api/cmp': 'governance',
  '/cmp': 'governance',
  '/api/audit-logs': 'governance',
  '/audit-logs': 'governance',

  // Foundational Core routes
  '/api/v1/auth': 'core',
  '/api/auth': 'core',
  '/auth': 'core',
  '/api/mfa': 'core',
  '/mfa': 'core',
  '/api/tenants': 'core',
  '/tenants': 'core',
  '/api/admin': 'core',
  '/admin': 'core',
  '/api/health': 'core',
  '/health': 'core',
  '/api/search': 'core',
  '/search': 'core',
};

// Sorted by prefix length descending to match longest prefix first
const SORTED_PREFIXES = Object.entries(SERVICE_PATH_PREFIXES).sort(
  (a, b) => b[0].length - a[0].length,
);

const VALID_SERVICE_SET = new Set<MicroserviceId>([
  'core',
  'hrm',
  'erp',
  'crm',
  'wms',
  'workspace',
  'analytics',
  'governance',
]);

/**
 * Resolve the target MicroserviceId from the request path.
 * Supports Gateway path formats (/api/v1/:service/*), Monolith paths (/api/:controller/*),
 * and direct service paths (/:controller/*).
 */
export function resolveMicroserviceFromPath(rawPath: string): MicroserviceId | null {
  if (!rawPath) return null;

  // Strip query string and trailing slashes
  const path = rawPath.split('?')[0].replace(/\/+$/, '') || '/';

  // 1. Direct and registered path mapping
  for (const [prefix, serviceId] of SORTED_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return serviceId;
    }
  }

  // 2. Generic dynamic Gateway pattern: /api/v1/:service/* or /api/:service/* or /:service/*
  const match = path.match(/^(?:\/api)?(?:\/v1)?\/([a-z0-9_-]+)(?:\/|$)/i);
  if (match) {
    const candidate = match[1].toLowerCase() as MicroserviceId;
    if (VALID_SERVICE_SET.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
