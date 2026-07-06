/**
 * apps/api/src/modules/admin/admin.module.ts
 *
 * P1.4 — wiring for the Admin Console backend.
 *
 * Module composition for P1.4:
 *   - `TenantsAdminController` — only the `GET /api/admin/tenants`
 *     route is exposed in P1.4. P1.5 / P1.6 / P1.7 add POST handlers
 *     in sibling files (`tenants-admin.service.ts` will grow).
 *
 * Dependencies:
 *   - `PrismaModule` is global, so we don't import it explicitly.
 *   - `AuthModule` is imported so the controller's `RolesGuard`
 *     (`APP_GUARD` registered in `app.module.ts`) can resolve the
 *     global guard — it's set up via @Roles() decorator + the
 *     global APP_GUARD, not via injecting AuthService here.
 *
 * Out-of-scope for P1.4:
 *   - Audit row writes on every mutation: P1.5/P1.6/P1.7 add their
 *     own writes; P5.2 escalates to WORM storage.
 *   - Rate limiting: future card; the GET endpoint is bounded by
 *     `take` so a single page costs at most O(25) tenants in three
 *     parallel aggregations.
 */

import { Module } from '@nestjs/common';
import { TenantsAdminController } from './tenants-admin.controller';
import { TenantsAdminService } from './tenants-admin.service';

@Module({
  controllers: [TenantsAdminController],
  providers: [TenantsAdminService],
  // P1.7 (impersonate) will need TenantsAdminService + the
  // ImpersonationService. Export it now so the future controllers
  // don't need to import AdminModule twice.
  exports: [TenantsAdminService],
})
export class AdminModule {}