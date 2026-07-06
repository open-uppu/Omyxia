/**
 * apps/api/src/modules/admin/admin.tenants.dto.ts
 *
 * P1.4 — DTOs for GET /api/admin/tenants.
 *
 * Why a separate, looser DTO here vs. `@omyxia/shared-types`'s
 * `parseAdminTenantFilters`?
 *
 *   - `parseAdminTenantFilters` is the shared parser — it lives in
 *     `@omyxia/shared-types` and produces the runtime
 *     `AdminTenantFilter` shape consumed by the FE and (in mock
 *     dev mode) by `apps/admin-console/src/app/api/admin/tenants`.
 *   - The NestJS controller here is the source of truth once the
 *     `apps/admin-console` Next.js route layer is retired. Its DTO
 *     validates the raw HTTP query string (strings, possible empty
 *     values, optional `?key=`-only CSVs) and produces the SAME
 *     `AdminTenantFilter` shape. We re-export the parser and the
 *     types so we never drift from the FE parser: whatever the FE
 *     accepts, we accept — and vice versa.
 *
 * The FE/backend drift risk is enforced by the shared-types test
 * suite (`admin-tenants.test.ts`) which is run by both projects.
 */

import { z } from 'zod';
import {
  AdminPlanSlugSchema,
  AdminTenantStatusSchema,
  AdminTenantRegionSchema,
  ADMIN_TENANT_PAGE_SIZE,
  parseAdminTenantFilters,
  type AdminPlanSlug,
  type AdminTenantStatus,
  type AdminTenantRegion,
  type AdminTenantFilter,
  type AdminTenantRow as SharedAdminTenantRow,
  type TenantListResponse as SharedTenantListResponse,
} from '@omyxia/shared-types';

// ----------------------------------------------------------------------------
// Re-exports — keep one canonical home for the enums and the page-size
// constant. The NestJS controller imports these from here so that
// swapping out the implementation (e.g. moving to a class-validator
// DTO) only changes one file.
// ----------------------------------------------------------------------------

export {
  AdminPlanSlugSchema,
  AdminTenantStatusSchema,
  AdminTenantRegionSchema,
  ADMIN_TENANT_PAGE_SIZE,
};
export type {
  AdminPlanSlug,
  AdminTenantStatus,
  AdminTenantRegion,
};

// ----------------------------------------------------------------------------
// Raw HTTP query — strings, possibly empty, possibly duplicated.
//
// We accept either a `URLSearchParams` instance (the common case in Nest
// via the @Query() decorator) or a plain `Record<string, unknown>` (the
// case for tests + the legacy `app/admin/tenants/route.ts` proxy).
// ----------------------------------------------------------------------------

export const TenantListQuerySchema = z
  .object({
    q: z.string().optional(),
    plan: z.string().optional(),
    status: z.string().optional(),
    region: z.string().optional(),
    page: z.string().optional(),
    pageSize: z.string().optional(),
  })
  .passthrough();

export type TenantListQuery = z.infer<typeof TenantListQuerySchema>;

/**
 * Server-side parser — converts raw HTTP query into the
 * `AdminTenantFilter` shape the FE already understands.
 *
 * Just delegates to the shared parser (no FE/BE drift).
 */
export function parseTenantListQuery(
  query: TenantListQuery | Record<string, unknown>,
): AdminTenantFilter {
  return parseAdminTenantFilters(query as Record<string, unknown>);
}

// ----------------------------------------------------------------------------
// Server-side response shape — type-only re-exports of the shared
// zod schemas so the controller can `as const`-narrow each row's
// shape without depending on the FE package at runtime.
// ----------------------------------------------------------------------------

export type AdminTenantRow = SharedAdminTenantRow;
export type TenantListResponse = SharedTenantListResponse;

/**
 * Re-exported alias for callers that prefer the DTO-namespace.
 *
 * Equivalent to `TenantListResponse` — the response shape lives in
 * `@omyxia/shared-types` and is duplicated here only as a type
 * re-export so the NestJS layer doesn't have to import the shared
 * package at runtime for typing.
 */
export type TenantListResponseDto = TenantListResponse;

// ----------------------------------------------------------------------------
// Suppress unused-imports for type-only imports that the bundler
// would otherwise strip (these aliases make the intent obvious in
// grep / IDE search).
// ----------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _schemas = [
  AdminPlanSlugSchema,
  AdminTenantStatusSchema,
  AdminTenantRegionSchema,
] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _pageSize = ADMIN_TENANT_PAGE_SIZE;
void _schemas;
void _pageSize;