/**
 * @RequiresFeature — endpoints opt-in to feature-gating.
 *
 * Wire format:
 *
 *   @RequiresFeature('module.crm')
 *   @Get('pipelines')
 *   listPipelines() { … }
 *
 *   @RequiresFeature('limit.maxEmployees', { max: 25 })
 *   @Post()
 *   createEmployee() { … }
 *
 * Behavior:
 *   - Module/admin keys  → boolean flag check (true ⇒ pass).
 *   - Limit keys         → if `opts.max` is set, ensure limit ≥ opts.max.
 *                          Limit can be `null` (unlimited) which always passes.
 *                          If plan doesn't even have the key → fail.
 *   - On denial          → `FeatureForbiddenException` (403 with
 *                          `code: 'FEATURE_NOT_INCLUDED'` or
 *                          `code: 'FEATURE_LIMIT_EXCEEDED'`).
 *
 * Implementation:
 *   The decorator attaches metadata via `SetMetadata`. The matching
 *   `FeatureGateGuard` reads the metadata, asks
 *   `EntitlementsService.forTenant(tenantId)` for the cached payload,
 *   and applies the boolean / limit rule.
 *
 * The decorator is intentionally side-effect-free at decoration time
 * (only `SetMetadata`). Toggling `soft: true` doesn't change runtime
 *   behaviour here — it's read by the guard.
 */
import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from './feature-catalog';
import type { RequiresFeatureOptions } from './entitlement.types';

export const FEATURE_METADATA_KEY = 'feature-gate:requires';

/**
 * Attach a `requires(feature, options)` rule to a controller method or
 * class. Multiple `@RequiresFeature()` are NOT composed; only the
 * innermost is read by the guard (per Reflector semantics — last
 * decorator wins for a given metadata key).
 *
 * For multi-feature requirements (rare), declare a single
 * `@RequiresFeature()` and have the guard look up each key separately
 * via the metadata list (a future enhancement).
 */
export function RequiresFeature(
  feature: FeatureKey,
  options: RequiresFeatureOptions = {},
): MethodDecorator & ClassDecorator {
  return SetMetadata(FEATURE_METADATA_KEY, { feature, options });
}
