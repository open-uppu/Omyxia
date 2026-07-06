/**
 * apps/api/src/modules/admin/tenants-admin.service.spec.ts
 *
 * P1.4 — Vitest spec for TenantsAdminService.
 *
 * Strategy:
 *   - Mock PrismaService with a hand-rolled fake (no `@prisma/client`
 *     runtime needed for these unit tests).
 *   - Verify each helper in isolation:
 *       - `buildWhere` — q, plan (legacy mapping), status, region, OR semantics
 *       - `list` — pagination, total echo, generatedAt ISO timestamp,
 *                  empty-tenant fast path, aggregate aggregation per row,
 *                  plan/status mapping, region/domain null handling
 *       - `legacyPlanToWire` — covered indirectly via the row shape tests
 *
 * The fake PrismaService implements just the surface that `list`
 * touches (`tenant.findMany`, `tenant.count`, `userTenant.groupBy`,
 * `fileItem.groupBy`, `auditLog.groupBy`).
 */

import { describe, it, expect, vi } from 'vitest';
import { TenantsAdminService } from './tenants-admin.service';
import {
  ADMIN_TENANT_PAGE_SIZE,
  parseAdminTenantFilters,
  type AdminTenantFilter,
} from '@omyxia/shared-types';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * Hand-rolled fake of PrismaService for unit-testing the listing path.
 * Records the most recent `where` clause passed to `tenant.findMany` /
 * `tenant.count` so tests can assert on the filter behaviour, and
 * returns deterministic rows from the `tenantsByQuery` map.
 */
class FakePrisma {
  tenants: Array<{
    id: string;
    slug: string;
    name: string;
    domain: string | null;
    plan: string;
    status: string;
    region: string | null;
    createdAt: Date;
  }> = [];
  userTenantCounts = new Map<string, number>();
  fileItemSums = new Map<string, bigint>();
  auditTenantMax = new Map<string, Date>();
  auditTargetMax = new Map<string, Date>();

  // Last calls captured for assertions.
  lastFindManyWhere: unknown = undefined;
  lastCountWhere: unknown = undefined;
  lastFindManySkip: number | undefined = undefined;
  lastFindManyTake: number | undefined = undefined;

  tenant = {
    findMany: vi.fn(async (args: { where?: unknown; skip?: number; take?: number }) => {
      this.lastFindManyWhere = args.where;
      this.lastFindManySkip = args.skip;
      this.lastFindManyTake = args.take;
      // Return up to `take` matching rows.
      return this.tenants
        .filter((t) => this.matches(t, args.where))
        .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? this.tenants.length));
    }),
    count: vi.fn(async (args: { where?: unknown }) => {
      this.lastCountWhere = args.where;
      return this.tenants.filter((t) => this.matches(t, args.where)).length;
    }),
  };

  userTenant = {
    groupBy: vi.fn(async () => {
      return Array.from(this.userTenantCounts.entries()).map(([tenantId, count]) => ({
        tenantId,
        _count: { _all: count },
      }));
    }),
  };

  fileItem = {
    groupBy: vi.fn(async () => {
      return Array.from(this.fileItemSums.entries()).map(([tenantId, size]) => ({
        tenantId,
        _sum: { size },
      }));
    }),
  };

  auditLog = {
    groupBy: vi.fn(async (args: { by: string[]; where?: { tenantId?: { in: string[] }; targetTenantId?: { in: string[] } } }) => {
      const by = args.by[0];
      const source = by === 'tenantId' ? this.auditTenantMax : this.auditTargetMax;
      const ids = (by === 'tenantId' ? args.where?.tenantId?.in : args.where?.targetTenantId?.in) ?? [];
      return Array.from(source.entries())
        .filter(([tid]) => ids.includes(tid))
        .map(([tenantId, ts]) => ({
          [by]: tenantId,
          _max: { createdAt: ts },
        }));
    }),
  };

  private matches(
    t: { name: string; domain: string | null; plan: string; status: string; region: string | null },
    where: any,
  ): boolean {
    if (!where) return true;
    if (where.OR) {
      const needle = where.OR[0]?.name?.contains;
      if (needle) {
        if (!t.name.includes(needle) && !(t.domain ?? '').includes(needle)) return false;
      }
    }
    if (where.status?.in && !where.status.in.includes(t.status)) return false;
    if (where.plan?.in && !where.plan.in.includes(t.plan)) return false;
    if (where.region?.in && !where.region.in.includes(t.region)) return false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(prisma: FakePrisma) {
  return new TenantsAdminService(prisma as any);
}

function makeFilter(overrides: Partial<AdminTenantFilter> = {}): AdminTenantFilter {
  return parseAdminTenantFilters(new URLSearchParams(''));
}

const FIXED_TENANTS = [
  {
    id: 't_acme',
    slug: 'acme',
    name: 'Acme Co',
    domain: 'acme.example.com',
    plan: 'STARTER',
    status: 'ACTIVE',
    region: 'eu',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: 't_beta',
    slug: 'beta',
    name: 'Beta Industries',
    domain: null,
    plan: 'GROWTH',
    status: 'ACTIVE',
    region: null,
    createdAt: new Date('2026-02-15T00:00:00Z'),
  },
  {
    id: 't_gamma',
    slug: 'gamma',
    name: 'Gamma Corp',
    domain: 'gamma.example.com',
    plan: 'ENTERPRISE',
    status: 'SUSPENDED',
    region: 'us',
    createdAt: new Date('2026-03-10T00:00:00Z'),
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantsAdminService', () => {
  describe('list', () => {
    it('returns the documented envelope shape for an empty table', async () => {
      const prisma = new FakePrisma();
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      expect(res.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(res.items).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.skip).toBe(0);
      expect(res.take).toBe(ADMIN_TENANT_PAGE_SIZE);
      expect(res.filters).toEqual({
        q: '',
        plan: [],
        status: [],
        region: [],
        page: 1,
        pageSize: ADMIN_TENANT_PAGE_SIZE,
      });
    });

    it('maps legacy DB plan STARTER/GROWTH/ENTERPRISE -> FREE/PRO/ENTERPRISE', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      expect(res.items.map((i) => i.plan)).toEqual(['FREE', 'PRO', 'ENTERPRISE']);
    });

    it('maps domain NULL -> "" and region NULL -> ""', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
      expect(byId['t_acme'].domain).toBe('acme.example.com');
      expect(byId['t_beta'].domain).toBe(''); // null -> ''
      expect(byId['t_beta'].region).toBe(''); // null -> ''
      expect(byId['t_acme'].region).toBe('eu');
    });

    it('aggregates user_count from UserTenant.groupBy', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      prisma.userTenantCounts.set('t_acme', 17);
      prisma.userTenantCounts.set('t_beta', 4);
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
      expect(byId['t_acme'].users).toBe(17);
      expect(byId['t_beta'].users).toBe(4);
      expect(byId['t_gamma'].users).toBe(0); // no map entry -> 0
    });

    it('aggregates storage_bytes from FileItem.groupBy as a Number', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      prisma.fileItemSums.set('t_acme', BigInt(2 * 1024 * 1024 * 1024)); // 2 GiB
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
      expect(byId['t_acme'].storageBytes).toBe(2 * 1024 * 1024 * 1024);
      expect(byId['t_beta'].storageBytes).toBe(0);
    });

    it('falls back to createdAt when AuditLog is empty for a tenant', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
      expect(byId['t_acme'].lastActivityAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('uses AuditLog.tenantId max for lastActivityAt', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      prisma.auditTenantMax.set('t_acme', new Date('2026-06-01T12:00:00Z'));
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
      expect(byId['t_acme'].lastActivityAt).toBe('2026-06-01T12:00:00.000Z');
    });

    it('uses AuditLog.targetTenantId max for lastActivityAt (cross-tenant admin actions)', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      prisma.auditTargetMax.set('t_acme', new Date('2026-07-01T08:00:00Z'));
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
      expect(byId['t_acme'].lastActivityAt).toBe('2026-07-01T08:00:00.000Z');
    });

    it('paginates via skip/take', async () => {
      const prisma = new FakePrisma();
      // 30 tenants total, page=2, pageSize=10 -> skip=10, take=10
      prisma.tenants = Array.from({ length: 30 }, (_, i) => ({
        id: `t_${i}`,
        slug: `slug-${i}`,
        name: `Tenant ${i}`,
        domain: null,
        plan: 'STARTER',
        status: 'ACTIVE',
        region: null,
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      }));
      const svc = makeService(prisma);
      const filters = parseAdminTenantFilters(new URLSearchParams('page=2&pageSize=10'));
      const res = await svc.list(filters);
      expect(res.skip).toBe(10);
      expect(res.take).toBe(10);
      expect(res.items.length).toBe(10);
      expect(res.total).toBe(30);
      expect(prisma.lastFindManySkip).toBe(10);
      expect(prisma.lastFindManyTake).toBe(10);
    });

    it('echoes the resolved filters in the response', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      const svc = makeService(prisma);
      const filters = parseAdminTenantFilters(
        new URLSearchParams('q=acme&plan=PRO&status=ACTIVE&region=eu&page=2&pageSize=50'),
      );
      const res = await svc.list(filters);
      expect(res.filters).toEqual(filters);
    });
  });

  describe('buildWhere', () => {
    it('returns an empty where for default filters', () => {
      const svc = makeService(new FakePrisma());
      expect(svc.buildWhere(makeFilter())).toEqual({});
    });

    it('translates plan FREE -> STARTER (legacy DB enum)', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(new URLSearchParams('plan=FREE'));
      const where = svc.buildWhere(filters);
      expect(where.plan).toEqual({ in: ['STARTER'] });
    });

    it('translates plan PRO -> GROWTH', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(new URLSearchParams('plan=PRO'));
      const where = svc.buildWhere(filters);
      expect(where.plan).toEqual({ in: ['GROWTH'] });
    });

    it('translates plan ENTERPRISE -> ENTERPRISE', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(new URLSearchParams('plan=ENTERPRISE'));
      const where = svc.buildWhere(filters);
      expect(where.plan).toEqual({ in: ['ENTERPRISE'] });
    });

    it('union-translates a multi-plan filter', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(
        new URLSearchParams('plan=FREE,PRO,ENTERPRISE'),
      );
      const where = svc.buildWhere(filters);
      expect((where.plan as { in: string[] }).in.sort()).toEqual(
        ['ENTERPRISE', 'GROWTH', 'STARTER'].sort(),
      );
    });

    it('passes status filter through verbatim', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(
        new URLSearchParams('status=ACTIVE,SUSPENDED'),
      );
      const where = svc.buildWhere(filters);
      expect(where.status).toEqual({ in: ['ACTIVE', 'SUSPENDED'] });
    });

    it('passes region filter through verbatim', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(new URLSearchParams('region=eu,us'));
      const where = svc.buildWhere(filters);
      expect(where.region).toEqual({ in: ['eu', 'us'] });
    });

    it('adds OR(name, domain) when q is non-empty', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(new URLSearchParams('q=acme'));
      const where = svc.buildWhere(filters);
      expect(where.OR).toEqual([
        { name: { contains: 'acme', mode: 'default' } },
        { domain: { contains: 'acme', mode: 'default' } },
      ]);
    });

    it('combines q + plan + status + region into one where', () => {
      const svc = makeService(new FakePrisma());
      const filters = parseAdminTenantFilters(
        new URLSearchParams('q=acme&plan=PRO&status=ACTIVE&region=eu'),
      );
      const where = svc.buildWhere(filters);
      expect(where.OR).toBeDefined();
      expect(where.plan).toEqual({ in: ['GROWTH'] });
      expect(where.status).toEqual({ in: ['ACTIVE'] });
      expect(where.region).toEqual({ in: ['eu'] });
    });
  });

  describe('row-shape guarantees (FE wire format)', () => {
    it('every field is present + typed (no `undefined`)', async () => {
      const prisma = new FakePrisma();
      prisma.tenants = [...FIXED_TENANTS];
      const svc = makeService(prisma);
      const res = await svc.list(makeFilter());
      for (const row of res.items) {
        expect(row.id).toBeTypeOf('string');
        expect(row.slug).toBeTypeOf('string');
        expect(row.name).toBeTypeOf('string');
        expect(typeof row.domain).toBe('string'); // may be ''
        expect(['FREE', 'PRO', 'ENTERPRISE']).toContain(row.plan);
        expect(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).toContain(row.status);
        expect(typeof row.region).toBe('string'); // may be ''
        expect(row.users).toBeTypeOf('number');
        expect(row.storageBytes).toBeTypeOf('number');
        expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(row.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });
  });
});