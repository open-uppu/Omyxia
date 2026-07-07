/**
 * apps/api/src/modules/admin/impersonation-broadcaster.ts
 *
 * P1.7 — ImpersonationBroadcaster.
 *
 * Owns the WebSocket fan-out for the impersonation lifecycle:
 *
 *   POST /admin/impersonate/:tenantId → broadcastStarted()
 *     - For every super_admin user (other than the actor) emit
 *       `admin:impersonate:started` on their `user:<id>` room so the
 *       admin-console live indicator updates in real time.
 *
 *   DELETE /admin/impersonate/:sessionId → broadcastEnded()
 *     - Mirror emission: `admin:impersonate:ended` so the live
 *       indicator clears.
 *
 * Why a standalone service?
 *   - The Admin module already depends on JwtModule + Prisma; pulling
 *     in RealtimeModule creates a cycle (Realtime → Chat → Workspace,
 *     Admin → Realtime). The broadcaster injects the RealtimeGateway
 *     via forwardRef to break that cycle.
 *   - Putting the recipient-resolution + emit logic in one place keeps
 *     the controller thin.
 *
 * Out of scope:
 *   - Returning socket.emit errors to the caller — broadcast failures
 *     are logged and swallowed (the HTTP response has already been
 *     sent by the time we get here, and the impersonation must work
 *     even if the realtime gateway is degraded).
 */

import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Server } from 'socket.io';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ServerEventNames,
  RoomNames,
} from '../../realtime/events';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import type {
  AdminImpersonateStartedPayload,
  AdminImpersonateEndedPayload,
} from '@omyxia/shared-types';

@Injectable()
export class ImpersonationBroadcaster {
  private readonly logger = new Logger(ImpersonationBroadcaster.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Resolve every super_admin user id EXCEPT the actor, then fan-out
   * `admin:impersonate:started` on each of their `user:<id>` rooms.
   *
   * Super-admin identification:
   *   We look at UserTenant rows with `role = 'SUPER_ADMIN'`. SUPER_ADMIN
   *   is by definition a cross-tenant role (per `apps/api/src/modules/
   *   auth/rbac/roles.ts`) so any UserTenant row with that role is
   *   the admin's "parking" row (they have one anchor tenant, even
   *   though `RolesGuard` lets them act anywhere when present).
   */
  async broadcastStarted(
    actorAdminId: string,
    payload: AdminImpersonateStartedPayload,
  ): Promise<void> {
    const server = this.getServer();
    if (!server) {
      this.logger.warn('realtime server unavailable; skipping impersonation broadcast');
      return;
    }

    try {
      const recipients = await this.prisma.userTenant.findMany({
        where: {
          role: 'SUPER_ADMIN',
          userId: { not: actorAdminId },
        },
        distinct: ['userId'],
        select: { userId: true },
      });

      for (const r of recipients) {
        server.to(RoomNames.user(r.userId)).emit(
          ServerEventNames.ADMIN_IMPERSONATE_STARTED,
          payload,
        );
      }
      this.logger.log(
        `impersonation:start broadcast to ${recipients.length} super_admin recipients`,
      );
    } catch (err) {
      this.logger.warn(
        `impersonation:start broadcast failed: ${(err as Error).message}`,
      );
    }
  }

  /** Mirror of {@link broadcastStarted} for the end-of-session event. */
  async broadcastEnded(
    payload: AdminImpersonateEndedPayload,
  ): Promise<void> {
    const server = this.getServer();
    if (!server) {
      this.logger.warn('realtime server unavailable; skipping impersonation-end broadcast');
      return;
    }

    try {
      // Fan-out to ALL super_admins (including the actor — the actor
      // may have multiple browser tabs and we want every tab's live
      // indicator to clear). Best-effort: we iterate UserTenant rows
      // matching SUPER_ADMIN; this is N≤10 in practice.
      const recipients = await this.prisma.userTenant.findMany({
        where: { role: 'SUPER_ADMIN' },
        distinct: ['userId'],
        select: { userId: true },
      });
      for (const r of recipients) {
        server.to(RoomNames.user(r.userId)).emit(
          ServerEventNames.ADMIN_IMPERSONATE_ENDED,
          payload,
        );
      }
    } catch (err) {
      this.logger.warn(
        `impersonation:end broadcast failed: ${(err as Error).message}`,
      );
    }
  }

  private getServer(): Server | undefined {
    // The gateway exposes `server` as a public @WebSocketServer() field.
    return this.realtime?.server;
  }
}
