/**
 * apps/api/src/modules/admin/impersonation-admin.service.spec.ts
 *
 * P1.7 — Vitest spec for ImpersonationAdminService.
 *
 * Strategy:
 *   - Mock PrismaService with a hand-rolled fake (no DB).
 *   - Mock JwtService so sign() returns a deterministic token.
 *   - Mock ImpersonationBroadcaster so we can assert on the fan-out
 *     payload without dragging in socket.io.
 *   - TenantContextService is supplied via the same fake used by
 *     other admin specs.
 *
 * The fake PrismaService implements `$transaction` by running the
 * callback against the same fake `tx`; this is enough for the
 * service paths exercised here (creation + audit on `start()`,
 * update + audit on `stop()`, no-op on the idempotent re-stop path).
 */

import { describe, it, expect, vi } from 'vitest';
import { ImpersonationAdminService } from './impersonation-admin.service';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeTx {
  constructor(private outer: FakePrisma) {}

  impersonationSession = {
    create: vi.fn(async (args: { data: { superAdminId: string; tenantId: string; reason: string; startedAt: Date; expiresAt: Date } }) => {
      const id = `cu_sess_${Math.random().toString(36).slice(2, 12)}`;
      this.outer.sessionById.set(id, {
        id,
        superAdminId: args.data.superAdminId,
        tenantId: args.data.tenantId,
        reason: args.data.reason,
        startedAt: args.data.startedAt,
        expiresAt: args.data.expiresAt,
        endedAt: null,
        auditLogId: null,
      });
      return { id };
    }),
    update: vi.fn(async (args: { where: { id: string }; data: { auditLogId?: string; endedAt?: Date } }) => {
      const row = this.outer.sessionById.get(args.where.id);
      if (!row) throw new Error('not found');
      if (args.data.auditLogId) row.auditLogId = args.data.auditLogId;
      if (args.data.endedAt) row.endedAt = args.data.endedAt;
      return { id: row.id };
    }),
    updateMany: vi.fn(async (args: { where: { id: string; endedAt: Date | null }; data: { endedAt: Date } }) => {
      const row = this.outer.sessionById.get(args.where.id);
      if (row && row.endedAt === null) row.endedAt = args.data.endedAt;
      return { count: row ? 1 : 0 };
    }),
    findUnique: vi.fn(async (args: { where: { id: string }; include?: any }) => {
      const row = this.outer.sessionById.get(args.where.id);
      if (!row) return null;
      if (args.include) {
        return {
          ...row,
          superAdmin: this.outer.userById.get(row.superAdminId),
          tenant: this.outer.tenantById.get(row.tenantId),
        };
      }
      return row;
    }),
  };

  auditLog = {
    create: vi.fn(async (args: { data: any }) => {
      const id = `cu_audit_${Math.random().toString(36).slice(2, 12)}`;
      this.outer.auditById.set(id, args.data);
      return { id };
    }),
  };
}

class FakePrisma {
  tenantById = new Map<string, any>();
  userById = new Map<string, any>();
  sessionById = new Map<string, any>();
  auditById = new Map<string, any>();

  tenant = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return this.tenantById.get(args.where.id) ?? null;
    }),
  };

  user = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      return this.userById.get(args.where.id) ?? null;
    }),
  };

  impersonationSession = {
    findUnique: vi.fn(async (args: { where: { id: string }; include?: any }) => {
      const row = this.sessionById.get(args.where.id);
      if (!row) return null;
      if (args.include) {
        return {
          ...row,
          superAdmin: this.userById.get(row.superAdminId),
          tenant: this.tenantById.get(row.tenantId),
        };
      }
      return row;
    }),
  };

  auditLog = {
    create: vi.fn(async (args: { data: any }) => {
      const id = `cu_audit_${Math.random().toString(36).slice(2, 12)}`;
      this.auditById.set(id, args.data);
      return { id };
    }),
  };

  $transaction = vi.fn(async (cb: (tx: FakeTx) => Promise<any>) => {
    return cb(new FakeTx(this));
  });

  // Override the per-method to call our fake so the static method runs in $transaction
  // No-op for tests: $transaction above is what gets invoked.
}

class FakeJwt {
  lastOptions: { expiresIn?: number } | undefined;
  sign = vi.fn((payload: any, options?: any) => {
    this.lastOptions = options;
    return `signed.jwt.${payload.sub}.${payload.impersonationSessionId}`;
  });
  verify = vi.fn();
}

class FakeTenantContext {
  private ctx: any = undefined;
  set(ctx: any) {
    this.ctx = ctx;
  }
  run<T>(_ctx: any, fn: () => T): T {
    return fn();
  }
  get() {
    return this.ctx;
  }
  getTenantId() {
    return this.ctx?.tenantId;
  }
  getUserId() {
    return this.ctx?.userId;
  }
  getRole() {
    return this.ctx?.role;
  }
}

class FakeBroadcaster {
  started: any[] = [];
  ended: any[] = [];
  broadcastStarted = vi.fn(async (_actorId: string, p: any) => {
    this.started.push(p);
  });
  broadcastEnded = vi.fn(async (p: any) => {
    this.ended.push(p);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(prisma: FakePrisma) {
  const jwt = new FakeJwt();
  const ctx = new FakeTenantContext();
  const broadcaster = new FakeBroadcaster();
  const svc = new ImpersonationAdminService(
    prisma as any,
    jwt as any,
    ctx as any,
    broadcaster as any,
  );
  return { svc, jwt, ctx, broadcaster, prisma };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImpersonationAdminService', () => {
  describe('parseReasonColumn (via the storage shape)', () => {
    // The static helper is private; we round-trip via `readSession`
    // below. Keep this as documentation that the column shape is
    // `[CODE] text`.
    it('documented format is `[CODE] text`', () => {
      expect(`[SUPPORT] SUP-1234 customer reports duplicated invoice`.startsWith(
        '[SUPPORT]',
      )).toBe(true);
    });
  });

  describe('start', () => {
    it('rejects when the tenant id is missing', async () => {
      const { svc } = makeService(new FakePrisma());
      await expect(
        svc.start('', { reasonCode: 'SUPPORT', reason: 'hello world' }),
      ).rejects.toThrow(/Missing :tenantId/);
    });

    it('rejects when the tenant does not exist', async () => {
      const prisma = new FakePrisma();
      const { svc, ctx } = makeService(prisma);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });
      prisma.userById.set('admin-1', {
        id: 'admin-1',
        email: 'admin@omyxia.app',
        name: 'Admin',
      });
      await expect(
        svc.start('missing', {
          reasonCode: 'SUPPORT',
          reason: 'hello world',
        }),
      ).rejects.toThrow(/Tenant missing not found/);
    });

    it('rejects ARCHIVED tenants', async () => {
      const prisma = new FakePrisma();
      prisma.tenantById.set('archived-1', {
        id: 'archived-1',
        name: 'Old co',
        slug: 'oldco',
        status: 'ARCHIVED',
      });
      const { svc, ctx } = makeService(prisma);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });
      prisma.userById.set('admin-1', {
        id: 'admin-1',
        email: 'admin@omyxia.app',
        name: 'Admin',
      });
      await expect(
        svc.start('archived-1', {
          reasonCode: 'SUPPORT',
          reason: 'hello world',
        }),
      ).rejects.toThrow(/Cannot impersonate ARCHIVED tenant/);
    });

    it('rejects when no actor context is present', async () => {
      const prisma = new FakePrisma();
      prisma.tenantById.set('tenant-1', {
        id: 'tenant-1',
        name: 'Acme',
        slug: 'acme',
        status: 'ACTIVE',
      });
      const { svc, ctx } = makeService(prisma);
      // ctx is undefined by default
      await expect(
        svc.start('tenant-1', {
          reasonCode: 'SUPPORT',
          reason: 'hello world',
        }),
      ).rejects.toThrow(/No authenticated actor/);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });
      // Now the actor is set but the user row is missing:
      await expect(
        svc.start('tenant-1', {
          reasonCode: 'SUPPORT',
          reason: 'hello world',
        }),
      ).rejects.toThrow(/Actor identity not found/);
    });

    it('happy path: mints the JWT, writes an audit row, broadcasts', async () => {
      const prisma = new FakePrisma();
      prisma.tenantById.set('tenant-1', {
        id: 'tenant-1',
        name: 'Acme',
        slug: 'acme',
        status: 'ACTIVE',
      });
      prisma.userById.set('admin-1', {
        id: 'admin-1',
        email: 'admin@omyxia.app',
        name: 'CEO Operator',
      });
      const { svc, ctx, jwt, broadcaster } = makeService(prisma);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });

      const out = await svc.start('tenant-1', {
        reasonCode: 'SUPPORT',
        reason: 'SUP-1234 customer reports duplicated invoice',
      });

      expect(out.session.sessionId).toMatch(/^cu_sess_/);
      expect(out.session.superAdminId).toBe('admin-1');
      expect(out.session.tenantId).toBe('tenant-1');
      expect(out.session.reasonCode).toBe('SUPPORT');
      expect(out.session.reason).toBe('SUP-1234 customer reports duplicated invoice');
      expect(out.session.ttlSeconds).toBe(3600);
      expect(out.accessToken).toMatch(/^signed\.jwt\.admin-1\./);
      expect(jwt.sign).toHaveBeenCalledOnce();
      expect(jwt.lastOptions?.expiresIn).toBe(3600);

      // The audit row metadata carries the structured reasonCode
      // alongside the human-readable reason.
      const auditRows = Array.from(prisma.auditById.values());
      expect(auditRows.length).toBe(1);
      const metadata = auditRows[0].after as any;
      expect(metadata.kind).toBe('IMPERSONATION_START');
      expect(metadata.reasonCode).toBe('SUPPORT');
      expect(metadata.actorAdminId).toBe('admin-1');
      expect(metadata.tenantId).toBe('tenant-1');
      expect(metadata.ttlSeconds).toBe(3600);

      // Broadcast fan-out.
      expect(broadcaster.started.length).toBe(1);
      expect(broadcaster.started[0].sessionId).toBe(out.session.sessionId);
      expect(broadcaster.started[0].tenantSlug).toBe('acme');
    });
  });

  describe('stop', () => {
    it('rejects when the session id is missing', async () => {
      const { svc } = makeService(new FakePrisma());
      await expect(svc.stop('')).rejects.toThrow(/Missing :sessionId/);
    });

    it('rejects unknown sessions', async () => {
      const prisma = new FakePrisma();
      const { svc, ctx } = makeService(prisma);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });
      await expect(svc.stop('does-not-exist')).rejects.toThrow(
        /Session does-not-exist not found/,
      );
    });

    it('is idempotent for an already-ended session', async () => {
      const prisma = new FakePrisma();
      const originalEndedAt = new Date('2026-07-07T07:00:00Z');
      prisma.sessionById.set('sess-1', {
        id: 'sess-1',
        superAdminId: 'admin-1',
        tenantId: 'tenant-1',
        reason: '[SUPPORT] x',
        startedAt: new Date('2026-07-07T06:00:00Z'),
        expiresAt: new Date('2026-07-07T08:00:00Z'),
        endedAt: originalEndedAt,
        auditLogId: 'audit-1',
      });
      const { svc, ctx, broadcaster } = makeService(prisma);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });
      const out = await svc.stop('sess-1');
      expect(out.sessionId).toBe('sess-1');
      expect(out.endedAt).toBe(originalEndedAt.toISOString());
      expect(broadcaster.ended.length).toBe(0);
    });

    it('happy path: writes IMPERSONATION_STOP audit row + broadcasts', async () => {
      const prisma = new FakePrisma();
      prisma.sessionById.set('sess-1', {
        id: 'sess-1',
        superAdminId: 'admin-1',
        tenantId: 'tenant-1',
        reason: '[SUPPORT] x',
        startedAt: new Date('2026-07-07T06:00:00Z'),
        expiresAt: new Date('2026-07-07T08:00:00Z'),
        endedAt: null,
        auditLogId: null,
      });
      const { svc, ctx, broadcaster } = makeService(prisma);
      ctx.set({ userId: 'admin-1', role: 'SUPER_ADMIN', tenantId: 'anchor-1' });
      const out = await svc.stop('sess-1');
      expect(out.sessionId).toBe('sess-1');
      expect(broadcaster.ended.length).toBe(1);
      expect(broadcaster.ended[0].endedReason).toBe('STOPPED');
      const auditRows = Array.from(prisma.auditById.values());
      expect(auditRows.length).toBe(1);
      const metadata = auditRows[0].after as any;
      expect(metadata.kind).toBe('IMPERSONATION_STOP');
      expect(metadata.stoppedByAdminId).toBe('admin-1');
    });
  });

  describe('readSession', () => {
    it('returns null for an empty session id', async () => {
      const { svc } = makeService(new FakePrisma());
      expect(await svc.readSession('')).toBeNull();
    });

    it('returns null for a missing session', async () => {
      const { svc } = makeService(new FakePrisma());
      expect(await svc.readSession('missing')).toBeNull();
    });

    it('returns the wire-shape session for an active row', async () => {
      const prisma = new FakePrisma();
      prisma.sessionById.set('sess-1', {
        id: 'sess-1',
        superAdminId: 'admin-1',
        tenantId: 'tenant-1',
        reason: '[SUPPORT] SUP-1234',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        endedAt: null,
        auditLogId: null,
      });
      prisma.userById.set('admin-1', {
        id: 'admin-1',
        email: 'admin@omyxia.app',
        name: 'Admin',
      });
      prisma.tenantById.set('tenant-1', {
        id: 'tenant-1',
        name: 'Acme',
        slug: 'acme',
      });
      const { svc } = makeService(prisma);
      const out = await svc.readSession('sess-1');
      expect(out?.sessionId).toBe('sess-1');
      expect(out?.reasonCode).toBe('SUPPORT');
      expect(out?.reason).toBe('SUP-1234');
    });

    it('returns null when the session is already ended', async () => {
      const prisma = new FakePrisma();
      prisma.sessionById.set('sess-1', {
        id: 'sess-1',
        superAdminId: 'admin-1',
        tenantId: 'tenant-1',
        reason: '[SUPPORT] x',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        endedAt: new Date(),
        auditLogId: null,
      });
      prisma.userById.set('admin-1', {
        id: 'admin-1',
        email: 'admin@omyxia.app',
        name: 'Admin',
      });
      prisma.tenantById.set('tenant-1', {
        id: 'tenant-1',
        name: 'Acme',
        slug: 'acme',
      });
      const { svc } = makeService(prisma);
      expect(await svc.readSession('sess-1')).toBeNull();
    });
  });

  describe('meFromClaims', () => {
    it('returns null when the impersonation flag is missing', async () => {
      const { svc } = makeService(new FakePrisma());
      const out = await svc.meFromClaims({
        sub: 'a',
        activeTenantId: 't',
        targetTenantId: 't',
        role: 'OWNER',
        originalAdminId: 'a',
        impersonation: false as any,
        impersonationSessionId: 's',
        impersonationReasonCode: 'SUPPORT',
        impersonationReason: 'x',
      });
      expect(out.session).toBeNull();
    });

    it('returns null when the session id claim points at a missing row', async () => {
      const { svc } = makeService(new FakePrisma());
      const out = await svc.meFromClaims({
        sub: 'a',
        activeTenantId: 't',
        targetTenantId: 't',
        role: 'OWNER',
        originalAdminId: 'a',
        impersonation: true,
        impersonationSessionId: 'missing',
        impersonationReasonCode: 'SUPPORT',
        impersonationReason: 'x',
      });
      expect(out.session).toBeNull();
    });

    it('returns the session for an active impersonation token', async () => {
      const prisma = new FakePrisma();
      prisma.sessionById.set('sess-1', {
        id: 'sess-1',
        superAdminId: 'admin-1',
        tenantId: 'tenant-1',
        reason: '[SUPPORT] SUP-1234',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        endedAt: null,
        auditLogId: null,
      });
      prisma.userById.set('admin-1', {
        id: 'admin-1',
        email: 'admin@omyxia.app',
        name: 'Admin',
      });
      prisma.tenantById.set('tenant-1', {
        id: 'tenant-1',
        name: 'Acme',
        slug: 'acme',
      });
      const { svc } = makeService(prisma);
      const out = await svc.meFromClaims({
        sub: 'admin-1',
        activeTenantId: 'tenant-1',
        targetTenantId: 'tenant-1',
        role: 'OWNER',
        originalAdminId: 'admin-1',
        impersonation: true,
        impersonationSessionId: 'sess-1',
        impersonationReasonCode: 'SUPPORT',
        impersonationReason: 'SUP-1234',
      });
      expect(out.session?.sessionId).toBe('sess-1');
      expect(out.session?.reasonCode).toBe('SUPPORT');
      expect(out.session?.reason).toBe('SUP-1234');
    });
  });
});
