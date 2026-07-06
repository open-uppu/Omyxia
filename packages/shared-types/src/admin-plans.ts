/**
 * Admin plan & add-on wire format (P2.5).
 *
 * Lives in `@omyxia/shared-types` so:
 *   - The admin-console frontend can validate shapes at runtime (zod).
 *   - The future backend CRUD endpoints under `/api/admin/plans` and
 *     `/api/admin/add-ons` return the same shape verbatim.
 *   - Tests can assert against the schema without spinning up React.
 *
 * Concept map:
 *
 *   - `Plan`      — a subscription tier (Free / Pro / Enterprise, or
 *                    a custom tier seeded for a single tenant).
 *   - `PlanFeature` — a per-plan feature flag with optional numeric
 *                     limit (enabled + cap). Drag-reorderable.
 *   - `AddOn`     — a module that augments a base plan (CRM, ERP,
 *                    WMS, BI, MAS). Applies to specific plan slugs.
 *
 * Why a flat `addOnSlugs` array on `Plan`?
 *   P1.2 stores included add-ons via a join table, but the FE doesn't
 *   need the join — it just needs "which add-ons are bundled?". The
 *   BE flattens to slugs for transport.
 *
 * Money conventions (mirror admin-entitlements):
 *   - All amounts in USD cents. The renderer formats.
 *   - `Decimal(15,2)` at the DB maps to `dollarsCents / 100`. The FE
 *     does the conversion in the mock + formatters.
 *
 * This module is intentionally pure-data — no React, no fetch — so
 * the API route handler and the page component can both import it
 * without dragging in hooks.
 */

import { z } from 'zod';
import { AddOnSlugSchema } from './admin-upgrade-modal';

// ----------------------------------------------------------------------------
// Enums — mirror the Prisma DB enums (P1.1 schema).
// ----------------------------------------------------------------------------

/**
 * Plan tier — the canonical enum the FE / BE / DB agree on.
 *
 * Includes `LEGACY_FULL_ACCESS` because the migration (P5.1) lands
 * every v1.0.0 tenant on this tier; the FE should be able to render
 * a "Legacy Full Access" badge without special-casing.
 */
export const AdminPlanTierSchema = z.enum([
  'FREE',
  'PRO',
  'ENTERPRISE',
  'LEGACY_FULL_ACCESS',
]);
export type AdminPlanTier = z.infer<typeof AdminPlanTierSchema>;

/**
 * Which plans an add-on can be attached to. Mirrors the
 * `AddOnAppliesTo` Prisma enum.
 */
export const AddOnAppliesToSchema = z.enum([
  'ALL',
  'FREE',
  'PRO',
  'ENTERPRISE',
]);
export type AddOnAppliesTo = z.infer<typeof AddOnAppliesToSchema>;

// ----------------------------------------------------------------------------
// Feature row — a single toggle in the plan editor toggle grid.
// ----------------------------------------------------------------------------

/**
 * Feature key shape — `module.<name>` or `limit.<camelCase>`.
 *
 * Mirrors the FE catalog and the BE P3.1 decorator. The regex is
 * intentionally permissive so the BE catalog can grow without a
 * schema-breaking change on the FE side. Unknown keys still round-
 * trip — the FE simply renders the toggle regardless.
 */
export const PlanFeatureKeySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/, {
    message:
      'Feature key must start with a letter and contain only letters, digits, underscore, dot.',
  });
export type PlanFeatureKey = z.infer<typeof PlanFeatureKeySchema>;

/**
 * Single toggle row on a plan.
 *
 * `limit` is only meaningful for `limit.*` keys; the BE clamps it to
 * non-negative integers (`null` = unlimited, ENTERPRISE pattern). The
 * editor allows `null` only when the key starts with `limit.` AND the
 * plan tier is `ENTERPRISE` or `LEGACY_FULL_ACCESS`.
 */
export const PlanFeatureSchema = z.object({
  /** Stable key — never changes for the lifetime of the catalog. */
  featureKey: PlanFeatureKeySchema,
  /** Display label — mirrors the FE catalog. */
  featureLabel: z.string(),
  /** Optional category — used for visual grouping in the toggle grid. */
  category: z
    .enum(['module', 'limit', 'admin'])
    .default('module'),
  /** Whether the feature is enabled on this plan. */
  enabled: z.boolean(),
  /** Numeric cap. `null` = unlimited. Only valid for `limit.*` keys. */
  limit: z.number().int().nonnegative().nullable().optional(),
  /**
   * Visual order within the toggle grid (0-based). Drag-drop reorder
   * rewrites this on the BE. Tests pin the order via a `sortOrder`
   * field with a numeric default.
   */
  sortOrder: z.number().int().nonnegative(),
});
export type PlanFeature = z.infer<typeof PlanFeatureSchema>;

// ----------------------------------------------------------------------------
// Plan — top-level subscription tier.
// ----------------------------------------------------------------------------

/**
 * Top-level plan shape.
 *
 * `addOnSlugs` lists the slugs of the add-ons bundled into this plan.
 * For "Pro → CRM" the FE renders a "Includes CRM" chip; for "Enterprise
 * → All modules" it renders "All add-ons included" and the slug list
 * is empty (because the add-ons are implicit via the tier).
 *
 * `entitlementCount` is server-computed (number of tenants currently
 * on this plan) so the editor can show "47 tenants on Pro" without a
 * second round-trip.
 */
export const AdminPlanSchema = z.object({
  id: z.string(),
  /** Human-readable display name — e.g. "Pro", "Enterprise — Vault". */
  name: z.string().min(1).max(80),
  tier: AdminPlanTierSchema,
  /** Monthly recurring price in USD cents. `0` = free / contact us. */
  priceCents: z.number().int().nonnegative(),
  /** Original SQL `Decimal(15,2)` value, kept as a string for fidelity. */
  priceDollars: z.string().regex(/^\d+(\.\d{1,2})?$/),
  description: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Bundled add-on slugs. Empty = add-ons NOT bundled; module is unlocked via the `features` list. */
  addOnSlugs: z.array(AddOnSlugSchema),
  /** Per-plan feature toggles. Drag-reorderable. */
  features: z.array(PlanFeatureSchema),
  /** Server-computed: how many tenants currently have this plan. */
  entitlementCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminPlan = z.infer<typeof AdminPlanSchema>;

// ----------------------------------------------------------------------------
// Add-on — optional module that augments a plan.
// ----------------------------------------------------------------------------

/**
 * Add-on catalog row.
 *
 * `appliesTo` controls which plan slugs this add-on is "stackable"
 * onto. ALL = stacks onto any plan; PRO/ENTERPRISE = restricts to
 * those tiers.
 *
 * `planCount` is server-computed (number of plans that currently
 * bundle this add-on). Lets the editor warn "Removing CRM from Pro
 * affects 47 tenants" before the user confirms.
 */
export const AdminAddOnSchema = z.object({
  id: z.string(),
  /** Display name — e.g. "CRM", "WMS — Bulk". */
  name: z.string().min(1).max(80),
  /** Stable slug — `addon.<kebab>`. Mirrors the BE catalog. */
  slug: AddOnSlugSchema,
  /** Monthly add-on price in USD cents. */
  priceCents: z.number().int().nonnegative(),
  priceDollars: z.string().regex(/^\d+(\.\d{1,2})?$/),
  description: z.string().nullable(),
  appliesTo: AddOnAppliesToSchema,
  isActive: z.boolean(),
  /** Server-computed: number of plans that currently bundle this. */
  planCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminAddOn = z.infer<typeof AdminAddOnSchema>;

// ----------------------------------------------------------------------------
// DTOs — what the editor POSTs / PATCHes.
// ----------------------------------------------------------------------------

/**
 * POST body for create-plan.
 *
 * `id` is omitted (BE assigns). `priceCents` is the canonical field;
 * the editor sends it and the BE derives `priceDollars`.
 */
export const CreatePlanDtoSchema = z.object({
  name: z.string().min(1).max(80),
  tier: AdminPlanTierSchema,
  priceCents: z.number().int().nonnegative().max(99_999_999_99),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
  addOnSlugs: z.array(AddOnSlugSchema).default([]),
  features: z
    .array(
      PlanFeatureSchema.omit({ sortOrder: true }).extend({
        sortOrder: z.number().int().nonnegative().optional(),
      })
    )
    .default([]),
});
export type CreatePlanDto = z.infer<typeof CreatePlanDtoSchema>;

/**
 * PATCH body — all fields optional except `id` (via URL).
 */
export const UpdatePlanDtoSchema = CreatePlanDtoSchema.partial();
export type UpdatePlanDto = z.infer<typeof UpdatePlanDtoSchema>;

/**
 * Drag-reorder body — the new sort orders.
 *
 * The editor sends the full ordered list because the BE only knows
 * the canonical list (saves a diff). The response echoes the canonical
 * row so the editor can reconcile its optimistic state.
 */
export const ReorderPlanFeaturesDtoSchema = z.object({
  /** Ordered list of feature keys (low→high sortOrder). */
  orderedFeatureKeys: z.array(PlanFeatureKeySchema).min(1),
});
export type ReorderPlanFeaturesDto = z.infer<typeof ReorderPlanFeaturesDtoSchema>;

export const CreateAddOnDtoSchema = z.object({
  name: z.string().min(1).max(80),
  /** Optional — BE derives from `name` if omitted. */
  slug: AddOnSlugSchema.optional(),
  priceCents: z.number().int().nonnegative().max(99_999_999_99),
  description: z.string().max(500).nullable().optional(),
  appliesTo: AddOnAppliesToSchema.default('ALL'),
  isActive: z.boolean().default(true),
});
export type CreateAddOnDto = z.infer<typeof CreateAddOnDtoSchema>;

export const UpdateAddOnDtoSchema = CreateAddOnDtoSchema.partial();
export type UpdateAddOnDto = z.infer<typeof UpdateAddOnDtoSchema>;

// ----------------------------------------------------------------------------
// Top-level payloads.
// ----------------------------------------------------------------------------

/**
 * List-plans response — flat array (frontend paginates client-side
 * because the catalog is small: ≤ 6 tiers + custom).
 */
export const ListPlansResponseSchema = z.object({
  plans: z.array(AdminPlanSchema),
  /** Add-ons bundled separately so the editor can show a picker. */
  addOns: z.array(AdminAddOnSchema),
  generatedAt: z.string(),
});
export type ListPlansResponse = z.infer<typeof ListPlansResponseSchema>;

export const ListAddOnsResponseSchema = z.object({
  addOns: z.array(AdminAddOnSchema),
  generatedAt: z.string(),
});
export type ListAddOnsResponse = z.infer<typeof ListAddOnsResponseSchema>;

// ----------------------------------------------------------------------------
// Helpers — pure functions the FE can use without depending on a
// React context. They round-trip through the schema so any drift is
// caught at module-load time.
// ----------------------------------------------------------------------------

/** Convert dollars (number) → cents (integer, rounded half-up). */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.max(0, Math.round(dollars * 100));
}

/** Convert cents (integer) → dollars (number). */
export function centsToDollars(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.round(cents)) / 100;
}

/** Format cents as a "$N.NN" display string. */
export function formatPriceCents(cents: number, currency: string = 'USD'): string {
  const symbol = currency === 'USD' ? '$' : '';
  const dollars = centsToDollars(cents);
  return `${symbol}${dollars.toFixed(2)}`;
}
