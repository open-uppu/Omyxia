/**
 * apps/api/src/modules/admin/impersonation-admin.controller.spec.ts
 *
 * P1.7 — Vitest spec for ImpersonationAdminController.
 *
 * Strategy:
 *   - Mock the service so we don't need real Prisma / JWT / Realtime.
 *   - Verify:
 *       - the controller is gated by `@Roles('SUPER_ADMIN')`
 *       - the POST handler validates the body via the shared zod schema
 *         (rejects unknown reasonCodes, rejects too-short reason)
 *       - the POST handler delegates the parsed input to the service
 *       - the `me` handler routes through `extractImpersonationClaims`
 *         and returns `{ session: null }` for ordinary requests
 */

import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { ImpersonationAdminController } from './impersonation-admin.controller';
import { ROLES_METADATA_KEY } from '../auth/rbac/roles.decorator';

describe('ImpersonationAdminController', () => {
  describe('route metadata', () => {
    it('mounts the controller at admin/impersonate', () => {
      const path = Reflect.getMetadata('path', ImpersonationAdminController);
      expect(path).toBe('admin/impersonate');
    });

    it('gates every handler with @Roles(SUPER_ADMIN)', () => {
      const roles = Reflect.getMetadata(
        ROLES_METADATA_KEY,
        ImpersonationAdminController,
      );
      expect(roles).toEqual(['SUPER_ADMIN']);
    });
  });

  describe('start handler', () => {
    it('rejects a body without a reasonCode', async () => {
      const svc = { start: vi.fn() } as any;
      const ctl = new ImpersonationAdminController(svc);
      await expect(
        ctl.start('tenant-1', { reason: 'bad' }),
      ).rejects.toThrow(/Invalid impersonation request/);
      expect(svc.start).not.toHaveBeenCalled();
    });

    it('rejects a body with a too-short reason', async () => {
      const svc = { start: vi.fn() } as any;
      const ctl = new ImpersonationAdminController(svc);
      await expect(
        ctl.start('tenant-1', { reasonCode: 'SUPPORT', reason: 'hi' }),
      ).rejects.toThrow(/Invalid impersonation request/);
      expect(svc.start).not.toHaveBeenCalled();
    });

    it('passes a valid body to service.start with the tenantId from path', async () => {
      const expected = {
        session: {} as any,
        accessToken: 'signed.jwt.token',
        expiresAt: '2026-07-07T08:25:00.000Z',
        ttlSeconds: 3600,
      };
      const svc = { start: vi.fn(async () => expected) } as any;
      const ctl = new ImpersonationAdminController(svc);
      const res = await ctl.start('tenant-abc', {
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234 customer reports duplicated invoice',
      });
      expect(svc.start).toHaveBeenCalledWith('tenant-abc', {
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234 customer reports duplicated invoice',
      });
      expect(res).toBe(expected);
    });
  });

  describe('stop handler', () => {
    it('passes the sessionId to service.stop', async () => {
      const expected = {
        sessionId: 'sess-1',
        endedAt: '2026-07-07T07:30:00.000Z',
      };
      const svc = { stop: vi.fn(async () => expected) } as any;
      const ctl = new ImpersonationAdminController(svc);
      const res = await ctl.stop('sess-1');
      expect(svc.stop).toHaveBeenCalledWith('sess-1');
      expect(res).toBe(expected);
    });
  });

  describe('me handler (admin route)', () => {
    it('returns { session: null } for a non-impersonation JWT', async () => {
      const svc = { meFromClaims: vi.fn() } as any;
      const ctl = new ImpersonationAdminController(svc);
      const req = {
        user: { sub: 'admin-1', role: 'OWNER' /* no impersonation flag */ },
      } as any;
      const res = await ctl.meAsAdmin(req);
      expect(res).toEqual({ session: null });
      expect(svc.meFromClaims).not.toHaveBeenCalled();
    });

    it('returns the session when the request carries a valid impersonation JWT', async () => {
      const claims = {
        sub: 'admin-1',
        activeTenantId: 't-1',
        targetTenantId: 't-1',
        role: 'OWNER',
        originalAdminId: 'admin-1',
        impersonation: true,
        impersonationSessionId: 'sess-1',
        impersonationReasonCode: 'SUPPORT',
        impersonationReason: 'SUP-1234',
      };
      const session = {
        sessionId: 'sess-1',
        superAdminId: 'admin-1',
        superAdminEmail: 'admin@omyxia.app',
        superAdminName: 'Admin',
        tenantId: 't-1',
        tenantName: 'Acme',
        tenantSlug: 'acme',
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234',
        startedAt: '2026-07-07T07:25:00.000Z',
        expiresAt: '2026-07-07T08:25:00.000Z',
        ttlSeconds: 3600,
      };
      const svc = { meFromClaims: vi.fn(async () => ({ session })) } as any;
      const ctl = new ImpersonationAdminController(svc);
      const req = { user: claims } as any;
      const res = await ctl.meAsAdmin(req);
      expect(svc.meFromClaims).toHaveBeenCalledOnce();
      expect(res.session?.sessionId).toBe('sess-1');
    });
  });

  describe('read handler', () => {
    it('returns the session when the DB row exists', async () => {
      const session = {
        sessionId: 'sess-1',
        superAdminId: 'admin-1',
        superAdminEmail: 'admin@omyxia.app',
        superAdminName: 'Admin',
        tenantId: 't-1',
        tenantName: 'Acme',
        tenantSlug: 'acme',
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234',
        startedAt: '2026-07-07T07:25:00.000Z',
        expiresAt: '2026-07-07T08:25:00.000Z',
        ttlSeconds: 3600,
      };
      const svc = { readSession: vi.fn(async () => session) } as any;
      const ctl = new ImpersonationAdminController(svc);
      const res = await ctl.read('sess-1');
      expect(svc.readSession).toHaveBeenCalledWith('sess-1');
      expect(res?.sessionId).toBe('sess-1');
    });

    it('returns null when the session is missing', async () => {
      const svc = { readSession: vi.fn(async () => null) } as any;
      const ctl = new ImpersonationAdminController(svc);
      const res = await ctl.read('does-not-exist');
      expect(res).toBeNull();
    });
  });
});
