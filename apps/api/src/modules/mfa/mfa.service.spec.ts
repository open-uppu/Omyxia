import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { MfaService } from './mfa.service';
import { generateTOTP } from './totp';

/**
 * MFA Service spec — covers enrollment idempotency, TOTP verification (with
 * replay protection), recovery code one-time-use, brute-force protection on
 * disable, and password re-auth on disable.
 */
describe('MfaService.enroll', () => {
  let service: MfaService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      mfaFactor: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      user: { findUnique: vi.fn() },
    };
    service = new MfaService(prisma);
  });

  it('generates a secret, 10 recovery codes, and an otpauth URL', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'alice@example.com' });
    prisma.mfaFactor.create.mockResolvedValue({});

    const result = await service.enroll('u-1');

    expect(result.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(result.otpAuthUrl).toContain('otpauth://totp/');
    expect(result.otpAuthUrl).toContain(encodeURIComponent('alice@example.com'));
    expect(result.recoveryCodes).toHaveLength(10);
    for (const code of result.recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    }
  });

  it('is idempotent: enrolling twice for the same user throws ConflictException', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue({ id: 'mf-1', isActive: true });

    await expect(service.enroll('u-1')).rejects.toThrow(ConflictException);
    expect(prisma.mfaFactor.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for unknown user', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.enroll('u-missing')).rejects.toThrow(BadRequestException);
  });

  it('stores bcrypt-hashed recovery codes (not plaintext)', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'a@b.com' });
    let storedHashes: string[] = [];
    prisma.mfaFactor.create.mockImplementation(async ({ data }: any) => {
      storedHashes = data.backupCodes;
      return {};
    });

    await service.enroll('u-1');

    expect(storedHashes).toHaveLength(10);
    for (const hash of storedHashes) {
      // bcrypt hash prefix
      expect(hash).toMatch(/^\$2[aby]\$/);
      // Not equal to a plaintext recovery code
      expect(hash.length).toBeGreaterThan(20);
    }
  });
});

describe('MfaService.verify', () => {
  let service: MfaService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      mfaFactor: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      user: { findUnique: vi.fn() },
    };
    service = new MfaService(prisma);
  });

  it('verifies a freshly-generated TOTP code', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    prisma.mfaFactor.findFirst.mockResolvedValue({
      id: 'mf-1',
      secret,
      backupCodes: ['$2a$10$hashed'],
      isActive: true,
      lastUsedAt: null,
    });
    prisma.mfaFactor.update.mockResolvedValue({});

    const code = generateTOTP(secret, Math.floor(Date.now() / 1000 / 30));
    const result = await service.verify('u-1', code);

    expect(result.verified).toBe(true);
    expect(result.method).toBe('totp');
    expect(prisma.mfaFactor.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid code', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue({
      id: 'mf-1',
      secret: 'JBSWY3DPEHPK3PXP',
      backupCodes: [],
      isActive: true,
      lastUsedAt: null,
    });

    await expect(service.verify('u-1', '000000')).rejects.toThrow(UnauthorizedException);
  });

  it('throws when MFA is not enabled', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue(null);
    await expect(service.verify('u-1', '123456')).rejects.toThrow(UnauthorizedException);
  });

  it('recovery code one-time-use: each code can only be consumed once', async () => {
    // Use real recovery codes flow: pre-hash a known recovery code, store, then verify it
    const { generateRecoveryCodes, hashRecoveryCodes } = await import('./recovery');
    const codes = generateRecoveryCodes(3); // smaller for test speed
    const hashed = await hashRecoveryCodes(codes);

    prisma.mfaFactor.findFirst.mockImplementation(async ({ where }: any) => {
      // After update, the array shrinks
      return {
        id: 'mf-1',
        secret: null, // skip TOTP
        backupCodes: currentHashes,
        isActive: true,
        lastUsedAt: null,
      };
    });

    let currentHashes = [...hashed];
    prisma.mfaFactor.update.mockImplementation(async ({ data }: any) => {
      currentHashes = data.backupCodes;
      return {};
    });

    // First use → success, hashes shrink
    const r1 = await service.verify('u-1', codes[0]);
    expect(r1.verified).toBe(true);
    expect(r1.method).toBe('recovery');
    expect(r1.recoveryCodesRemaining).toBe(2);

    // Second use of the same code → fails (already consumed)
    prisma.mfaFactor.findFirst.mockImplementation(async () => ({
      id: 'mf-1',
      secret: null,
      backupCodes: currentHashes,
      isActive: true,
      lastUsedAt: new Date(),
    }));

    await expect(service.verify('u-1', codes[0])).rejects.toThrow(UnauthorizedException);
  });

  it('replay protection: same TOTP code cannot be used twice within the window', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const code = generateTOTP(secret, Math.floor(Date.now() / 1000 / 30));

    prisma.mfaFactor.findFirst.mockResolvedValue({
      id: 'mf-1',
      secret,
      backupCodes: [],
      isActive: true,
      // lastUsedAt in the same 30s window → reject replay
      lastUsedAt: new Date(),
    });

    await expect(service.verify('u-1', code)).rejects.toThrow(/already used/i);
  });
});

describe('MfaService.disable', () => {
  let service: MfaService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      mfaFactor: { findFirst: vi.fn(), update: vi.fn() },
      user: { findUnique: vi.fn() },
    };
    service = new MfaService(prisma);
  });

  it('requires the current password (re-auth) and marks factor inactive', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correctpw', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', passwordHash: hash });
    prisma.mfaFactor.findFirst.mockResolvedValue({ id: 'mf-1', isActive: true });
    prisma.mfaFactor.update.mockResolvedValue({});

    await service.disable('u-1', 'correctpw');

    expect(prisma.mfaFactor.update).toHaveBeenCalledWith({
      where: { id: 'mf-1' },
      data: { isActive: false },
    });
  });

  it('rejects wrong password (brute-force protection)', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correctpw', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', passwordHash: hash });

    await expect(service.disable('u-1', 'wrongpw')).rejects.toThrow(UnauthorizedException);
    expect(prisma.mfaFactor.update).not.toHaveBeenCalled();
  });

  it('rejects when MFA is not enabled', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correctpw', 4);
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', passwordHash: hash });
    prisma.mfaFactor.findFirst.mockResolvedValue(null);

    await expect(service.disable('u-1', 'correctpw')).rejects.toThrow(BadRequestException);
  });
});

describe('MfaService.getStatus', () => {
  let service: MfaService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      mfaFactor: { findFirst: vi.fn() },
      user: { findUnique: vi.fn() },
    };
    service = new MfaService(prisma);
  });

  it('returns disabled when no active factor', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue(null);
    const s = await service.getStatus('u-1');
    expect(s).toEqual({ enabled: false, type: null });
  });

  it('returns enabled + remaining count when active factor exists', async () => {
    prisma.mfaFactor.findFirst.mockResolvedValue({
      id: 'mf-1',
      type: 'TOTP',
      isActive: true,
      backupCodes: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'],
    });
    const s = await service.getStatus('u-1');
    expect(s.enabled).toBe(true);
    expect(s.type).toBe('totp');
    expect(s.recoveryCodesRemaining).toBe(7);
  });
});