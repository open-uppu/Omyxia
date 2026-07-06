/**
 * apps/api/src/modules/admin/tenants-admin.controller.spec.ts
 *
 * P1.4 — Vitest spec for TenantsAdminController.
 *
 * Strategy:
 *   - Mock the service so we don't need a real Prisma connection.
 *   - Verify:
 *       - the handler is gated by `@Roles('SUPER_ADMIN')`
 *       - the controller delegates parsed filters to the service
 *       - the controller's `parseTenantListQuery` agrees with the
 *         FE-side `parseAdminTenantFilters` (so FE/BE never drift)
 *       - the controller wires up to a `GET /` route
 */

import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { TenantsAdminController } from './tenants-admin.controller';
import { ROLES_METADATA_KEY } from '../auth/rbac/roles.decorator';
import { parseTenantListQuery } from './admin.tenants.dto';
import {
  ADMIN_TENANT_PAGE_SIZE,
  parseAdminTenantFilters,
} from '@omyxia/shared-types';

describe('TenantsAdminController', () => {
  describe('route metadata', () => {
    it('exposes GET / at the controller-level', () => {
      const path = Reflect.getMetadata('path', TenantsAdminController);
      expect(path).toBe('admin/tenants');
    });

    it('gates the handler with @Roles(SUPER_ADMIN)', () => {
      // @Roles is applied at the class level (applies to every
      // handler in the controller). RolesGuard's getAllAndOverride
      // will pick it up for the GET / handler.
      const roles = Reflect.getMetadata(ROLES_METADATA_KEY, TenantsAdminController);
      expect(roles).toEqual(['SUPER_ADMIN']);
    });

    it('declares the handler as a GET', () => {
      const method = Reflect.getMetadata(
        'method',
        TenantsAdminController.prototype.list,
      );
      // NestJS uses the RequestMethod enum; 0 = GET, 1 = POST, etc.
      // Hard-code 0 here so we don't import the enum into a unit test.
      expect(method).toBe(0);
    });
  });

  describe('list handler', () => {
    it('parses the raw query and delegates to the service', async () => {
      const svc = {
        list: vi.fn(async (filters: unknown) => ({
          generatedAt: '2026-07-06T15:00:00.000Z',
          filters: filters as any,
          items: [],
          total: 0,
          skip: 0,
          take: ADMIN_TENANT_PAGE_SIZE,
        })),
      } as any;
      const ctl = new TenantsAdminController(svc);
      const res = await ctl.list({ plan: 'PRO,ENTERPRISE', status: 'ACTIVE' });
      // The handler should pass parsed filters to the service.
      expect(svc.list).toHaveBeenCalledOnce();
      const passed = svc.list.mock.calls[0][0];
      expect(passed).toMatchObject({
        plan: ['PRO', 'ENTERPRISE'],
        status: ['ACTIVE'],
        page: 1,
        pageSize: ADMIN_TENANT_PAGE_SIZE,
      });
      expect(res.filters).toEqual(passed);
    });

    it('uses defaults when the query is empty', async () => {
      const svc = {
        list: vi.fn(async (filters: unknown) => ({
          generatedAt: '2026-07-06T15:00:00.000Z',
          filters: filters as any,
          items: [],
          total: 0,
          skip: 0,
          take: ADMIN_TENANT_PAGE_SIZE,
        })),
      } as any;
      const ctl = new TenantsAdminController(svc);
      await ctl.list({});
      const passed = svc.list.mock.calls[0][0];
      expect(passed).toEqual({
        q: '',
        plan: [],
        status: [],
        region: [],
        page: 1,
        pageSize: ADMIN_TENANT_PAGE_SIZE,
      });
    });

    it('clamps oversized pageSize to the documented default', async () => {
      const svc = { list: vi.fn(async () => ({})) } as any;
      const ctl = new TenantsAdminController(svc);
      await ctl.list({ pageSize: '9999' });
      const passed = svc.list.mock.calls[0][0];
      expect(passed.pageSize).toBe(ADMIN_TENANT_PAGE_SIZE);
    });

    it('drops unknown enum values (case-sensitive plan/status, case-insensitive region)', async () => {
      const svc = { list: vi.fn(async () => ({})) } as any;
      const ctl = new TenantsAdminController(svc);
      await ctl.list({
        plan: 'FREE,PRO,bogus,STARTER',
        status: 'active,DELETED,SUSPENDED',
        region: 'EU,apac,xx',
      });
      const passed = svc.list.mock.calls[0][0];
      expect(passed.plan).toEqual(['FREE', 'PRO']); // STARTER not aliased to FREE
      expect(passed.status).toEqual(['ACTIVE', 'SUSPENDED']);
      expect(passed.region).toEqual(['eu', 'apac']);
    });
  });

  describe('parseTenantListQuery (FE/BE drift guard)', () => {
    it('agrees with parseAdminTenantFilters for a fully-populated URL', () => {
      const sp = new URLSearchParams(
        'q=acme&plan=PRO,ENTERPRISE&status=ACTIVE&region=eu&page=2&pageSize=50',
      );
      const fe = parseAdminTenantFilters(sp);
      const be = parseTenantListQuery(sp as any);
      expect(be).toEqual(fe);
    });

    it('agrees with parseAdminTenantFilters for empty input', () => {
      const sp = new URLSearchParams('');
      const fe = parseAdminTenantFilters(sp);
      const be = parseTenantListQuery({});
      expect(be).toEqual(fe);
    });
  });
});