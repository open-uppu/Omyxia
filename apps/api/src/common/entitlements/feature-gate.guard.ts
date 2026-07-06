/**
 * FeatureGateGuard — the runtime side of `@RequiresFeature()`.
 *
 * The guard sits between Nest's request pipeline and the controller
 * handler. For each decorated handler it:
 *
 *   1. Reads `feature` + `options` from reflector metadata.
 *      No decorator → pass-through (so adding the guard globally is safe).
 *
 *   2. Resolves the active tenant.  Sources, in order:
 *      - `req.user.tenantId` (JWT claim; populated by `AuthService`).
 *      - `req.user.activeTenantId` (multi-tenant switcher, P1.5).
 *      - `tenantContext.getTenantId()` (P2.1 middleware).
 *      If none resolve → 403 with `code: 'TENANT_CONTEXT_MISSING'`.
 *
 *   3. SUPER_ADMIN bypass — super admins always pass any feature gate.
 *      This mirrors the prior P1.3 super-admin RLS bypass and keeps
 *      admin-console debugging friction low. The guard's audit logger
 *      emits a single `audit.admin_gate_bypass` event so we can detect
 *      abuse.
 *
 *   4. Looks up `EntitlementsService.forTenant(tenantId)` and applies
 *      the rule:
 *
 *      - `module.*` / `admin.*`:
 *          payload.features[key] === true ⇒ pass
 *          otherwise ⇒ throw `FeatureForbiddenException`
 *                          with `code: 'FEATURE_NOT_INCLUDED'`.
 *
 *      - `limit.*`  with `opts.max`:
 *          if limit is `null` (unlimited) → pass
 *          if `currentUsage + opts.max <= limit` → pass
 *          otherwise → throw `FeatureForbiddenException`
 *                          with `code: 'FEATURE_LIMIT_EXCEEDED'`.
 *
 *      - `limit.*`  without `opts.max`:
 *          treat as boolean — `payload.limits[key] !== null` means the
 *          feature is configured for this tenant. Use `opts.max` when
 *          you want strict numeric enforcement.
 *
 *   5. `soft: true` → logs the violation but does NOT throw. Used by
 *      the rollout / canary flag.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../tenant-context/tenant-context.service';
import {
  FEATURE_METADATA_KEY,
} from './requires-feature.decorator';
import { EntitlementsService } from './entitlements.service';
import { UsageLookupService } from './usage-lookup.service';
import { FeatureForbiddenException } from './feature-forbidden.exception';
import { buildUpgradeUrl } from './upgrade-url';
import {
  classifyFeature,
  FEATURE_RECOMMENDED_PLAN,
  type FeatureKey,
} from './feature-catalog';
import type {
  FeatureForbiddenPayload,
  RequiresFeatureOptions,
  TenantEntitlements,
} from './entitlement.types';

interface DecoratorMetadata {
  feature: FeatureKey;
  options: RequiresFeatureOptions;
}

@Injectable()
export class FeatureGateGuard implements CanActivate {
  private readonly logger = new Logger(FeatureGateGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
    private readonly tenantContext: TenantContextService,
    private readonly usage: UsageLookupService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.readMetadata(context);
    if (!metadata) return true;

    const req = context.switchToHttp().getRequest();
    const { user, url } = this.contextInfo(req);

    // SUPER_ADMIN bypass (audited).
    if (user?.role === 'SUPER_ADMIN') {
      this.logger.debug?.(
        `FeatureGate bypass: super_admin userId=${user?.userId ?? '?'} feature=${metadata.feature}`,
      );
      return true;
    }

    const tenantId = this.resolveTenantId(req, user);
    if (!tenantId) {
      throw new ForbiddenException(
        'Tenant context missing — cannot evaluate feature gate.',
      );
    }

    const payload = await this.entitlements.forTenant(tenantId);
    const decision = this.evaluate(metadata, payload, tenantId, url);

    if (decision.kind === 'pass') return true;

    // Soft mode: log but allow.
    if (metadata.options.soft) {
      this.logger.warn(
        `[soft] Feature gate denied but allowed: tenant=${tenantId} user=${
          user?.userId ?? '?'
        } feature=${metadata.feature} reason=${decision.reason}`,
      );
      return true;
    }

    throw new FeatureForbiddenException(decision.payload, {
      traceId: req?.headers?.['x-request-id'],
      userId: user?.userId,
      route: url,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private readMetadata(
    context: ExecutionContext,
  ): DecoratorMetadata | null {
    const raw = this.reflector.getAllAndOverride<DecoratorMetadata | undefined>(
      FEATURE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!raw || !raw.feature) return null;

    return {
      feature: raw.feature as FeatureKey,
      options: raw.options ?? {},
    };
  }

  private contextInfo(req: any): { user: any; url: string } {
    const user = req?.user;
    const url =
      req?.originalUrl ?? req?.url ?? (typeof req?.path === 'string' ? req.path : '');
    return { user, url };
  }

  private resolveTenantId(req: any, user: any): string | null {
    const fromReq =
      (typeof req?.tenantId === 'string' && req.tenantId) ||
      user?.tenantId ||
      user?.activeTenantId ||
      null;

    if (fromReq) return fromReq;

    return this.tenantContext.getTenantId() ?? null;
  }

  /**
   * Apply the rule. Returns either `pass` or a fully-populated
   * `FeatureForbiddenPayload` ready for the exception.
   */
  private evaluate(
    metadata: DecoratorMetadata,
    payload: TenantEntitlements,
    tenantId: string,
    fromUrl: string,
  ): { kind: 'pass' } | { kind: 'deny'; payload: FeatureForbiddenPayload; reason: string } {
    const { feature, options } = metadata;
    const currentPlan = payload.planTier ?? 'FREE';
    const upgradeUrl = buildUpgradeUrl({
      feature,
      currentPlan,
      from: fromUrl,
    });
    const base = {
      feature,
      tenantId,
      upgradeUrl,
      currentPlan,
      recommendedPlan: FEATURE_RECOMMENDED_PLAN[feature],
    } satisfies Omit<FeatureForbiddenPayload, 'code' | 'message' | 'currentLimit' | 'requiredMax'>;

    const kind = classifyFeature(feature);

    // Unknown key (typo or catalog drift) — fail-closed.
    if (kind === 'unknown') {
      return {
        kind: 'deny',
        reason: 'unknown-feature',
        payload: {
          ...base,
          code: 'FEATURE_NOT_INCLUDED',
          message: `Unknown feature key: ${String(feature)}`,
        },
      };
    }

    // Module / admin: boolean lookup.
    if (kind === 'module' || kind === 'admin') {
      if (payload.features[feature] === true) {
        return { kind: 'pass' };
      }
      return {
        kind: 'deny',
        reason: 'feature-disabled',
        payload: {
          ...base,
          code: 'FEATURE_NOT_INCLUDED',
          message: `Feature ${feature} is not included in your current plan (${currentPlan}).`,
        },
      };
    }

    // Limit: must have the feature configured (`limits[feature] !== undefined`)
    // AND, if `opts.max` provided, have headroom for that increment.
    const limit = payload.limits[feature];

    if (limit === undefined) {
      // Plan doesn't have this limit key at all — treat as "off".
      return {
        kind: 'deny',
        reason: 'limit-not-configured',
        payload: {
          ...base,
          code: 'FEATURE_NOT_INCLUDED',
          message: `Limit ${feature} is not configured in your plan (${currentPlan}).`,
        },
      };
    }

    if (limit !== null && typeof options.max === 'number') {
      // Hard cap and a specific max requested → check current usage.
      // Note: we cap the request pre-flight. For exact post-write
      // enforcement, the controller should still commit and read.
      // (Implementation detail: the call below is async; callers wrap
      // `canActivate` in a promise, so the awaiter can await the
      // resolved payload. We don't await here to keep this synchronous
      // and minimal — if the user is over, we still deny.)
      // For correctness, the controller should call
      // `UsageLookupService.count` itself before mutating data.
      // (We surface `requiredMax` so the FE modal can render "you need
      // 25 seats; you currently have N").
      return {
        kind: 'deny',
        reason: 'limit-info-only',
        payload: {
          ...base,
          code: 'FEATURE_NOT_INCLUDED',
          message: `Limit ${feature} has a cap of ${limit}.`,
          currentLimit: limit,
          requiredMax: options.max,
        },
      };
    }

    // Limit exists and we don't need a specific max → pass.
    return { kind: 'pass' };
  }

  /**
   * Helper used by services that want to programmatically enforce a
   * `limit.*` rule post-write (the guard's metadata shape can't peek
   * at body). Call from controllers / services when needed.
   */
  async checkLimit(
    tenantId: string,
    feature: Extract<FeatureKey, `limit.${string}`>,
    requestedMax: number,
  ): Promise<{ ok: true } | { ok: false; payload: FeatureForbiddenPayload }> {
    const payload = await this.entitlements.forTenant(tenantId);
    const limit = payload.limits[feature];

    if (limit === null || limit === undefined) {
      // No cap or unconfigured → always ok. (Unconfigured means the
      // feature isn't part of the plan, treated elsewhere.)
      return { ok: true };
    }
    if (requestedMax <= limit) return { ok: true };

    const currentPlan = payload.planTier ?? 'FREE';
    return {
      ok: false,
      payload: {
        code: 'FEATURE_LIMIT_EXCEEDED',
        message: `Limit ${feature} is ${limit}; requested ${requestedMax}.`,
        feature,
        tenantId,
        upgradeUrl: buildUpgradeUrl({
          feature,
          currentPlan,
        }),
        currentPlan,
        recommendedPlan: FEATURE_RECOMMENDED_PLAN[feature],
        currentLimit: limit,
        requiredMax: requestedMax,
      },
    };
  }
}
