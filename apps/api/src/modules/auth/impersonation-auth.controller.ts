/**
 * apps/api/src/modules/auth/impersonation-auth.controller.ts
 *
 * P1.7 — Auth-namespaced impersonation probe.
 *
 * Provides:
 *
 *   GET /api/auth/impersonate/me
 *
 * Auth-namespaced so the tenant-UI banner can call it as a "who am
 * I?" probe without traversing the cross-tenant admin route. The
 * SUPER_ADMIN gate on the JWT itself does the auth check — there
 * is no `@Roles()` decorator here because:
 *
 *   - Impersonation tokens carry `role: 'OWNER'` (synthesised for
 *     the impersonated tenant), NOT `SUPER_ADMIN`.
 *   - A regular tenant-member token has no `impersonation` flag
 *     and returns `{ session: null }` immediately.
 *   - The actual JWT signature is verified upstream by the
 *     TenantContextMiddleware (or the standard passport-jwt
 *     guard); we only read the verified payload off `req.user`.
 *
 * Mounted under AuthModule so the URL stays under `/api/auth` (the
 * semantic home of "who am I?" probes — see /api/auth/me and the
 * switch-tenant endpoint).
 *
 * The actual session lookup delegates to
 * `ImpersonationAdminService.meFromClaims()` so the controller
 * stays a thin shell.
 */

import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/rbac/roles.decorator';
import {
  ImpersonationMeResponseSchema,
  ImpersonationSessionSchema,
  type ImpersonationMeResponse,
  type ImpersonationJwtClaims,
} from '@omyxia/shared-types';
import { ImpersonationAdminService } from '../admin/impersonation-admin.service';

function extractImpersonationClaims(
  req: Request,
): ImpersonationJwtClaims | null {
  const u = (req as any)?.user;
  if (!u || typeof u !== 'object') return null;
  if (u.impersonation !== true) return null;
  if (
    typeof u.sub !== 'string' ||
    typeof u.activeTenantId !== 'string' ||
    typeof u.targetTenantId !== 'string' ||
    typeof u.originalAdminId !== 'string' ||
    typeof u.impersonationSessionId !== 'string' ||
    typeof u.impersonationReason !== 'string' ||
    typeof u.impersonationReasonCode !== 'string' ||
    u.role !== 'OWNER'
  ) {
    return null;
  }
  return {
    sub: u.sub,
    activeTenantId: u.activeTenantId,
    targetTenantId: u.targetTenantId,
    role: 'OWNER',
    originalAdminId: u.originalAdminId,
    impersonation: true,
    impersonationSessionId: u.impersonationSessionId,
    impersonationReasonCode: u.impersonationReasonCode as ImpersonationJwtClaims['impersonationReasonCode'],
    impersonationReason: u.impersonationReason,
  };
}

@Controller('auth/impersonate')
@Roles('SUPER_ADMIN', 'OWNER', 'ADMIN', 'HR_MANAGER', 'ACCOUNTANT', 'MANAGER', 'MEMBER', 'VIEWER')
export class ImpersonationAuthController {
  constructor(
    private readonly impersonationService: ImpersonationAdminService,
  ) {}

  /**
   * GET /api/auth/impersonate/me
   *
   * Returns `{ session: null }` for every request that does NOT
   * carry an impersonation JWT — this is the cheap path the banner
   * takes on every page load. When the user IS impersonating, the
   * session shape is the canonical record (not just the JWT
   * claims) so a revoked / EXPIRED session can never leak.
   */
  @Get('me')
  async me(@Req() req: Request): Promise<ImpersonationMeResponse> {
    const claims = extractImpersonationClaims(req);
    if (!claims) {
      return ImpersonationMeResponseSchema.parse({ session: null });
    }
    const out = await this.impersonationService.meFromClaims(claims);
    return ImpersonationMeResponseSchema.parse({
      session: out.session
        ? ImpersonationSessionSchema.parse(out.session)
        : null,
    });
  }
}
