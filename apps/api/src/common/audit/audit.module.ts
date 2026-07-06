import { Global, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { AuditMiddleware } from './audit.middleware';
import { InMemoryChainHeadCache } from './audit-signer';

/**
 * The default chain-head cache used when nothing else is wired in. We
 * deliberately expose it as a Provider here so tests can swap it via
 * `overrideProvider(AUDIT_CHAIN_CACHE)`.
 *
 * In a multi-replica production deployment this would be replaced with
 * a Redis-backed implementation that reads/writes via the same SADD /
 * SET semantics — see the architectural note in audit-middleware.ts.
 */
export const AUDIT_CHAIN_CACHE = Symbol('AUDIT_CHAIN_CACHE');

const defaultChainCacheProvider: Provider = {
  provide: AUDIT_CHAIN_CACHE,
  useFactory: () => new InMemoryChainHeadCache(),
};

@Global()
@Module({
  providers: [AuditMiddleware, defaultChainCacheProvider],
  exports: [AuditMiddleware, AUDIT_CHAIN_CACHE],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply to all routes — middleware itself filters out non-write verbs
    // and health checks. Order matters: AuditMiddleware runs AFTER
    // TenantContextMiddleware so that tenantId/userId are available.
    consumer.apply(AuditMiddleware).forRoutes('*');
  }
}
