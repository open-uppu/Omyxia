import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      auditLog: {
        findMany: vi.fn().mockResolvedValue([{ id: 'audit-1' }]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('tenant-1') };
    service = new AuditService(prisma, tenantContext);
  });

  describe('list', () => {
    it('always applies tenantId from the AsyncLocalStorage context', async () => {
      await service.list({}, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }),
      );
    });

    it('throws when there is no tenant context', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.list({}, { skip: 0, take: 20 })).rejects.toThrow('No tenant context');
    });

    it('filters by table when provided', async () => {
      await service.list({ table: 'crm/lead' }, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', table: 'crm/lead' }),
        }),
      );
    });

    it('filters by action when provided', async () => {
      await service.list({ action: 'DELETE' }, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', action: 'DELETE' }),
        }),
      );
    });

    it('filters by userId when provided', async () => {
      await service.list({ userId: 'user-42' }, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-42' }),
        }),
      );
    });

    it('filters by dateFrom/dateTo on createdAt (gte/lte)', async () => {
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');
      const dateTo = new Date('2026-01-31T23:59:59.000Z');

      await service.list({ dateFrom, dateTo }, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            createdAt: { gte: dateFrom, lte: dateTo },
          }),
        }),
      );
    });

    it('supports a dateFrom-only range', async () => {
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');

      await service.list({ dateFrom }, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            createdAt: { gte: dateFrom },
          }),
        }),
      );
    });

    it('supports a dateTo-only range', async () => {
      const dateTo = new Date('2026-01-31T23:59:59.000Z');

      await service.list({ dateTo }, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            createdAt: { lte: dateTo },
          }),
        }),
      );
    });

    it('applies combined filters in a single where clause', async () => {
      const dateFrom = new Date('2026-02-01T00:00:00.000Z');

      await service.list(
        { table: 'crm/lead', action: 'UPDATE', userId: 'user-9', dateFrom },
        { skip: 0, take: 20 },
      );

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            table: 'crm/lead',
            action: 'UPDATE',
            userId: 'user-9',
            createdAt: { gte: dateFrom },
          }),
        }),
      );
    });

    it('passes skip/take into the prisma query for pagination', async () => {
      await service.list({}, { skip: 20, take: 50 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 50 }),
      );
    });

    it('orders results by createdAt descending', async () => {
      await service.list({}, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('returns items from findMany and total from count', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
      prisma.auditLog.count.mockResolvedValue(42);

      const result = await service.list({}, { skip: 0, take: 20 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.count).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }),
      );
      expect(result).toEqual({ items: [{ id: 'a1' }, { id: 'a2' }], total: 42 });
    });
  });

  describe('findById', () => {
    it('returns the row when found in the current tenant', async () => {
      prisma.auditLog.findFirst.mockResolvedValue({ id: 'audit-1', tenantId: 'tenant-1' });

      const result = await service.findById('audit-1');

      expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
        where: { id: 'audit-1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual({ id: 'audit-1', tenantId: 'tenant-1' });
    });

    it('throws NotFoundException when the row does not exist', async () => {
      prisma.auditLog.findFirst.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the row belongs to another tenant (cross-tenant rows are invisible)', async () => {
      // The where clause must include tenantId so a row from a different tenant
      // simply does not match — Prisma returns null and we throw 404.
      prisma.auditLog.findFirst.mockResolvedValue(null);

      await expect(service.findById('audit-other-tenant')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
        where: { id: 'audit-other-tenant', tenantId: 'tenant-1' },
      });
    });

    it('throws when there is no tenant context', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);

      await expect(service.findById('audit-1')).rejects.toThrow('No tenant context');
    });
  });
});