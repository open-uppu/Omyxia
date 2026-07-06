import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * RedisService — single shared connection + dedicated subscriber connection.
 *
 * Connection layout (P3.3 cleanup):
 *
 *   - `client`        — used for normal command traffic (get/set/del/pub/…).
 *                       Cannot be used for SUBSCRIBE — once a connection is in
 *                       subscribe-mode it can no longer issue regular commands.
 *   - `subscriber`    — a separate connection created lazily on the first
 *                       `subscribe(channel, cb)` call. Owns all SUBSCRIBE state.
 *                       Multiple channels share the same subscriber connection
 *                       so we don't fan out to N Redis fds.
 *
 * Why a single subscriber?  Previously every `subscribe(channel, cb)` call
 * did `client.duplicate()` which leaked one connection per subscribe. With
 * P3.3 the entitlement service subscribes long-lived, so a leaked fd per
 * redeploy would have been a real leak.
 *
 * Lifecycle:
 *   - `onModuleInit()`   opens `client` and connects.
 *   - `onModuleDestroy()` closes both `client` and `subscriber`.
 *   - `subscribe()` is idempotent — duplicate subscriptions for the same
 *     channel add a new callback to the existing listener list. The same
 *     Redis SUBSCRIBE command is only issued once per channel.
 *   - `unsubscribe()` removes a single callback and the Redis UNSUBSCRIBE
 *     command fires only when the last callback for that channel leaves.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private subscriber: Redis | null = null;

  /**
   * channel → Set<callback>. Keeps track of registered message callbacks per
   * channel so multiple services can subscribe to the same channel without
   * each opening their own Redis connection.
   */
  private readonly channelCallbacks = new Map<string, Set<(message: string) => void>>();

  /** Set of channels currently SUBSCRIBE-d on the shared subscriber connection. */
  private readonly subscribedChannels = new Set<string>();

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      lazyConnect: true,
    });

    this.client.on('error', (err) => {
      this.logger.error(`[Redis] Connection error: ${err.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log('[Redis] Connected');
    });

    try {
      await this.client.connect();
    } catch (err) {
      this.logger.error(`[Redis] Failed to connect: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    try {
      if (this.subscriber) {
        await this.subscriber.quit().catch(() => undefined);
        this.subscriber = null;
      }
    } finally {
      this.channelCallbacks.clear();
      this.subscribedChannels.clear();
      if (this.client) {
        await this.client.quit().catch(() => undefined);
      }
    }
  }

  getClient(): Redis {
    return this.client;
  }

  // -----------------------------------------------------------------------
  // Command helpers
  // -----------------------------------------------------------------------

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (ttlSeconds) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  // -----------------------------------------------------------------------
  // Subscribe / Unsubscribe (P3.3 lifecycle-aware)
  // -----------------------------------------------------------------------

  /**
   * Subscribe to a Redis pub/sub channel.
   *
   * - Idempotent: calling subscribe('foo', cbA) then subscribe('foo', cbB)
   *   results in BOTH callbacks receiving each message. Only one Redis
   *   SUBSCRIBE command is issued.
   * - The shared subscriber connection is created lazily on first use.
   * - Returns an `unsubscribe()` function that, when called, removes the
   *   callback. The Redis UNSUBSCRIBE command fires only when the last
   *   callback for the channel leaves.
   *
   * Throws if called after `onModuleDestroy()` (subscriber is gone).
   */
  async subscribe(
    channel: string,
    callback: (message: string) => void,
  ): Promise<() => Promise<void>> {
    if (!this.channelCallbacks.has(channel)) {
      this.channelCallbacks.set(channel, new Set());
    }
    const callbacks = this.channelCallbacks.get(channel)!;
    callbacks.add(callback);

    if (!this.subscribedChannels.has(channel)) {
      await this.ensureSubscriberConnection();
      await this.subscriber!.subscribe(channel);
      this.subscribedChannels.add(channel);
    }

    return async () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.channelCallbacks.delete(channel);
        if (this.subscriber && this.subscribedChannels.has(channel)) {
          await this.subscriber.unsubscribe(channel).catch((err) => {
            this.logger.warn(
              `[Redis] unsubscribe(${channel}) failed: ${(err as Error).message}`,
            );
          });
          this.subscribedChannels.delete(channel);
        }
      }
    };
  }

  /**
   * Ensure the shared subscriber connection exists and the message router
   * is wired. Called lazily on the first `subscribe()` invocation.
   *
   * The router fans incoming messages out to every registered callback for
   * the channel. A throw in one callback does not block the others — each
   * callback runs inside its own try/catch and errors are logged.
   */
  private async ensureSubscriberConnection(): Promise<void> {
    if (this.subscriber) return;

    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.subscriber = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      lazyConnect: true,
    });

    this.subscriber.on('error', (err) => {
      this.logger.error(`[Redis subscriber] ${err.message}`);
    });

    this.subscriber.on('message', (ch: string, msg: string) => {
      const callbacks = this.channelCallbacks.get(ch);
      if (!callbacks) return;
      for (const cb of callbacks) {
        try {
          cb(msg);
        } catch (err) {
          this.logger.error(
            `[Redis subscriber] callback for ${ch} threw: ${(err as Error).message}`,
          );
        }
      }
    });

    try {
      await this.subscriber.connect();
    } catch (err) {
      this.logger.error(
        `[Redis subscriber] connect failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}