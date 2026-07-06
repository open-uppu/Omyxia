-- omyxia v2.0.0 P1.1 — Admin Console schema (plans, plan_features, add_ons,
-- tenant_entitlements, tenant_entitlement_add_ons, impersonation_sessions)
--
-- NOTE: This migration intentionally does NOT drop pre-existing tables that
-- are not declared in schema.prisma (e.g. SearchIndex, AnalyticsEvent from
-- 0007_search_analytics). They are untracked drift and will require a
-- follow-up schema declaration to prevent future `prisma migrate dev` runs
-- from attempting to drop them again. Out of scope for P1.1.

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO', 'ENTERPRISE', 'LEGACY_FULL_ACCESS');

-- CreateEnum
CREATE TYPE "AddOnAppliesTo" AS ENUM ('ALL', 'FREE', 'PRO', 'ENTERPRISE');
-- AlterEnum
ALTER TYPE "TenantRole" ADD VALUE 'SUPER_ADMIN';

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "revokedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "appliesTo" "AddOnAppliesTo" NOT NULL DEFAULT 'ALL',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(6) NOT NULL,
    "expiresAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantEntitlementAddOn" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantEntitlementAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(6) NOT NULL,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "endedAt" TIMESTAMP(6),
    "auditLogId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "idx_refresh_token_user" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "idx_refresh_token_expires" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "idx_plan_tier" ON "Plan"("tier");

-- CreateIndex
CREATE INDEX "idx_plan_active" ON "Plan"("isActive");

-- CreateIndex
CREATE INDEX "idx_plan_feature_plan" ON "PlanFeature"("planId");

-- CreateIndex
CREATE INDEX "idx_plan_feature_key" ON "PlanFeature"("featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureKey_key" ON "PlanFeature"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_name_key" ON "AddOn"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_slug_key" ON "AddOn"("slug");

-- CreateIndex
CREATE INDEX "idx_add_on_applies_to" ON "AddOn"("appliesTo");

-- CreateIndex
CREATE INDEX "idx_add_on_active" ON "AddOn"("isActive");

-- CreateIndex
CREATE INDEX "idx_tenant_entitlement_tenant" ON "TenantEntitlement"("tenantId");

-- CreateIndex
CREATE INDEX "idx_tenant_entitlement_effective" ON "TenantEntitlement"("tenantId", "effectiveAt");

-- CreateIndex
CREATE INDEX "idx_tenant_entitlement_plan" ON "TenantEntitlement"("planId");

-- CreateIndex
CREATE INDEX "idx_tenant_ent_addon_ent" ON "TenantEntitlementAddOn"("entitlementId");

-- CreateIndex
CREATE INDEX "idx_tenant_ent_addon_addon" ON "TenantEntitlementAddOn"("addOnId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantEntitlementAddOn_entitlementId_addOnId_key" ON "TenantEntitlementAddOn"("entitlementId", "addOnId");

-- CreateIndex
CREATE INDEX "idx_impersonation_tenant" ON "ImpersonationSession"("tenantId");

-- CreateIndex
CREATE INDEX "idx_impersonation_super_admin" ON "ImpersonationSession"("superAdminId");

-- CreateIndex
CREATE INDEX "idx_impersonation_expires" ON "ImpersonationSession"("expiresAt");

-- CreateIndex
CREATE INDEX "idx_impersonation_active" ON "ImpersonationSession"("tenantId", "endedAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TenantEntitlement" ADD CONSTRAINT "TenantEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TenantEntitlement" ADD CONSTRAINT "TenantEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TenantEntitlementAddOn" ADD CONSTRAINT "TenantEntitlementAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TenantEntitlementAddOn" ADD CONSTRAINT "TenantEntitlementAddOn_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "TenantEntitlement"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "AuditLog"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- Row Level Security — per multi-tenant rules (companies/omyxia.md §v2.0.0)
-- ----------------------------------------------------------------------------
-- Catalog tables (global, no tenantId, no RLS):
--   - Plan, PlanFeature, AddOn are accessible to all authenticated users
--     for read; write restricted to SUPER_ADMIN via P1.3 middleware.
--
-- Tenant-scoped tables (RLS):
--   - TenantEntitlement must match current_tenant_id()
--   - ImpersonationSession must match current_tenant_id()
--   - TenantEntitlementAddOn is reached via its TenantEntitlement (parent)
--     and inherits the same tenant scope by joins.
-- =========================================================================

-- TenantEntitlement
ALTER TABLE "TenantEntitlement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "TenantEntitlement"
  USING ("tenantId" = current_tenant_id()::TEXT)
  WITH CHECK ("tenantId" = current_tenant_id()::TEXT);

-- ImpersonationSession
ALTER TABLE "ImpersonationSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ImpersonationSession"
  USING ("tenantId" = current_tenant_id()::TEXT)
  WITH CHECK ("tenantId" = current_tenant_id()::TEXT);
