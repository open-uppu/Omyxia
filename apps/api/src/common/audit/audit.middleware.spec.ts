import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { AuditMiddleware } from './audit.middleware';
import { InMemoryChainHeadCache } from './audit-signer';

describe('AuditMiddleware', () => {
  let prisma: any;
  let tenantContext: any;
  let chainCache: InMemoryChainHeadCache;
  let middleware: AuditMiddleware;

  beforeEach(() => {
    prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
    tenantContext = {
      getTenantId: vi.fn().mockReturnValue('t-1'),
      getUserId: vi.fn().mockReturnValue('u-1'),
    };
    chainCache = new InMemoryChainHeadCache();
    middleware = new AuditMiddleware(prisma, tenantContext, chainCache);
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

  // -------------------------------------------------------------------
  // P5.2 WORM chain tests
  // -------------------------------------------------------------------
  describe('P5.2 WORM chain', () => {
    it('writes previousSignature=null and signedAt=now on the first row', async () => {
      // chainCache is empty (after beforeEach)
      expect(await chainCache.get('t-1')).toBeNull();

      const { req, res } = makeReqRes('POST', '/api/crm/leads', { name: 'Acme' });
      middleware.use(req, res, () => undefined);
      res.json({ id: 'lead-1' });
      res.emit('finish');
      await new Promise((r) => setTimeout(r, 5));

      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(arg.previousSignature).toBeNull();
      expect(arg.signature).toBeNull(); // off-band; signed in audit-snapshot CLI
      expect(arg.signedAt).toBeInstanceOf(Date);
      // signed_at is recent (within the last 5 s)
      expect(Date.now() - arg.signedAt.getTime()).toBeLessThan(5000);
    });

    it('carries the cache chain head as previousSignature on the second row', async () => {
      const { req, res } = makeReqRes('POST', '/api/crm/leads', { name: 'A' });
      middleware.use(req, res, () => undefined);
      res.json({ id: 'l1' });
      res.emit('finish');
      await new Promise((r) => setTimeout(r, 5));

      const { req: req2, res: res2 } = makeReqRes('POST', '/api/crm/leads', { name: 'B' });
      middleware.use(req2, res2, () => undefined);
      res2.json({ id: 'l2' });
      res2.emit('finish');
      await new Promise((r) => setTimeout(r, 5));

      const first = prisma.auditLog.create.mock.calls[0][0].data;
      const second = prisma.auditLog.create.mock.calls[1][0].data;
      expect(first.previousSignature).toBeNull();
      // second.previousSignature is the placeholder set after the first
      // INSERT (format: 'pending:<isoTimestamp>').
      expect(second.previousSignature).toMatch(/^pending:\d{4}-\d{2}-\d{2}T/);
      expect(second.previousSignature).not.toBe(first.previousSignature ?? null);
    });

    it('uses previousSignature=null for cross-tenant (tenantId=null) writes', async () => {
      tenantContext.getTenantId.mockReturnValue(undefined);
      const { req, res } = makeReqRes('POST', '/api/admin/tenants', { slug: 'acme' });
      middleware.use(req, res, () => undefined);
      res.json({ id: 'tnt-1' });
      res.emit('finish');
      await new Promise((r) => setTimeout(r, 5));
      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(arg.previousSignature).toBeNull();
    });

    it('does not store signature on insert (off-band via snapshot CLI)', async () => {
      const { req, res } = makeReqRes('PATCH', '/api/crm/leads/leadcuidxxxxxxxxxxxxxxxxx', { name: 'Z' });
      middleware.use(req, res, () => undefined);
      res.json({ id: 'leadcuidxxxxxxxxxxxxxxxxx', name: 'Z' });
      res.emit('finish');
      await new Promise((r) => setTimeout(r, 5));
      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      // WORM trigger forbids UPDATE-after-INSERT, so the live row's
      // `signature` stays NULL. The off-band ledger is the authoritative
      // chain hash.
      expect(arg.signature).toBeNull();
    });
  });
});