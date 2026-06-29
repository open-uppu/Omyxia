import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { AuditMiddleware } from './audit.middleware';

describe('AuditMiddleware', () => {
  let prisma: any;
  let tenantContext: any;
  let middleware: AuditMiddleware;

  beforeEach(() => {
    prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
    tenantContext = {
      getTenantId: vi.fn().mockReturnValue('t-1'),
      getUserId: vi.fn().mockReturnValue('u-1'),
    };
    middleware = new AuditMiddleware(prisma, tenantContext);
  });

  function makeReqRes(method: string, path: string, body: any = {}) {
    const req: any = {
      method,
      path,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'jest-test' },
      body,
    };
    const res: any = new EventEmitter();
    res.statusCode = 200;
    res.json = vi.fn().mockImplementation((b: any) => {
      res._body = b;
      return res;
    });
    return { req, res };
  }

  it('skips GET requests (no audit row)', () => {
    const { req, res } = makeReqRes('GET', '/api/crm/leads');
    const next = vi.fn();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('skips health check endpoints', () => {
    const next = vi.fn();
    for (const p of ['/health', '/api/health', '/healthz', '/readyz', '/api/health/db']) {
      const { req, res } = makeReqRes('POST', p, {});
      middleware.use(req, res, next);
    }
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('captures POST with redacted before/after, tenantId, userId, ipAddress, userAgent', async () => {
    const { req, res } = makeReqRes('POST', '/api/crm/leads', { name: 'Acme', password: 'p4ss' });
    const next = vi.fn();
    middleware.use(req, res, next);
    res.json({ id: 'lead-1', name: 'Acme' });
    res.emit('finish');
    // Wait for the async persist promise to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const arg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(arg.tenantId).toBe('t-1');
    expect(arg.userId).toBe('u-1');
    expect(arg.table).toBe('crm/leads');
    expect(arg.rowId).toBeNull();
    expect(arg.action).toBe('CREATE');
    expect(arg.ipAddress).toBe('127.0.0.1');
    expect(arg.userAgent).toBe('jest-test');
    expect(arg.before).toEqual({ name: 'Acme', password: '[REDACTED]' });
    expect(arg.after).toEqual({ id: 'lead-1', name: 'Acme' });
  });

  it('captures PUT as UPDATE and PATCH as UPDATE', async () => {
    for (const method of ['PUT', 'PATCH']) {
      prisma.auditLog.create.mockClear();
      const { req, res } = makeReqRes(method, '/api/crm/leads/leadcuid12345678901234', { name: 'X' });
      middleware.use(req, res, () => undefined);
      res.json({ id: 'leadcuid12345678901234', name: 'X' });
      res.emit('finish');
      await new Promise((r) => setTimeout(r, 5));
      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(arg.action).toBe('UPDATE');
      expect(arg.rowId).toBe('leadcuid12345678901234');
      expect(arg.table).toBe('crm/leads');
    }
  });

  it('captures DELETE as DELETE', async () => {
    const { req, res } = makeReqRes('DELETE', '/api/crm/leads/leadcuid12345678901234');
    middleware.use(req, res, () => undefined);
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 5));
    const arg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(arg.action).toBe('DELETE');
    expect(arg.rowId).toBe('leadcuid12345678901234');
  });

  it('scopes audit row to tenantId (uses null when no tenant context)', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);
    tenantContext.getUserId.mockReturnValue(undefined);
    const { req, res } = makeReqRes('POST', '/api/crm/leads', { name: 'X' });
    middleware.use(req, res, () => undefined);
    res.json({ id: 'l-1' });
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 5));
    const arg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(arg.tenantId).toBeNull();
    expect(arg.userId).toBeNull();
  });

  it('does NOT persist audit row on error responses (4xx/5xx)', async () => {
    const { req, res } = makeReqRes('POST', '/api/crm/leads', { name: 'X' });
    middleware.use(req, res, () => undefined);
    res.statusCode = 422;
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 5));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('swallows persist errors and does not crash the request', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('DB down'));
    const { req, res } = makeReqRes('POST', '/api/crm/leads', { name: 'X' });
    // Should not throw
    expect(() => middleware.use(req, res, () => undefined)).not.toThrow();
    res.json({ id: 'l-1' });
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 10));
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('redacts sensitive fields in nested objects (passwords, tokens)', async () => {
    const { req, res } = makeReqRes('POST', '/api/auth/login', {
      email: 'a@x.com',
      password: 'p4ss',
      headers: { authorization: 'Bearer x' },
    });
    middleware.use(req, res, () => undefined);
    res.json({ token: 'jwt.x.y', user: { id: 'u-1', passwordHash: 'bcrypt$' } });
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 5));
    const arg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(arg.before.password).toBe('[REDACTED]');
    expect(arg.before.headers.authorization).toBe('[REDACTED]');
    expect(arg.after.token).toBe('[REDACTED]');
    expect(arg.after.user.passwordHash).toBe('[REDACTED]');
    expect(arg.before.email).toBe('a@x.com'); // not sensitive
  });
});