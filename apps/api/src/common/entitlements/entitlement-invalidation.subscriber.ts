/**
 * EntitlementInvalidationSubscriber — Redis pub/sub consumer for the
 * `entitlement:invalidate` channel.
 *
 * Lifecycle:
 *   - `onModuleInit()`  opens the Redis subscription via `RedisService.subscribe()`.
 *   - `onModuleDestroy()` calls the unsubscribe handle so the shared
 *     subscriber connection can be torn down cleanly.
 *
 * Per-message flow (P3.3 contract):
 *   1. Parse the JSON payload (`EntitlementInvalidationMessage`).
 *      Malformed payloads are logged and dropped — we never throw out of
 *      the subscriber loop because that would stop subsequent messages.
 *   2. Drop the local Redis cache entry for the tenant. Idempotent: a
 *      missing key is not an error.
 *   3. Forward to `RealtimeGateway.broadcastEntitlementInvalidation(...)`
 *      so every socket.io client in the affected `tenant:<id>` room
 *      receives an `entitlements:invalidated` event and re-fetches
 *      `/api/entitlements/me`.
 *
 * Multi-instance semantics:
 *   - Every API replica runs this subscriber. A plan change published by
 *     instance A is fanned out by every replica's gateway to the same
 *     tenant room — so the FE sees exactly one event per publish
 *     (the per-instance room emit is de-duplicated because socket.io
 *     namespaces are per-replica).
 *   - The Redis `del` step runs on every replica too, which is the
 *     whole point: it ensures no replica serves a stale cache entry
 *     for the next request after the invalidation.
 *
 * Why a separate module-side service?
 *   - Keeping it inside `FeatureGateModule` ensures the subscriber boots
 *     before any controller can issue a `EntitlementsService.invalidate()`
 *     call (Nest module init order: providers before controllers).
 *   - It also keeps the dependency graph clean: the subscriber needs
 *     `RedisService` (already imported via `RedisModule`) +
 *     `RealtimeGateway` (already provided by `RealtimeModule`, which
 *     is @Global).
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  ENTITLEMENT_CACHE_KEY_PREFIX,
  ENTITLEMENT_INVALIDATE_CHANNEL,
  type EntitlementInvalidationMessage,
} from './entitlement-invalidation.types';

@Injectable()
export class EntitlementInvalidationSubscriber
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EntitlementInvalidationSubscriber.name);
  private unsubscribe: (() => Promise<void>) | null = null;

  /** Counter of messages processed; useful in tests + ops dashboards. */
  private messagesHandled = 0;
  private messagesSkipped = 0;
  private messagesFailed = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.redis.subscribe(
        ENTITLEMENT_INVALIDATE_CHANNEL,
        (raw) => {
          // Use void + catch so a synchronous throw doesn't kill the
          // shared subscriber's message router (which would silently
          // stop ALL channels on this connection).
          this.handleMessage(raw).catch((err) => {
            this.messagesFailed += 1;
            this.logger.error(
              `handleMessage threw for raw=${JSON.stringify(raw)}: ${(err as Error).message}`,
            );
          });
        },
      );
      this.logger.log(
        `subscribed to ${ENTITLEMENT_INVALIDATE_CHANNEL} (lifecycle-bound, idempotent unsubscribe on shutdown)`,
      );
    } catch (err) {
      // Don't crash boot — the app should still come up so the rest of
      // the entitlements API works. Local eviction on the publisher side
      // still happens; only the multi-replica fan-out is degraded.
      this.logger.error(
        `failed to subscribe to ${ENTITLEMENT_INVALIDATE_CHANNEL}: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.unsubscribe) {
      try {
        await this.unsubscribe();
      } catch (err) {
        this.logger.warn(
          `unsubscribe from ${ENTITLEMENT_INVALIDATE_CHANNEL} failed: ${(err as Error).message}`,
        );
      } finally {
        this.unsubscribe = null;
      }
    }
  }

  /**
   * Test seam: stats for the message router. Read-only.
   */
  stats(): {
    handled: number;
    skipped: number;
    failed: number;
  } {
    return {
      handled: this.messagesHandled,
      skipped: this.messagesSkipped,
      failed: this.messagesFailed,
    };
  }

  /**
   * Per-message handler — public for unit testing.
   *
   * Always resolves; never throws. Errors are captured into the stats
   * counter and logged.
   */
  async handleMessage(raw: string): Promise<void> {
    const message = this.parse(raw);
    if (!message) {
      this.messagesSkipped += 1;
      return;
    }

    if (!message.tenantId || typeof message.tenantId !== 'string') {
      this.messagesSkipped += 1;
      this.logger.warn(
        `dropping invalid message (missing tenantId): ${raw.slice(0, 200)}`,
      );
      return;
    }

    // Step 1: drop the Redis cache entry.
    try {
      await this.redis.del(this.cacheKey(message.tenantId));
    } catch (err) {
      // Don't fail the WS broadcast — the next read will simply reload
      // a fresh entry from the DB.
      this.logger.warn(
        `Redis del failed during invalidation for tenant=${message.tenantId}: ${(err as Error).message}`,
      );
    }

    // Step 2: fan-out to the tenant's WS room.
    try {
      this.gateway.broadcastEntitlementInvalidation(message);
    } catch (err) {
      this.messagesFailed += 1;
      this.logger.error(
        `WS broadcast failed for tenant=${message.tenantId}: ${(err as Error).message}`,
      );
      return;
    }

    this.messagesHandled += 1;
    this.logger.debug?.(
      `invalidation handled tenant=${message.tenantId} reason=${message.reason} source=${message.source} nonce=${message.nonce}`,
    );
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private cacheKey(tenantId: string): string {
    return `${ENTITLEMENT_CACHE_KEY_PREFIX}${tenantId}`;
  }

  private parse(raw: string): EntitlementInvalidationMessage | null {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      // Light validation — unknown fields are tolerated for forward-compat.
      const candidate: EntitlementInvalidationMessage = {
        tenantId: typeof obj.tenantId === 'string' ? obj.tenantId : '',
        reason: typeof obj.reason === 'string' ? obj.reason : 'unknown',
        source:
          obj.source === 'admin' ||
          obj.source === 'stripe-webhook' ||
          obj.source === 'system' ||
          obj.source === 'manual'
            ? obj.source
            : 'manual',
        at: typeof obj.at === 'string' ? obj.at : new Date().toISOString(),
        nonce: typeof obj.nonce === 'number' && Number.isFinite(obj.nonce)
          ? obj.nonce
          : 0,
      };
      return candidate;
    } catch (err) {
      this.logger.warn(
        `dropping unparseable message: ${raw.slice(0, 200)} — ${(err as Error).message}`,
      );
      return null;
    }
  }

  // Re-export for tests that want to assert the cache key format.
  static cacheKeyFor(tenantId: string): string {
    return `${ENTITLEMENT_CACHE_KEY_PREFIX}${tenantId}`;
  }

  // Re-export for tests that want to assert the channel name.
  static channel(): string {
    return ENTITLEMENT_INVALIDATE_CHANNEL;
  }

  // Re-export for tests that want to validate payload shape.
  static makePayload(
    partial: Partial<EntitlementInvalidationMessage>,
  ): EntitlementInvalidationMessage {
    return {
      tenantId: partial.tenantId ?? '',
      reason: partial.reason ?? 'manual',
      source: partial.source ?? 'manual',
      at: partial.at ?? new Date(0).toISOString(),
      nonce: partial.nonce ?? 0,
    };
  }
}