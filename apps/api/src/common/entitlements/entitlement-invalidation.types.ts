/**
 * Shared types + constants for the entitlement invalidation pipeline (P3.3).
 *
 * Lives in its own file to avoid a circular import between
 *   - entitlements.service.ts   (publishes on the channel)
 *   - entitlement-invalidation.subscriber.ts (subscribes to the channel)
 *
 * Anything that needs the channel name or the message shape should
 * import from here.
 */

/**
 * Canonical Redis channel that publishes "this tenant's entitlements
 * changed" events. Every API instance subscribes to this channel and
 * drops its local + Redis cache on receipt, then fans-out an
 * `entitlements:invalidated` WebSocket event to the affected tenant
 * room so connected clients can refresh their UI.
 *
 * Channel name is intentionally singular + imperative (per the P3.3
 * card spec); the legacy `entitlements:invalidated` (plural + past
 * tense) channel from the P3.1 prototype is no longer emitted.
 */
export const ENTITLEMENT_INVALIDATE_CHANNEL = 'entitlement:invalidate';

/** Cache key shape used by `EntitlementsService`. */
export const ENTITLEMENT_CACHE_KEY_PREFIX = 'entitlements:v1:';

/**
 * Shape of a single message published on the
 * `entitlement:invalidate` Redis channel.
 *
 * Kept narrow on purpose — subscribers (the entitlement subscriber,
 * future webhook handlers, …) should not be tempted to parse
 * arbitrary blobs.
 */
export interface EntitlementInvalidationMessage {
  /** Tenant whose entitlement cache should be evicted. */
  tenantId: string;
  /**
   * Free-form short reason. Suggested values:
   *   - 'manual'           — super_admin pressed the "invalidate" button.
   *   - 'plan-change'      — admin changed a tenant's plan tier.
   *   - 'addon-change'     — admin added/removed an add-on.
   *   - 'tenant-suspend'   — kill-switch flipped on the tenant.
   *   - 'stripe-webhook'   — subscription.updated / deleted landed.
   *   - 'cache-evict'      — periodic cache cleanup.
   */
  reason: string;
  /** Where the publish originated. */
  source: 'admin' | 'stripe-webhook' | 'system' | 'manual';
  /** ISO timestamp the message was published. */
  at: string;
  /**
   * Monotonic per-(tenantId, instance) counter. Resets on process restart,
   * which is acceptable — a restart implies a fresh in-process cache.
   * FE clients use this to detect out-of-order events.
   */
  nonce: number;
}