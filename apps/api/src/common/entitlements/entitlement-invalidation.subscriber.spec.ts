/**
 * Tests for EntitlementInvalidationSubscriber (P3.3).
 *
 * Strategy: build a stub `RedisService` whose `subscribe()` captures the
 * callback, then exercise `handleMessage()` directly. We do NOT spin up
 * the full Nest module graph — this keeps the test fast and isolated
 * (the subscriber's only public side-effect is `gateway.broadcast…` +
 * `redis.del`).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { EntitlementInvalidationSubscriber } from './entitlement-invalidation.subscriber';
import type { EntitlementInvalidationMessage } from './entitlement-invalidation.types';

interface RouterEntry {
  channel: string;
  cb: (raw: string) => void;
}

class FakeRedis {
  public readonly routes: RouterEntry[] = [];
  public readonly deletedKeys: string[] = [];
  /** Simulated subscribe failure flag (set per test). */
  public subscribeFails: Error | null = null;

  async subscribe(
    channel: string,
    cb: (raw: string) => void,
  ): Promise<() => Promise<void>> {
    if (this.subscribeFails) throw this.subscribeFails;
    this.routes.push({ channel, cb });
    return async () => {
      this.routes.splice(
        this.routes.findIndex((r) => r === this.routes[this.routes.length - 1]),
        1,
      );
    };
  }

  async del(key: string): Promise<number> {
    this.deletedKeys.push(key);
    return 1;
  }
}

class FakeGateway {
  public readonly broadcasts: EntitlementInvalidationMessage[] = [];
  public throwOnBroadcast: Error | null = null;

  broadcastEntitlementInvalidation(payload: EntitlementInvalidationMessage) {
    if (this.throwOnBroadcast) throw this.throwOnBroadcast;
    this.broadcasts.push(payload);
    return true;
  }
}

function makeMessage(over: Partial<EntitlementInvalidationMessage> = {}): EntitlementInvalidationMessage {
  return {
    tenantId: 't-1',
    reason: 'plan-change',
    source: 'admin',
    at: '2026-07-06T10:00:00.000Z',
    nonce: 1,
    ...over,
  };
}

describe('EntitlementInvalidationSubscriber', () => {
  let redis: FakeRedis;
  let gateway: FakeGateway;
  let sub: EntitlementInvalidationSubscriber;

  beforeEach(() => {
    redis = new FakeRedis();
    gateway = new FakeGateway();
    sub = new EntitlementInvalidationSubscriber(
      redis as unknown as ConstructorParameters<typeof EntitlementInvalidationSubscriber>[0],
      gateway as unknown as ConstructorParameters<typeof EntitlementInvalidationSubscriber>[1],
    );
  });

  describe('lifecycle', () => {
    it('subscribes to entitlement:invalidate on init and unsubscribes on destroy', async () => {
      await sub.onModuleInit();
      expect(redis.routes).toHaveLength(1);
      expect(redis.routes[0].channel).toBe('entitlement:invalidate');
      await sub.onModuleDestroy();
      // onModuleDestroy nulls the handle but the route is removed by the
      // returned closure.
      expect(sub['unsubscribe']).toBeNull();
    });

    it('does NOT throw when init subscription fails (defensive boot)', async () => {
      redis.subscribeFails = new Error('redis down');
      await expect(sub.onModuleInit()).resolves.not.toThrow();
      expect(redis.routes).toHaveLength(0);
    });

    it('is idempotent on destroy when never initialised', async () => {
      await expect(sub.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('handleMessage()', () => {
    it('parses a valid JSON message, deletes the cache key, and broadcasts to the gateway', async () => {
      await sub.onModuleInit();
      const msg = makeMessage();
      await sub.handleMessage(JSON.stringify(msg));

      expect(redis.deletedKeys).toEqual(['entitlements:v1:t-1']);
      expect(gateway.broadcasts).toEqual([msg]);
      expect(sub.stats()).toEqual({ handled: 1, skipped: 0, failed: 0 });
    });

    it('counts malformed JSON as skipped, not failed', async () => {
      await sub.onModuleInit();
      await sub.handleMessage('not-json');
      await sub.handleMessage('');
      await sub.handleMessage('{"unrelated":1}');

      expect(redis.deletedKeys).toEqual([]);
      expect(gateway.broadcasts).toEqual([]);
      expect(sub.stats()).toEqual({ handled: 0, skipped: 3, failed: 0 });
    });

    it('counts messages missing tenantId as skipped', async () => {
      await sub.onModuleInit();
      await sub.handleMessage(JSON.stringify({ reason: 'manual' }));

      expect(redis.deletedKeys).toEqual([]);
      expect(gateway.broadcasts).toEqual([]);
      expect(sub.stats()).toEqual({ handled: 0, skipped: 1, failed: 0 });
    });

    it('coerces unknown source values to "manual"', async () => {
      await sub.onModuleInit();
      const msg = { ...makeMessage(), source: 'who-knows' as unknown as 'admin' };
      await sub.handleMessage(JSON.stringify(msg));

      expect(gateway.broadcasts[0].source).toBe('manual');
    });

    it('still broadcasts when redis.del throws (best-effort cache eviction)', async () => {
      await sub.onModuleInit();
      vi.spyOn(redis, 'del').mockRejectedValueOnce(new Error('redis down'));
      const msg = makeMessage({ tenantId: 't-2' });
      await sub.handleMessage(JSON.stringify(msg));

      // Even though del threw, the WS broadcast went out.
      expect(gateway.broadcasts).toEqual([msg]);
      expect(sub.stats().handled).toBe(1);
    });

    it('counts broadcast failure as failed, does not advance handled counter', async () => {
      await sub.onModuleInit();
      gateway.throwOnBroadcast = new Error('ws down');
      const msg = makeMessage();
      await sub.handleMessage(JSON.stringify(msg));

      expect(gateway.broadcasts).toEqual([]);
      expect(sub.stats()).toEqual({ handled: 0, skipped: 0, failed: 1 });
    });

    it('routes messages through the subscription callback end-to-end', async () => {
      await sub.onModuleInit();
      expect(redis.routes).toHaveLength(1);

      // Replay a real publish via the captured callback to prove the
      // wiring (init → subscribe → handleMessage) is correct.
      const msg = makeMessage({ nonce: 42 });
      redis.routes[0].cb(JSON.stringify(msg));

      // Give the .catch microtask a tick to settle.
      await new Promise((r) => setImmediate(r));

      expect(redis.deletedKeys).toEqual(['entitlements:v1:t-1']);
      expect(gateway.broadcasts[0].nonce).toBe(42);
    });

    it('does not crash the subscription router when handleMessage throws', async () => {
      await sub.onModuleInit();

      // First message — broadcast throws; the router must stay alive
      // and the second message must still be processed.
      gateway.throwOnBroadcast = new Error('boom');
      redis.routes[0].cb(JSON.stringify(makeMessage({ tenantId: 't-bad' })));
      await new Promise((r) => setImmediate(r));

      // Gateway recovers. Second message should still flow through.
      gateway.throwOnBroadcast = null;
      const msg = makeMessage({ tenantId: 't-after-error' });
      redis.routes[0].cb(JSON.stringify(msg));
      await new Promise((r) => setImmediate(r));

      // The bad message was processed up to (and including) the
      // cache del (which runs before the broadcast), so its key
      // is in the list. The after-error message is the one that
      // actually went end-to-end.
      expect(redis.deletedKeys).toEqual([
        'entitlements:v1:t-bad',
        'entitlements:v1:t-after-error',
      ]);
      expect(gateway.broadcasts).toEqual([msg]);
    });
  });

  describe('static helpers', () => {
    it('cacheKeyFor(tenantId) follows the canonical v1 key shape', () => {
      expect(EntitlementInvalidationSubscriber.cacheKeyFor('xyz')).toBe(
        'entitlements:v1:xyz',
      );
    });
    it('channel() returns the published channel name', () => {
      expect(EntitlementInvalidationSubscriber.channel()).toBe(
        'entitlement:invalidate',
      );
    });
    it('makePayload() fills in sensible defaults', () => {
      const p = EntitlementInvalidationSubscriber.makePayload({ tenantId: 'a' });
      expect(p).toMatchObject({
        tenantId: 'a',
        reason: 'manual',
        source: 'manual',
        nonce: 0,
      });
      expect(typeof p.at).toBe('string');
    });
  });
});