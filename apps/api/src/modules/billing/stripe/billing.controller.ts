/**
 * omyxia v2.0.0 P4.1 — BillingController (tenant-facing endpoints).
 *
 * Three responsibilities, all behind the existing RolesGuard:
 *
 *   * `POST /api/billing/portal`           — open Stripe customer portal.
 *   * `POST /api/billing/checkout`         — first-time signup via Checkout.
 *   * `GET  /api/billing/subscription`     — current subscription summary
 *                                            for the requesting tenant.
 *   * `POST /api/billing/subscription`     — admin-initiated plan change
 *                                            (create / replace). SUPER_ADMIN
 *                                            gated via RolesGuard; for
 *                                            MVP this is the supported
 *                                            path while the admin console
 *                                            is wired up.
 *
 * The webhook endpoint lives in `webhook.controller.ts` because it needs
 * raw-body access and is intentionally NOT behind auth (Stripe signs the
 * payload; we verify the signature instead).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { StripeService } from './stripe.service';
import { StripeCatalogService } from './stripe-catalog.service';
import {
  DEFAULT_PRORATION_BEHAVIOR,
  isProrationBehavior,
} from './proration';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RolesGuard } from '../../auth/rbac/roles.guard';
import { Roles } from '../../auth/rbac/roles.decorator';
import { TenantRole } from '@prisma/client';
import type {
  BillingPortalResult,
  BillingSummary,
  CheckoutSessionResult,
} from './stripe.types';

const portalBodySchema = z.object({
  returnUrl: z.string().url().optional(),
});

const checkoutBodySchema = z.object({
  planTier: z.enum(['FREE', 'PRO', 'ENTERPRISE', 'LEGACY_FULL_ACCESS']),
  addOnIds: z.array(z.string()).optional().default([]),
  returnUrl: z.string().url().optional(),
});

const replaceBodySchema = z.object({
  stripeSubscriptionId: z.string().min(1),
  planTier: z.enum(['FREE', 'PRO', 'ENTERPRISE', 'LEGACY_FULL_ACCESS']),
  addOnIds: z.array(z.string()).optional().default([]),
  prorationBehavior: z.string().optional(),
});

const addItemBodySchema = z.object({
  addOnId: z.string().min(1),
  quantity: z.number().int().min(1).max(1000).optional().default(1),
  prorationBehavior: z.string().optional(),
});

const removeItemBodySchema = z.object({
  stripeSubscriptionItemId: z.string().min(1),
  prorationBehavior: z.string().optional(),
});

const cancelBodySchema = z.object({
  stripeSubscriptionId: z.string().min(1),
  immediate: z.boolean().optional().default(false),
});

interface TenantRequest {
  user: { id: string; tenantId: string; role: string };
}

@Controller('api/billing')
@UseGuards(RolesGuard)
export class BillingController {
  constructor(
    private readonly stripe: StripeService,
    private readonly catalog: StripeCatalogService,
    private readonly prisma: PrismaService,
  ) {}

  /** `POST /api/billing/portal` — auth required, any role. */
  @Post('portal')
  async portal(
    @Req() req: Request,
    @Body(new ValidationPipe({ whitelist: true })) rawBody: unknown,
  ): Promise<BillingPortalResult> {
    const tenantId = this.requireTenantId(req);
    const body = portalBodySchema.parse(rawBody ?? {});
    return this.stripe.createPortalSession(tenantId, body.returnUrl);
  }

  /** `POST /api/billing/checkout` — auth required, any role. */
  @Post('checkout')
  async checkout(
    @Req() req: Request,
    @Body(new ValidationPipe({ whitelist: true })) rawBody: unknown,
  ): Promise<CheckoutSessionResult> {
    const tenantId = this.requireTenantId(req);
    const body = checkoutBodySchema.parse(rawBody ?? {});
    return this.stripe.createCheckoutSession(
      tenantId,
      body.planTier,
      body.addOnIds,
      body.returnUrl,
    );
  }

  /** `GET /api/billing/subscription` — auth required, any role. */
  @Get('subscription')
  async subscription(@Req() req: Request): Promise<BillingSummary> {
    const tenantId = this.requireTenantId(req);
    const sub = await this.prisma.stripeSubscription.findUnique({
      where: { tenantId },
      include: { items: { include: { plan: true, addOn: true } } },
    });
    const customer = await this.prisma.stripeCustomer.findUnique({
      where: { tenantId },
      select: { stripeCustomerId: true },
    });
    if (!sub) {
      return {
        tenantId,
        hasCustomer: Boolean(customer),
        hasSubscription: false,
        items: [],
      };
    }
    const baseItem = sub.items.find((i) => i.kind === 'BASE_PLAN' && i.plan);
    return {
      tenantId,
      hasCustomer: Boolean(customer),
      hasSubscription: true,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEndsAt: sub.trialEnd?.toISOString() ?? null,
      planTier: baseItem?.plan?.tier ?? null,
      items: sub.items.map((i) => ({
        stripeSubscriptionItemId: i.stripeSubscriptionItemId,
        stripePriceId: i.stripePriceId,
        kind: i.kind,
        quantity: i.quantity,
        isActive: i.isActive,
        catalogName: i.plan?.name ?? i.addOn?.name ?? undefined,
        catalogSlug: i.plan?.tier ?? i.addOn?.slug ?? undefined,
      })),
    };
  }

  /**
   * `POST /api/billing/subscription` — SUPER_ADMIN-only; used by the
   * admin console (P2.5) to migrate a tenant from FREE → PAID or change
   * the base plan. Gated by the RolesGuard + @Roles(SUPER_ADMIN).
   */
  @Post('subscription')
  @Roles(TenantRole.SUPER_ADMIN)
  async replaceSubscription(
    @Req() req: Request,
    @Body(new ValidationPipe({ whitelist: true })) rawBody: unknown,
  ): Promise<{ stripeSubscriptionId: string }> {
    this.requireTenantId(req); // SUPER_ADMIN may target any tenant in the future
    const body = replaceBodySchema.parse(rawBody ?? {});
    const proration = this.parseProration(body.prorationBehavior);

    const existing = await this.prisma.stripeSubscription.findUnique({
      where: { stripeSubscriptionId: body.stripeSubscriptionId },
      select: { tenantId: true, stripeSubscriptionId: true },
    });
    if (!existing) {
      throw new NotFoundException(`subscription not found: ${body.stripeSubscriptionId}`);
    }
    const result = await this.stripe.replaceSubscriptionItems(
      existing.tenantId,
      existing.stripeSubscriptionId,
      body.planTier,
      body.addOnIds,
      proration,
    );
    return { stripeSubscriptionId: result.stripeSubscriptionId };
  }

  /** `POST /api/billing/subscription/items` — SUPER_ADMIN-only. Add an add-on. */
  @Post('subscription/items')
  @Roles(TenantRole.SUPER_ADMIN)
  async addItem(
    @Req() req: Request,
    @Body(new ValidationPipe({ whitelist: true })) rawBody: unknown,
  ): Promise<{ stripeSubscriptionItemId: string }> {
    this.requireTenantId(req);
    const body = addItemBodySchema.parse(rawBody ?? {});
    const proration = this.parseProration(body.prorationBehavior);

    const sub = await this.prisma.stripeSubscription.findFirst({
      where: { items: { some: { addOnId: body.addOnId } } },
      select: { tenantId: true, stripeSubscriptionId: true },
    });
    if (!sub) {
      throw new NotFoundException(`no subscription contains addOn=${body.addOnId}`);
    }
    const result = await this.stripe.addSubscriptionItem(
      sub.tenantId,
      sub.stripeSubscriptionId,
      body.addOnId,
      body.quantity,
      proration,
    );
    return { stripeSubscriptionItemId: result.stripeSubscriptionItemId };
  }

  /** `POST /api/billing/subscription/items/remove` — SUPER_ADMIN-only. Remove an add-on. */
  @Post('subscription/items/remove')
  @Roles(TenantRole.SUPER_ADMIN)
  async removeItem(
    @Req() req: Request,
    @Body(new ValidationPipe({ whitelist: true })) rawBody: unknown,
  ): Promise<{ removed: true }> {
    this.requireTenantId(req);
    const body = removeItemBodySchema.parse(rawBody ?? {});
    const proration = this.parseProration(body.prorationBehavior);

    const item = await this.prisma.stripeSubscriptionItem.findUnique({
      where: { stripeSubscriptionItemId: body.stripeSubscriptionItemId },
      select: { subscription: { select: { tenantId: true, stripeSubscriptionId: true } } },
    });
    if (!item) {
      throw new NotFoundException(`item not found: ${body.stripeSubscriptionItemId}`);
    }
    await this.stripe.removeSubscriptionItem(
      item.subscription.tenantId,
      body.stripeSubscriptionItemId,
      proration,
    );
    return { removed: true };
  }

  /** `POST /api/billing/subscription/cancel` — SUPER_ADMIN-only. */
  @Post('subscription/cancel')
  @Roles(TenantRole.SUPER_ADMIN)
  async cancel(
    @Req() req: Request,
    @Body(new ValidationPipe({ whitelist: true })) rawBody: unknown,
  ): Promise<{ stripeSubscriptionId: string }> {
    this.requireTenantId(req);
    const body = cancelBodySchema.parse(rawBody ?? {});
    const sub = await this.prisma.stripeSubscription.findUnique({
      where: { stripeSubscriptionId: body.stripeSubscriptionId },
      select: { tenantId: true, stripeSubscriptionId: true },
    });
    if (!sub) {
      throw new NotFoundException(`subscription not found: ${body.stripeSubscriptionId}`);
    }
    const result = await this.stripe.cancelSubscription(
      sub.tenantId,
      body.stripeSubscriptionId,
      !body.immediate,
    );
    return { stripeSubscriptionId: result.stripeSubscriptionId };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private requireTenantId(req: Request): string {
    const user = (req as unknown as TenantRequest).user;
    if (!user?.tenantId) {
      throw new ForbiddenException('tenant context missing on request');
    }
    return user.tenantId;
  }

  private parseProration(input: string | undefined) {
    if (!input) return DEFAULT_PRORATION_BEHAVIOR;
    if (!isProrationBehavior(input)) {
      throw new BadRequestException(
        `invalid prorationBehavior: ${input} (allowed: create_prorations | none | always_invoice)`,
      );
    }
    return input;
  }
}
