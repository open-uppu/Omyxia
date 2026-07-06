/**
 * Tests for EntitlementsAdminService (P3.3).
 *
 * Strategy: a tiny in-memory Prisma stub that captures transactional
 * intent (we don't run the real DB — the goal is to verify the
 * service's control flow: which Prisma calls happen, in what order,
 * and whether `EntitlementsService.invalidate()` is called with the
 * right `{reason, source}`).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntitlementsAdminService } from './entitlements-admin.service';

type Row = Record<string, unknown> & { id: string };

class InMemoryPrisma {
  public tenants: Map<string, Row> = new Map();
  public plans: Map<string, Row> = new Map();
  public addOns: Map<string, Row> = new Map();
  public entitlements: Map<string, Row> = new Map();
  /** key: `${entId}::${addOnId}` → Row */
  public entAddOns: Map<string, Row> = new Map();

  constructor() {
    // Seed minimal fixtures.
    this.tenants.set('t-1', { id: 't-1', slug: 'acme', name: 'Acme', status: 'ACTIVE' });
    this.tenants.set('t-2', { id: 't-2', slug: 'globex', name: 'Globex', status: 'ACTIVE' });
    this.plans.set('plan-pro', { id: 'plan-pro', name: 'PRO', tier: 'PRO' });
    this.plans.set('plan-enterprise', {
      id: 'plan-enterprise',
      name: 'ENTERPRISE',
      tier: 'ENTERPRISE',
    });
    this.addOns.set('sso', { id: 'addon-sso', slug: 'sso', name: 'SSO' });
    this.addOns.set('audit', { id: 'addon-audit', slug: 'audit', name: 'Audit' });
    this.entitlements.set('ent-1', {
      id: 'ent-1',
      tenantId: 't-1',
      planId: 'plan-pro',
      effectiveAt: new Date('2026-01-01'),
    });
  }

  // The Prisma service exposes `$transaction` and per-model methods.
  // We forward per-model calls to a "tx" namespace so that operations
  // running inside a transaction are the same as operations running
  // outside (the row maps are shared).
  public $transaction = async <T>(fn: (tx: InMemoryPrisma) => Promise<T>): Promise<T> => fn(this);

  tenant = {
    findUnique: async ({ where }: { where: { id: string } }) => this.tenants.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const t = this.tenants.get(where.id);
      if (!t) throw new Error('tenant not found');
      Object.assign(t, data);
      return t;
    },
  };

  plan = {
    findUnique: async ({ where }: { where: { id: string } }) => this.plans.get(where.id) ?? null,
  };

  addOn = {
    findMany: async ({ where }: { where: { slug: { in: string[] } } }) => {
      const inSet = new Set(where.slug.in);
      return Array.from(this.addOns.values()).filter((a) => inSet.has(a.slug as string));
    },
  };

  tenantEntitlement = {
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: { tenantId: string };
      orderBy?: { effectiveAt: 'asc' | 'desc' };
    }) => {
      const matches = Array.from(this.entitlements.values())
        .filter((e) => e.tenantId === where.tenantId)
        .sort((a, b) => {
          const aT = (a.effectiveAt as Date).getTime();
          const bT = (b.effectiveAt as Date).getTime();
          return orderBy?.effectiveAt === 'desc' ? bT - aT : aT - bT;
        });
      return matches[0] ?? null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `ent-${this.entitlements.size + 1}`;
      const row = { id, ...data } as Row;
      this.entitlements.set(id, row);
      return { ...row, plan: { features: [] }, addOns: [] };
    },
    update: async ({
      where,
      data,
      include,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: unknown;
    }) => {
      const e = this.entitlements.get(where.id);
      if (!e) throw new Error('entitlement not found');
      Object.assign(e, data);
      return { ...e, plan: { features: [] }, addOns: [] };
    },
  };

  tenantEntitlementAddOn = {
    deleteMany: async ({ where }: { where: { entitlementId: string } }) => {
      let n = 0;
      for (const k of Array.from(this.entAddOns.keys())) {
        if (this.entAddOns.get(k)!.entitlementId === where.entitlementId) {
          this.entAddOns.delete(k);
          n += 1;
        }
      }
      return { count: n };
    },
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      for (const d of data) {
        const id = `ea-${this.entAddOns.size + 1}`;
        this.entAddOns.set(`${d.entitlementId}::${d.addOnId}`, { id, ...d });
      }
      return { count: data.length };
    },
  };
}

class FakeEntitlements {
  public readonly invalidations: Array<{ tenantId: string; reason: string; source: string }> = [];
  async invalidate(
    tenantId: string,
    opts: { reason?: string; source?: string } = {},
  ): Promise<void> {
    this.invalidations.push({
      tenantId,
      reason: opts.reason ?? 'manual',
      source: opts.source ?? 'admin',
    });
  }
}

describe('EntitlementsAdminService', () => {
  let prisma: InMemoryPrisma;
  let ent: FakeEntitlements;
  let svc: EntitlementsAdminService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    ent = new FakeEntitlements();
    svc = new EntitlementsAdminService(
      prisma as unknown as ConstructorParameters<typeof EntitlementsAdminService>[0],
      ent as unknown as ConstructorParameters<typeof EntitlementsAdminService>[1],
    );
  });

  describe('changePlan()', () => {
    it('updates an existing entitlement row and invalidates with reason=plan-change', async () => {
      const result = await svc.changePlan({
        tenantId: 't-1',
        planId: 'plan-enterprise',
        actorUserId: 'u-99',
      });
      expect(result.id).toBe('ent-1');
      expect(prisma.entitlements.get('ent-1')!.planId).toBe('plan-enterprise');
      expect(ent.invalidations).toEqual([
        { tenantId: 't-1', reason: 'plan-change', source: 'admin' },
      ]);
    });

    it('creates a new entitlement row if none exists, and invalidates', async () => {
      const result = await svc.changePlan({ tenantId: 't-2', planId: 'plan-pro' });
      expect(result.id).toBe('ent-2');
      expect(prisma.entitlements.get('ent-2')!.tenantId).toBe('t-2');
      expect(ent.invalidations).toEqual([
        { tenantId: 't-2', reason: 'plan-change', source: 'admin' },
      ]);
    });

    it('rejects an unknown plan', async () => {
      await expect(
        svc.changePlan({ tenantId: 't-1', planId: 'plan-nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an unknown tenant', async () => {
      await expect(
        svc.changePlan({ tenantId: 't-nope', planId: 'plan-pro' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects missing tenantId or planId', async () => {
      await expect(
        svc.changePlan({ tenantId: '', planId: 'plan-pro' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.changePlan({ tenantId: 't-1', planId: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('setAddOns()', () => {
    it('replaces the add-on set on the existing entitlement and invalidates with reason=addon-change', async () => {
      prisma.entAddOns.set('ent-1::addon-sso', {
        id: 'ea-1',
        entitlementId: 'ent-1',
        addOnId: 'addon-sso',
      });
      const result = await svc.setAddOns({
        tenantId: 't-1',
        addOnSlugs: ['audit'],
        actorUserId: 'u-9',
      });
      expect(result).toEqual({ tenantId: 't-1', addOnSlugs: ['audit'] });
      // The old sso add-on was replaced by audit.
      expect(prisma.entAddOns.size).toBe(1);
      expect(prisma.entAddOns.has('ent-1::addon-audit')).toBe(true);
      expect(prisma.entAddOns.has('ent-1::addon-sso')).toBe(false);
      expect(ent.invalidations).toEqual([
        { tenantId: 't-1', reason: 'addon-change', source: 'admin' },
      ]);
    });

    it('clears all add-ons when given an empty array', async () => {
      prisma.entAddOns.set('ent-1::addon-sso', {
        id: 'ea-1',
        entitlementId: 'ent-1',
        addOnId: 'addon-sso',
      });
      const result = await svc.setAddOns({ tenantId: 't-1', addOnSlugs: [] });
      expect(result.addOnSlugs).toEqual([]);
      expect(prisma.entAddOns.size).toBe(0);
      expect(ent.invalidations).toEqual([
        { tenantId: 't-1', reason: 'addon-change', source: 'admin' },
      ]);
    });

    it('rejects an unknown add-on slug', async () => {
      await expect(
        svc.setAddOns({ tenantId: 't-1', addOnSlugs: ['sso', 'unknown-addon'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when the tenant has no entitlement row', async () => {
      await expect(
        svc.setAddOns({ tenantId: 't-2', addOnSlugs: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('suspendTenant() + resumeTenant()', () => {
    it('flips status to SUSPENDED and invalidates with reason=tenant-suspend', async () => {
      const result = await svc.suspendTenant({
        tenantId: 't-1',
        reason: 'abuse',
        actorUserId: 'u-99',
      });
      expect(result.status).toBe('SUSPENDED');
      expect(ent.invalidations).toEqual([
        { tenantId: 't-1', reason: 'tenant-suspend', source: 'admin' },
      ]);
    });

    it('rejects when reason is missing', async () => {
      await expect(
        svc.suspendTenant({ tenantId: 't-1', reason: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('flips status back to ACTIVE and invalidates with reason=tenant-resume', async () => {
      await svc.suspendTenant({ tenantId: 't-1', reason: 'abuse' });
      ent.invalidations.length = 0;
      const result = await svc.resumeTenant('t-1', 'u-99');
      expect(result.status).toBe('ACTIVE');
      expect(ent.invalidations).toEqual([
        { tenantId: 't-1', reason: 'tenant-resume', source: 'admin' },
      ]);
    });
  });

  it('cooperates with EntitlementsService.invalidate() — every mutating call invalidates exactly once', async () => {
    // Spy on the invalidate function to count calls.
    const spy = vi.spyOn(ent, 'invalidate');
    await svc.changePlan({ tenantId: 't-1', planId: 'plan-enterprise' });
    await svc.setAddOns({ tenantId: 't-1', addOnSlugs: ['sso'] });
    await svc.suspendTenant({ tenantId: 't-1', reason: 'test' });
    await svc.resumeTenant('t-1');
    expect(spy).toHaveBeenCalledTimes(4);
  });
});