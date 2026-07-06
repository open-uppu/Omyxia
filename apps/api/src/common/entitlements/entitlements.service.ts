/**
 * EntitlementsService — read-through Redis cache for `TenantEntitlements`.
 *
 * Reads follow this order:
 *
 *   1. Redis: `entitlements:v1:{tenantId}`  (TTL 5 min by default).
 *   2. Postgres: join of `TenantEntitlement` (current/effective) +
 *      `Plan` + `PlanFeature` + `TenantEntitlementAddOn` + `AddOn`.
 *   3. Cache the freshly-built payload back into Redis with TTL.
 *
 * If both fail (Redis down + DB error), we return a "deny-all" payload
 * (`features: {}`, `limits: {}`, `plan: 'FREE'`) so the guard defaults
 * to fail-closed. This is the safer side — we'd rather wrongly deny a
 * user than wrongly grant access when entitlements are unknown.
 *
 * Why 5-minute TTL?
 *   - The admin side of the system (super_admin) can change a tenant's
 *     plan via the admin console. The 5-minute window bounds the worst-
 *     case lag between an upgrade and the new feature becoming available.
 *   - Super-admins can also call `invalidate(tenantId)` to manually
 *     evict; the `entitlements:invalidated` pub/sub channel is used by
 *     other API instances to evict their local cache too.
 *
 * Cache key format (v1 versioned so we can bump the payload schema
 * later without colliding):
 *   `entitlements:v1:<tenantId>`
 *
 * Future-proofing:
 *   - When P3.3 caches the `GET /api/entitlements/me` payload format,
 *     the cache key version can stay `v1` because the payload shape
 *     matches `TenantEntitlements` (only slightly enriched for the FE).
 *   - When P3.5 introduces per-tenant entropy, payload can include a
 *     `nonce` field for cache busting on impersonation switches.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { TenantEntitlements } from './entitlement.types';

const CACHE_KEY_PREFIX = 'entitlements:v1:';
const DEFAULT_TTL_SECONDS = 5 * 60;

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    const envTtl = Number(process.env.ENTITLEMENT_CACHE_TTL_SECONDS);
    this.ttlSeconds = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_SECONDS;
  }

  /**
   * Read the effective entitlements for a tenant.
   *
   * Always resolves — never throws. On full failure returns a deny-all
   * sentinel. Hits the cache first, then the DB.
   */
  async forTenant(tenantId: string): Promise<TenantEntitlements> {
    if (!tenantId) {
      return this.denyAll(tenantId, 'missing-tenant');
    }

    const cached = await this.readFromCache(tenantId).catch((err) => {
      this.logger.warn(
        `Redis read failed for tenant=${tenantId}; falling back to DB. ${err?.message ?? err}`,
      );
      return null;
    });
    if (cached) return cached;

    const fresh = await this.loadFromDb(tenantId).catch((err) => {
      this.logger.error(
        `DB read failed for tenant=${tenantId}; returning deny-all. ${err?.message ?? err}`,
      );
      return this.denyAll(tenantId, 'db-error');
    });

    // Skip caching deny-all sentinels so a transient outage self-heals.
    if (fresh.planTier !== null) {
      await this.writeToCache(tenantId, fresh).catch((err) => {
        this.logger.warn(
          `Redis write failed for tenant=${tenantId}. ${err?.message ?? err}`,
        );
      });
    }

    return fresh;
  }

  /**
   * Manually evict a tenant's cached payload.
   * Called from the admin-tenant-suspend / plan-change flows so the
   * change is visible within seconds instead of after the TTL.
   */
  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(tenantId));
    } catch (err) {
      this.logger.warn(
        `Redis del failed for tenant=${tenantId}. ${err?.message ?? err}`,
      );
    }
    // Pub/sub so other API replicas evict their in-process copies too.
    try {
      await this.redis.publish('entitlements:invalidated', tenantId);
    } catch (err) {
      // Publish failure is non-fatal — local eviction already happened.
      this.logger.debug?.(
        `Redis pub entitlements:invalidated failed for tenant=${tenantId}. ${err?.message ?? err}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private cacheKey(tenantId: string): string {
    return `${CACHE_KEY_PREFIX}${tenantId}`;
  }

  private async readFromCache(tenantId: string): Promise<TenantEntitlements | null> {
    const raw = await this.redis.get(this.cacheKey(tenantId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TenantEntitlements;
    } catch {
      // Corrupt payload — drop the entry and let the DB populate a fresh one.
      await this.redis.del(this.cacheKey(tenantId)).catch(() => undefined);
      return null;
    }
  }

  private async writeToCache(
    tenantId: string,
    payload: TenantEntitlements,
  ): Promise<void> {
    await this.redis.set(
      this.cacheKey(tenantId),
      JSON.stringify(payload),
      this.ttlSeconds,
    );
  }

  /**
   * Build the payload from Postgres.
   *
   *   Plan tier mapping (admin-visible — kept in lockstep with P1.2 seed):
   *     FREE         → no modules except auth + minimal
   *     PRO          → most modules, capped limits
   *     ENTERPRISE   → everything, unlimited
   *     LEGACY_FULL_ACCESS → all features, no limits enforced
   *                            (grandfathered — surfaced for audit only).
   */
  private async loadFromDb(tenantId: string): Promise<TenantEntitlements> {
    const now = new Date();

    // Latest effective entitlement that hasn't already expired.
    const entitlement = await this.prisma.tenantEntitlement.findFirst({
      where: {
        tenantId,
        effectiveAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { effectiveAt: 'desc' },
      include: {
        plan: {
          include: { features: true },
        },
        addOns: {
          include: { addOn: true },
        },
      },
    });

    // Tenant without a plan yet → deny-all sentinel.
    if (!entitlement) {
      return this.denyAll(tenantId, 'no-entitlement');
    }

    const planTier = entitlement.plan.tier;
    const isLegacy = planTier === 'LEGACY_FULL_ACCESS';

    // Build a flat features / limits map. Unknown keys default to false / null.
    const features: Record<string, boolean> = {};
    const limits: Record<string, number | null> = {};

    for (const f of entitlement.plan.features) {
      features[f.featureKey] = f.enabled;
      if (f.limit !== null) limits[f.featureKey] = f.limit;
    }

    // LEGACY_FULL_ACCESS pretend everything's enabled. Useful when the
    // plan matrix didn't yet exist when a tenant signed up.
    if (isLegacy) {
      for (const key of [
        'module.crm',
        'module.hr',
        'module.erp',
        'module.bi',
        'module.reports',
        'module.storage',
        'module.email',
        'module.chat',
        'module.documents',
        'module.projects',
        'module.marketing',
        'module.backup',
        'module.endpoint',
        'module.itsm',
        'module.srm',
        'module.fms',
        'module.frm',
        'module.mas',
        'module.wms',
      ]) {
        features[key] = true;
      }
    }

    // Add-ons: a slug match enables `addon.<slug>` markers. The guard
    // doesn't read them today but the FE /upgrade page filters by them.
    const addOns = entitlement.addOns.map((e) => e.addOn.slug);

    return {
      tenantId,
      planId: entitlement.planId,
      planTier,
      effectiveAt: entitlement.effectiveAt.toISOString(),
      expiresAt: entitlement.expiresAt ? entitlement.expiresAt.toISOString() : null,
      features,
      limits,
      addOns,
      generatedAt: now.toISOString(),
    };
  }

  private denyAll(tenantId: string, _reason: string): TenantEntitlements {
    return {
      tenantId: tenantId || '',
      planId: null,
      planTier: null,
      effectiveAt: new Date(0).toISOString(),
      expiresAt: null,
      features: {},
      limits: {},
      addOns: [],
      generatedAt: new Date().toISOString(),
    };
  }
}
