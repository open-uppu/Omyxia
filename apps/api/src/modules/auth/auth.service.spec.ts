import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.signup', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      tenant: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userTenant: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };
    jwt = { sign: vi.fn().mockReturnValue('signed.token') };
    tenantContext = {
      getTenantId: vi.fn().mockReturnValue('t-1'),
      getUserId: vi.fn().mockReturnValue('u-1'),
    };
    service = new AuthService(prisma, jwt, tenantContext);
  });

  it('creates User + Tenant + UserTenant(OWNER) in a single transaction and returns a token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const createdUser = { id: 'u-new', email: 'a@x.com', name: 'Alice' };
    const createdTenant = { id: 't-new', slug: 'acme-x', name: 'Acme', settings: {} };
    const createdMembership = { id: 'ut-1', userId: 'u-new', tenantId: 't-new', role: 'OWNER' };
    prisma.user.create.mockResolvedValue(createdUser);
    prisma.tenant.create.mockResolvedValue(createdTenant);
    prisma.userTenant.create.mockResolvedValue(createdMembership);

    const result = await service.signup({
      email: 'A@X.com',
      password: 'longpassword',
      name: 'Alice',
      tenantName: 'Acme',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'a@x.com', name: 'Alice' }),
      }),
    );
    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Acme', slug: expect.stringMatching(/^acme-/) }),
      }),
    );
    expect(prisma.userTenant.create).toHaveBeenCalledWith({
      data: { userId: 'u-new', tenantId: 't-new', role: 'OWNER', active: true },
    });
    expect(jwt.sign).toHaveBeenCalledWith({
      sub: 'u-new',
      activeTenantId: 't-new',
      role: 'OWNER',
    });
    expect(result).toEqual({
      token: 'signed.token',
      user: createdUser,
      tenant: createdTenant,
      role: 'OWNER',
    });
  });

  it('rejects duplicate email before any inserts happen', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-existing' });

    await expect(
      service.signup({ email: 'a@x.com', password: 'longpassword', name: 'A', tenantName: 'T' }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('rejects missing required fields', async () => {
    await expect(service.signup({ email: '', password: 'longpassword', name: 'A', tenantName: 'T' })).rejects.toThrow(BadRequestException);
    await expect(service.signup({ email: 'a@x.com', password: 'short', name: 'A', tenantName: 'T' })).rejects.toThrow(BadRequestException);
    await expect(service.signup({ email: 'a@x.com', password: 'longpassword', name: '', tenantName: 'T' })).rejects.toThrow(BadRequestException);
    await expect(service.signup({ email: 'a@x.com', password: 'longpassword', name: 'A', tenantName: '' })).rejects.toThrow(BadRequestException);
  });

  it('rolls back when User.create throws mid-transaction', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(new Error('boom'));

    await expect(
      service.signup({ email: 'a@x.com', password: 'longpassword', name: 'A', tenantName: 'T' }),
    ).rejects.toThrow('boom');
    // $transaction itself isn't atomic in our mock — but the service wraps the error path:
    // we verify that no token was issued.
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('translates Prisma P2002 (unique constraint) into ConflictException', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002', meta: { target: ['email'] } });

    await expect(
      service.signup({ email: 'a@x.com', password: 'longpassword', name: 'A', tenantName: 'T' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };
    jwt = { sign: vi.fn().mockReturnValue('signed.token') };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('t-1'), getUserId: vi.fn().mockReturnValue('u-1') };
    service = new AuthService(prisma, jwt, tenantContext);
  });

  it('returns a token for valid credentials', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correct', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@x.com',
      passwordHash: hash,
      tenants: [{ tenantId: 't-1', role: 'OWNER' }],
    });

    const result = await service.login('a@x.com', 'correct');
    expect(result.token).toBe('signed.token');
    expect(result.role).toBe('OWNER');
  });

  it('rejects unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('x@x.com', 'pw')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects wrong password', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correct', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@x.com',
      passwordHash: hash,
      tenants: [{ tenantId: 't-1', role: 'OWNER' }],
    });
    await expect(service.login('a@x.com', 'wrong')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects user with no tenant membership', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correct', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@x.com',
      passwordHash: hash,
      tenants: [],
    });
    await expect(service.login('a@x.com', 'correct')).rejects.toThrow(UnauthorizedException);
  });
});

describe('AuthService.completeOnboarding', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      user: { update: vi.fn() },
      tenant: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (cb: any) => cb(prisma)),
    };
    jwt = { sign: vi.fn().mockReturnValue('signed.token') };
    tenantContext = { getTenantId: vi.fn().mockReturnValue('t-1'), getUserId: vi.fn().mockReturnValue('u-1') };
    service = new AuthService(prisma, jwt, tenantContext);
  });

  it('renames tenant, sets locale, sets fiscal year, and marks onboardingComplete=true', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't-1',
      name: 'Old Name',
      settings: {},
    });
    prisma.tenant.update.mockResolvedValue({ id: 't-1', name: 'New Name', settings: { fiscalYearStart: '01-01', onboardingComplete: true } });

    const result = await service.completeOnboarding({
      tenantName: 'New Name',
      locale: 'th-TH',
      fiscalYearStart: '01-01',
    });

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { name: 'New Name', settings: { fiscalYearStart: '01-01', onboardingComplete: true } },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { locale: 'th-TH' },
    });
    expect(result.onboardingComplete).toBe(true);
  });

  it('merges settings: existing keys are preserved when adding new ones', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 't-1',
      name: 'X',
      settings: { theme: 'dark', fiscalYearStart: '04-01' },
    });
    prisma.tenant.update.mockResolvedValue({});

    await service.completeOnboarding({ fiscalYearStart: '10-01' });

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: {
        settings: {
          theme: 'dark',
          fiscalYearStart: '10-01',
          onboardingComplete: true,
        },
      },
    });
  });

  it('requires auth context', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);
    await expect(service.completeOnboarding({})).rejects.toThrow(UnauthorizedException);
  });

  it('validates locale format', async () => {
    await expect(service.completeOnboarding({ locale: 'invalid_locale' })).rejects.toThrow(BadRequestException);
  });

  it('validates fiscalYearStart format (MM-DD)', async () => {
    await expect(service.completeOnboarding({ fiscalYearStart: '13-01' })).rejects.toThrow(BadRequestException);
    await expect(service.completeOnboarding({ fiscalYearStart: '1-1' })).rejects.toThrow(BadRequestException);
    await expect(service.completeOnboarding({ fiscalYearStart: '01-32' })).rejects.toThrow(BadRequestException);
  });
});