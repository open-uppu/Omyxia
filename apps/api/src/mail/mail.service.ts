import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContextService } from '../common/tenant-context/tenant-context.service';
import { SmtpService, SendMailOptions, SendMailResult } from './smtp.service';
import { ImapService, FetchedMessage } from './imap.service';
import { Prisma, EmailStatus, EmailMessage } from '@prisma/client';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private messageHandlerRegistered = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly smtpService: SmtpService,
    private readonly imapService: ImapService,
  ) {}

  onModuleInit() {
    if (!this.messageHandlerRegistered) {
      this.imapService.setMessageHandler(async (messages: any[]) => {
        await this.handleIncomingMessages(messages);
      });
      this.messageHandlerRegistered = true;
    }
  }

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  // ==================== OUTBOUND EMAIL ====================

  async sendEmail(options: SendMailOptions): Promise<SendMailResult & { emailMessage: EmailMessage }> {
    const tenantId = this.getTenantId();
    const from = options.from || 'noreply@openuppu.local';

    // Send via SMTP
    const result = await this.smtpService.sendMail(options);

    // Persist to outbox (SENT folder)
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];
    const ccAddresses = options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : [];
    const bccAddresses = options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : [];

    const emailMessage = await this.prisma.emailMessage.create({
      data: {
        tenantId,
        folder: 'SENT',
        from,
        fromAddress: from,
        toAddresses,
        ccAddresses,
        bccAddresses,
        subject: options.subject,
        body: options.text || options.html || '',
        bodyHtml: options.html,
        bodyText: options.text,
        status: 'SENT',
        sentAt: new Date(),
        statusMessage: result.response,
        messageId: result.messageId,
      },
    });

    // Emit realtime event for sent email
    this.emitEmailEvent('email:sent', emailMessage);

    return { ...result, emailMessage };
  }

  async sendEmailWithTemplate(
    templateCode: string,
    to: string | string[],
    variables: Record<string, string>
  ): Promise<SendMailResult & { emailMessage: EmailMessage }> {
    const tenantId = this.getTenantId();

    const template = await this.prisma.emailTemplate.findFirst({
      where: { tenantId, code: templateCode, isActive: true },
    });

    if (!template) {
      throw new Error(`Template not found: ${templateCode}`);
    }

    const subject = this.renderTemplate(template.subject, variables);
    const bodyHtml = this.renderTemplate(template.bodyHtml, variables);
    const bodyText = this.renderTemplate(template.body, variables);

    return this.sendEmail({
      to,
      subject,
      html: bodyHtml,
      text: bodyText,
    });
  }

  private renderTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] || match);
  }

  async getOutbox(folder: string = 'SENT', take: number = 50): Promise<EmailMessage[]> {
    return this.prisma.emailMessage.findMany({
      where: { tenantId: this.getTenantId(), folder: folder.toUpperCase() },
      orderBy: { sentAt: 'desc' },
      take,
    });
  }

  async getOutboxMessage(id: string): Promise<EmailMessage | null> {
    return this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'SENT' },
    });
  }

  // ==================== INBOUND EMAIL ====================

  async syncInbox(): Promise<EmailMessage[]> {
    this.logger.log('Starting manual inbox sync');
    const messages = await this.imapService.fetchUnseenMessages();
    return this.handleIncomingMessages(messages);
  }

  async markAsRead(id: string): Promise<EmailMessage | null> {
    const message = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'INBOX' },
    });

    if (!message) return null;

    if (message.receivedAt) {
      await this.imapService.markSeen(message.receivedAt.getTime()); // Using timestamp as UID reference
    }

    return this.prisma.emailMessage.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async getInbox(folder: string = 'INBOX', take: number = 50): Promise<EmailMessage[]> {
    return this.prisma.emailMessage.findMany({
      where: { tenantId: this.getTenantId(), folder: folder.toUpperCase() },
      orderBy: { receivedAt: 'desc' },
      take,
    });
  }

  async getInboxMessage(id: string): Promise<EmailMessage | null> {
    return this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId(), folder: 'INBOX' },
    });
  }

  async getUnreadCount(): Promise<number> {
    return this.prisma.emailMessage.count({
      where: { tenantId: this.getTenantId(), folder: 'INBOX', isRead: false },
    });
  }

  async getMailboxes() {
    return this.imapService.listMailboxes();
  }

  async getInboxStatus() {
    const count = await this.imapService.getMessageCount('INBOX');
    const unseen = await this.imapService.searchUnseen('INBOX');
    return { total: count, unseen: unseen.length, connected: this.imapService.isConnected() };
  }

  // ==================== INTERNAL ====================

  private async handleIncomingMessages(messages: FetchedMessage[]): Promise<EmailMessage[]> {
    const tenantId = this.getTenantId();
    const created: EmailMessage[] = [];

    for (const msg of messages) {
      // Check if already exists (by message-id or UID)
      const existing = await this.prisma.emailMessage.findFirst({
        where: {
          tenantId,
          folder: 'INBOX',
          OR: [
            { messageId: msg.headers['message-id'] || '' },
            // Fallback to subject + from + date matching
            { subject: msg.subject, fromAddress: msg.from, receivedAt: msg.date },
          ],
        },
      });

      if (existing) {
        // Mark as seen in IMAP
        await this.imapService.markSeen(msg.uid);
        continue;
      }

      const emailMessage = await this.prisma.emailMessage.create({
        data: {
          tenantId,
          folder: 'INBOX',
          from: msg.from,
          fromAddress: msg.from,
          toAddresses: msg.to,
          ccAddresses: msg.cc,
          bccAddresses: [],
          subject: msg.subject,
          body: msg.text || '',
          bodyHtml: msg.html,
          bodyText: msg.text,
          receivedAt: msg.date,
          status: 'DELIVERED',
          isRead: false,
          messageId: msg.headers['message-id'],
        },
      });

      // Mark as seen in IMAP
      await this.imapService.markSeen(msg.uid);

      created.push(emailMessage);
      this.emitEmailEvent('email:new', emailMessage);
    }

    return created;
  }

  private emitEmailEvent(event: string, message: EmailMessage) {
    // Emit realtime event via event emitter or websocket
    this.logger.log(`Emitting event: ${event} for message ${message.id}`);
    // Could emit to EventEmitter2 or WebSocket gateway here
  }

  // ==================== UTILITIES ====================

  async verifySmtpConnection(): Promise<boolean> {
    return this.smtpService.verifyConnection();
  }

  async verifyImapConnection(): Promise<boolean> {
    return this.imapService.isConnected();
  }

  getTenantContext(): { tenantId: string; userId: string | undefined } {
    return {
      tenantId: this.tenantContext.getTenantId()!,
      userId: this.tenantContext.getUserId(),
    };
  }
}