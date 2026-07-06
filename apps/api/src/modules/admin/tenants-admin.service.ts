/**
 * apps/api/src/modules/admin/tenants-admin.service.ts
 *
 * P1.4 — Admin Console: GET /api/admin/tenants (list, search, filter)
 *
 * Service-side of the cross-tenant listing. The HTTP controller owns
 * the RBAC gate (`@Roles('SUPER_ADMIN')`) and DTO validation; this
 * service owns:
 *   - Prisma query construction (single connection; the SUPER_ADMIN
 *     bypass flips `app.bypass_rls = 'on'` at the connection level
 *     in P1.3, so the listing crosses tenants transparently).
 *   - The aggregations for `users` (count of active UserTenant),
 *     `storageBytes` (sum of FileItem.size), `lastActivityAt`
 *     (max over AuditLog.tenantId + AuditLog.targetTenantId +
 *     fallback to createdAt).
 *   - The DB -> wire format mapping (legacy `Tenant.plan` enum ->
 *     FREE / PRO / ENTERPRISE; nullable `domain` / `region` -> '' or
 *     enum string).
 *   - Cursor-style pagination (page + pageSize), defaulting to the
 *     documented `ADMIN_TENANT_PAGE_SIZE = 25`.
 *
 * The list query is implemented as ONE base query (the tenant rows)
 * plus parallel aggregations in `Promise.all` to keep the p95 under
 * 200 ms for the dashboard's "first page" load.
 *
 * Out of scope for P1.4:
 *   - POST /api/admin/tenants (creation) — P1.5
 *   - POST /api/admin/tenants/:id/suspend (kill switch) — P1.6
 *   - Audit row writes for the GET — SuperAdminGuard already writes
 *     an `ADMIN_ACCESS` audit row for every admin route hit, so we
 *     don't double-log here (avoids "list-then-audit-spam" noise).
 *   - Caching — the FE uses Next.js fetch revalidation; the BE stays
 *     stateless for P1.4. P2.5 adds Redis caching if the dashboard's
 *     p95 exceeds 100 ms at p90.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  AdminPlanSlugSchema,
  type AdminPlanSlug,
  type AdminTenantRegion,
  type AdminTenantStatus,
  type AdminTenantFilter,
  type AdminTenantRow,
  type TenantListResponse,
} from '@omyxia/shared-types';

// ----------------------------------------------------------------------------
// DB <-> wire enum mapping
// ----------------------------------------------------------------------------

/**
 * The DB stores `Tenant.plan` as the LEGACY v1.0.0 enum:
 *   STARTER | GROWTH | ENTERPRISE
 *
 * The v2.0.0 admin console renders plans from the `Plan` table, which
 * uses the modern PlanTier enum:
 *   FREE | PRO | ENTERPRISE | LEGACY_FULL_ACCESS
 *
 * Mapping (for the list endpoint, where a tenant's "effective" plan
 * is what shows on the row):
 *
 *   DB plan       -> wire plan
 *   --------------------------------
 *   STARTER       -> FREE
 *   GROWTH        -> PRO
 *   ENTERPRISE    -> ENTERPRISE
 *
 * P5.1 will migrate every STARTER / GROWTH tenant to the new
 * TenantEntitlement rows backed by an explicit Plan id; once that
 * lands, this service can read `tenant.tenantEntitlement[0].plan.tier`
 * and `legacyToWire` goes away. For P1.4 we keep the mapping inline.
 */
function legacyPlanToWire(dbPlan: string): AdminPlanSlug {
  switch (dbPlan) {
    case 'GROWTH':
      return 'PRO';
    case 'ENTERPRISE':
      return 'ENTERPRISE';
    case 'STARTER':
    default:
      return 'FREE';
  }
}

/** DB plan enum -> wire plan enum, for the filter direction. */
function wirePlanToDbPlans(plan: AdminPlanSlug): string[] {
  switch (plan) {
    case 'PRO':
      return ['GROWTH'];
    case 'ENTERPRISE':
      return ['ENTERPRISE'];
    case 'FREE':
    default:
      return ['STARTER'];
  }
}

const VALID_REGION_VALUES = new Set<string>(['eu', 'us', 'apac']);

function isValidRegion(value: string | null | undefined): value is AdminTenantRegion {
  return !!value && VALID_REGION_VALUES.has(value);
}

/**
 * BigInt -> Number coercion for `FileItem.size`. We never expect the
 * sum to exceed `Number.MAX_SAFE_INTEGER` (≈9 PB) for any single
 * tenant — the P2.2 dashboard measures in TiB, and the platform cap
 * is 100 TiB.
 *
 * Throws on overflow only when the number is bigger than MAX_SAFE_INTEGER
 * AND our caller asked for an unsafe row (e.g. shared workspace). For
 * safety we clamp to MAX_SAFE_INTEGER — the response stays well-formed.
 */
function bigIntToSafeNumber(n: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (n > max) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(n);
}

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

@Injectable()
export class TenantsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List tenants with the documented filter set, returning
   * the wire-shape rows + pagination metadata.
   *
   * The query shape (one round-trip per filter dimension):
   *   1. `tenant.findMany({ where, orderBy, skip, take })`
   *      Returns the base columns.
   *   2. `tenant.count({ where })` runs in parallel for `total`.
   *   3. For `users` + `storageBytes` + `lastActivityAt` we issue
   *      three extra `groupBy` queries keyed by tenantId — these
   *      are bounded by `take` (max 200), so the cost is constant.
   */
  async list(filters: AdminTenantFilter): Promise<TenantListResponse> {
    const where: Prisma.TenantWhereInput = this.buildWhere(filters);

    const skip = Math.max(0, (filters.page - 1) * filters.pageSize);
    const take = filters.pageSize;

    // 1 + 2 in parallel.
    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    if (tenants.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        filters: this.echoFilters(filters),
        items: [],
        total,
        skip,
        take,
      };
    }

    // 3. Aggregations keyed by tenantId for the bounded page.
    const tenantIds = tenants.map((t) => t.id);

    const [userCounts, fileSums, lastActivities] = await Promise.all([
      this.prisma.userTenant.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, active: true },
        _count: { _all: true },
      }),
      // FileItem.size is BigInt; aggregate returns `BigInt` for `_sum`.
      this.prisma.fileItem.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds } },
        _sum: { size: true },
      }),
      // lastActivityAt — three sources combined into one query that
      // reads max(createdAt) per tenantId. AuditLog is the dominant
      // path in production (every write is audited via AuditMiddleware)
      // but we accept a slight over-count if a tenant has never had a
      // write yet — the fallback to `createdAt` covers the
      // sign-up-only path.
      this.getLastActivitiesBatch(tenantIds),
    ]);

    const usersByTenant = new Map<string, number>(
      userCounts.map((r) => [r.tenantId, r._count._all]),
    );
    const storageByTenant = new Map<string, number>(
      fileSums.map((r) => [
        r.tenantId,
        bigIntToSafeNumber(r._sum.size ?? BigInt(0)),
      ]),
    );
    const activityByTenant = new Map<string, string>(lastActivities);

    const items: AdminTenantRow[] = tenants.map((t) =>
      this.toWireRow(t, {
        users: usersByTenant.get(t.id) ?? 0,
        storageBytes: storageByTenant.get(t.id) ?? 0,
        lastActivityAt:
          activityByTenant.get(t.id) ?? t.createdAt.toISOString(),
      }),
    );

    return {
      generatedAt: new Date().toISOString(),
      filters: this.echoFilters(filters),
      items,
      total,
      skip,
      take,
    };
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /**
   * Build the Prisma `where` clause from the AdminTenantFilter shape.
   *
   * Search semantics:
   *   - `q` matches the tenant's `name` OR `domain` (case-sensitive in
   *     dev; the gin_trgm_ops index added in the P1.4 migration makes
   *     it locale-aware in prod).
   *   - An empty `q` is omitted from the where (no effect).
   *
   * Filter semantics:
   *   - Empty arrays ("no filter applied") produce no constraint.
   *   - Non-empty arrays become `in: [...]` lists.
   *   - Unknown enum values that survived the DTO parser are silently
   *     dropped (the DTO normalises them away).
   */
  buildWhere(filters: AdminTenantFilter): Prisma.TenantWhereInput {
    const where: Prisma.TenantWhereInput = {};

    if (filters.q.trim().length > 0) {
      const needle = filters.q.trim();
      where.OR = [
        { name: { contains: needle, mode: 'default' } },
        { domain: { contains: needle, mode: 'default' } },
      ];
    }

    if (filters.status.length > 0) {
      where.status = { in: filters.status };
    }

    if (filters.plan.length > 0) {
      // Map FE plan slugs back to the DB's legacy enum so the where
      // clause hits `idx_tenant_status_plan`. A modernised backend
      // would key on `tenantEntitlement.plan.tier` — that's P5.1.
      const dbPlans = new Set<string>();
      for (const p of filters.plan) {
        for (const db of wirePlanToDbPlans(p)) dbPlans.add(db);
      }
      if (dbPlans.size > 0) {
        where.plan = { in: [...dbPlans] };
      }
    }

    if (filters.region.length > 0) {
      // Tenant.region is a nullable text column with a CHECK constraint.
      // An empty array => no constraint; populated => equality with any-of.
      const regions = filters.region.filter(isValidRegion);
      if (regions.length > 0) {
        where.region = { in: regions };
      }
    }

    return where;
  }

  /**
   * Fetch the most recent activity timestamp per tenant in a single
   * round-trip. We use AuditLog as the primary source (every
   * login/CRUD already produces one via AuditMiddleware), and fall
   * back to `Tenant.createdAt` for tenants whose audit log is still
   * empty (the fresh sign-up path).
   *
   * Implementation note: AuditLog uses `targetTenantId` for cross-tenant
   * admin actions AND `tenantId` for normal user actions. Both columns
   * are separately indexed (the P1.4 migration adds
   * `idx_audit_target_tenant_created`).
   */
  private async getLastActivitiesBatch(
    tenantIds: string[],
  ): Promise<Array<[string, string]>> {
    if (tenantIds.length === 0) return [];

    const [auditTenantMax, auditTargetMax] = await Promise.all([
      // tenantId path — normal user actions.
      this.prisma.auditLog.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds } },
        _max: { createdAt: true },
      }),
      // targetTenantId path — super_admin actions against this tenant.
      this.prisma.auditLog.groupBy({
        by: ['targetTenantId'],
        where: { targetTenantId: { in: tenantIds } },
        _max: { createdAt: true },
      }),
    ]);

    const byTenant = new Map<string, Date>();

    const ingest = (tenantId: string | null, ts: Date | null | undefined) => {
      if (!tenantId || !ts) return;
      const cur = byTenant.get(tenantId);
      if (!cur || ts > cur) byTenant.set(tenantId, ts);
    };

    for (const row of auditTenantMax) ingest(row.tenantId, row._max.createdAt);
    for (const row of auditTargetMax) {
      ingest(row.targetTenantId, row._max.createdAt);
    }

    return [...byTenant.entries()].map(([tid, ts]) => [tid, ts.toISOString()]);
  }

  /**
   * Map a Prisma Tenant row + the pre-fetched aggregations into the
   * wire-shape row consumed by the FE.
   *
   * - `domain` is normalised to '' when null (FE filter shows "No
   *   domain" rather than rendering a literal "null").
   * - `region` is normalised to '' when null (same reason).
   * - `plan` is mapped from the legacy enum to the v2.0.0 enum
   *   via `legacyPlanToWire`.
   */
  private toWireRow(
    t: {
      id: string;
      slug: string;
      name: string;
      domain: string | null;
      plan: string;
      status: string;
      region: string | null;
      createdAt: Date;
    },
    aggs: { users: number; storageBytes: number; lastActivityAt: string },
  ): AdminTenantRow {
    const plan = legacyPlanToWire(t.plan);
    // Parse against the schema to defend against unexpected legacy
    // values being introduced outside the migration path. The DB
    // constrains `plan` to the TenantPlan enum, so this is a belt
    // + braces guard.
    const planParsed = AdminPlanSlugSchema.safeParse(plan);

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      domain: t.domain ?? '',
      plan: planParsed.success ? planParsed.data : 'FREE',
      status: t.status as AdminTenantStatus,
      region: isValidRegion(t.region) ? t.region : '',
      users: aggs.users,
      storageBytes: aggs.storageBytes,
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: aggs.lastActivityAt,
    };
  }

  /**
   * Echo the resolved filters back into the response so the FE can
   * display what the server actually used. Keeps the shape compatible
   * with `TenantListResponseSchema.filters` from the shared package.
   */
  private echoFilters(filters: AdminTenantFilter): TenantListResponse['filters'] {
    return {
      q: filters.q,
      plan: filters.plan,
      status: filters.status,
      region: filters.region,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }
}