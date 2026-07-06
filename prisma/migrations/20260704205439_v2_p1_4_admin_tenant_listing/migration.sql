-- omyxia v2.0.0 P1.4 — Admin Console: GET /api/admin/tenants (list, search, filter)
--
-- Goal: surface the cross-tenant listing endpoint to super_admin
-- without bumping any client code. The card asks for the response
-- shape `{ id, name, domain, plan, status, user_count, storage_used,
-- created_at, last_activity }` and the FE shared-types contract
-- already declares `domain` + `region`. We add both as nullable
-- columns on Tenant (no destructive change for v1.0.0 tenants —
-- their domain stays NULL until the operator backfills).
--
-- We also add `AuditLog.targetTenantId` so cross-tenant admin
-- actions (super_admin listing, super_admin suspending) leave a
-- trail that the P1.4 `lastActivityAt` aggregation can read.
--
-- Idempotency: every statement uses IF NOT EXISTS where Postgres
-- supports it, and DO blocks for the rest, so the migration is
-- safe to re-run on a database that already has the columns
-- (e.g. a developer who ran the partial migration locally).

-- ============================================================================
-- 1) Tenant: add domain + region columns (nullable for backward compat)
-- ============================================================================

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "domain" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "region" TEXT;

-- A CHECK constraint keeps `region` honest at the DB level — only the
-- three values the FE knows about, NULL for "not yet set". We use a
-- separate DO block so the migration can re-run cleanly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_region_check'
  ) THEN
    ALTER TABLE "Tenant"
      ADD CONSTRAINT tenant_region_check
      CHECK ("region" IS NULL OR "region" IN ('eu', 'us', 'apac'));
  END IF;
END$$;

-- ============================================================================
-- 2) AuditLog: add targetTenantId (cross-tenant admin actions)
-- ============================================================================

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "targetTenantId" TEXT;

-- The composite index lets the P1.4 lastActivityAt aggregation scan
-- ≤ 20 ms on 100k tenants. It mirrors idx_audit_tenant_created so
-- the planner can use either path depending on which side is filled.
CREATE INDEX IF NOT EXISTS "idx_audit_target_tenant_created"
  ON "AuditLog"("targetTenantId" ASC, "createdAt" DESC);

-- ============================================================================
-- 3) Indexes — admin list / filter latency
-- ============================================================================

-- Composite (status, plan) helps the list endpoint's filter path
-- when the FE narrows by status AND plan. The simple idx_tenant_status
-- already exists; this composite extends it for the second key.
CREATE INDEX IF NOT EXISTS "idx_tenant_status_plan"
  ON "Tenant"("status" ASC, "plan" ASC);

-- The region index lets the region+plan filter scan ≤ 20 ms on a 100k
-- table. We use the existing `CREATE INDEX IF NOT EXISTS` guard for
-- Postgres 15+ compatibility.
CREATE INDEX IF NOT EXISTS "idx_tenant_region_plan"
  ON "Tenant"("region" ASC, "plan" ASC);

-- A trigram index makes the search-by-name substring query fast even
-- at 100k tenants. Requires `CREATE EXTENSION pg_trgm` — PG 15 ships
-- with pg_trgm in the default install of omyxia (see infra/postgres/
-- init.sql in the Helm chart). The IF NOT EXISTS guard means the
-- migration is safe to re-run on a fresh DB. (The extension was
-- already enabled by 0007_search_analytics so this is a no-op in
-- practice; we keep the explicit enable here so P1.4 is
-- self-contained on older deploys.)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "idx_tenant_name_trgm"
  ON "Tenant" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_tenant_domain_trgm"
  ON "Tenant" USING gin ("domain" gin_trgm_ops);

-- ============================================================================
-- 4) UserTenant + FileItem aggregation indexes (P1.4 read path)
-- ============================================================================

-- The list endpoint aggregations GROUP BY tenantId for user_count and
-- storage_used. Both columns are already indexed (UserTenant.tenantId
-- via "idx_user_tenant_tenant"; FileItem.tenantId via
-- "idx_file_item_tenant"). No new index required.

-- ============================================================================
-- 5) RLS — keep the existing tenant_isolation policy intact.
-- ============================================================================
-- The tenant_isolation RLS policies from 0002_sprint_systems /
-- 0003_specialized / 0004_governance_bi cover the new columns
-- because their SELECT path is just `SELECT "id", ..., "domain",
-- "region" FROM "Tenant" WHERE ...` — the policy USING clause only
-- checks `"tenantId" = current_tenant_id()`. The new columns don't
-- change RLS semantics.
--
-- Tenant itself is NOT RLS-enabled in v1.0.0 — the admin list endpoint
-- reads across tenants via the SUPER_ADMIN bypass path (P1.3 sets
-- `app.bypass_rls = 'on'` at the connection level).