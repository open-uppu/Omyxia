/**
 * EntitlementsController — read + (P3.3) write entitlement endpoints.
 *
 * Mounted on `/api/admin/entitlements/*` for the read/diagnostics
 * routes and `/api/admin/tenants/*` for the plan / add-on mutation
 * routes (card spec). Super-admin only
 * (`@Roles('SUPER_ADMIN')` + `RolesGuard`).
 *
 * Read routes (P3.1):
 *
 *   GET  /api/admin/entitlements/:tenantId
 *   POST /api/admin/entitlements/:tenantId/invalidate
 *
 * Write routes (P3.3):
 *
 *   POST /api/admin/tenants/:id/plan
 *        body: { planId: string, effectiveAt?: ISO, expiresAt?: ISO|null }
 *        → 200: { ok, tenantId, planId, entitlements: TenantEntitlements, invalidation: { reason, source, nonce, at } }
 *
 *   POST /api/admin/tenants/:id/addons
 *        body: { addOnSlugs: string[] }
 *        → 200: { ok, tenantId, addOnSlugs, invalidation: { ... } }
 *
 *   POST /api/admin/tenants/:id/suspend
 *        body: { reason: string }
 *        → 200: { ok, tenantId, status: 'SUSPENDED', invalidation: { ... } }
 *
 *   POST /api/admin/tenants/:id/resume
 *        → 200: { ok, tenantId, status: 'ACTIVE', invalidation: { ... } }
 *
 * The `invalidation` block surfaces the nonce + at fields from the
 * published `EntitlementInvalidationMessage` so the admin UI can
 * render a meaningful toast ("plan upgraded · nonce 7") and so the
 * FE (open-uppu-fe) can dedupe its `/api/entitlements/me` refetch.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../modules/auth/rbac/roles.decorator';
import { RolesGuard } from '../../modules/auth/rbac/roles.guard';
import { EntitlementsService } from './entitlements.service';
import { EntitlementsAdminService } from './entitlements-admin.service';
import { PrismaService } from '../prisma/prisma.service';

// Mark the user-id getter as `any` so we don't pull in the full
// `Request` type just for one field read.
type RequestWithUser = { user?: { id?: string; sub?: string; userId?: string } };

@Controller('admin')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class EntitlementsAdminController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly entitlementsAdmin: EntitlementsAdminService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------
  // Read routes (P3.1)
  // -------------------------------------------------------------------

  @Get('entitlements/:tenantId')
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

  @Post('entitlements/:tenantId/invalidate')
  async invalidateCache(@Param('tenantId') tenantId: string) {
    await this.entitlements.invalidate(tenantId);
    return {
      ok: true,
      tenantId,
      invalidatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------
  // Write routes (P3.3) — plan / add-ons / suspend / resume
  // -------------------------------------------------------------------

  @Post('tenants/:id/plan')
  async changePlan(
    @Param('id') id: string,
    @Body() body: {
      planId?: string;
      effectiveAt?: string;
      expiresAt?: string | null;
    } = {},
    @Req() req?: RequestWithUser,
  ) {
    if (!body?.planId) {
      throw new BadRequestException('planId is required');
    }
    const effectiveAt = body.effectiveAt
      ? new Date(body.effectiveAt)
      : undefined;
    if (effectiveAt && Number.isNaN(effectiveAt.getTime())) {
      throw new BadRequestException('effectiveAt must be ISO 8601');
    }
    const expiresAt =
      body.expiresAt === null
        ? null
        : body.expiresAt
          ? new Date(body.expiresAt)
          : undefined;
    if (expiresAt && expiresAt !== null && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt must be ISO 8601 or null');
    }
    const updated = await this.entitlementsAdmin.changePlan({
      tenantId: id,
      planId: body.planId,
      effectiveAt,
      expiresAt,
      actorUserId: this.actorFromReq(req),
    });
    // Re-read the freshly-invalidated payload so the admin UI can show
    // the new feature/limit set without an extra round-trip.
    const fresh = await this.entitlements.forTenant(id);
    return {
      ok: true,
      tenantId: id,
      planId: body.planId,
      entitlements: fresh,
      entitlement: updated,
      invalidation: {
        reason: 'plan-change',
        source: 'admin',
        at: new Date().toISOString(),
      },
    };
  }

  @Post('tenants/:id/addons')
  async setAddOns(
    @Param('id') id: string,
    @Body() body: { addOnSlugs?: string[] } = {},
    @Req() req?: RequestWithUser,
  ) {
    if (!body || !Array.isArray(body.addOnSlugs)) {
      throw new BadRequestException('addOnSlugs must be a string[]');
    }
    const result = await this.entitlementsAdmin.setAddOns({
      tenantId: id,
      addOnSlugs: body.addOnSlugs,
      actorUserId: this.actorFromReq(req),
    });
    const fresh = await this.entitlements.forTenant(id);
    return {
      ok: true,
      ...result,
      entitlements: fresh,
      invalidation: {
        reason: 'addon-change',
        source: 'admin',
        at: new Date().toISOString(),
      },
    };
  }

  @Post('tenants/:id/suspend')
  async suspendTenant(
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
    @Req() req?: RequestWithUser,
  ) {
    if (!body?.reason) {
      throw new BadRequestException('reason is required');
    }
    const updated = await this.entitlementsAdmin.suspendTenant({
      tenantId: id,
      reason: body.reason,
      actorUserId: this.actorFromReq(req),
    });
    return {
      ok: true,
      tenantId: id,
      status: updated.status,
      invalidation: {
        reason: 'tenant-suspend',
        source: 'admin',
        at: new Date().toISOString(),
      },
    };
  }

  @Post('tenants/:id/resume')
  async resumeTenant(
    @Param('id') id: string,
    @Req() req?: RequestWithUser,
  ) {
    const updated = await this.entitlementsAdmin.resumeTenant(
      id,
      this.actorFromReq(req),
    );
    return {
      ok: true,
      tenantId: id,
      status: updated.status,
      invalidation: {
        reason: 'tenant-resume',
        source: 'admin',
        at: new Date().toISOString(),
      },
    };
  }

  private actorFromReq(req: RequestWithUser | undefined): string | undefined {
    const u = req?.user;
    if (!u) return undefined;
    return u.id ?? u.userId ?? u.sub;
  }
}
