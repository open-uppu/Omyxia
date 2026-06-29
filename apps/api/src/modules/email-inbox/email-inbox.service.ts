import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';
import { MailService } from '../../mail/mail.service';
import { EmailMessage, Prisma } from '@prisma/client';

@Injectable()
export class EmailInboxService {
  private readonly logger = new Logger(EmailInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly mailService: MailService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async syncInbox(): Promise<{ synced: number; messages: EmailMessage[] }> {
    this.logger.log('Manual inbox sync triggered');
    const messages = await this.mailService.syncInbox();
    return { synced: messages.length, messages };
  }

  async getInbox(folder: string = 'INBOX', options: { take?: number; skip?: number; search?: string } = {}): Promise<EmailMessage[]> {
    const { take = 50, skip = 0, search } = options;
    const tenantId = this.getTenantId();

    const where: Prisma.EmailMessageWhereInput = {
      tenantId,
      folder: folder.toUpperCase(),
    };

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { from: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.emailMessage.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take,
      skip,
    });
  }

  async getMessage(id: string): Promise<EmailMessage | null> {
    return this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'INBOX' },
    });
  }

  async markAsRead(id: string): Promise<EmailMessage | null> {
    return this.mailService.markAsRead(id);
  }

  async markAsUnread(id: string): Promise<EmailMessage | null> {
    const message = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'INBOX' },
    });

    if (!message) return null;

    return this.prisma.emailMessage.update({
      where: { id },
      data: { isRead: false },
    });
  }

  async moveToFolder(id: string, folder: string): Promise<EmailMessage | null> {
    const message = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'INBOX' },
    });

    if (!message) return null;

    return this.prisma.emailMessage.update({
      where: { id },
      data: { folder: folder.toUpperCase() },
    });
  }

  async deleteMessage(id: string): Promise<EmailMessage | null> {
    const message = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'INBOX' },
    });

    if (!message) return null;

    return this.prisma.emailMessage.update({
      where: { id },
      data: { folder: 'TRASH' },
    });
  }

  async getUnreadCount(): Promise<number> {
    return this.mailService.getUnreadCount();
  }

  async getFolderCounts(): Promise<Record<string, number>> {
    const tenantId = this.getTenantId();
    const folders = ['INBOX', 'SENT', 'DRAFTS', 'TRASH', 'SPAM', 'ARCHIVE'];
    const counts: Record<string, number> = {};

    for (const folder of folders) {
      counts[folder] = await this.prisma.emailMessage.count({
        where: { tenantId, folder },
      });
    }

    return counts;
  }

  async searchMessages(query: string, options: { take?: number; skip?: number } = {}): Promise<EmailMessage[]> {
    const { take = 50, skip = 0 } = options;
    const tenantId = this.getTenantId();

    return this.prisma.emailMessage.findMany({
      where: {
        tenantId,
        OR: [
          { subject: { contains: query, mode: 'insensitive' } },
          { from: { contains: query, mode: 'insensitive' } },
          { body: { contains: query, mode: 'insensitive' } },
          { toAddresses: { hasSome: [query] } },
        ],
      },
      orderBy: { receivedAt: 'desc' },
      take,
      skip,
    });
  }
}