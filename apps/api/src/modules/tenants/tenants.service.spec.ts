import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: any;
  let tenantContext: any;
  let jwt: any;

  const tenantActive = { id: 't-1', slug: 'acme', name: 'Acme', status: 'ACTIVE', settings: {} };
  const tenantSuspended = { id: 't-2', slug: 'oldco', name: 'OldCo', status: 'SUSPENDED', settings: {} };

  beforeEach(() => {
    prisma = {
      userTenant: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('t-1') };
    jwt = { sign: vi.fn().mockReturnValue('signed.jwt.token') };
    service = new TenantsService(prisma, tenantContext, jwt);
  });

  describe('listForUser', () => {
    it('lists user tenants with role and active flag', async () => {
      prisma.userTenant.findMany.mockResolvedValue([
        { tenantId: 't-1', role: 'OWNER', joinedAt: new Date('2024-01-01'), tenant: tenantActive },
        { tenantId: 't-3', role: 'MEMBER', joinedAt: new Date('2024-02-01'), tenant: { ...tenantActive, id: 't-3', slug: 'globex' } },
      ]);

      const result = await service.listForUser('u-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 't-1', role: 'OWNER', active: true });
      expect(result[1]).toMatchObject({ id: 't-3', role: 'MEMBER', active: false });
    });
  });

  describe('switchTenant', () => {
    it('issues a new JWT bound to the target tenant', async () => {
      prisma.userTenant.findUnique.mockResolvedValue({
        tenantId: 't-3',
        userId: 'u-1',
        role: 'ADMIN',
        tenant: { id: 't-3', slug: 'globex', name: 'Globex', status: 'ACTIVE' },
      });

      const result = await service.switchTenant('u-1', 't-3');

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: 'u-1',
        activeTenantId: 't-3',
        role: 'ADMIN',
      });
      expect(result).toEqual({
        token: 'signed.jwt.token',
        tenant: { id: 't-3', slug: 'globex', name: 'Globex', status: 'ACTIVE' },
        role: 'ADMIN',
      });
    });

    it('is idempotent: switching to the same active tenant succeeds and re-issues a token', async () => {
      prisma.userTenant.findUnique.mockResolvedValue({
        tenantId: 't-1',
        userId: 'u-1',
        role: 'OWNER',
        tenant: tenantActive,
      });

      const result = await service.switchTenant('u-1', 't-1');

      expect(result.token).toBe('signed.jwt.token');
      expect(jwt.sign).toHaveBeenCalledTimes(1);
    });

    it('rejects when user is not a member of target tenant', async () => {
      prisma.userTenant.findUnique.mockResolvedValue(null);

      await expect(service.switchTenant('u-1', 't-9')).rejects.toThrow(ForbiddenException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('rejects when target tenant is suspended', async () => {
      prisma.userTenant.findUnique.mockResolvedValue({
        tenantId: 't-2',
        userId: 'u-1',
        role: 'MEMBER',
        tenant: tenantSuspended,
      });

      await expect(service.switchTenant('u-1', 't-2')).rejects.toThrow(ForbiddenException);
    });

    it('rejects when input is missing', async () => {
      await expect(service.switchTenant('', 't-1')).rejects.toThrow(BadRequestException);
      await expect(service.switchTenant('u-1', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('createTenant', () => {
    it('creates a tenant and UserTenant(owner) inside a transaction', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      const createdTenant = { id: 't-new', slug: 'new-co', name: 'New Co', status: 'ACTIVE', settings: {} };
      prisma.tenant.create.mockResolvedValue(createdTenant);
      prisma.userTenant.create.mockResolvedValue({ id: 'ut-1', tenantId: 't-new', userId: 'u-1', role: 'OWNER' });

      const result = await service.createTenant('u-1', { name: 'New Co' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.tenant.create).toHaveBeenCalledWith({
        data: { slug: 'new-co', name: 'New Co', settings: {} },
      });
      expect(prisma.userTenant.create).toHaveBeenCalledWith({
        data: { tenantId: 't-new', userId: 'u-1', role: 'OWNER', active: true },
      });
      expect(result).toEqual(createdTenant);
    });

    it('rejects duplicate slug', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't-1', slug: 'acme' });

      await expect(service.createTenant('u-1', { name: 'Acme', slug: 'acme' })).rejects.toThrow(ConflictException);
      expect(prisma.tenant.create).not.toHaveBeenCalled();
      expect(prisma.userTenant.create).not.toHaveBeenCalled();
    });

    it('rejects missing name', async () => {
      await expect(service.createTenant('u-1', { name: '' })).rejects.toThrow(BadRequestException);
      await expect(service.createTenant('u-1', {} as any)).rejects.toThrow(BadRequestException);
      await expect(service.createTenant('u-1', { name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid slug', async () => {
      // Slug contains illegal characters
      await expect(service.createTenant('u-1', { name: 'X', slug: 'a@b' })).rejects.toThrow(BadRequestException);
      await expect(service.createTenant('u-1', { name: 'X', slug: 'has spaces' })).rejects.toThrow(BadRequestException);
      // Slug too short
      await expect(service.createTenant('u-1', { name: 'X', slug: 'a' })).rejects.toThrow(BadRequestException);
    });

    it('rolls back: if UserTenant.create fails, the transaction handler propagates the error', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenant.create.mockResolvedValue({ id: 't-new', slug: 'new-co', name: 'New Co' });
      prisma.userTenant.create.mockRejectedValue(new Error('FK violation'));

      await expect(service.createTenant('u-1', { name: 'New Co' })).rejects.toThrow('FK violation');
    });
  });
});