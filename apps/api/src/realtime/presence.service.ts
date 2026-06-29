import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';
import { ServerEventNames, PresenceUpdatePayload, RoomNames } from './events';

const PRESENCE_TTL = 60; // seconds
const HEARTBEAT_INTERVAL = 30; // seconds

@Injectable()
export class PresenceService implements OnModuleInit {
  private readonly logger = new Logger(PresenceService.name);
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    // Periodic cleanup of stale presence entries (optional, Redis TTL handles most)
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 60000);
  }

  async onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Mark user as online in the tenant
   */
  async userOnline(userId: string, tenantId: string, metadata?: Record<string, unknown>): Promise<void> {
    const key = `presence:${tenantId}`;
    const member = JSON.stringify({ userId, status: 'online', lastSeen: new Date().toISOString(), metadata });
    await this.redis.getClient().sadd(key, member);
    await this.redis.getClient().expire(key, PRESENCE_TTL);
    this.logger.debug(`User ${userId} online in tenant ${tenantId}`);
  }

  /**
   * Mark user as offline in the tenant
   */
  async userOffline(userId: string, tenantId: string): Promise<void> {
    const key = `presence:${tenantId}`;
    // We need to remove the specific member - we'll find it by userId
    const members = await this.redis.smembers(key);
    const memberToRemove = members.find((m) => {
      try {
        const parsed = JSON.parse(m);
        return parsed.userId === userId;
      } catch {
        return false;
      }
    });
    if (memberToRemove) {
      await this.redis.srem(key, memberToRemove);
    }
    this.logger.debug(`User ${userId} offline in tenant ${tenantId}`);
  }

  /**
   * Handle heartbeat from client - refresh TTL and update lastSeen
   */
  async heartbeat(userId: string, tenantId: string, metadata?: Record<string, unknown>): Promise<void> {
    const key = `presence:${tenantId}`;
    const members = await this.redis.smembers(key);
    
    // Find and update the user's entry
    for (const member of members) {
      try {
        const parsed = JSON.parse(member);
        if (parsed.userId === userId) {
          const updated = JSON.stringify({
            ...parsed,
            status: 'online',
            lastSeen: new Date().toISOString(),
            metadata: metadata ?? parsed.metadata,
          });
          await this.redis.srem(key, member);
          await this.redis.getClient().sadd(key, updated);
          await this.redis.getClient().expire(key, PRESENCE_TTL);
          break;
        }
      } catch {
        // Ignore malformed entries
      }
    }
  }

  /**
   * Get all online users in a tenant
   */
  async getOnlineUsers(tenantId: string): Promise<Array<{ userId: string; status: string; lastSeen: string; metadata?: Record<string, unknown> }>> {
    const key = `presence:${tenantId}`;
    const members = await this.redis.smembers(key);
    return members
      .map((m) => {
        try {
          return JSON.parse(m);
        } catch {
          return null;
        }
      })
      .filter((m): m is { userId: string; status: string; lastSeen: string; metadata?: Record<string, unknown> } => m !== null);
  }

  /**
   * Check if a user is online in a tenant
   */
  async isUserOnline(userId: string, tenantId: string): Promise<boolean> {
    const key = `presence:${tenantId}`;
    const members = await this.redis.smembers(key);
    return members.some((m) => {
      try {
        return JSON.parse(m).userId === userId;
      } catch {
        return false;
      }
    });
  }

  /**
   * Get online count for a tenant
   */
  async getOnlineCount(tenantId: string): Promise<number> {
    const key = `presence:${tenantId}`;
    return this.redis.getClient().scard(key);
  }

  /**
   * Cleanup stale entries (those expired but not removed by Redis)
   * Note: Redis TTL handles most of this automatically
   */
  private async cleanupStale(): Promise<void> {
    // Redis handles TTL expiration automatically, but we can do additional cleanup here if needed
    this.logger.debug('Presence cleanup tick');
  }

  /**
   * Build presence update payload for broadcasting
   */
  buildPresenceUpdatePayload(
    userId: string,
    tenantId: string,
    status: 'online' | 'offline' | 'away',
    metadata?: Record<string, unknown>
  ): PresenceUpdatePayload {
    return {
      userId,
      tenantId,
      status,
      lastSeen: new Date().toISOString(),
      metadata,
    };
  }

  /**
   * Room names for presence
   */
  static tenantRoom(tenantId: string): string {
    return RoomNames.tenant(tenantId);
  }
}