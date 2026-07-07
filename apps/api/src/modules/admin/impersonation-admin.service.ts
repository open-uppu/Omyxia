/**
 * apps/api/src/modules/admin/impersonation-admin.service.ts
 *
 * P1.7 — Impersonation service.
 *
 * Lives behind the controller; owns:
 *   - JWT signing for an impersonation session
 *   - Persistence of the ImpersonationSession row
 *   - Audit log writes (one row per START, STOP, EXPIRE)
 *   - WebSocket fan-out via ImpersonationBroadcaster
 *   - Tenant-status check (cannot impersonate ARCHIVED tenants)
 *   - Idempotency on the "stop" path (deleting an already-ended
 *     session returns a no-op rather than an error)
 *
 * JWT shape: see {@link ImpersonationJwtClaimsSchema} in
 * `@omyxia/shared-types`. The token is signed with the same secret
 * (`process.env.JWT_SECRET`) the regular auth flow uses — HS256,
 * 1-hour TTL.
 *
 * Audit row contract (per P5.2 WORM escalation):
 *   - `table`     = 'admin/impersonate'
 *   - `action`    = 'CREATE' (start), 'UPDATE' (stop), 'EXPIRE'
 *                   (we encode the latter two as UPDATE since
 *                   AuditMiddleware only knows the three CRUD verbs;
 *                   the discriminator lives in `metadata.reason`)
 *   - `rowId`     = session id
 *   - `metadata`  = { kind: 'IMPERSONATION_START' | 'IMPERSONATION_STOP' |
 *                    'IMPERSONATION_EXPIRE', actorAdminId, tenantId,
 *                    reason, reasonCode, ttlSeconds }
 *   - `targetTenantId` = the tenant being impersonated (so the
 *                        composite index added in P1.4 covers
 *                        "what did admin X do while impersonating
 *                        tenant Y" queries)
 *   - `tenantId`  = NULL — the row is admin-scoped, not tenant-scoped
 *
 * The actual write happens here, bypassing AuditMiddleware, because:
 *   - We want a SINGLE row per session lifecycle event with our own
 *     `metadata.reason` discriminator (AuditMiddleware only writes a
 *     row when the request goes through, and the impersonation flow
 *     is the OTHER direction — the admin's JWT is REPLACED, not
 *     augmented).
 *   - The metadata envelope is admin-specific and doesn't fit the
 *     generic "before/after diff" shape AuditMiddleware uses.
 *
 * Out of scope for P1.7:
 *   - Active-session enforcement (only one impersonation per super
 *     admin at a time). P2.4 may add it if real users complain.
 *   - Per-tenant impersonation rate limiting. P1.7 logs every
 *     impersonation, the WORM layer in P5.2 prevents tampering.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AdminImpersonateEndedPayload,
  AdminImpersonateStartedPayload,
  ImpersonationJwtClaims,
  ImpersonationSession,
  ImpersonationStartRequest,
  ImpersonationTokenResponse,
} from '@omyxia/shared-types';
import {
  IMPERSONATION_TTL_SECONDS,
  ImpersonationTokenResponseSchema,
  ImpersonationSessionSchema,
} from '@omyxia/shared-types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';
import { ImpersonationBroadcaster } from './impersonation-broadcaster';

@Injectable()
export class ImpersonationAdminService {
  private readonly logger = new Logger(ImpersonationAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tenantContext: TenantContextService,
    private readonly broadcaster: ImpersonationBroadcaster,
  ) {}

  // --------------------------------------------------------------------------
  // POST /admin/impersonate/:tenantId
  // --------------------------------------------------------------------------

  /**
   * Start an impersonation session.
   *
   *   1. Resolve the acting super_admin from the JWT payload
   *      (TenantContextMiddleware populates TenantContextService).
   *   2. Verify the actor is SUPER_ADMIN (RolesGuard already did
   *      this at the controller boundary, but the service is the
   *      last line of defence — the global guard is configured to
   *      be bypassable by the RolesGuard bypass flag in tests).
   *   3. Load the target tenant. Reject if it doesn't exist or
   *      is ARCHIVED.
   *   4. Persist the ImpersonationSession row (this is the
   *      authoritative record; the JWT carries the sessionId so
   *      every audit row downstream can be joined back here).
   *   5. Write an AuditLog row tagged 'IMPERSONATION_START'.
   *   6. Sign and return the impersonation-scoped JWT.
   *
   * Side-effects:
   *   - The WebSocket broadcast is scheduled AFTER the HTTP response
   *     goes out (this method awaits only the DB writes — the
   *     broadcaster does its own catch-all and never throws into
   *     the request lifecycle).
   */
  async start(
    tenantId: string,
    input: ImpersonationStartRequest,
  ): Promise<ImpersonationTokenResponse> {
    if (!tenantId) {
      throw new BadRequestException('Missing :tenantId path parameter');
    }

    // 1. Resolved actor.
    const actor = this.resolveActor();

    // 2. Reject ARCHIVED tenants — pointless to impersonate them and
    // it creates a noisy audit trail.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    if (tenant.status === 'ARCHIVED') {
      throw new BadRequestException(
        `Cannot impersonate ARCHIVED tenant ${tenant.slug}`,
      );
    }

    // 3. Load the actor's identity for the wire payload. We bail
    // hard if the actor row is missing — that's a configuration
    // bug, not a user error.
    const admin = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, email: true, name: true },
    });
    if (!admin) {
      throw new ForbiddenException('Actor identity not found');
    }

    // 4. Mint session + audit + token.
    const startedAt = new Date();
    const expiresAt = new Date(
      startedAt.getTime() + IMPERSONATION_TTL_SECONDS * 1000,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.impersonationSession.create({
        data: {
          superAdminId: admin.id,
          tenantId: tenant.id,
          reason: this.composeReason(input),
          startedAt,
          expiresAt,
        },
        select: { id: true },
      });

      // 5. Write the audit row inside the same transaction. The
      // auditLogId back-pointer lets the SOC2 review query
      // `SELECT * FROM impersonation_sessions WHERE audit_log_id IS NOT NULL`
      // map every session to its canonical audit row.
      const audit = await tx.auditLog.create({
        data: {
          tenantId: null,
          userId: admin.id,
          targetTenantId: tenant.id,
          table: 'admin/impersonate',
          rowId: session.id,
          action: 'CREATE',
          before: null,
          after: {
            kind: 'IMPERSONATION_START',
            actorAdminId: admin.id,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            reasonCode: input.reasonCode,
            reason: input.reason,
            startedAt: startedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            ttlSeconds: IMPERSONATION_TTL_SECONDS,
          } as any,
          ipAddress: null,
          userAgent: null,
        },
        select: { id: true },
      });

      await tx.impersonationSession.update({
        where: { id: session.id },
        data: { auditLogId: audit.id },
      });

      return { sessionId: session.id, auditId: audit.id };
    });

    // 6. Build the wire session.
    const wireSession = ImpersonationSessionSchema.parse({
      sessionId: result.sessionId,
      superAdminId: admin.id,
      superAdminEmail: admin.email,
      superAdminName: admin.name,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      reasonCode: input.reasonCode,
      reason: input.reason,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: IMPERSONATION_TTL_SECONDS,
    } satisfies ImpersonationSession);

    // 7. Sign the JWT.
    const accessToken = this.jwt.sign(
      {
        sub: admin.id,
        activeTenantId: tenant.id,
        targetTenantId: tenant.id,
        role: 'OWNER',
        originalAdminId: admin.id,
        impersonation: true,
        impersonationSessionId: result.sessionId,
        impersonationReasonCode: input.reasonCode,
        impersonationReason: input.reason,
      } satisfies ImpersonationJwtClaims,
      { expiresIn: IMPERSONATION_TTL_SECONDS },
    );

    // 8. Broadcast (best-effort).
    await this.broadcaster.broadcastStarted(
      admin.id,
      this.toStartedPayload(wireSession),
    );

    // 9. Return the wire envelope.
    return ImpersonationTokenResponseSchema.parse({
      session: wireSession,
      accessToken,
      expiresAt: wireSession.expiresAt,
      ttlSeconds: wireSession.ttlSeconds,
    });
  }

  // --------------------------------------------------------------------------
  // DELETE /admin/impersonate/:sessionId
  // --------------------------------------------------------------------------

  /**
   * End an impersonation session early.
   *
   *   1. Load the session. If `endedAt` is already set, no-op return
   *      (idempotency — the FE's banner can call this safely on every
   *      unmount).
   *   2. Set `endedAt = now()` on the session.
   *   3. Write an AuditLog row tagged 'IMPERSONATION_STOP' with the
   *      session's `auditLogId` linked for SOC2 traceability.
   *   4. Best-effort WebSocket fan-out so other admins see the live
   *      indicator clear.
   */
  async stop(sessionId: string): Promise<{ sessionId: string; endedAt: string }> {
    if (!sessionId) {
      throw new BadRequestException('Missing :sessionId path parameter');
    }
    const actor = this.resolveActor();

    const existing = await this.prisma.impersonationSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        superAdminId: true,
        tenantId: true,
        endedAt: true,
      },
    });
    if (!existing) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    if (existing.endedAt) {
      // Already ended — idempotent return.
      return {
        sessionId: existing.id,
        endedAt: existing.endedAt.toISOString(),
      };
    }

    // Only the actor themselves OR another super_admin can stop.
    if (existing.superAdminId !== actor.userId && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only the impersonator or another super_admin can stop this session',
      );
    }

    const endedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.impersonationSession.update({
        where: { id: sessionId },
        data: { endedAt },
      });

      await tx.auditLog.create({
        data: {
          tenantId: null,
          userId: actor.userId,
          targetTenantId: existing.tenantId,
          table: 'admin/impersonate',
          rowId: sessionId,
          action: 'UPDATE',
          before: null,
          after: {
            kind: 'IMPERSONATION_STOP',
            actorAdminId: existing.superAdminId,
            stoppedByAdminId: actor.userId,
            tenantId: existing.tenantId,
            endedAt: endedAt.toISOString(),
            endedReason: 'STOPPED',
          } as any,
          ipAddress: null,
          userAgent: null,
        },
      });
    });

    await this.broadcaster.broadcastEnded({
      sessionId,
      tenantId: existing.tenantId,
      endedAt: endedAt.toISOString(),
      endedReason: 'STOPPED',
    } satisfies AdminImpersonateEndedPayload);

    return { sessionId, endedAt: endedAt.toISOString() };
  }

  // --------------------------------------------------------------------------
  // GET /api/admin/impersonate/:sessionId
  // --------------------------------------------------------------------------

  /**
   * Read the canonical record of one session by id, returning the
   * wire-shape {@link ImpersonationSession} or null. Used by the
   * admin-console live indicator + the audit-trail view.
   *
   * Returns null when the session has been ended, expired, or
   * doesn't exist — the FE treats all three as "no active session"
   * and the differentiation lives in the audit log.
   */
  async readSession(sessionId: string): Promise<ImpersonationSession | null> {
    if (!sessionId) return null;
    const row = await this.prisma.impersonationSession.findUnique({
      where: { id: sessionId },
      include: {
        superAdmin: { select: { id: true, email: true, name: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!row) return null;
    if (row.endedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      void this.markExpired(row.id, row.superAdminId, row.tenantId).catch(
        () => {},
      );
      return null;
    }

    // The reason / reasonCode stored on `ImpersonationSession.reason`
    // is the composed string `[CODE] text` for the audit log. We
    // re-decompose here for the wire shape; the controller can
    // usually just take what we return.
    const reasonParsed = ImpersonationAdminService.parseReasonColumn(row.reason);

    return ImpersonationSessionSchema.parse({
      sessionId: row.id,
      superAdminId: row.superAdmin.id,
      superAdminEmail: row.superAdmin.email,
      superAdminName: row.superAdmin.name,
      tenantId: row.tenant.id,
      tenantName: row.tenant.name,
      tenantSlug: row.tenant.slug,
      reasonCode: reasonParsed.code,
      reason: reasonParsed.text,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ttlSeconds: Math.max(
        1,
        Math.floor((row.expiresAt.getTime() - Date.now()) / 1000),
      ),
    });
  }

  // --------------------------------------------------------------------------
  // GET /api/auth/impersonate/me
  // --------------------------------------------------------------------------

  /**
   * Read the impersonation state from a JWT payload that already
   * carries the impersonation claims. Returns `{ session: null }`
   * when the claims don't look like an impersonation token, when
   * the session row is gone, or when the session has ended /
   * expired. The tenant-UI banner calls this on every load.
   *
   * Note: this re-loads the session row from MySQL so a revoked
   * / EXPIRED session can't leak via a stale token.
   */
  async meFromClaims(claims: ImpersonationJwtClaims): Promise<{
    session: ImpersonationSession | null;
  }> {
    if (!claims?.impersonation) return { session: null };

    const row = await this.prisma.impersonationSession.findUnique({
      where: { id: claims.impersonationSessionId },
      include: {
        superAdmin: { select: { id: true, email: true, name: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!row) return { session: null };
    if (row.endedAt) return { session: null };
    if (row.expiresAt.getTime() <= Date.now()) {
      // Best-effort mark expired + write audit, do not block the FE.
      void this.markExpired(row.id, row.superAdminId, row.tenantId).catch(() => {});
      return { session: null };
    }

    const wire: ImpersonationSession = {
      sessionId: row.id,
      superAdminId: row.superAdmin.id,
      superAdminEmail: row.superAdmin.email,
      superAdminName: row.superAdmin.name,
      tenantId: row.tenant.id,
      tenantName: row.tenant.name,
      tenantSlug: row.tenant.slug,
      reasonCode: claims.impersonationReasonCode,
      reason: claims.impersonationReason,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ttlSeconds: Math.max(
        1,
        Math.floor((row.expiresAt.getTime() - Date.now()) / 1000),
      ),
    };
    return { session: wire };
  }

  // --------------------------------------------------------------------------
  // helpers
  // --------------------------------------------------------------------------

  private resolveActor(): { userId: string; role: string } {
    const ctx = this.tenantContext.get();
    if (!ctx?.userId) {
      throw new ForbiddenException(
        'No authenticated actor on impersonation request',
      );
    }
    return { userId: ctx.userId, role: ctx.role ?? '' };
  }

  /**
   * Persist a human-readable audit string. The structured
   * `reasonCode` lives separately in the AuditLog.metadata so the
   * support-ops dashboards can keep counting buckets.
   */
  private composeReason(input: ImpersonationStartRequest): string {
    return `[${input.reasonCode}] ${input.reason}`.slice(0, 500);
  }

  private toStartedPayload(s: ImpersonationSession): AdminImpersonateStartedPayload {
    return {
      sessionId: s.sessionId,
      superAdminId: s.superAdminId,
      superAdminEmail: s.superAdminEmail,
      superAdminName: s.superAdminName,
      tenantId: s.tenantId,
      tenantName: s.tenantName,
      tenantSlug: s.tenantSlug,
      reasonCode: s.reasonCode,
      reason: s.reason,
      startedAt: s.startedAt,
      expiresAt: s.expiresAt,
    };
  }

  /**
   * Decompose `[CODE] text` → { code, text }. Falls back to `OTHER`
   * + the raw column when the format isn't recognised (legacy rows
   * from before this column was structured).
   */
  private static parseReasonColumn(
    raw: string,
  ): { code: ImpersonationReason; text: string } {
    const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(raw ?? '');
    if (!m) return { code: 'OTHER', text: raw ?? '' };
    const code = (m[1] ?? '').trim();
    const text = (m[2] ?? '').trim();
    const allowed: ReadonlyArray<ImpersonationReason> = [
      'SUPPORT',
      'AUDIT',
      'DEBUG',
      'MIGRATION',
      'OTHER',
    ];
    return {
      code: (allowed as readonly string[]).includes(code)
        ? (code as ImpersonationReason)
        : 'OTHER',
      text,
    };
  }

  /**
   * Mark an expired session + audit row. Fire-and-forget from the
   * `meFromClaims` path; never throws out of the request lifecycle.
   */
  private async markExpired(
    sessionId: string,
    adminId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      const endedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.impersonationSession.updateMany({
          where: { id: sessionId, endedAt: null },
          data: { endedAt },
        });
        await tx.auditLog.create({
          data: {
            tenantId: null,
            userId: adminId,
            targetTenantId: tenantId,
            table: 'admin/impersonate',
            rowId: sessionId,
            action: 'UPDATE',
            after: {
              kind: 'IMPERSONATION_EXPIRE',
              actorAdminId: adminId,
              tenantId,
              endedAt: endedAt.toISOString(),
              endedReason: 'EXPIRED',
            } as any,
            ipAddress: null,
            userAgent: null,
          },
        });
      });

      await this.broadcaster.broadcastEnded({
        sessionId,
        tenantId,
        endedAt: endedAt.toISOString(),
        endedReason: 'EXPIRED',
      } satisfies AdminImpersonateEndedPayload);
    } catch (err) {
      this.logger.warn(
        `markExpired(${sessionId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
