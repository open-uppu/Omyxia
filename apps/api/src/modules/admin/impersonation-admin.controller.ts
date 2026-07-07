/**
 * apps/api/src/modules/admin/impersonation-admin.controller.ts
 *
 * P1.7 — Super-admin impersonation endpoints.
 *
 * Routes (all gated behind the global RolesGuard with
 * `@Roles('SUPER_ADMIN')`):
 *
 *   POST   /api/admin/impersonate/:tenantId
 *     — Start a new impersonation session. Returns the scoped JWT
 *       + the new {@link ImpersonationSession} envelope. The JWT is
 *       1-hour TTL and includes the original_admin_id +
 *       target_tenant_id + impersonation_session_id claims.
 *
 *   DELETE /api/admin/impersonate/:sessionId
 *     — End a session early. Idempotent: ending an already-ended
 *       session returns the existing endedAt timestamp.
 *
 *   GET    /api/admin/impersonate/:sessionId
 *     — Read the canonical record of one session. Useful for the
 *       admin-console live indicator + audit-trail view.
 *
 * `GET /api/auth/impersonate/me` lives in the Auth module (same
 * handler logic, but the URL belongs to the auth namespace). See
 * {@link AuthController}. Created here to keep the route helper
 * cohesive.
 *
 * Auth:
 *   - The global `RolesGuard` (registered as `APP_GUARD` in
 *     app.module.ts) does the SUPER_ADMIN check via `@Roles`.
 *   - The actual JWT verification is done by the Nest JWT guard
 *     upstream — controller methods read `req.user` via the same
 *     `TenantContextMiddleware` every other controller uses.
 *
 * Audit:
 *   - The service writes its own AuditLog rows tagged
 *     IMPERSONATION_START / STOP / EXPIRE — see the service for
 *     the metadata envelope. We do NOT rely on AuditMiddleware for
 *     this flow because the JWT itself is the artefact being
 *     created, not a downstream mutation.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/rbac/roles.decorator';
import {
  ImpersonationStartRequestSchema,
  ImpersonationTokenResponseSchema,
  ImpersonationMeResponseSchema,
  ImpersonationSessionSchema,
  type ImpersonationStartRequest,
  type ImpersonationTokenResponse,
  type ImpersonationSession,
  type ImpersonationMeResponse,
  type ImpersonationJwtClaims,
} from '@omyxia/shared-types';
import { BadRequestException } from '@nestjs/common';
import { ImpersonationAdminService } from './impersonation-admin.service';

/**
 * Loose JWT-claim extractor for an impersonation token on the
 * request. The standard TenantContextMiddleware only fills
 * `{ tenantId, userId, role }`, so we have to re-decode the token
 * here for the `me` endpoint. We deliberately DON'T rely on the
 * middleware / JwtService because:
 *   - The session-id claim is non-standard.
 *   - The middleware isn't aware of the impersonation contract;
 *     letting it strip claims would be brittle.
 */
function extractImpersonationClaims(req: Request): ImpersonationJwtClaims | null {
  // Pull the verified JWT payload off `req.user` — NestJS places
  // it there once the auth pipeline (passport-jwt OR the same
  // TenantContextMiddleware path) has verified the signature.
  // The shape is `{ sub, activeTenantId, role, ...rest }`. We
  // type the field as `any` because Nest doesn't have a global
  // User type — the auth pipeline mutates it freely.
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

@Controller('admin/impersonate')
@Roles('SUPER_ADMIN')
export class ImpersonationAdminController {
  constructor(private readonly service: ImpersonationAdminService) {}

  /**
   * POST /api/admin/impersonate/:tenantId
   *
   * Body: { reasonCode: 'SUPPORT'|'AUDIT'|'DEBUG'|'MIGRATION'|'OTHER',
   *         reason: string (3-500 chars) }
   *
   * Response (200): {@link ImpersonationTokenResponse}
   */
  @Post(':tenantId')
  async start(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<ImpersonationTokenResponse> {
    const parsed = ImpersonationStartRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'Invalid impersonation request: ' +
          parsed.error.errors.map((e) => e.message).join('; '),
      );
    }
    const input: ImpersonationStartRequest = parsed.data;
    const result = await this.service.start(tenantId, input);
    return result;
  }

  /**
   * DELETE /api/admin/impersonate/:sessionId
   *
   * Body: none. Idempotent.
   * Response (200): { sessionId, endedAt }
   */
  @Delete(':sessionId')
  @HttpCode(200)
  async stop(@Param('sessionId') sessionId: string) {
    return this.service.stop(sessionId);
  }

  /**
   * GET /api/admin/impersonate/:sessionId
   *
   * Reads the canonical session record. The service constructs the
   * wire shape from the DB row + the claims.
   */
  @Get(':sessionId')
  async read(@Param('sessionId') sessionId: string): Promise<ImpersonationSession | null> {
    const session = await this.service.readSession(sessionId);
    return session
      ? ImpersonationSessionSchema.parse(session)
      : null;
  }

  /**
   * GET /api/auth/impersonate/me
   *
   * Tenant-UI banner endpoint. Reads the impersonation claims off
   * the request JWT and returns the canonical session or null.
   *
   * The route lives under `/api/auth` because the UI calls this as
   * a "who am I?" probe — semantically auth, not admin. We expose
   * it as a separate controller method mounted on the Auth module
   * route, see `impersonation-auth.controller.ts`.
   *
   * For convenience we ALSO expose the same probe under
   * `/api/admin/impersonate/me` so an admin-console that ships its
   * own session UI can use either URL.
   */
  @Get('me')
  async meAsAdmin(@Req() req: Request): Promise<ImpersonationMeResponse> {
    const claims = extractImpersonationClaims(req);
    if (!claims) {
      return ImpersonationMeResponseSchema.parse({ session: null });
    }
    const out = await this.service.meFromClaims(claims);
    // Normalise through the wire schema so the FE never sees
    // extra server-only fields.
    return ImpersonationMeResponseSchema.parse({
      session: out.session ? ImpersonationSessionSchema.parse(out.session) : null,
    });
  }
}
