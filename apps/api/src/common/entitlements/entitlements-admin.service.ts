/**
 * EntitlementsAdminService — transactional plan / add-on mutations
 * for the admin console.
 *
 * P3.3 contract: every code path that mutates a tenant's effective
 * entitlements MUST go through this service so that:
 *
 *   1. The Prisma writes happen in a single transaction (no half-updates
 *      if the DB drops between `update Plan` and `update addOns`).
 *   2. `EntitlementsService.invalidate()` is called exactly once per
 *      mutation, with the right `reason` so FE clients can render a
 *      meaningful toast ("your plan was upgraded", "an add-on was
 *      enabled", "the workspace was suspended", …).
 *   3. The Redis pub/sub fan-out and WebSocket push run automatically
 *      via the existing invalidation pipeline — no separate
 *      `notifyClients()` plumbing needed.
 *
 * Why a separate service rather than adding methods to
 * `EntitlementsService`?
 *   - `EntitlementsService` is the read-side (Redis cache + DB
 *     materialiser). Mixing reads + transactional writes there would
 *     bloat its responsibilities.
 *   - The admin endpoints (controllers) sit in the same module
 *     (`FeatureGateModule`) but should be testable independently of
 *     the read cache.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from './entitlements.service';

export interface ChangePlanInput {
  /** Target tenant. */
  tenantId: string;
  /** Target plan id (UUID from `Plan.id`). */
  planId: string;
  /** Optional effectiveAt override. Defaults to `now`. */
  effectiveAt?: Date;
  /** Optional expiry. Defaults to null (no expiry). */
  expiresAt?: Date | null;
  /**
   * Acting super-admin user id. Stored on the new entitlement row for
   * audit trail (column may not exist yet — see P5.2 work).
   */
  actorUserId?: string;
}

export interface SetAddOnsInput {
  tenantId: string;
  /**
   * Add-on slugs to attach. Replaces any existing add-on set on the
   * current entitlement row. Pass an empty array to clear all.
   */
  addOnSlugs: string[];
  actorUserId?: string;
}

export interface SuspendTenantInput {
  tenantId: string;
  reason: string;
  actorUserId?: string;
}

@Injectable()
export class EntitlementsAdminService {
  private readonly logger = new Logger(EntitlementsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Move a tenant to a new plan.
   *
   * Implementation:
   *   - Verifies plan exists.
   *   - Looks up the most recent `TenantEntitlement` row for the tenant
   *     (the one the cache read path uses) and, if found, updates its
   *     `planId` + `effectiveAt`. Otherwise creates a fresh row with
   *     `effectiveAt = now`.
   *   - Invalidates the cache with reason='plan-change', source='admin'.
   *
   * Returns the updated (or newly-created) `TenantEntitlement` row.
   */
  async changePlan(input: ChangePlanInput) {
    const { tenantId, planId, effectiveAt, expiresAt } = input;
    if (!tenantId) throw new BadRequestException('tenantId is required');
    if (!planId) throw new BadRequestException('planId is required');

    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found`);
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const now = effectiveAt ?? new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenantEntitlement.findFirst({
        where: { tenantId },
        orderBy: { effectiveAt: 'desc' },
        select: { id: true },
      });
      if (existing) {
        return tx.tenantEntitlement.update({
          where: { id: existing.id },
          data: {
            planId,
            effectiveAt: now,
            expiresAt: expiresAt ?? null,
          },
          include: {
            plan: { include: { features: true } },
            addOns: { include: { addOn: true } },
          },
        });
      }
      return tx.tenantEntitlement.create({
        data: {
          tenantId,
          planId,
          effectiveAt: now,
          expiresAt: expiresAt ?? null,
        },
        include: {
          plan: { include: { features: true } },
          addOns: { include: { addOn: true } },
        },
      });
    });

    await this.entitlements.invalidate(tenantId, {
      reason: 'plan-change',
      source: 'admin',
    });

    this.logger.log(
      `changePlan tenant=${tenantId} → planId=${planId} (tier=${plan.tier}) actor=${input.actorUserId ?? 'unknown'}`,
    );
    return updated;
  }

  /**
   * Replace the add-on set on a tenant's current entitlement.
   *
   * Looks up the add-on rows by slug; throws `NotFoundException` if any
   * slug is unknown so the admin UI can surface a clear error rather
   * than silently dropping unknown slugs.
   */
  async setAddOns(input: SetAddOnsInput) {
    const { tenantId, addOnSlugs } = input;
    if (!tenantId) throw new BadRequestException('tenantId is required');
    if (!Array.isArray(addOnSlugs)) {
      throw new BadRequestException('addOnSlugs must be an array');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    const addOns = addOnSlugs.length
      ? await this.prisma.addOn.findMany({
          where: { slug: { in: addOnSlugs } },
          select: { id: true, slug: true },
        })
      : [];
    const foundSlugs = new Set(addOns.map((a) => a.slug));
    const missing = addOnSlugs.filter((s) => !foundSlugs.has(s));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Unknown add-on(s): ${missing.join(', ')}`,
      );
    }

    const entitlement = await this.prisma.tenantEntitlement.findFirst({
      where: { tenantId },
      orderBy: { effectiveAt: 'desc' },
      select: { id: true },
    });
    if (!entitlement) {
      throw new BadRequestException(
        `Tenant ${tenantId} has no entitlement row; call changePlan() first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tenantEntitlementAddOn.deleteMany({
        where: { entitlementId: entitlement.id },
      });
      if (addOns.length > 0) {
        await tx.tenantEntitlementAddOn.createMany({
          data: addOns.map((a) => ({
            entitlementId: entitlement.id,
            addOnId: a.id,
          })),
        });
      }
    });

    await this.entitlements.invalidate(tenantId, {
      reason: 'addon-change',
      source: 'admin',
    });

    this.logger.log(
      `setAddOns tenant=${tenantId} → [${addOnSlugs.join(', ')}] actor=${input.actorUserId ?? 'unknown'}`,
    );
    return { tenantId, addOnSlugs };
  }

  /**
   * Suspend a tenant by flipping `Tenant.status = 'SUSPENDED'`.
   *
   * Note: P3.3 does NOT change the entitlement row itself — the FE will
   * see the cached payload still allow features until the next refresh
   * (TTL). The invalidation we emit closes that window to seconds:
   * once the WS event lands, the admin console / workspace re-fetch
   * `/api/entitlements/me`, and the suspended status is reflected via
   * the existing `TENANT_SUSPENDED` middleware (P1.6).
   */
  async suspendTenant(input: SuspendTenantInput) {
    const { tenantId, reason } = input;
    if (!tenantId) throw new BadRequestException('tenantId is required');
    if (!reason) throw new BadRequestException('reason is required');

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'SUSPENDED' },
      select: { id: true, status: true },
    });

    await this.entitlements.invalidate(tenantId, {
      reason: 'tenant-suspend',
      source: 'admin',
    });

    this.logger.warn(
      `suspendTenant tenant=${tenantId} reason=${reason} actor=${input.actorUserId ?? 'unknown'}`,
    );
    return tenant;
  }

  /**
   * Resume a suspended tenant.
   */
  async resumeTenant(tenantId: string, actorUserId?: string) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    await this.entitlements.invalidate(tenantId, {
      reason: 'tenant-resume',
      source: 'admin',
    });
    this.logger.log(
      `resumeTenant tenant=${tenantId} actor=${actorUserId ?? 'unknown'}`,
    );
    return tenant;
  }
}