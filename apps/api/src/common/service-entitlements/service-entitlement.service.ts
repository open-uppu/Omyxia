import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  type MicroserviceId,
  type ServiceAccessContext,
  type ServiceAccessDecision,
  type ServicePlanTier,
  type TenantRole,
  SERVICE_FEATURE_MAPPING,
  evaluateServiceAccess,
} from '@omyxia/shared-types';

const REDIS_KEY_PREFIX = 'tenant:';
const REDIS_KEY_SUFFIX = ':entitlements';
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

export const DEFAULT_PLAN_SERVICES: Record<ServicePlanTier, MicroserviceId[]> = {
  FREE: ['core', 'workspace'],
  STARTER: ['core', 'workspace', 'hrm', 'crm'],
  GROWTH: ['core', 'workspace', 'hrm', 'crm', 'erp'],
  PRO: ['core', 'workspace', 'hrm', 'crm', 'erp', 'analytics'],
  ENTERPRISE: ['core', 'workspace', 'hrm', 'crm', 'erp', 'wms', 'analytics', 'governance'],
};

@Injectable()
export class ServiceEntitlementService {
  private readonly logger = new Logger(ServiceEntitlementService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(RedisService) private readonly redis?: RedisService,
  ) {
    const envTtl = Number(process.env.ENTITLEMENT_CACHE_TTL_SECONDS);
    this.ttlSeconds = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_SECONDS;
  }

  cacheKey(tenantId: string): string {
    return `${REDIS_KEY_PREFIX}${tenantId}${REDIS_KEY_SUFFIX}`;
  }

  /**
   * Retrieve effective ServiceAccessContext for a tenant, checking Redis first and
   * falling back to PostgreSQL via Prisma.
   */
  async getAccessContext(
    tenantId: string,
    userContext?: { userId?: string; role?: string },
  ): Promise<ServiceAccessContext> {
    if (!tenantId) {
      return {
        tenantId: '',
        userId: userContext?.userId || 'anonymous',
        role: (userContext?.role as TenantRole) || 'MEMBER',
        planTier: 'FREE',
        entitledServices: ['core'],
        enabledFeatures: [],
        isSuspended: false,
      };
    }

    // 1. Read from Redis cache
    const cached = await this.readFromCache(tenantId).catch((err) => {
      this.logger.warn(
        `Redis read error for tenant=${tenantId}: ${err?.message || err}. Falling back to DB.`,
      );
      return null;
    });

    if (cached) {
      return {
        ...cached,
        userId: userContext?.userId || cached.userId || 'anonymous',
        role: (userContext?.role as TenantRole) || cached.role || 'MEMBER',
      };
    }

    // 2. Load fresh from Database
    const fresh = await this.loadFromDb(tenantId, userContext).catch((err) => {
      this.logger.error(
        `DB read failed for tenant=${tenantId}: ${err?.message || err}. Returning fail-closed context.`,
      );
      return {
        tenantId,
        userId: userContext?.userId || 'anonymous',
        role: (userContext?.role as TenantRole) || 'MEMBER',
        planTier: 'FREE' as ServicePlanTier,
        entitledServices: ['core' as MicroserviceId],
        enabledFeatures: [],
        isSuspended: false,
      };
    });

    // 3. Write back to Redis cache
    await this.writeToCache(tenantId, fresh).catch((err) => {
      this.logger.warn(`Redis write failed for tenant=${tenantId}: ${err?.message || err}`);
    });

    return fresh;
  }

  /**
   * Evaluate whether a tenant access context permits invoking the target microservice.
   * Delegates to pure contract function evaluateServiceAccess.
   */
  evaluate(context: ServiceAccessContext, targetService: MicroserviceId): ServiceAccessDecision {
    return evaluateServiceAccess(context, targetService);
  }

  /**
   * Invalidate tenant entitlements cache in Redis (called on plan update, add-on purchase, suspension).
   */
  async invalidate(tenantId: string): Promise<void> {
    if (!tenantId || !this.redis) return;
    try {
      await this.redis.del(this.cacheKey(tenantId));
      await this.redis.publish('tenant:entitlements:invalidated', tenantId);
    } catch (err: any) {
      this.logger.warn(`Cache invalidation failed for tenant=${tenantId}: ${err?.message || err}`);
    }
  }

  private async readFromCache(tenantId: string): Promise<ServiceAccessContext | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(this.cacheKey(tenantId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ServiceAccessContext;
    } catch {
      await this.redis.del(this.cacheKey(tenantId)).catch(() => undefined);
      return null;
    }
  }

  private async writeToCache(tenantId: string, context: ServiceAccessContext): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(this.cacheKey(tenantId), JSON.stringify(context), this.ttlSeconds);
  }

  private async loadFromDb(
    tenantId: string,
    userContext?: { userId?: string; role?: string },
  ): Promise<ServiceAccessContext> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, plan: true, status: true },
    });

    const isSuspended = tenant?.status === 'SUSPENDED';

    const now = new Date();
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

    // Resolve plan tier
    let planTier: ServicePlanTier = 'FREE';
    const isLegacy = entitlement?.plan?.tier === 'LEGACY_FULL_ACCESS';

    if (entitlement?.plan?.tier) {
      const rawTier = entitlement.plan.tier;
      if (rawTier === 'ENTERPRISE' || rawTier === 'LEGACY_FULL_ACCESS') {
        planTier = 'ENTERPRISE';
      } else if (rawTier === 'PRO') {
        planTier = 'PRO';
      } else {
        planTier = 'FREE';
      }
    } else if (tenant?.plan) {
      if (tenant.plan === 'ENTERPRISE') planTier = 'ENTERPRISE';
      else if (tenant.plan === 'GROWTH') planTier = 'GROWTH';
      else if (tenant.plan === 'STARTER') planTier = 'STARTER';
    }

    // Collect enabled features
    const enabledFeaturesSet = new Set<string>();
    if (entitlement?.plan?.features) {
      for (const f of entitlement.plan.features) {
        if (f.enabled) enabledFeaturesSet.add(f.featureKey);
      }
    }

    // Add-on slugs & features
    const addOnSlugs = entitlement?.addOns.map((a) => a.addOn.slug.toLowerCase()) || [];
    for (const slug of addOnSlugs) {
      enabledFeaturesSet.add(`ADDON_${slug.toUpperCase()}`);
    }

    // Entitled services calculation
    const entitledServicesSet = new Set<MicroserviceId>();

    if (isLegacy) {
      const allServices: MicroserviceId[] = [
        'core',
        'hrm',
        'erp',
        'crm',
        'wms',
        'workspace',
        'analytics',
        'governance',
      ];
      allServices.forEach((s) => entitledServicesSet.add(s));
    } else {
      // Default tier services
      const tierDefaults = DEFAULT_PLAN_SERVICES[planTier] || ['core', 'workspace'];
      tierDefaults.forEach((s) => entitledServicesSet.add(s));

      // Add-on unlocked services
      for (const slug of addOnSlugs) {
        if (slug === 'erp' || slug.includes('erp')) entitledServicesSet.add('erp');
        if (slug === 'hrm' || slug.includes('hrm')) entitledServicesSet.add('hrm');
        if (slug === 'crm' || slug.includes('crm')) entitledServicesSet.add('crm');
        if (slug === 'wms' || slug.includes('wms')) entitledServicesSet.add('wms');
        if (slug === 'analytics' || slug.includes('bi')) entitledServicesSet.add('analytics');
        if (slug === 'governance') entitledServicesSet.add('governance');
      }

      // Feature-flag matching check
      for (const [svc, feats] of Object.entries(SERVICE_FEATURE_MAPPING) as [MicroserviceId, string[]][]) {
        if (feats.some((f) => enabledFeaturesSet.has(f))) {
          entitledServicesSet.add(svc);
        }
      }
    }

    return {
      tenantId,
      userId: userContext?.userId || 'anonymous',
      role: (userContext?.role as TenantRole) || 'MEMBER',
      planTier,
      entitledServices: Array.from(entitledServicesSet),
      enabledFeatures: Array.from(enabledFeaturesSet),
      isSuspended,
    };
  }
}
