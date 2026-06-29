import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma/prisma.service';
import { PresenceService } from './presence.service';
import {
  ClientEventNames,
  RoomNames,
  ServerEventNames,
} from './events';
import type {
  AuthenticatedSocketData,
  RealtimeJwtPayload,
} from './realtime.types';

/**
 * Realtime gateway — single namespace, owns the WebSocket connection
 * lifecycle for every realtime surface (presence + chat passthrough).
 *
 * Connection contract:
 *   - Client connects to `/realtime` with `auth.token` (preferred) or
 *     `query.token` carrying a JWT signed by the API (HS256, secret =
 *     `JWT_SECRET`). Payload shape: `{ sub, activeTenantId, role }`.
 *   - Server verifies the token, joins `user:<id>` and `tenant:<id>` rooms,
 *     marks the user online via PresenceService (Redis), and auto-joins every
 *     chat channel the user is a member of.
 *   - Server emits `auth:success` (per-socket) and broadcasts `presence:online`
 *     to the tenant room.
 *   - On disconnect: server marks the user offline and broadcasts
 *     `presence:offline`.
 *
 * Phase C scope: presence + chat passthrough only. Typing, read receipts,
 * edit/delete, and per-channel ACL refinement are explicitly out of scope.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server) {
    this.logger.log(`Realtime gateway initialised on ${server.path() ?? '/realtime'}`);
  }

  /**
   * Extract a JWT from the handshake. Accepts `auth.token` (preferred,
   * matching socket.io conventions) and falls back to `query.token` for
   * clients that cannot set custom headers on the upgrade request.
   */
  private extractToken(client: Socket): string | undefined {
    const authToken = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

    const queryToken = (client.handshake.query as { token?: unknown } | undefined)?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();

    return undefined;
  }

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.emit(ServerEventNames.AUTH_FAILED, {
        code: 'NO_TOKEN',
        message: 'Missing auth token on handshake',
      });
      client.disconnect(true);
      return;
    }

    let payload: RealtimeJwtPayload;
    try {
      const verified = this.jwt.verify<RealtimeJwtPayload>(token);
      if (!verified?.sub || !verified?.activeTenantId || !verified?.role) {
        throw new Error('payload missing required claims');
      }
      payload = verified;
    } catch (err) {
      this.logger.debug(`Rejecting socket ${client.id}: ${(err as Error).message}`);
      client.emit(ServerEventNames.AUTH_FAILED, {
        code: 'INVALID_TOKEN',
        message: 'JWT verification failed',
      });
      client.disconnect(true);
      return;
    }

    const data: AuthenticatedSocketData = {
      userId: payload.sub,
      tenantId: payload.activeTenantId,
      role: payload.role,
      rooms: [],
      channels: [],
    };
    client.data = data;

    // Standard rooms: per-user notifications + per-tenant presence fan-out.
    const userRoom = RoomNames.user(data.userId);
    const tenantRoom = RoomNames.tenant(data.tenantId);
    await client.join([userRoom, tenantRoom]);
    data.rooms.push(userRoom, tenantRoom);

    // Auto-join chat channels the user is a member of (best-effort: if the
    // DB query fails we still keep presence online — chat will work after
    // the client refreshes channel memberships via REST).
    try {
      const memberships = await this.prisma.chatChannelMember.findMany({
        where: { tenantId: data.tenantId, userId: data.userId },
        select: { channelId: true },
      });
      const channelRooms = memberships.map((m) => RoomNames.channel(m.channelId));
      if (channelRooms.length > 0) {
        await client.join(channelRooms);
        data.channels = memberships.map((m) => m.channelId);
        data.rooms.push(...channelRooms);
      }
    } catch (err) {
      this.logger.warn(
        `Could not auto-join chat channels for user ${data.userId} in tenant ${data.tenantId}: ${(err as Error).message}`,
      );
    }

    // Mark user online in presence + broadcast to tenant.
    try {
      await this.presence.userOnline(data.userId, data.tenantId);
    } catch (err) {
      this.logger.warn(
        `Presence.userOnline failed for ${data.userId}: ${(err as Error).message}`,
      );
    }
    this.server.to(tenantRoom).emit(ServerEventNames.PRESENCE_ONLINE, {
      userId: data.userId,
      tenantId: data.tenantId,
      timestamp: new Date().toISOString(),
    });

    client.emit(ServerEventNames.AUTH_SUCCESS, {
      userId: data.userId,
      tenantId: data.tenantId,
      role: data.role,
      rooms: data.rooms,
    });
    client.emit(ServerEventNames.CONNECTION_ESTABLISHED, {
      socketId: client.id,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(
      `socket ${client.id} authed as user ${data.userId} in tenant ${data.tenantId} (channels=${data.channels.length})`,
    );
  }

  async handleDisconnect(client: Socket) {
    const data = client.data as Partial<AuthenticatedSocketData> | undefined;
    if (!data?.userId || !data?.tenantId) {
      return; // never authenticated — nothing to clean up
    }

    try {
      await this.presence.userOffline(data.userId, data.tenantId);
    } catch (err) {
      this.logger.warn(
        `Presence.userOffline failed for ${data.userId}: ${(err as Error).message}`,
      );
    }

    const tenantRoom = RoomNames.tenant(data.tenantId);
    this.server.to(tenantRoom).emit(ServerEventNames.PRESENCE_OFFLINE, {
      userId: data.userId,
      tenantId: data.tenantId,
      timestamp: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    this.logger.log(`socket ${client.id} disconnected (user ${data.userId})`);
  }

  /**
   * Heartbeat from the client to refresh the presence TTL in Redis. Cheap
   * server-side: no DB hit, just a Redis SREM/SADD round-trip.
   */
  @SubscribeMessage(ClientEventNames.PRESENCE_HEARTBEAT)
  async onPresenceHeartbeat(@ConnectedSocket() client: Socket) {
    const data = client.data as Partial<AuthenticatedSocketData> | undefined;
    if (!data?.userId || !data?.tenantId) return { ok: false, reason: 'UNAUTHENTICATED' };

    try {
      await this.presence.heartbeat(data.userId, data.tenantId);
    } catch (err) {
      this.logger.warn(
        `Presence.heartbeat failed for ${data.userId}: ${(err as Error).message}`,
      );
      return { ok: false, reason: 'PRESENCE_FAILED' };
    }
    return { ok: true };
  }

  /**
   * Debug helper — echoes the current socket identity. Useful for the smoke
   * test client to confirm the handshake worked.
   */
  @SubscribeMessage('whoami')
  onWhoAmI(@ConnectedSocket() client: Socket, @MessageBody() _payload: unknown) {
    const data = client.data as Partial<AuthenticatedSocketData> | undefined;
    return {
      userId: data?.userId ?? null,
      tenantId: data?.tenantId ?? null,
      role: data?.role ?? null,
      socketId: client.id,
      rooms: data?.rooms ?? [],
      channels: data?.channels ?? [],
    };
  }
}