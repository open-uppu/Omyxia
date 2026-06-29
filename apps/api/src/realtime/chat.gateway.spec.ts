import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { ChatGateway } from './chat.gateway';
import type { AuthenticatedSocketData } from './realtime.types';

/**
 * ChatGateway is the realtime write path for chat:message. Tests pin down:
 *  - Auth gate: unauthenticated sockets get { error: 'UNAUTHENTICATED' }
 *  - Validation: invalid channel / empty / oversized content rejected
 *  - Membership: non-members are rejected even if the channel exists
 *  - Happy path: persists via ChatService.sendMessage, runs inside
 *    TenantContextService.run, broadcasts chat:message:new + chat:message
 *    to the channel room.
 */

function makeSocket(opts: {
  userId?: string;
  tenantId?: string;
  role?: string;
} = {}) {
  const data: Partial<AuthenticatedSocketData> = opts.userId && opts.tenantId
    ? {
        userId: opts.userId,
        tenantId: opts.tenantId,
        role: opts.role ?? 'MEMBER',
        rooms: [`user:${opts.userId}`, `tenant:${opts.tenantId}`],
        channels: [],
      }
    : {};
  const nspTo = vi.fn().mockReturnThis();
  const socket = {
    id: 'sock-1',
    handshake: { auth: {}, query: {} },
    data: data as Record<string, unknown>,
    emit: vi.fn(),
    disconnect: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    nsp: { to: nspTo, emit: vi.fn() },
  } as unknown as Socket;
  return { socket, nspTo };
}

function makeGateway(opts: {
  membership?: { tenantId: string } | null;
  persisted?: unknown;
  chatSend?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    chatChannelMember: {
      findUnique: vi.fn().mockResolvedValue(opts.membership ?? null),
    },
  };
  const tenantContext = {
    run: vi.fn(async (_ctx: unknown, cb: () => unknown) => cb()),
  };
  const chatService = {
    sendMessage: opts.chatSend ?? vi.fn().mockImplementation(async (_channelId: string, content: string) => {
      // Default to reflecting the trimmed content the gateway passed in.
      const base = {
        id: 'msg-1',
        tenantId: 'tenant-1',
        channelId: 'chan-1',
        senderId: 'user-1',
        content,
        createdAt: new Date('2026-06-29T10:00:00Z'),
      };
      return opts.persisted ? { ...base, ...(opts.persisted as object) } : base;
    }),
  };
  const gateway = new ChatGateway(prisma as any, chatService as any, tenantContext as any);
  return { gateway, prisma, tenantContext, chatService };
}

describe('ChatGateway.onChatMessage', () => {
  it('rejects an unauthenticated socket', async () => {
    const { gateway } = makeGateway({});
    const { socket } = makeSocket();

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: 'hello',
    });

    expect(result).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('rejects an empty channelId', async () => {
    const { gateway } = makeGateway({ membership: { tenantId: 'tenant-1' } });
    const { socket } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: '',
      content: 'hello',
    });

    expect(result).toEqual({ error: 'INVALID_CHANNEL_ID' });
  });

  it('rejects empty content', async () => {
    const { gateway } = makeGateway({ membership: { tenantId: 'tenant-1' } });
    const { socket } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: '   ',
    });

    expect(result).toEqual({ error: 'EMPTY_CONTENT' });
  });

  it('rejects oversized content (>4000 chars)', async () => {
    const { gateway } = makeGateway({ membership: { tenantId: 'tenant-1' } });
    const { socket } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: 'x'.repeat(4001),
    });

    expect(result).toEqual({ error: 'CONTENT_TOO_LONG' });
  });

  it('rejects non-members even if the channel exists', async () => {
    const { gateway } = makeGateway({ membership: null });
    const { socket } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: 'hello',
    });

    expect(result).toEqual({ error: 'NOT_A_MEMBER' });
  });

  it('rejects a member of the channel but under a different tenant (cross-tenant guard)', async () => {
    const { gateway } = makeGateway({ membership: { tenantId: 'tenant-other' } });
    const { socket } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: 'hello',
    });

    expect(result).toEqual({ error: 'NOT_A_MEMBER' });
  });

  it('persists + broadcasts the message on the happy path', async () => {
    const { gateway, prisma, tenantContext, chatService } = makeGateway({
      membership: { tenantId: 'tenant-1' },
    });
    const { socket, nspTo } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: '  hello world  ',
    });

    // Membership check.
    expect(prisma.chatChannelMember.findUnique).toHaveBeenCalledWith({
      where: { channelId_userId: { channelId: 'chan-1', userId: 'user-1' } },
      select: { tenantId: true },
    });

    // TenantContext wraps the service call.
    expect(tenantContext.run).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'MEMBER' },
      expect.any(Function),
    );

    // ChatService called with the trimmed content via the tenant context.
    const innerCb = (tenantContext.run as any).mock.calls[0][1];
    chatService.sendMessage.mockClear();
    await innerCb();
    expect(chatService.sendMessage).toHaveBeenCalledWith('chan-1', 'hello world');

    // Broadcast to the channel room with both legacy + new event names.
    expect(nspTo).toHaveBeenCalledWith('channel:chan-1');
    const ns = socket.nsp as unknown as { emit: ReturnType<typeof vi.fn> };
    expect(ns.emit).toHaveBeenNthCalledWith(
      1,
      'chat:message:new',
      expect.objectContaining({
        id: 'msg-1',
        tenantId: 'tenant-1',
        channelId: 'chan-1',
        senderId: 'user-1',
        content: 'hello world',
        createdAt: '2026-06-29T10:00:00.000Z',
      }),
    );
    expect(ns.emit).toHaveBeenNthCalledWith(
      2,
      'chat:message',
      expect.objectContaining({ id: 'msg-1', content: 'hello world' }),
    );

    // Returned payload mirrors the broadcast.
    expect(result).toMatchObject({
      id: 'msg-1',
      tenantId: 'tenant-1',
      channelId: 'chan-1',
      senderId: 'user-1',
      content: 'hello world',
      createdAt: '2026-06-29T10:00:00.000Z',
    });
  });

  it('passes parentId through when provided', async () => {
    const { gateway } = makeGateway({
      membership: { tenantId: 'tenant-1' },
      persisted: {
        id: 'msg-2',
        tenantId: 'tenant-1',
        channelId: 'chan-1',
        senderId: 'user-1',
        content: 'reply',
        createdAt: new Date('2026-06-29T10:00:00Z'),
      },
    });
    const { socket } = makeSocket({ userId: 'user-1', tenantId: 'tenant-1' });

    const result = await gateway.onChatMessage(socket, {
      channelId: 'chan-1',
      content: 'reply',
      parentId: 'msg-1',
    });

    expect(result).toMatchObject({ id: 'msg-2', parentId: 'msg-1' });
  });
});