/**
 * omyxia v2.0.0 P4.1 — StripeCatalogService
 *
 * Translates Stripe price IDs ↔ omyxia `Plan` / `AddOn` catalog rows.
 * Two resolution paths:
 *
 *   1. Database-first  : `Plan.stripePriceId` / `AddOn.stripePriceId`
 *                        are the source of truth for production. The
 *                        admin-console (P2.5) populates these when an
 *                        admin registers Stripe products for a plan.
 *
 *   2. Environment fallback: in dev / CI the catalog rows are not always
 *                        wired to a live Stripe account, so we accept
 *                        price IDs from `STRIPE_PRICE_*` env vars. This
 *                        lets the smoke tests + integration suite run
 *                        without hitting Stripe.
 *
 * If neither lookup hits, we throw so the caller can decide whether to
 * fall back to a no-op (test mode) or surface an error to the admin UI.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { AddOn, Plan, PlanTier } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CatalogLookupResult } from './stripe.types';

interface CatalogEnvFallback {
  /** Map of plan-tier enum to a Stripe price ID (used when DB lookup fails). */
  planByTier: Partial<Record<PlanTier, string>>;
  /** Map of add-on slug to a Stripe price ID. */
  addonBySlug: Record<string, string>;
}

@Injectable()
export class StripeCatalogService {
  private readonly logger = new Logger(StripeCatalogService.name);
  /**
   * Cached env fallback so we don't re-parse env on every webhook. The map
   * is intentionally read once in the constructor and frozen — env vars
   * are static for the lifetime of the process.
   */
  private readonly envFallback: CatalogEnvFallback;

  constructor(private readonly prisma: PrismaService) {
    this.envFallback = Object.freeze(this.readEnvFallback());
  }

  // ---------------------------------------------------------------------
  // Plan ↔ Stripe price
  // ---------------------------------------------------------------------

  /** Return the Stripe price ID for a plan, preferring DB then env. */
  async priceIdForPlan(planId: string): Promise<string | null> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { stripePriceId: true, tier: true },
    });
    if (plan?.stripePriceId) return plan.stripePriceId;
    return this.envFallback.planByTier[plan?.tier ?? ''] ?? null;
  }

  /** Resolve a Stripe price ID → plan (DB lookup; no env fallback). */
  async findPlanByPriceId(stripePriceId: string): Promise<Pick<Plan, 'id' | 'tier'> | null> {
    if (!stripePriceId) return null;
    const plan = await this.prisma.plan.findUnique({
      where: { stripePriceId },
      select: { id: true, tier: true },
    });
    return plan;
  }

  /** List plans with their Stripe price IDs (used by the admin UI). */
  async listPlansWithPrices(): Promise<Array<Pick<Plan, 'id' | 'name' | 'tier' | 'stripePriceId'>>> {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      select: { id: true, name: true, tier: true, stripePriceId: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ---------------------------------------------------------------------
  // Add-on ↔ Stripe price
  // ---------------------------------------------------------------------

  /** Return the Stripe price ID for an add-on, preferring DB then env. */
  async priceIdForAddOn(addOnId: string): Promise<string | null> {
    const addon = await this.prisma.addOn.findUnique({
      where: { id: addOnId },
      select: { stripePriceId: true, slug: true },
    });
    if (addon?.stripePriceId) return addon.stripePriceId;
    return this.envFallback.addonBySlug[addon?.slug ?? ''] ?? null;
  }

  /** Resolve a Stripe price ID → add-on. */
  async findAddOnByPriceId(stripePriceId: string): Promise<Pick<AddOn, 'id' | 'slug'> | null> {
    if (!stripePriceId) return null;
    return this.prisma.addOn.findUnique({
      where: { stripePriceId },
      select: { id: true, slug: true },
    });
  }

  /** List add-ons with their Stripe price IDs (used by the admin UI). */
  async listAddOnsWithPrices(): Promise<Array<Pick<AddOn, 'id' | 'slug' | 'name' | 'stripePriceId'>>> {
    return this.prisma.addOn.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, stripePriceId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------------
  // Generic price → catalog lookup (used by webhook sync)
  // ---------------------------------------------------------------------

  /**
   * Resolve a Stripe price ID to whichever catalog row owns it. The result
   * is intentionally tagged with `kind` so the entitlements sync can route
   * the item to `TenantEntitlement` (PLAN) vs `TenantEntitlementAddOn`
   * (ADDON). Returns `null` when neither matches — that is normal during
   * the first invoice of a brand-new account where Stripe sends items
   * referencing prices we haven't yet mapped.
   */
  async lookupPrice(stripePriceId: string): Promise<CatalogLookupResult | null> {
    if (!stripePriceId) return null;
    const [plan, addon] = await Promise.all([
      this.findPlanByPriceId(stripePriceId),
      this.findAddOnByPriceId(stripePriceId),
    ]);
    if (plan) {
      return {
        kind: 'PLAN',
        catalogId: plan.id,
        planTier: plan.tier,
      };
    }
    if (addon) {
      return {
        kind: 'ADDON',
        catalogId: addon.id,
      };
    }
    return null;
  }

  /**
   * Reverse mapping — useful when we want to create a subscription and need
   * to attach a base plan from a tier key (e.g. admin console: "promote
   * tenant to PRO").
   */
  async priceIdForPlanTier(tier: PlanTier): Promise<string | null> {
    const plan = await this.prisma.plan.findFirst({
      where: { tier, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { stripePriceId: true },
    });
    if (plan?.stripePriceId) return plan.stripePriceId;
    return this.envFallback.planByTier[tier] ?? null;
  }

  /**
   * Read the env fallback map. Returns an empty (but frozen) object when no
   * env vars are set so the catalog still works in dev — all lookups just
   * return `null`.
   */
  private readEnvFallback(): CatalogEnvFallback {
    const trim = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);
    const planByTier: CatalogEnvFallback['planByTier'] = {
      FREE: trim(process.env.STRIPE_PRICE_FREE),
      PRO: trim(process.env.STRIPE_PRICE_PRO),
      ENTERPRISE: trim(process.env.STRIPE_PRICE_ENTERPRISE),
      LEGACY_FULL_ACCESS: trim(process.env.STRIPE_PRICE_LEGACY),
    };
    const addonBySlug: Record<string, string> = {};
    const storage = trim(process.env.STRIPE_PRICE_ADDON_EXTRA_STORAGE);
    if (storage) addonBySlug['extra_storage'] = storage;
    const apiPack = trim(process.env.STRIPE_PRICE_ADDON_API_PACK);
    if (apiPack) addonBySlug['api_pack'] = apiPack;
    const priority = trim(process.env.STRIPE_PRICE_ADDON_PRIORITY_SUPPORT);
    if (priority) addonBySlug['priority_support'] = priority;
    return Object.freeze({ planByTier, addonBySlug });
  }
}
