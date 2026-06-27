import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listChannels() {
    return this.prisma.chatChannel.findMany({
      where: { tenantId: this.getTenantId(), isArchived: false },
    });
  }

  async createChannel(data: { name: string; description?: string; type?: string }) {
    return this.prisma.chatChannel.create({
      data: {
        tenantId: this.getTenantId(),
        name: data.name,
        description: data.description,
        type: (data.type as any) || 'PUBLIC',
        members: {
          create: {
            tenantId: this.getTenantId(),
            userId: this.tenantContext.getUserId()!,
            role: 'OWNER',
          },
        },
      },
    });
  }

  async listMessages(channelId: string, limit = 50) {
    return this.prisma.chatMessage.findMany({
      where: { tenantId: this.getTenantId(), channelId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async sendMessage(channelId: string, content: string) {
    return this.prisma.chatMessage.create({
      data: {
        tenantId: this.getTenantId(),
        channelId,
        senderId: this.tenantContext.getUserId()!,
        content,
      },
    });
  }
}