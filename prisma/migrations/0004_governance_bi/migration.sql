-- open-uppu — Migration 0004: Governance (PDPA) + BI (loops #14-#15)

-- ============================================================================
-- CMP / PDPA (Consent Management) — loop #14
-- ============================================================================

CREATE TABLE "ConsentRecord" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "subjectEmail" TEXT,
  type TEXT NOT NULL,
  "grantedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "withdrawnAt" TIMESTAMP
);

CREATE INDEX idx_consent_tenant ON "ConsentRecord"("tenantId");
CREATE INDEX idx_consent_subject ON "ConsentRecord"("tenantId", "subjectType", "subjectId");
CREATE INDEX idx_consent_type ON "ConsentRecord"("tenantId", type);
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentRecord" USING ("tenantId" = current_tenant_id());

CREATE TABLE "DataSubjectRequest" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "requestType" TEXT NOT NULL,
  "subjectEmail" TEXT NOT NULL,
  "subjectName" TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "receivedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP NOT NULL,
  "completedAt" TIMESTAMP,
  notes TEXT
);

CREATE INDEX idx_dsr_tenant ON "DataSubjectRequest"("tenantId");
CREATE INDEX idx_dsr_status ON "DataSubjectRequest"("tenantId", status);
ALTER TABLE "DataSubjectRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataSubjectRequest" USING ("tenantId" = current_tenant_id());

CREATE TABLE "CookieConsent" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "visitorId" TEXT NOT NULL,
  categories TEXT[] NOT NULL DEFAULT '{}',
  "grantedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_cookie_tenant ON "CookieConsent"("tenantId");
CREATE INDEX idx_cookie_visitor ON "CookieConsent"("visitorId");
ALTER TABLE "CookieConsent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CookieConsent" USING ("tenantId" = current_tenant_id());

CREATE TABLE "PrivacyPolicy" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP NOT NULL,
  "effectiveTo" TIMESTAMP,
  "bodyHtml" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", version)
);

CREATE INDEX idx_policy_tenant ON "PrivacyPolicy"("tenantId");
ALTER TABLE "PrivacyPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PrivacyPolicy" USING ("tenantId" = current_tenant_id());

CREATE TABLE "DataBreachIncident" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "discoveredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedAt" TIMESTAMP,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  "affectedRecords" INTEGER,
  status TEXT NOT NULL DEFAULT 'INVESTIGATING',
  "remediationNotes" TEXT
);

CREATE INDEX idx_breach_tenant ON "DataBreachIncident"("tenantId");
ALTER TABLE "DataBreachIncident" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataBreachIncident" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- BI (Business Intelligence) — loop #15
-- ============================================================================

CREATE TABLE "Dashboard" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '[]',
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "ownerId" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dashboard_tenant ON "Dashboard"("tenantId");
ALTER TABLE "Dashboard" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Dashboard" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ReportSnapshot" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "dashboardId" TEXT REFERENCES "Dashboard"(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  data JSONB NOT NULL DEFAULT '{}',
  "generatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP
);

CREATE INDEX idx_snapshot_tenant ON "ReportSnapshot"("tenantId");
CREATE INDEX idx_snapshot_dashboard ON "ReportSnapshot"("dashboardId");
ALTER TABLE "ReportSnapshot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReportSnapshot" USING ("tenantId" = current_tenant_id());

CREATE TABLE "KpiDefinition" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  "sqlQuery" TEXT,
  unit TEXT,
  "targetValue" NUMERIC(20,4),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", code)
);

CREATE INDEX idx_kpi_tenant ON "KpiDefinition"("tenantId");
ALTER TABLE "KpiDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KpiDefinition" USING ("tenantId" = current_tenant_id());

CREATE TABLE "KpiSnapshot" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "kpiId" TEXT NOT NULL REFERENCES "KpiDefinition"(id) ON DELETE CASCADE,
  "value" NUMERIC(20,4) NOT NULL,
  "snapshotAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  period TEXT
);

CREATE INDEX idx_kpi_snap_tenant ON "KpiSnapshot"("tenantId");
CREATE INDEX idx_kpi_snap_kpi ON "KpiSnapshot"("kpiId", "snapshotAt");
ALTER TABLE "KpiSnapshot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KpiSnapshot" USING ("tenantId" = current_tenant_id());

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
  RAISE NOTICE 'Phase 3 complete. Total tables: %, Total RLS policies: %', table_count, policy_count;
END $$;