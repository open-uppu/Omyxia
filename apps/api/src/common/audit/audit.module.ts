import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuditMiddleware } from './audit.middleware';

@Global()
@Module({
  providers: [AuditMiddleware],
  exports: [AuditMiddleware],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply to all routes — middleware itself filters out non-write verbs
    // and health checks. Order matters: AuditMiddleware runs AFTER
    // TenantContextMiddleware so that tenantId/userId are available.
    consumer.apply(AuditMiddleware).forRoutes('*');
  }
}