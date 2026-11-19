import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantContextModule } from '../tenant-context/tenant-context.module';
import { RedisModule } from '../redis/redis.module';
import { ServiceEntitlementService } from './service-entitlement.service';
import { ServiceEntitlementGuard } from './service-entitlement.guard';
import { ServiceEntitlementMiddleware } from './service-entitlement.middleware';

@Global()
@Module({
  imports: [
    PrismaModule,
    TenantContextModule,
    RedisModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-in-production',
    }),
  ],
  providers: [
    ServiceEntitlementService,
    ServiceEntitlementGuard,
    ServiceEntitlementMiddleware,
  ],
  exports: [
    ServiceEntitlementService,
    ServiceEntitlementGuard,
    ServiceEntitlementMiddleware,
  ],
})
export class ServiceEntitlementsModule {}
