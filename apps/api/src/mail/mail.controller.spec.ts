import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MailController } from './mail.controller';

describe('MailController', () => {
  let controller: MailController;
  let service: {
    listTemplates: ReturnType<typeof vi.fn>;
    upsertTemplate: ReturnType<typeof vi.fn>;
    getTemplate: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      listTemplates: vi.fn().mockReturnValue([{ id: 'welcome' }]),
      upsertTemplate: vi.fn().mockReturnValue({ id: 'x', subject: 's', body: 'b' }),
      getTemplate: vi.fn().mockReturnValue({ id: 'welcome', subject: 'Welcome', body: 'Hi {{name}}' }),
      send: vi.fn().mockResolvedValue({ messageId: 'm1' }),
    };
    controller = new MailController(service as any);
  });

  it('listTemplates: rejects unauthenticated', () => {
    expect(() => controller.listTemplates({})).toThrow(ForbiddenException);
  });

  it('listTemplates: returns templates when authenticated', () => {
    expect(controller.listTemplates({ user: { sub: 'u1' } })).toEqual([{ id: 'welcome' }]);
  });

  it('upsertTemplate: rejects missing fields', () => {
    expect(() =>
      controller.upsertTemplate({ user: { sub: 'u1' } }, { id: '', subject: '', body: '' }),
    ).toThrow(BadRequestException);
  });

  it('upsertTemplate: delegates when valid', () => {
    const r = controller.upsertTemplate(
      { user: { sub: 'u1' } },
      { id: 'invite', subject: 'You are invited', body: 'Hello {{name}}' },
    );
    expect(service.upsertTemplate).toHaveBeenCalled();
    expect(r).toEqual({ id: 'x', subject: 's', body: 'b' });
  });

  it('getTemplate: throws NotFound when service returns null', () => {
    service.getTemplate.mockReturnValue(null);
    expect(() => controller.getTemplate({ user: { sub: 'u1' } }, 'missing')).toThrow(
      BadRequestException,
    );
  });

  it('send: rejects missing subject', () => {
    expect(() =>
      controller.send({ user: { sub: 'u1' } }, { to: 'a@b.c', subject: '', body: 'x' }),
    ).toThrow(BadRequestException);
  });

  it('send: rejects when neither body nor templateId provided', () => {
    expect(() =>
      controller.send({ user: { sub: 'u1' } }, { to: 'a@b.c', subject: 'x' }),
    ).toThrow(BadRequestException);
  });

  it('send: delegates when valid', async () => {
    const r = await controller.send(
      { user: { sub: 'u1' } },
      { to: 'a@b.c', subject: 'Hello', body: 'World' },
    );
    expect(service.send).toHaveBeenCalled();
    expect(r).toEqual({ messageId: 'm1' });
  });
});
