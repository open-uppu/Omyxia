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

  async listMessages(folder: string = 'inbox') {
    // Stub: returns draft messages
    return this.prisma.emailMessage.findMany({
      where: { tenantId: this.getTenantId(), status: 'SENT' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async send(data: { to: string[]; subject: string; bodyHtml?: string; bodyText?: string }) {
    return this.prisma.emailMessage.create({
      data: {
        tenantId: this.getTenantId(),
        senderId: this.tenantContext.getUserId(),
        fromAddress: 'noreply@openuppu.local',
        toAddresses: data.to,
        subject: data.subject,
        bodyHtml: data.bodyHtml,
        bodyText: data.bodyText,
        status: 'SENT',
        sentAt: new Date(),
      },
    });
  }

  async listTemplates() {
    return this.prisma.emailTemplate.findMany({ where: { tenantId: this.getTenantId() } });
  }

  async createTemplate(data: { name: string; subject: string; bodyHtml: string; variables?: string[] }) {
    return this.prisma.emailTemplate.create({
      data: { ...data, variables: data.variables || [], tenantId: this.getTenantId() },
    });
  }
}