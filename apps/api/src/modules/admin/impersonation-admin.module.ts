/**
 * apps/api/src/modules/admin/impersonation-admin.module.ts
 *
 * P1.7 — ImpersonationAdminModule.
 *
 * The AdminModule (in admin.module.ts) owns the cross-tenant
 * endpoints for the admin console. The impersonation controller is
 * mounted under the same `admin/impersonate` route, so this module
 * is kept in the admin/ folder and re-imported by AdminModule.
 *
 * Why a sub-module instead of inlining?
 *   - Keeps the P1.4 (tenants-list) controller + service files
 *     untouched and lets the P1.7 chunk grow in isolation.
 *   - Lets us wire RealtimeModule via `forwardRef` in ONE place —
 *     the cycle (Realtime → Auth → Admin → Realtime) breaks here.
 *
 * Imports:
 *   - PrismaModule (global; exposes PrismaService).
 *   - TenantContextModule (global; exposes TenantContextService
 *     that the SUPER_ADMIN context flows through).
 *   - JwtModule (root-level registration in app.module.ts).
 *   - RealtimeModule (forwardRef to avoid cycles).
 *
 * Exports:
 *   - ImpersonationAdminService — the auth controller reuses
 *     `service.meFromClaims()` for the `/api/auth/impersonate/me`
 *     route.
 */

import { Module, forwardRef } from '@nestjs/common';
import { ImpersonationAdminController } from './impersonation-admin.controller';
import { ImpersonationAdminService } from './impersonation-admin.service';
import { ImpersonationBroadcaster } from './impersonation-broadcaster';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [forwardRef(() => RealtimeModule)],
  controllers: [ImpersonationAdminController],
  providers: [ImpersonationAdminService, ImpersonationBroadcaster],
  exports: [ImpersonationAdminService],
})
export class ImpersonationAdminModule {}
