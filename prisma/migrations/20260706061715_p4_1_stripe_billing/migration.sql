-- omyxia v2.0.0 P4.1 — Stripe billing integration: subscriptions + add-on proration
--
-- Adds:
--   * stripePriceId / stripeProductId columns on Plan + AddOn catalog
--   * stripeCustomerId convenience column on Tenant (1:1 to Stripe customer)
--   * StripeCustomer         — per-tenant Stripe customer record
--   * StripeSubscription     — per-tenant current subscription snapshot
--   * StripeSubscriptionItem — base plan + add-on line items, proration-aware
--   * StripeWebhookEvent     — idempotency log for incoming webhooks
--
-- Write access to the new tables is restricted to:
--   * Super-admin (catalog writes, e.g. via admin console)
--   * StripeService         (Stripe-issued changes via webhook + portal)
--   * TenantContext         (tenant-owned billing actions via /api/billing/*)
--
-- Like the P1.1 admin-console migration, this intentionally does NOT drop
-- untracked tables (SearchIndex, AnalyticsEvent etc.). Out of scope for P4.1.
--
-- Rollback notes: dropping the new tables is safe; the catalog columns are
-- nullable and removing them does not break existing rows.

-- =========================================================================
-- Catalog extensions: Plan + AddOn + Tenant
-- =========================================================================

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "stripeProductId" TEXT;

-- Backfill is INTENTIONALLY skipped: catalog writes happen via the admin
-- console or Prisma seed migrations; existing dev rows stay un-mapped.

-- AddUniqueConstraint
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_stripePriceId_key" UNIQUE ("stripePriceId");

-- AddIndex (handles the case where Plan.stripePriceId is null)
CREATE INDEX "idx_plan_stripe_price" ON "Plan" ("stripePriceId");

-- AlterTable
ALTER TABLE "AddOn" ADD COLUMN "stripePriceId" TEXT;

-- AddUniqueConstraint
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_stripePriceId_key" UNIQUE ("stripePriceId");

-- AddIndex
CREATE INDEX "idx_add_on_stripe_price" ON "AddOn" ("stripePriceId");

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "stripeCustomerId" TEXT;

-- AddUniqueConstraint
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_stripeCustomerId_key" UNIQUE ("stripeCustomerId");

-- =========================================================================
-- New enums
-- =========================================================================

-- CreateEnum
CREATE TYPE "StripeItemKind" AS ENUM ('BASE_PLAN', 'ADDON');

-- CreateEnum
CREATE TYPE "StripeSubscriptionStatus" AS ENUM (
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'CANCELED',
  'UNPAID',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'PAUSED'
);

-- CreateEnum
CREATE TYPE "StripeWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'SKIPPED');

-- =========================================================================
-- New tables: StripeCustomer, StripeSubscription, StripeSubscriptionItem,
-- StripeWebhookEvent
-- =========================================================================

-- CreateTable
CREATE TABLE "StripeCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_tenantId_key" UNIQUE ("tenantId");
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_stripeCustomerId_key" UNIQUE ("stripeCustomerId");

-- AddIndex
CREATE INDEX "idx_stripe_customer_id" ON "StripeCustomer" ("stripeCustomerId");

-- CreateTable
CREATE TABLE "StripeSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" "StripeSubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(6) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(6) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelAt" TIMESTAMP(6),
    "canceledAt" TIMESTAMP(6),
    "trialStart" TIMESTAMP(6),
    "trialEnd" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeSubscription_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_tenantId_key" UNIQUE ("tenantId");
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_stripeSubscriptionId_key" UNIQUE ("stripeSubscriptionId");

-- AddIndex
CREATE INDEX "idx_stripe_subscription_id" ON "StripeSubscription" ("stripeSubscriptionId");
CREATE INDEX "idx_stripe_subscription_status" ON "StripeSubscription" ("status");

-- CreateTable
CREATE TABLE "StripeSubscriptionItem" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "stripeSubscriptionItemId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "kind" "StripeItemKind" NOT NULL,
    "addOnId" TEXT,
    "planId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeSubscriptionItem_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "StripeSubscriptionItem" ADD CONSTRAINT "StripeSubscriptionItem_stripeSubscriptionItemId_key" UNIQUE ("stripeSubscriptionItemId");

-- AddIndex
CREATE INDEX "idx_stripe_sub_item_sub" ON "StripeSubscriptionItem" ("subscriptionId");
CREATE INDEX "idx_stripe_sub_item_price" ON "StripeSubscriptionItem" ("stripePriceId");
CREATE INDEX "idx_stripe_sub_item_plan" ON "StripeSubscriptionItem" ("planId");
CREATE INDEX "idx_stripe_sub_item_addon" ON "StripeSubscriptionItem" ("addOnId");

-- =========================================================================
-- Foreign keys
-- =========================================================================

-- AddForeignKey
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- NOTE: `Tenant.stripeCustomerId` is intentionally left as a denormalised
-- cache (no FK back to StripeCustomer). The application keeps both fields
-- in sync inside `StripeService.ensureCustomer()`. A circular FK here would
-- force an ordered two-step INSERT during seed, which the demo seeder
-- doesn't currently support.

-- AddForeignKey
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StripeSubscriptionItem" ADD CONSTRAINT "StripeSubscriptionItem_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "StripeSubscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StripeSubscriptionItem" ADD CONSTRAINT "StripeSubscriptionItem_addOnId_fkey"
    FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StripeSubscriptionItem" ADD CONSTRAINT "StripeSubscriptionItem_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- =========================================================================
-- StripeWebhookEvent — idempotency log (no tenant FK, global)
-- =========================================================================

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(6),
    "status" "StripeWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_stripeEventId_key" UNIQUE ("stripeEventId");

-- AddIndex
CREATE INDEX "idx_stripe_webhook_type" ON "StripeWebhookEvent" ("type");
CREATE INDEX "idx_stripe_webhook_status" ON "StripeWebhookEvent" ("status", "receivedAt");
