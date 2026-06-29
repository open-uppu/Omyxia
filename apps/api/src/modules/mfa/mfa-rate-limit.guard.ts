/**
 * MfaRateLimitGuard — simple in-memory token-bucket rate limiter for the
 * MFA verify endpoint. Prevents brute-force enumeration of TOTP and recovery
 * codes.
 *
 * Defaults: 5 attempts per 60 seconds per (userId, route). When exceeded,
 * returns 429 Too Many Requests.
 *
 * Scope: process-local only. For multi-instance deployments, swap in a Redis
 * backed counter — interface is the same.
 */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULTS = {
  windowMs: 60_000,
  max: 5,
};

@Injectable()
export class MfaRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly opts: Partial<typeof DEFAULTS> = {}) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req?.user?.sub ?? req?.ip ?? 'anon';
    const route = req?.route?.path ?? req?.path ?? req?.url ?? 'unknown';
    const key = `${userId}::${route}`;

    const windowMs = this.opts.windowMs ?? DEFAULTS.windowMs;
    const max = this.opts.max ?? DEFAULTS.max;
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bucket.count += 1;
    return true;
  }

  /** Test helper — reset the limiter between tests */
  reset() {
    this.buckets.clear();
  }
}