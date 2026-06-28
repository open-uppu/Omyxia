import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      emailMessage: {
        create: vi.fn().mockResolvedValue({ id: 'message-2', subject: 'Hello' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'message-1', subject: 'Inbox item' }]),
        findFirst: vi.fn().mockResolvedValue({ id: 'message-1', subject: 'Inbox item' }),
      },
    };
    tenantContext = {
      getTenantId: vi.fn().mockReturnValue('tenant-1'),
      getUserId: vi.fn().mockReturnValue('user-1'),
    };
    service = new EmailService(prisma, tenantContext);
  });

  it('should send an email for the tenant', async () => {
    const data = {
      to: 'customer@example.com',
      subject: 'Hello',
      body: 'Welcome to Omyxia',
    };

    const result = await service.sendEmail(data);

    expect(prisma.emailMessage.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        folder: 'SENT',
        from: 'noreply@openuppu.local',
        fromAddress: 'noreply@openuppu.local',
        toAddresses: ['customer@example.com'],
        subject: 'Hello',
        body: 'Welcome to Omyxia',
      },
    });
    expect(result).toEqual({ id: 'message-2', subject: 'Hello' });
  });

  it('should list inbox messages for the tenant', async () => {
    const result = await service.listInbox();

    expect(prisma.emailMessage.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', folder: 'INBOX' },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    expect(result).toEqual([{ id: 'message-1', subject: 'Inbox item' }]);
  });

  it('should get a message scoped to the tenant', async () => {
    const result = await service.getMessage('message-1');

    expect(prisma.emailMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'message-1', tenantId: 'tenant-1' },
    });
    expect(result).toEqual({ id: 'message-1', subject: 'Inbox item' });
  });

  it('should throw when there is no tenant context', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);

    await expect(service.listInbox()).rejects.toThrow('No tenant context');
  });
});
