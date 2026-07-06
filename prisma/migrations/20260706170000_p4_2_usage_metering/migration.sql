-- omyxia v2.0.0 P4.2 — Usage metering (storage + API calls → invoice items)
--
-- Adds per-tenant per-day tracking of three meters:
--   STORAGE_GB_HOURS  — total storage (GB·h, sum of hourly samples)
--   API_CALL_COUNT    — authenticated API call counter
--   ACTIVE_USERS      — distinct active users per day
--
-- Adds six new tables:
--   * PlanUsageQuota           — per-plan included quota + overage prices
--   * TenantUsageDaily         — daily per-tenant per-meter rollup
--   * TenantUsageEvent         — fine-grained event log (90d retention)
--   * MeteredUsageReport       — month-end usage reports to push to Stripe
--   * MeteredSubscriptionItem  — joins StripeSubscriptionItem → a meter
--   * OverageInvoiceItem       — overage line items appended to Stripe invoices
--
-- Adds three new enums: UsageMeter, UsageReportStatus, OverageStatus.
--
-- Tenant and Plan gain inverse relation fields (managed by Prisma). The
-- `Tenant` and `Plan` table definitions are not touched here — the
-- `@@relation` side is added by `prisma generate` and the table layout
-- is unchanged for existing rows.
--
-- StripeSubscriptionItem gains an optional `metered` relation row in
-- `MeteredSubscriptionItem`. We do NOT add a column to StripeSubscriptionItem
-- itself; the relation is the join key.
--
-- RLS: All new tables have `tenantId` so they fit under the existing
-- `app.current_tenant` RLS pattern (P1.3). The catalog tables
-- (`PlanUsageQuota`, `MeteredSubscriptionItem`) are tenantId-less and
-- follow the catalog-level access pattern (super_admin only).
--
-- Rollback notes: dropping the new tables is safe; nothing references
-- them from existing tables except the inverse relations on
-- Tenant/Plan/StripeSubscriptionItem, which are managed by Prisma.

-- =========================================================================
-- Enums
-- =========================================================================

-- CreateEnum
CREATE TYPE "UsageMeter" AS ENUM ('STORAGE_GB_HOURS', 'API_CALL_COUNT', 'ACTIVE_USERS');

-- CreateEnum
CREATE TYPE "UsageReportStatus" AS ENUM ('PENDING', 'SENT_TO_STRIPE', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "OverageStatus" AS ENUM ('PENDING', 'INVOICED', 'REFUNDED', 'FAILED');

-- =========================================================================
-- PlanUsageQuota (catalog — no tenantId)
-- =========================================================================

-- CreateTable
CREATE TABLE "PlanUsageQuota" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "storageGb" DECIMAL(15,4),
    "apiCalls" INTEGER,
    "activeUsers" INTEGER,
    "storageOveragePrice" DECIMAL(15,4),
    "apiCallOveragePrice" DECIMAL(15,4),
    "activeUserOveragePrice" DECIMAL(15,4),
    "apiCallsHardCap" INTEGER,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanUsageQuota_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "PlanUsageQuota" ADD CONSTRAINT "PlanUsageQuota_planId_key" UNIQUE ("planId");

-- AddIndex
CREATE INDEX "idx_plan_usage_quota_plan" ON "PlanUsageQuota" ("planId");

-- AddForeignKey
ALTER TABLE "PlanUsageQuota" ADD CONSTRAINT "PlanUsageQuota_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- TenantUsageDaily (per-tenant per-day rollup)
-- =========================================================================

-- CreateTable
CREATE TABLE "TenantUsageDaily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meter" "UsageMeter" NOT NULL,
    "usageDate" DATE NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "breakdown" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantUsageDaily_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "TenantUsageDaily" ADD CONSTRAINT "TenantUsageDaily_idempotencyKey_key" UNIQUE ("idempotencyKey");

-- AddUniqueConstraint
ALTER TABLE "TenantUsageDaily" ADD CONSTRAINT "TenantUsageDaily_tenantId_meter_usageDate_key" UNIQUE ("tenantId", "meter", "usageDate");

-- AddIndex
CREATE INDEX "idx_tenant_usage_daily_date" ON "TenantUsageDaily" ("usageDate");
CREATE INDEX "idx_tenant_usage_daily_tenant_date" ON "TenantUsageDaily" ("tenantId", "usageDate");
CREATE INDEX "idx_tenant_usage_daily_meter_date" ON "TenantUsageDaily" ("meter", "usageDate");

-- AddForeignKey
ALTER TABLE "TenantUsageDaily" ADD CONSTRAINT "TenantUsageDaily_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- TenantUsageEvent (fine-grained, 90d retention)
-- =========================================================================

-- CreateTable
CREATE TABLE "TenantUsageEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "meter" "UsageMeter" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregatedAt" TIMESTAMP(6),

    CONSTRAINT "TenantUsageEvent_pkey" PRIMARY KEY ("id")
);

-- AddIndex
CREATE INDEX "idx_tenant_usage_event_tenant_time" ON "TenantUsageEvent" ("tenantId", "occurredAt");
CREATE INDEX "idx_tenant_usage_event_meter_time" ON "TenantUsageEvent" ("meter", "occurredAt");
CREATE INDEX "idx_tenant_usage_event_aggregated" ON "TenantUsageEvent" ("aggregatedAt");

-- AddForeignKey
ALTER TABLE "TenantUsageEvent" ADD CONSTRAINT "TenantUsageEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- MeteredUsageReport (month-end reports to push to Stripe)
-- =========================================================================

-- CreateTable
CREATE TABLE "MeteredUsageReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "meter" "UsageMeter" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "stripeUsageRecordId" TEXT,
    "stripeSubscriptionItemId" TEXT,
    "status" "UsageReportStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "reportedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeteredUsageReport_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "MeteredUsageReport" ADD CONSTRAINT "MeteredUsageReport_tenantId_meter_periodStart_key" UNIQUE ("tenantId", "meter", "periodStart");

-- AddIndex
CREATE INDEX "idx_metered_usage_report_status" ON "MeteredUsageReport" ("status", "reportedAt");
CREATE INDEX "idx_metered_usage_report_period" ON "MeteredUsageReport" ("periodEnd");

-- AddForeignKey
ALTER TABLE "MeteredUsageReport" ADD CONSTRAINT "MeteredUsageReport_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- MeteredSubscriptionItem (joins StripeSubscriptionItem → meter)
-- =========================================================================

-- CreateTable
CREATE TABLE "MeteredSubscriptionItem" (
    "id" TEXT NOT NULL,
    "subscriptionItemId" TEXT NOT NULL,
    "meter" "UsageMeter" NOT NULL,
    "stripeSubscriptionItemId" TEXT,
    "stripeMeteredPriceId" TEXT NOT NULL,
    "reportingUnit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeteredSubscriptionItem_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "MeteredSubscriptionItem" ADD CONSTRAINT "MeteredSubscriptionItem_subscriptionItemId_key" UNIQUE ("subscriptionItemId");

-- AddIndex
CREATE INDEX "idx_metered_sub_item_meter" ON "MeteredSubscriptionItem" ("meter");
CREATE INDEX "idx_metered_sub_item_stripe_id" ON "MeteredSubscriptionItem" ("stripeSubscriptionItemId");

-- AddForeignKey
ALTER TABLE "MeteredSubscriptionItem" ADD CONSTRAINT "MeteredSubscriptionItem_subscriptionItemId_fkey"
    FOREIGN KEY ("subscriptionItemId") REFERENCES "StripeSubscriptionItem"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- =========================================================================
-- OverageInvoiceItem (overage charges → Stripe invoice items)
-- =========================================================================

-- CreateTable
CREATE TABLE "OverageInvoiceItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meter" "UsageMeter" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "includedQuantity" DECIMAL(20,6) NOT NULL,
    "actualQuantity" DECIMAL(20,6) NOT NULL,
    "overageQuantity" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(15,4) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripeInvoiceItemId" TEXT,
    "stripeInvoiceId" TEXT,
    "status" "OverageStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "invoicedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverageInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "OverageInvoiceItem" ADD CONSTRAINT "OverageInvoiceItem_tenantId_meter_periodStart_key" UNIQUE ("tenantId", "meter", "periodStart");

-- AddIndex
CREATE INDEX "idx_overage_invoice_item_status" ON "OverageInvoiceItem" ("status", "periodEnd");
CREATE INDEX "idx_overage_invoice_item_tenant_period" ON "OverageInvoiceItem" ("tenantId", "periodEnd");

-- AddForeignKey
ALTER TABLE "OverageInvoiceItem" ADD CONSTRAINT "OverageInvoiceItem_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;