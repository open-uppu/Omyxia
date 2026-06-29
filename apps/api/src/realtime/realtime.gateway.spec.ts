import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';
import type { AuthenticatedSocketData } from './realtime.types';

/**
 * RealtimeGateway is the WebSocket handshake gate. These tests pin down the
 * contract:
 *  - No token / bad token / missing claims -> emit auth:failed + disconnect
 *  - Good token -> join user + tenant rooms, mark online, broadcast presence,
 *    auto-join channels the user is a member of, emit auth:success +
 *    connection:established
 *  - Disconnect of an authenticated socket -> mark offline + broadcast
 *  - presence:heartbeat refreshes PresenceService.heartbeat
 */

function makeServer() {
  return {
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  } as unknown as Server;
}

function makeSocket(overrides: Partial<{
  handshakeAuth: Record<string, unknown>;
  handshakeQuery: Record<string, unknown>;
  data: Record<string, unknown> | null;
}> = {}) {
  const socket = {
    id: 'sock-1',
    handshake: {
      auth: overrides.handshakeAuth ?? {},
      query: overrides.handshakeQuery ?? {},
    },
    data: (overrides.data ?? {}) as Record<string, unknown>,
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    nsp: {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    },
  } as unknown as Socket;
  return socket;
}

function makeGateway(opts: {
  jwtVerifyImpl: (token: string) => unknown;
  memberships?: Array<{ channelId: string }>;
  presence?: {
    userOnline?: ReturnType<typeof vi.fn>;
    userOffline?: ReturnType<typeof vi.fn>;
    heartbeat?: ReturnType<typeof vi.fn>;
  };
}) {
  const jwt = {
    verify: vi.fn(opts.jwtVerifyImpl),
  };
  const prisma = {
    chatChannelMember: {
      findMany: vi.fn().mockResolvedValue(opts.memberships ?? []),
      findUnique: vi.fn(),
    },
  };
  const presence = {
    userOnline: opts.presence?.userOnline ?? vi.fn().mockResolvedValue(undefined),
    userOffline: opts.presence?.userOffline ?? vi.fn().mockResolvedValue(undefined),
    heartbeat: opts.presence?.heartbeat ?? vi.fn().mockResolvedValue(undefined),
  };
  const gateway = new RealtimeGateway(
    jwt as any,
    prisma as any,
    presence as any,
  );
  gateway.afterInit({ path: () => '/realtime' } as unknown as Server);
  (gateway as any).server = makeServer();
  return { gateway, jwt, prisma, presence };
}

describe('RealtimeGateway.handleConnection', () => {
  beforeEach(() => {
    // Each gateway gets its own server mock via makeGateway; no shared fixture needed.
  });

  it('rejects a socket with no token (auth:failed + disconnect)', async () => {
    const { gateway } = makeGateway({ jwtVerifyImpl: () => ({ sub: 'u1' }) });
    const socket = makeSocket();

    await gateway.handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'auth:failed',
      expect.objectContaining({ code: 'NO_TOKEN' }),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a token that fails verification', async () => {
    const { gateway } = makeGateway({ jwtVerifyImpl: () => { throw new UnauthorizedException(); } });
    const socket = makeSocket({ handshakeAuth: { token: 'bad' } });

    await gateway.handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'auth:failed',
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a token whose payload is missing required claims', async () => {
    const { gateway } = makeGateway({ jwtVerifyImpl: () => ({ sub: 'u1' }) });
    const socket = makeSocket({ handshakeAuth: { token: 'incomplete' } });

    await gateway.handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'auth:failed',
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('accepts a token from auth, joins user + tenant rooms, marks online, auto-joins channels, emits success', async () => {
    const userOnline = vi.fn().mockResolvedValue(undefined);
    const { gateway, prisma } = makeGateway({
      jwtVerifyImpl: () => ({
        sub: 'user-1',
        activeTenantId: 'tenant-1',
        role: 'OWNER',
      }),
      memberships: [{ channelId: 'chan-a' }, { channelId: 'chan-b' }],
      presence: { userOnline },
    });
    const socket = makeSocket({ handshakeAuth: { token: 'good' } });

    await gateway.handleConnection(socket);

    // Socket joined user + tenant + every channel the user is in.
    expect(socket.join).toHaveBeenCalledWith(['user:user-1', 'tenant:tenant-1']);
    expect(socket.join).toHaveBeenCalledWith(['channel:chan-a', 'channel:chan-b']);
    expect(prisma.chatChannelMember.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1' },
      select: { channelId: true },
    });

    // Presence marked online and broadcast to tenant room (via gateway.server).
    expect(userOnline).toHaveBeenCalledWith('user-1', 'tenant-1');
    const gatewayServer = (gateway as any).server;
    expect(gatewayServer.to).toHaveBeenCalledWith('tenant:tenant-1');
    expect(gatewayServer.emit).toHaveBeenCalledWith(
      'presence:online',
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1' }),
    );

    // Per-socket success events.
    expect(socket.emit).toHaveBeenCalledWith(
      'auth:success',
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'OWNER',
        rooms: expect.arrayContaining(['user:user-1', 'tenant:tenant-1', 'channel:chan-a', 'channel:chan-b']),
      }),
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'connection:established',
      expect.objectContaining({ socketId: 'sock-1' }),
    );

    // Socket data bag populated for downstream handlers.
    const data = socket.data as AuthenticatedSocketData;
    expect(data.userId).toBe('user-1');
    expect(data.tenantId).toBe('tenant-1');
    expect(data.channels).toEqual(['chan-a', 'chan-b']);
  });

  it('falls back to query.token when auth.token is absent', async () => {
    const { gateway, jwt } = makeGateway({
      jwtVerifyImpl: () => ({ sub: 'user-2', activeTenantId: 'tenant-2', role: 'MEMBER' }),
    });
    const socket = makeSocket({ handshakeQuery: { token: 'from-query' } });

    await gateway.handleConnection(socket);

    expect(jwt.verify).toHaveBeenCalledWith('from-query');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('keeps the socket online even if channel auto-join query fails', async () => {
    const userOnline = vi.fn().mockResolvedValue(undefined);
    const { gateway, prisma } = makeGateway({
      jwtVerifyImpl: () => ({ sub: 'user-3', activeTenantId: 'tenant-3', role: 'MEMBER' }),
      presence: { userOnline },
    });
    prisma.chatChannelMember.findMany.mockRejectedValue(new Error('db down'));
    const socket = makeSocket({ handshakeAuth: { token: 'good' } });

    await gateway.handleConnection(socket);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(userOnline).toHaveBeenCalled();
    const gatewayServer = (gateway as any).server;
    expect(gatewayServer.emit).toHaveBeenCalledWith(
      'presence:online',
      expect.objectContaining({ userId: 'user-3' }),
    );
  });
});

describe('RealtimeGateway.handleDisconnect', () => {
  it('marks offline and broadcasts presence:offline for authenticated sockets', async () => {
    const userOffline = vi.fn().mockResolvedValue(undefined);
    const { gateway } = makeGateway({
      jwtVerifyImpl: () => ({ sub: 'u', activeTenantId: 't', role: 'MEMBER' }),
      presence: { userOffline },
    });
    const server = makeServer();
    (gateway as any).server = server;

    const socket = makeSocket({
      data: { userId: 'u', tenantId: 't', role: 'MEMBER', rooms: [], channels: [] },
    });

    await gateway.handleDisconnect(socket);

    expect(userOffline).toHaveBeenCalledWith('u', 't');
    expect(server.to).toHaveBeenCalledWith('tenant:t');
    expect(server.emit).toHaveBeenCalledWith(
      'presence:offline',
      expect.objectContaining({ userId: 'u', tenantId: 't' }),
    );
  });

  it('no-ops for sockets that never authenticated', async () => {
    const userOffline = vi.fn().mockResolvedValue(undefined);
    const { gateway } = makeGateway({
      jwtVerifyImpl: () => ({}),
      presence: { userOffline },
    });
    (gateway as any).server = makeServer();
    const socket = makeSocket({ data: {} });

    await gateway.handleDisconnect(socket);

    expect(userOffline).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway presence:heartbeat', () => {
  it('refreshes presence for an authenticated socket and returns ok=true', async () => {
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const { gateway } = makeGateway({
      jwtVerifyImpl: () => ({}),
      presence: { heartbeat },
    });
    const socket = makeSocket({
      data: { userId: 'u-9', tenantId: 't-9', role: 'MEMBER', rooms: [], channels: [] },
    });

    const result = await gateway.onPresenceHeartbeat(socket);

    expect(heartbeat).toHaveBeenCalledWith('u-9', 't-9');
    expect(result).toEqual({ ok: true });
  });

  it('returns ok=false for an unauthenticated socket', async () => {
    const heartbeat = vi.fn();
    const { gateway } = makeGateway({
      jwtVerifyImpl: () => ({}),
      presence: { heartbeat },
    });
    const socket = makeSocket({ data: {} });

    const result = await gateway.onPresenceHeartbeat(socket);

    expect(heartbeat).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
  });
});

describe('RealtimeGateway whoami', () => {
  it('returns the socket identity for an authenticated socket', async () => {
    const { gateway } = makeGateway({
      jwtVerifyImpl: () => ({}),
    });
    const socket = makeSocket({
      data: {
        userId: 'u-x',
        tenantId: 't-x',
        role: 'OWNER',
        rooms: ['user:u-x', 'tenant:t-x'],
        channels: ['chan-1'],
      },
    });

    const result = gateway.onWhoAmI(socket, undefined);

    expect(result).toEqual({
      userId: 'u-x',
      tenantId: 't-x',
      role: 'OWNER',
      socketId: 'sock-1',
      rooms: ['user:u-x', 'tenant:t-x'],
      channels: ['chan-1'],
    });
  });

  it('returns nulls for an unauthenticated socket', async () => {
    const { gateway } = makeGateway({
      jwtVerifyImpl: () => ({}),
    });
    const socket = makeSocket({ data: {} });

    const result = gateway.onWhoAmI(socket, undefined);

    expect(result).toEqual({
      userId: null,
      tenantId: null,
      role: null,
      socketId: 'sock-1',
      rooms: [],
      channels: [],
    });
  });
});