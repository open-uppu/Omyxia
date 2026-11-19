import { describe, expect, it } from 'vitest';
import { resolveMicroserviceFromPath } from './service-resolver';

describe('resolveMicroserviceFromPath', () => {
  it('resolves Gateway routes (/api/v1/:service/*)', () => {
    expect(resolveMicroserviceFromPath('/api/v1/erp/journals')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/v1/hrm/employees')).toBe('hrm');
    expect(resolveMicroserviceFromPath('/api/v1/crm/leads')).toBe('crm');
    expect(resolveMicroserviceFromPath('/api/v1/wms/inventory')).toBe('wms');
    expect(resolveMicroserviceFromPath('/api/v1/analytics/kpis')).toBe('analytics');
    expect(resolveMicroserviceFromPath('/api/v1/workspace/chat')).toBe('workspace');
    expect(resolveMicroserviceFromPath('/api/v1/governance/audit')).toBe('governance');
    expect(resolveMicroserviceFromPath('/api/v1/core/tenants')).toBe('core');
  });

  it('resolves Monolith API routes (/api/:controller/*)', () => {
    expect(resolveMicroserviceFromPath('/api/journals')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/accounts')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/ap')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/ar')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/tax')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/fiscal-periods')).toBe('erp');

    expect(resolveMicroserviceFromPath('/api/employees')).toBe('hrm');
    expect(resolveMicroserviceFromPath('/api/attendance')).toBe('hrm');
    expect(resolveMicroserviceFromPath('/api/leave')).toBe('hrm');
    expect(resolveMicroserviceFromPath('/api/payroll')).toBe('hrm');
    expect(resolveMicroserviceFromPath('/api/positions')).toBe('hrm');

    expect(resolveMicroserviceFromPath('/api/crm')).toBe('crm');
    expect(resolveMicroserviceFromPath('/api/crm/leads/123')).toBe('crm');

    expect(resolveMicroserviceFromPath('/api/wms')).toBe('wms');

    expect(resolveMicroserviceFromPath('/api/chat')).toBe('workspace');
    expect(resolveMicroserviceFromPath('/api/files')).toBe('workspace');
    expect(resolveMicroserviceFromPath('/api/email')).toBe('workspace');
    expect(resolveMicroserviceFromPath('/api/projects')).toBe('workspace');

    expect(resolveMicroserviceFromPath('/api/bi')).toBe('analytics');
    expect(resolveMicroserviceFromPath('/api/analytics')).toBe('analytics');

    expect(resolveMicroserviceFromPath('/api/auth/login')).toBe('core');
    expect(resolveMicroserviceFromPath('/api/health')).toBe('core');
    expect(resolveMicroserviceFromPath('/health')).toBe('core');
  });

  it('handles query strings and trailing slashes', () => {
    expect(resolveMicroserviceFromPath('/api/v1/erp/journals?from=2026-01-01&to=2026-12-31')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/journals/')).toBe('erp');
    expect(resolveMicroserviceFromPath('/api/v1/crm/?limit=20')).toBe('crm');
  });

  it('returns null for unknown paths', () => {
    expect(resolveMicroserviceFromPath('')).toBeNull();
    expect(resolveMicroserviceFromPath('/unknown-path')).toBeNull();
    expect(resolveMicroserviceFromPath('/api/nonexistent-service/action')).toBeNull();
  });
});
