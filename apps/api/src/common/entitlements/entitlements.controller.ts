/**
 * EntitlementsController — read-only entitlement introspection.
 *
 * Mounted on `/api/admin/entitlements/*`. Returns the same payload
 * shape that the FE `GET /api/entitlements/me` mock returns. Super-admin
 * only (RoleGuard equivalent lives in `RbacModule` via `@Roles('SUPER_ADMIN')`).
 *
 * Two routes:
 *
 *   GET /api/admin/entitlements/:tenantId
 *       Returns the full `TenantEntitlements` for the given tenant.
 *       Useful for "why is feature X off for this tenant?" debugging
 *       and for the admin-console's per-tenant entitlement editor (P2.4).
 *
 *   GET /api/admin/entitlements/:tenantId/cache-status
 *       Returns `{ cached: boolean, generatedAt: string, ttlSeconds: number }`.
 *       Used by the admin console diagnostics panel.
 */
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../modules/auth/rbac/roles.decorator';
import { RolesGuard } from '../../modules/auth/rbac/roles.guard';
import { EntitlementsService } from './entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin/entitlements')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class EntitlementsAdminController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':tenantId')
  async getForTenant(@Param('tenantId') tenantId: string) {
    const payload = await this.entitlements.forTenant(tenantId);
    // Make sure the tenant actually exists; don't leak deny-all silently.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!tenant) {
      return { ok: false, code: 'TENANT_NOT_FOUND', tenantId };
    }
    return {
      ok: true,
      tenant,
      entitlements: payload,
    };
  }

  @Post(':tenantId/invalidate')
  async invalidateCache(@Param('tenantId') tenantId: string) {
    await this.entitlements.invalidate(tenantId);
    return {
      ok: true,
      tenantId,
      invalidatedAt: new Date().toISOString(),
    };
  }
}
