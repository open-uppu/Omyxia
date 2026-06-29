import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  let service: { list: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: vi.fn().mockResolvedValue({ id: 'a1' }),
    };
    controller = new AuditController(service as unknown as AuditService);
  });

  it('list: rejects unauthenticated requests', async () => {
    await expect(
      controller.list({}, undefined, undefined, undefined, undefined, undefined, undefined, undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('list: parses filters and delegates to service', async () => {
    const req = { user: { sub: 'user-1' } };
    const result = await controller.list(
      req,
      'crm/leads',
      'DELETE' as any,
      'user-2',
      '2026-01-01T00:00:00Z',
      '2026-01-31T23:59:59Z',
      '10',
      '25',
    );
    expect(result).toEqual({ items: [], total: 0 });
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'crm/leads',
        action: 'DELETE',
        userId: 'user-2',
      }),
      { skip: 10, take: 25 },
    );
  });

  it('list: throws BadRequest on bad date', async () => {
    const req = { user: { sub: 'user-1' } };
    await expect(
      controller.list(req, undefined, undefined, undefined, 'not-a-date', undefined, undefined, undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('list: defaults pagination to skip=0, take=50', async () => {
    const req = { user: { sub: 'user-1' } };
    await controller.list(req, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
    expect(service.list).toHaveBeenCalledWith(expect.anything(), { skip: 0, take: 50 });
  });

  it('list: caps take at 200', async () => {
    const req = { user: { sub: 'user-1' } };
    await controller.list(req, undefined, undefined, undefined, undefined, undefined, undefined, '9999');
    expect(service.list).toHaveBeenCalledWith(expect.anything(), { skip: 0, take: 200 });
  });

  it('findOne: rejects unauthenticated', async () => {
    await expect(controller.findOne({}, 'a1')).rejects.toThrow(ForbiddenException);
    expect(service.findById).not.toHaveBeenCalled();
  });

  it('findOne: rejects empty id', async () => {
    const req = { user: { sub: 'user-1' } };
    await expect(controller.findOne(req, '')).rejects.toThrow(BadRequestException);
  });

  it('findOne: delegates to service', async () => {
    const req = { user: { sub: 'user-1' } };
    const result = await controller.findOne(req, 'a1');
    expect(result).toEqual({ id: 'a1' });
    expect(service.findById).toHaveBeenCalledWith('a1');
  });
});
