-- open-uppu — Migration 0003: Specialized systems (loops #8-#13)
-- FRM, MAS+CDP, PMS+DMS, WMS+SRM, FMS+ITSM, Endpoint+Backup

-- ============================================================================
-- FRM (Financial Risk Management) — loop #8
-- ============================================================================

CREATE TABLE "CreditAssessment" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "partyType" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "creditLimit" NUMERIC(15,2) NOT NULL,
  "currentExposure" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "riskGrade" TEXT,
  "assessedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextReviewAt" TIMESTAMP,
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_credit_tenant ON "CreditAssessment"("tenantId");
CREATE INDEX idx_credit_party ON "CreditAssessment"("tenantId", "partyType", "partyId");
ALTER TABLE "CreditAssessment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CreditAssessment" USING ("tenantId" = current_tenant_id());

CREATE TABLE "CashFlowForecast" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "periodStart" TIMESTAMP NOT NULL,
  "periodEnd" TIMESTAMP NOT NULL,
  "openingBalance" NUMERIC(15,2) NOT NULL,
  "expectedInflow" NUMERIC(15,2) NOT NULL,
  "expectedOutflow" NUMERIC(15,2) NOT NULL,
  "closingBalance" NUMERIC(15,2) NOT NULL,
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cashflow_tenant ON "CashFlowForecast"("tenantId");
ALTER TABLE "CashFlowForecast" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CashFlowForecast" USING ("tenantId" = current_tenant_id());

CREATE TABLE "FraudAlert" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "alertType" TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fraud_tenant ON "FraudAlert"("tenantId");
ALTER TABLE "FraudAlert" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FraudAlert" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- MAS (Marketing Automation) + CDP — loop #9
-- ============================================================================

CREATE TABLE "MarketingCampaign" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  "audienceFilter" JSONB NOT NULL DEFAULT '{}',
  "emailTemplateId" TEXT,
  "scheduledAt" TIMESTAMP,
  "sentAt" TIMESTAMP,
  "recipientsCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_campaign_tenant ON "MarketingCampaign"("tenantId");
ALTER TABLE "MarketingCampaign" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MarketingCampaign" USING ("tenantId" = current_tenant_id());

CREATE TABLE "CustomerProfile" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "customerId" TEXT,
  email TEXT,
  phone TEXT,
  attributes JSONB NOT NULL DEFAULT '{}',
  "lastEventAt" TIMESTAMP,
  "totalEvents" INTEGER NOT NULL DEFAULT 0,
  "lifetimeValue" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profile_tenant ON "CustomerProfile"("tenantId");
CREATE INDEX idx_profile_email ON "CustomerProfile"("tenantId", email);
ALTER TABLE "CustomerProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerProfile" USING ("tenantId" = current_tenant_id());

CREATE TABLE "CustomerEvent" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "profileId" TEXT NOT NULL REFERENCES "CustomerProfile"(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  source TEXT,
  properties JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_tenant ON "CustomerEvent"("tenantId");
CREATE INDEX idx_event_profile ON "CustomerEvent"("profileId", "occurredAt");
ALTER TABLE "CustomerEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerEvent" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- PMS (Project Management) + DMS (Document Management) — loop #10
-- ============================================================================

CREATE TABLE "Project" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNING',
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  "ownerId" TEXT,
  budget NUMERIC(15,2),
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_project_tenant ON "Project"("tenantId");
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Project" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ProjectTask" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "parentId" TEXT,
  "assigneeId" TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'TODO',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  "dueDate" TIMESTAMP,
  "estimatedHours" NUMERIC(5,2),
  "actualHours" NUMERIC(5,2),
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_tenant ON "ProjectTask"("tenantId");
CREATE INDEX idx_task_project ON "ProjectTask"("projectId");
ALTER TABLE "ProjectTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProjectTask" USING ("tenantId" = current_tenant_id());

CREATE TABLE "DocumentTemplate" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  "bodyHtml" TEXT NOT NULL,
  variables TEXT[] NOT NULL DEFAULT '{}',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_doc_template_tenant ON "DocumentTemplate"("tenantId");
ALTER TABLE "DocumentTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentTemplate" USING ("tenantId" = current_tenant_id());

CREATE TABLE "DocumentInstance" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "templateId" TEXT REFERENCES "DocumentTemplate"(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  "bodyHtml" TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  "signedBy" TEXT,
  "signedAt" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_doc_instance_tenant ON "DocumentInstance"("tenantId");
ALTER TABLE "DocumentInstance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentInstance" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- WMS (Warehouse) + SRM (Supplier) — loop #11
-- ============================================================================

CREATE TABLE "Warehouse" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_warehouse_tenant ON "Warehouse"("tenantId");
ALTER TABLE "Warehouse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Warehouse" USING ("tenantId" = current_tenant_id());

CREATE TABLE "InventoryItem" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "warehouseId" TEXT NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  uom TEXT NOT NULL DEFAULT 'EA',
  quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  "reorderPoint" NUMERIC(15,3),
  "unitCost" NUMERIC(15,2),
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "warehouseId", sku)
);

CREATE INDEX idx_inventory_tenant ON "InventoryItem"("tenantId");
CREATE INDEX idx_inventory_warehouse ON "InventoryItem"("warehouseId");
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InventoryItem" USING ("tenantId" = current_tenant_id());

CREATE TABLE "StockMovement" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "itemId" TEXT NOT NULL REFERENCES "InventoryItem"(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  quantity NUMERIC(15,3) NOT NULL,
  "unitCost" NUMERIC(15,2),
  reference TEXT,
  "occurredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_mvmt_tenant ON "StockMovement"("tenantId");
CREATE INDEX idx_stock_mvmt_item ON "StockMovement"("itemId");
ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockMovement" USING ("tenantId" = current_tenant_id());

CREATE TABLE "SupplierScore" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "vendorId" TEXT NOT NULL REFERENCES "Vendor"(id) ON DELETE CASCADE,
  "onTimeDeliveryRate" NUMERIC(5,2),
  "qualityScore" NUMERIC(5,2),
  "priceCompetitiveness" NUMERIC(5,2),
  "totalScore" NUMERIC(5,2),
  "periodStart" TIMESTAMP NOT NULL,
  "periodEnd" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_supplier_score_tenant ON "SupplierScore"("tenantId");
ALTER TABLE "SupplierScore" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierScore" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- ITSM (Ticketing) + FMS (Fleet) — loop #13
-- ============================================================================

CREATE TABLE "Ticket" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "ticketNo" TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  category TEXT,
  "reporterId" TEXT,
  "assigneeId" TEXT,
  "slaDueAt" TIMESTAMP,
  "resolvedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "ticketNo")
);

CREATE INDEX idx_ticket_tenant ON "Ticket"("tenantId");
CREATE INDEX idx_ticket_status ON "Ticket"("tenantId", status);
ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Ticket" USING ("tenantId" = current_tenant_id());

CREATE TABLE "Vehicle" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "plateNo" TEXT NOT NULL,
  model TEXT,
  "yearMade" INTEGER,
  "fuelType" TEXT,
  "assignedDriverId" TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastMaintenanceAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "plateNo")
);

CREATE INDEX idx_vehicle_tenant ON "Vehicle"("tenantId");
ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Vehicle" USING ("tenantId" = current_tenant_id());

CREATE TABLE "VehicleTrip" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "vehicleId" TEXT NOT NULL REFERENCES "Vehicle"(id) ON DELETE CASCADE,
  "driverId" TEXT,
  "startLocation" TEXT,
  "endLocation" TEXT,
  "startAt" TIMESTAMP NOT NULL,
  "endAt" TIMESTAMP,
  distance NUMERIC(10,2),
  "fuelUsed" NUMERIC(10,2),
  notes TEXT
);

CREATE INDEX idx_trip_tenant ON "VehicleTrip"("tenantId");
ALTER TABLE "VehicleTrip" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VehicleTrip" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- Endpoint Security + Backup — loop #12
-- ============================================================================

CREATE TABLE "Device" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "userId" TEXT,
  type TEXT NOT NULL,
  os TEXT,
  hostname TEXT,
  "macAddress" TEXT,
  "ipAddress" TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastSeenAt" TIMESTAMP,
  "enrolledAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_device_tenant ON "Device"("tenantId");
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Device" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ThreatEvent" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "deviceId" TEXT REFERENCES "Device"(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  "detectedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP
);

CREATE INDEX idx_threat_tenant ON "ThreatEvent"("tenantId");
ALTER TABLE "ThreatEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ThreatEvent" USING ("tenantId" = current_tenant_id());

CREATE TABLE "BackupRecord" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  sizeBytes BIGINT,
  "storageKey" TEXT,
  "startedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP,
  "expiresAt" TIMESTAMP
);

CREATE INDEX idx_backup_tenant ON "BackupRecord"("tenantId");
ALTER TABLE "BackupRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BackupRecord" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
DECLARE
  table_count INTEGER;
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO table_count FROM information_schema.tables WHERE table_schema = 'public';
  SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE schemaname = 'public';
  RAISE NOTICE 'Phase 2 complete. Tables: %, RLS policies: %', table_count, policy_count;
END $$;