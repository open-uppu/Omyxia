import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';
import { ChatService } from '../modules/workspace/chat.service';
import {
  ChatMessagePayload,
  ClientEventNames,
  RoomNames,
  ServerEventNames,
} from './events';
import type { AuthenticatedSocketData } from './realtime.types';

interface ChatMessageInput {
  channelId?: unknown;
  content?: unknown;
  parentId?: unknown;
}

const MAX_CONTENT_LENGTH = 4000;

/**
 * Chat gateway — handles the realtime half of the chat surface.
 *
 * Shares the `/realtime` namespace with RealtimeGateway so that one socket
 * per tab carries presence + chat. Membership is enforced here (defence in
 * depth — the REST controller also checks): a sender must be a member of
 * the target channel inside the active tenant.
 *
 * Phase C scope: send + broadcast new messages. Edit / delete / typing /
 * read receipts are explicitly out of scope.
 */
@WebSocketGateway({ namespace: '/realtime' })
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private requireAuth(socket: Socket): AuthenticatedSocketData {
    const data = socket.data as Partial<AuthenticatedSocketData> | undefined;
    if (!data?.userId || !data?.tenantId) {
      throw new Error('UNAUTHENTICATED');
    }
    return data as AuthenticatedSocketData;
  }

  /**
   * Persist + broadcast a new chat message.
   *
   * Payload: `{ channelId: string, content: string, parentId?: string }`.
   * Returns the persisted payload to the sender (so optimistic UI can be
   * reconciled) and broadcasts `chat:message:new` to the channel room.
   */
  @SubscribeMessage(ClientEventNames.CHAT_MESSAGE)
  async onChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: ChatMessageInput,
  ): Promise<ChatMessagePayload | { error: string }> {
    let auth: AuthenticatedSocketData;
    try {
      auth = this.requireAuth(client);
    } catch {
      return { error: 'UNAUTHENTICATED' };
    }

    const channelId = typeof raw?.channelId === 'string' ? raw.channelId.trim() : '';
    const content = typeof raw?.content === 'string' ? raw.content : '';
    const parentId =
      typeof raw?.parentId === 'string' && raw.parentId.trim()
        ? raw.parentId.trim()
        : undefined;

    if (!channelId) return { error: 'INVALID_CHANNEL_ID' };
    const trimmed = content.trim();
    if (!trimmed) return { error: 'EMPTY_CONTENT' };
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      return { error: 'CONTENT_TOO_LONG' };
    }

    // Defence-in-depth: ensure the sender is a member of the target channel
    // inside the active tenant. RealtimeGateway auto-joined the socket, but
    // membership can have been revoked after connect.
    const membership = await this.prisma.chatChannelMember.findUnique({
      where: {
        channelId_userId: { channelId, userId: auth.userId },
      },
      select: { tenantId: true },
    });
    if (!membership || membership.tenantId !== auth.tenantId) {
      return { error: 'NOT_A_MEMBER' };
    }

    // ChatService.sendMessage reads tenantId from TenantContextService's
    // AsyncLocalStorage. The HTTP middleware sets it on every request, but
    // WebSocket calls never go through that middleware — run the service
    // call inside an explicit tenant context so future additions (audit,
    // notifications) keep working.
    const persisted = await this.tenantContext.run(
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      () => this.chatService.sendMessage(channelId, trimmed),
    );

    const payload: ChatMessagePayload = {
      id: persisted.id,
      tenantId: persisted.tenantId,
      channelId: persisted.channelId,
      senderId: persisted.senderId,
      content: persisted.content,
      parentId: parentId ?? undefined,
      createdAt:
        persisted.createdAt instanceof Date
          ? persisted.createdAt.toISOString()
          : String(persisted.createdAt),
    };

    const channelRoom = RoomNames.channel(channelId);
    client.nsp.to(channelRoom).emit(ServerEventNames.CHAT_MESSAGE_NEW, payload);
    // Also emit on the legacy `chat:message` channel for back-compat with the
    // foundation's ClientEvents surface.
    client.nsp.to(channelRoom).emit(ServerEventNames.CHAT_MESSAGE, payload);

    this.logger.debug(
      `chat message ${payload.id} -> channel ${channelId} (tenant ${auth.tenantId})`,
    );
    return payload;
  }
}