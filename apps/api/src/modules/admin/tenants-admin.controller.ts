/**
 * apps/api/src/modules/admin/tenants-admin.controller.ts
 *
 * P1.4 — Admin Console: GET /api/admin/tenants (list, search, filter)
 *
 * Single endpoint in the controller for P1.4. POST handlers for
 * create (P1.5), suspend/unsuspend (P1.6) and the impersonate flow
 * (P1.7) will be added by their respective cards.
 *
 * Auth:
 *   - The global `RolesGuard` (registered as `APP_GUARD` in
 *     app.module.ts) is the only gate keeping this behind
 *     `SUPER_ADMIN`. Any non-admin token gets a 403 before this
 *     controller's body runs.
 *   - We do NOT add a per-controller `@UseGuards()` — the existing
 *     global guard does the job and the test suite asserts via the
 *     route's `Reflect.getMetadata('rbac:roles', handler)` shape (see
 *     `tenants-admin.controller.spec.ts`).
 *
 * Validation:
 *   - The DTO is parsed at the boundary via `parseTenantListQuery`,
 *     which re-uses the FE-side `parseAdminTenantFilters` from
 *     `@omyxia/shared-types`. Any invalid enum / non-positive page
 *     is dropped silently (the FE parser' documented behavior) and
 *     clamped at the service layer (pageSize > 200 -> default 25).
 *   - Empty / absent query params produce the documented defaults
 *     (q='', plan=[], status=[], region=[], page=1, pageSize=25).
 *
 * Audit:
 *   - The RolesGuard / auth pipeline records an `ADMIN_ACCESS` row on
 *     every admin route hit. We don't write another audit row for
 *     list calls — the user's token + path + IP/User-Agent are
 *     already captured. P5.2 (SOC2 WORM) escalates this once P5.1
 *     ships.
 */

import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/rbac/roles.decorator';
import { TenantsAdminService } from './tenants-admin.service';
import {
  parseTenantListQuery,
  type TenantListResponse,
} from './admin.tenants.dto';

@Controller('admin/tenants')
@Roles('SUPER_ADMIN')
export class TenantsAdminController {
  constructor(private readonly tenantsService: TenantsAdminService) {}

  /**
   * GET /api/admin/tenants
   *
   * Query string (all optional):
   *   q=acme                    # name OR domain substring
   *   plan=PRO,enterprise       # FREE | PRO | ENTERPRISE (case-insensitive)
   *   status=ACTIVE,suspended   # ACTIVE | SUSPENDED | ARCHIVED
   *   region=eu,us,apac         # lowercase
   *   page=2                    # 1-based, clamped to >= 1
   *   pageSize=25               # clamped to the documented default 25 if > 200
   *
   * Response: see `TenantListResponse` in admin.tenants.dto.ts.
   */
  @Get()
  list(@Query() query: Record<string, unknown>): Promise<TenantListResponse> {
    const filters = parseTenantListQuery(query);
    return this.tenantsService.list(filters);
  }
}