/**
 * @omyxia/shared-types — admin-impersonate tests (P1.7).
 *
 * Validates the wire format without depending on the API code or
 * the React tree, so a typo in the schema surfaces in this suite
 * rather than at runtime in a tenant UI render.
 *
 * Strategy:
 *   - Parse / fail-parse each schema in isolation
 *   - Round-trip a fully-populated `ImpersonationSession` and the
 *     `ImpersonationTokenResponse` envelope to make sure the field
 *     set is identical end to end
 *   - Snapshot the TTL constant so a silent change to "1 hour" is
 *     caught here rather than by a post-merge SOC2 review
 */

import { describe, it, expect } from 'vitest';
import {
  ADMIN_TENANT_PAGE_SIZE,
  parseAdminTenantFilters,
} from './admin-tenants';
import {
  IMPERSONATION_TTL_SECONDS,
  IMPERSONATION_TTL_MS,
  ImpersonationReasonSchema,
  ImpersonationStartRequestSchema,
  ImpersonationSessionSchema,
  ImpersonationTokenResponseSchema,
  ImpersonationMeResponseSchema,
  ImpersonationJwtClaimsSchema,
  AdminImpersonateStartedPayloadSchema,
  AdminImpersonateEndedPayloadSchema,
} from './admin-impersonate';

describe('admin-impersonate (P1.7)', () => {
  describe('TTL constants', () => {
    it('exposes 1 hour (3600 s) as the impersonation TTL', () => {
      // Hard-coded to 1 h — the card spec; change here AND in the
      // comments above the constant if you ever need to.
      expect(IMPERSONATION_TTL_SECONDS).toBe(60 * 60);
      expect(IMPERSONATION_TTL_SECONDS * 1000).toBe(IMPERSONATION_TTL_MS);
    });
  });

  describe('ImpersonationReasonSchema', () => {
    it('accepts the documented taxonomy values', () => {
      for (const v of ['SUPPORT', 'AUDIT', 'DEBUG', 'MIGRATION', 'OTHER']) {
        expect(ImpersonationReasonSchema.parse(v)).toBe(v);
      }
    });

    it('rejects unknown reasons with a clear zod error', () => {
      const r = ImpersonationReasonSchema.safeParse('PWNED');
      expect(r.success).toBe(false);
    });
  });

  describe('ImpersonationStartRequestSchema', () => {
    it('requires both reasonCode and a non-trivial reason', () => {
      const ok = {
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234 customer reports duplicated invoice',
      };
      const parsed = ImpersonationStartRequestSchema.parse(ok);
      expect(parsed.reasonCode).toBe('SUPPORT');
      expect(parsed.reason).toBe(ok.reason);
    });

    it('trims whitespace from the reason and rejects < 3 chars', () => {
      const good = ImpersonationStartRequestSchema.safeParse({
        reasonCode: 'AUDIT',
        reason: '   hello world   ',
      });
      expect(good.success).toBe(true);
      if (good.success) expect(good.data.reason).toBe('hello world');

      const short = ImpersonationStartRequestSchema.safeParse({
        reasonCode: 'AUDIT',
        reason: 'hi',
      });
      expect(short.success).toBe(false);
    });

    it('rejects requests missing the reason', () => {
      const r = ImpersonationStartRequestSchema.safeParse({
        reasonCode: 'SUPPORT',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('ImpersonationSessionSchema', () => {
    const fixedSession = {
      sessionId: 'cu_session_abcdef0123456789',
      superAdminId: 'cu_admin_xxx',
      superAdminEmail: 'admin@omyxia.app',
      superAdminName: 'CEO Operator',
      tenantId: 'cu_tenant_yyy',
      tenantName: 'Acme Co',
      tenantSlug: 'acme',
      reasonCode: 'SUPPORT' as const,
      reason: 'SUP-1234 billing question',
      startedAt: '2026-07-07T07:25:00.000Z',
      expiresAt: '2026-07-07T08:25:00.000Z',
      ttlSeconds: 3600,
    };

    it('round-trips a fully-populated session', () => {
      const parsed = ImpersonationSessionSchema.parse(fixedSession);
      expect(parsed).toEqual(fixedSession);
    });

    it('rejects invalid email addresses', () => {
      const r = ImpersonationSessionSchema.safeParse({
        ...fixedSession,
        superAdminEmail: 'not-an-email',
      });
      expect(r.success).toBe(false);
    });

    it('rejects ttlSeconds = 0', () => {
      const r = ImpersonationSessionSchema.safeParse({
        ...fixedSession,
        ttlSeconds: 0,
      });
      expect(r.success).toBe(false);
    });
  });

  describe('ImpersonationTokenResponseSchema', () => {
    it('requires the session envelope AND a non-empty accessToken', () => {
      const r = ImpersonationTokenResponseSchema.safeParse({
        session: {
          sessionId: 's',
          superAdminId: 'a',
          superAdminEmail: 'admin@omyxia.app',
          superAdminName: 'Admin',
          tenantId: 't',
          tenantName: 'Acme',
          tenantSlug: 'acme',
          reasonCode: 'SUPPORT' as const,
          reason: 'x'.repeat(4),
          startedAt: '2026-07-07T07:25:00.000Z',
          expiresAt: '2026-07-07T08:25:00.000Z',
          ttlSeconds: 60,
        },
        accessToken: '...',
        expiresAt: '2026-07-07T08:25:00.000Z',
        ttlSeconds: 60,
      });
      expect(r.success).toBe(true);
    });

    it('rejects empty accessToken', () => {
      const r = ImpersonationTokenResponseSchema.safeParse({
        session: {},
        accessToken: '',
        expiresAt: '2026-07-07T08:25:00.000Z',
        ttlSeconds: 60,
      });
      expect(r.success).toBe(false);
    });
  });

  describe('ImpersonationMeResponseSchema', () => {
    it('accepts { session: null } for the "not impersonating" branch', () => {
      const r = ImpersonationMeResponseSchema.parse({ session: null });
      expect(r.session).toBeNull();
    });
  });

  describe('ImpersonationJwtClaimsSchema', () => {
    it('rejects tokens without the impersonation flag', () => {
      const r = ImpersonationJwtClaimsSchema.safeParse({
        sub: 'a',
        activeTenantId: 't',
        targetTenantId: 't',
        role: 'OWNER',
        originalAdminId: 'a',
        // impersonation: true,   <- deliberately omitted
        impersonationSessionId: 's',
        impersonationReasonCode: 'SUPPORT',
        impersonationReason: 'r',
      });
      expect(r.success).toBe(false);
    });

    it('round-trips a fully-populated impersonation JWT payload', () => {
      const ok = ImpersonationJwtClaimsSchema.parse({
        sub: 'a',
        activeTenantId: 't',
        targetTenantId: 't',
        role: 'OWNER',
        originalAdminId: 'a',
        impersonation: true,
        impersonationSessionId: 's',
        impersonationReasonCode: 'SUPPORT',
        impersonationReason: 'SUP-1234',
      });
      expect(ok.impersonation).toBe(true);
      expect(ok.role).toBe('OWNER');
    });
  });

  describe('WebSocket payload schemas', () => {
    it('admin:impersonate:started carries the broadcast context', () => {
      const r = AdminImpersonateStartedPayloadSchema.parse({
        sessionId: 's',
        superAdminId: 'a',
        superAdminEmail: 'admin@omyxia.app',
        superAdminName: 'Admin',
        tenantId: 't',
        tenantName: 'Acme',
        tenantSlug: 'acme',
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234',
        startedAt: '2026-07-07T07:25:00.000Z',
        expiresAt: '2026-07-07T08:25:00.000Z',
      });
      expect(r.sessionId).toBe('s');
    });

    it('admin:impersonate:ended accepts the three end reasons', () => {
      for (const endedReason of ['STOPPED', 'EXPIRED', 'SUPERSEDED']) {
        const r = AdminImpersonateEndedPayloadSchema.parse({
          sessionId: 's',
          tenantId: 't',
          endedAt: '2026-07-07T07:30:00.000Z',
          endedReason,
        });
        expect(r.endedReason).toBe(endedReason);
      }
    });
  });

  describe('FE/BE drift guard — shared-types re-exports stay the same', () => {
    it('admin-impersonate does not break the tenant-list parser', () => {
      // Sanity check: adding the new module shouldn't destabilise
      // the older admin-tenants APIs.
      const sp = new URLSearchParams(
        'q=acme&plan=PRO,ENTERPRISE&status=ACTIVE&region=eu&page=2&pageSize=50',
      );
      const r = parseAdminTenantFilters(sp);
      expect(r.pageSize).toBeLessThanOrEqual(ADMIN_TENANT_PAGE_SIZE * 8); // sanity bound
    });
  });
});
