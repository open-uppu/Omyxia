/**
 * Admin Console — Tenant listing wire format (P1.4).
 *
 * Lives in `@omyxia/shared-types` so:
 *   - The admin-console frontend (P2.3) can validate response shapes
 *     at runtime (zod) and parse the same query string the backend
 *     accepts.
 *   - The NestJS API (apps/api) parses the same `URLSearchParams`
 *     shape via `parseAdminTenantFilters` — we re-use the exact
 *     same parser on both sides so they can never drift.
 *
 * Conventions:
 *   - All enum values are SCREAMING_SNAKE_CASE strings.
 *   - All timestamps are ISO 8601 strings.
 *   - All amounts (counts, byte sizes) are plain numbers; the
 *     response is bounded by the API's page size so JSON precision
 *     is safe up to 2^53.
 *   - Empty arrays in the query string are valid filters: an empty
 *     `?plan=` means "no plan filter" (NOT "plan must equal empty").
 *
 * This module is intentionally pure-data — no React, no hooks, no
 * environment reads — so it can be imported from both the React tree
 * and the Node API route handlers.
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

/** Admin-tier plan slug. Mirrors the v2.0.0 `Plan.tier` enum (P1.1).
 *  NOTE: The legacy `Tenant.plan` enum in the DB is STARTER/GROWTH/ENTERPRISE
 *  and is mapped at the API boundary (see
 *  apps/api/src/modules/admin/tenants-admin.service.ts → legacyPlanToWire). */
export const AdminPlanSlugSchema = z.enum(['FREE', 'PRO', 'ENTERPRISE']);
export type AdminPlanSlug = z.infer<typeof AdminPlanSlugSchema>;

/** Tenant lifecycle status. Mirrors `Tenant.status` in the DB. */
export const AdminTenantStatusSchema = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
]);
export type AdminTenantStatus = z.infer<typeof AdminTenantStatusSchema>;

/** Tenant deployment region. The DB column is nullable (new tenants get a
 *  region via P5.1 backfill); the wire format uses `''` as the "unset"
 *  sentinel so the FE never renders "null" as a string. */
export const AdminTenantRegionSchema = z.enum(['eu', 'us', 'apac']);
export type AdminTenantRegion = z.infer<typeof AdminTenantRegionSchema>;

// ============================================================================
// Pagination defaults
// ============================================================================

/** Default page size for the admin tenants list. The API clamps
 *  `pageSize > 200` back to this value. */
export const ADMIN_TENANT_PAGE_SIZE = 25;

/** Hard ceiling: the FE never asks for more than this in a single
 *  page; the API clamps any larger request to the default. */
export const ADMIN_TENANT_MAX_PAGE_SIZE = 200;

// ============================================================================
// Row + filter shapes
// ============================================================================

/** One row in the admin tenants table. The shape is intentionally
 *  flat — every field the table renders is a top-level key so the
 *  FE doesn't have to drill into nested objects. */
export const AdminTenantRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  /** Empty string when `Tenant.domain` is NULL — the FE filter
   *  surfaces "No domain" rather than rendering "null". */
  domain: z.string(),
  plan: AdminPlanSlugSchema,
  status: AdminTenantStatusSchema,
  /** Empty string when `Tenant.region` is NULL. */
  region: z.union([AdminTenantRegionSchema, z.literal('')]),
  /** Count of active `UserTenant` rows. */
  users: z.number().int().nonnegative(),
  /** Sum of `FileItem.size` in bytes. Safe up to 2^53 (~9 PB); omyxia
   *  caps per-tenant storage at 100 TiB so the runtime value never
   *  approaches the limit. */
  storageBytes: z.number().int().nonnegative(),
  /** ISO 8601 — `Tenant.createdAt`. Never null. */
  createdAt: z.string(),
  /** ISO 8601 — max over `AuditLog.createdAt` for any action by a
   *  member of this tenant OR a super_admin targeting this tenant,
   *  with a fallback to `createdAt` when no activity exists yet. */
  lastActivityAt: z.string(),
});
export type AdminTenantRow = z.infer<typeof AdminTenantRowSchema>;

/** The filter envelope the FE sends as a query string and the BE
 *  parses back into a typed object. Keys mirror the documented
 *  query params 1:1. */
export const AdminTenantFilterSchema = z.object({
  /** Substring search on `Tenant.name` OR `Tenant.domain`. */
  q: z.string().default(''),
  plan: z.array(AdminPlanSlugSchema).default([]),
  status: z.array(AdminTenantStatusSchema).default([]),
  region: z.array(AdminTenantRegionSchema).default([]),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(ADMIN_TENANT_PAGE_SIZE),
});
export type AdminTenantFilter = z.infer<typeof AdminTenantFilterSchema>;

// ============================================================================
// Response envelope
// ============================================================================

export const TenantListFiltersEchoSchema = z.object({
  q: z.string(),
  plan: z.array(AdminPlanSlugSchema),
  status: z.array(AdminTenantStatusSchema),
  region: z.array(AdminTenantRegionSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type TenantListFiltersEcho = z.infer<typeof TenantListFiltersEchoSchema>;

/** Top-level response payload for `GET /api/admin/tenants`. */
export const TenantListResponseSchema = z.object({
  /** ISO timestamp the snapshot was generated. The dashboard renders
   *  this in the footer as "Last updated …". */
  generatedAt: z.string(),
  /** Echo of the resolved filters (after normalisation/clamps). */
  filters: TenantListFiltersEchoSchema,
  items: z.array(AdminTenantRowSchema),
  /** Total matching rows across all pages. The FE uses this to render
   *  the pagination footer. */
  total: z.number().int().nonnegative(),
  /** 0-based skip offset (`(page - 1) * pageSize`). Echoed so the
   *  FE can render a "Showing 26–50 of 137" footer without recomputing. */
  skip: z.number().int().nonnegative(),
  /** Effective page size after server-side clamping. Echoed so the FE
   *  knows what the server actually used (its own state may be stale). */
  take: z.number().int().positive(),
});
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;

// ============================================================================
// Query-string parser
// ============================================================================

/**
 * Parse a `URLSearchParams` (or anything URLSearchParams-constructable)
 * into the canonical `AdminTenantFilter` shape. Both the FE and the BE
 * use this — that's the whole point of the shared package.
 *
 * Semantics:
 *   - `q` is taken verbatim (trimmed). Empty / missing → `''`.
 *   - `plan`, `status`, `region` are comma-separated lists. Each token
 *     is validated against its enum; invalid tokens are silently
 *     dropped (the documented "fail soft" behaviour — see P2.3 FE).
 *   - `page` is `parseInt`-parsed with `Number.isFinite` guard; any
 *     non-positive / non-finite value falls back to `1`.
 *   - `pageSize` is clamped to `[1, ADMIN_TENANT_MAX_PAGE_SIZE]`. Values
 *     above the max fall back to `ADMIN_TENANT_PAGE_SIZE` (NOT the max
 *     — we want the documented default behaviour to win so we don't
 *     accidentally serve huge pages).
 *   - Repeated keys (`?plan=FREE&plan=PRO`) are honoured: `searchParams`
 *     already dedupes via `getAll` and we union them.
 *
 * Returns a fully-typed object with all defaults filled in.
 */
export function parseAdminTenantFilters(
  source: URLSearchParams | string | Record<string, unknown>,
): AdminTenantFilter {
  let sp: URLSearchParams;
  if (source instanceof URLSearchParams) {
    sp = source;
  } else if (typeof source === 'string') {
    sp = new URLSearchParams(source);
  } else {
    sp = new URLSearchParams();
    for (const [k, v] of Object.entries(source)) {
      if (v == null) continue;
      const s = Array.isArray(v) ? v.join(',') : String(v);
      if (s.length > 0) sp.set(k, s);
    }
  }

  const q = (sp.get('q') ?? '').trim();

  const plan = splitCsv(sp.get('plan'))
    .map((s) => s.toUpperCase())
    .filter((v): v is AdminPlanSlug => AdminPlanSlugSchema.safeParse(v).success);

  const status = splitCsv(sp.get('status'))
    .map((s) => s.toUpperCase())
    .filter((v): v is AdminTenantStatus =>
      AdminTenantStatusSchema.safeParse(v).success,
    );

  const region = splitCsv(sp.get('region'))
    .map((s) => s.toLowerCase())
    .filter((v): v is AdminTenantRegion =>
      AdminTenantRegionSchema.safeParse(v).success,
    );

  const page = parsePositiveInt(sp.get('page'), 1);
  // pageSize: clamp > max → default (per doc); clamp < 1 → default.
  const rawPageSize = parsePositiveInt(sp.get('pageSize'), ADMIN_TENANT_PAGE_SIZE);
  const pageSize =
    rawPageSize > ADMIN_TENANT_MAX_PAGE_SIZE ? ADMIN_TENANT_PAGE_SIZE : rawPageSize;

  return AdminTenantFilterSchema.parse({
    q,
    plan,
    status,
    region,
    page,
    pageSize,
  });
}

function splitCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}