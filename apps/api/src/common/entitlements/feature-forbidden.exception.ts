/**
 * FeatureForbiddenException
 *
 * 403 with a stable, FE-actionable body. The shape is consumed by:
 *
 *   - `apps/admin-console/src/components/entitlements/FeatureGuard.tsx`
 *     (renders the `/upgrade` modal with `currentPlan` / `recommendedPlan`).
 *   - `apps/admin-console/src/app/api/entitlements/me/route.ts` (P3.2 mock).
 *   - The API gateway's response log (status code 403, error.code
 *     `FEATURE_NOT_INCLUDED`).
 *
 * Why a dedicated exception class instead of a plain
 * `new ForbiddenException(...)`?
 *
 *   1.  The 403 body has a STRICT shape (`code`, `feature`, `upgradeUrl`,
 *       etc). The FE upgrade-modal Bus (P3.4) keys off `code` to know
 *       whether to show the upgrade modal vs a generic toast.
 *       Constructing it via a dedicated class keeps the type-checked
 *       payload attached at throw-site.
 *   2.  `instanceof FeatureForbiddenException` lets the test layer
 *       assert on the payload without parsing the response body.
 *
 * NestJS auto-serializes the response because we set `objectBody` on
 * the `HttpException` parent class — the body becomes the response
 * JSON. NestJS wraps it as `{ statusCode, message, ...objectBody }`
 * if we used `.json()` mode, but we use plain object body so it
 * stays unwrapped.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { FeatureForbiddenPayload } from './entitlement.types';

export class FeatureForbiddenException extends HttpException {
  /** Public read-only accessor for the structured payload. */
  readonly payload: FeatureForbiddenPayload;

  constructor(payload: FeatureForbiddenPayload, debugContext?: Record<string, unknown>) {
    super(
      {
        ...payload,
        // Don't leak server-internal keys into the response — but capture
        // them on the exception instance so logging / monitoring can pick
        // them up without needing to parse the body twice.
        ...(debugContext
          ? { __debug: { keys: Object.keys(debugContext), traceId: debugContext.traceId } }
          : {}),
      },
      HttpStatus.FORBIDDEN,
    );
    this.payload = payload;
  }

  /** Convenience for the response-only shape (stripping `__debug`). */
  toClientJson(): FeatureForbiddenPayload {
    return this.payload;
  }
}
