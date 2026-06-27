import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class ItsmService extends TenantScopedService {
  async listTickets(status?: string, priority?: string) {
    return this.prisma.ticket.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(status && { status }),
        ...(priority && { priority }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTicket(data: any) {
    const ticketNo = `T-${Date.now()}`;
    const slaDueAt = new Date(Date.now() + (data.priority === 'URGENT' ? 4 : data.priority === 'HIGH' ? 24 : 72) * 3600000);
    return this.prisma.ticket.create({
      data: { ...data, ticketNo, tenantId: this.getTenantId(), slaDueAt },
    });
  }

  async assignTicket(id: string, assigneeId: string) {
    return this.prisma.ticket.update({ where: { id }, data: { assigneeId } });
  }

  async resolveTicket(id: string) {
    return this.prisma.ticket.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }
}