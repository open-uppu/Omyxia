import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async sendEmail(data: { to: string | string[]; subject: string; body?: string; bodyHtml?: string; bodyText?: string }) {
    const toAddresses = Array.isArray(data.to) ? data.to : [data.to];
    return this.prisma.emailMessage.create({
      data: {
        tenantId: this.getTenantId(),
        folder: 'SENT',
        from: 'noreply@openuppu.local',
        fromAddress: 'noreply@openuppu.local',
        toAddresses,
        subject: data.subject,
        body: data.body ?? data.bodyText ?? data.bodyHtml ?? '',
      },
    });
  }

  async listInbox() {
    return this.prisma.emailMessage.findMany({
      where: { tenantId: this.getTenantId(), folder: 'INBOX' },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }

  async getMessage(id: string) {
    return this.prisma.emailMessage.findFirst({
      where: { id, tenantId: this.getTenantId() },
    });
  }

  async listMessages(folder: string = 'INBOX') {
    return this.prisma.emailMessage.findMany({
      where: { tenantId: this.getTenantId(), folder: folder.toUpperCase() },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }

  async send(data: { to: string[]; subject: string; bodyHtml?: string; bodyText?: string }) {
    return this.sendEmail(data);
  }

  async listTemplates() {
    return this.prisma.emailTemplate.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createTemplate(data: { code?: string; name: string; subject: string; body?: string; bodyHtml?: string }) {
    return this.prisma.emailTemplate.create({
      data: {
        tenantId: this.getTenantId(),
        code: data.code ?? data.name.toLowerCase().replace(/\s+/g, '-'),
        name: data.name,
        subject: data.subject,
        bodyHtml: data.bodyHtml ?? data.body ?? '',
      },
    });
  }
}
