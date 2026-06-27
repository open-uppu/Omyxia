-- open-uppu — Multi-tenant SaaS
-- Migration 0001_init: Schema + Multi-tenant RLS
--
-- Every domain table has:
--   1. tenant_id column
--   2. ENABLE ROW LEVEL SECURITY
--   3. CREATE POLICY tenant_isolation
--   4. Indexes on tenant_id for performance
--
-- Helper function: current_tenant_id() reads from session GUC
-- App sets via: SET LOCAL app.current_tenant = 'tenant_id_here';

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Read tenant from session GUC (set by TenantContext middleware)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
DECLARE
  tid TEXT;
BEGIN
  BEGIN
    tid := current_setting('app.current_tenant', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN NULLIF(tid, '');
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if current session has tenant context
CREATE OR REPLACE FUNCTION has_tenant_context() RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_tenant_id() IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'HR_MANAGER', 'ACCOUNTANT', 'MANAGER', 'MEMBER');
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN');
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "InvoiceType" AS ENUM ('AP', 'AR');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');
CREATE TYPE "MfaType" AS ENUM ('TOTP', 'SMS', 'EMAIL');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'PERMISSION_CHANGE', 'ROLE_ASSIGN', 'MFA_CHALLENGE', 'PASSWORD_RESET', 'SUSPICIOUS_ACTIVITY');

-- ============================================================================
-- TABLES (Tenant + User — no tenantId on User itself, uses UserTenant bridge)
-- ============================================================================

CREATE TABLE "Tenant" (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan "TenantPlan" NOT NULL DEFAULT 'STARTER',
  status "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  settings JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tenant_status ON "Tenant"(status);

CREATE TABLE "User" (
  id TEXT PRIMARY KEY,
  email CITEXT NOT NULL UNIQUE,
  "emailVerified" TIMESTAMP,
  "passwordHash" TEXT NOT NULL,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'th',
  "avatarUrl" TEXT,
  "lastLoginAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_email ON "User"(email);

CREATE TABLE "UserTenant" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role "TenantRole" NOT NULL DEFAULT 'MEMBER',
  active BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "userId")
);

CREATE INDEX idx_user_tenant_user ON "UserTenant"("userId");
CREATE INDEX idx_user_tenant_tenant ON "UserTenant"("tenantId");

CREATE TABLE "UserSession" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  "activeTenantId" TEXT,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "expiresAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_session_user ON "UserSession"("userId");
CREATE INDEX idx_user_session_token ON "UserSession"(token);
CREATE INDEX idx_user_session_expires ON "UserSession"("expiresAt");

-- RLS for UserSession (scoped via user tenant membership — simplified: tenant via activeTenantId)
ALTER TABLE "UserSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserSession"
  USING ("activeTenantId" = current_tenant_id() OR "activeTenantId" IS NULL);

-- ============================================================================
-- EMPLOYEE
-- ============================================================================

CREATE TABLE "Employee" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "userId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "employeeNo" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "thFirstName" TEXT,
  "thLastName" TEXT,
  email TEXT,
  "nationalId" TEXT,
  "taxId" TEXT,
  "socialSecurityNo" TEXT,
  "hireDate" TIMESTAMP NOT NULL,
  "terminationDate" TIMESTAMP,
  "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
  "departmentId" TEXT,
  "positionId" TEXT,
  "managerId" TEXT,
  status "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "employeeNo"),
  UNIQUE("tenantId", email),
  UNIQUE("tenantId", "nationalId")
);

CREATE INDEX idx_employee_tenant ON "Employee"("tenantId");
CREATE INDEX idx_employee_tenant_status ON "Employee"("tenantId", status);
CREATE INDEX idx_employee_tenant_dept ON "Employee"("tenantId", "departmentId");
CREATE INDEX idx_employee_tenant_mgr ON "Employee"("tenantId", "managerId");

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Employee"
  USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- DEPARTMENT
-- ============================================================================

CREATE TABLE "Department" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  "parentId" TEXT,
  "managerId" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", code)
);

CREATE INDEX idx_department_tenant ON "Department"("tenantId");
CREATE INDEX idx_department_tenant_parent ON "Department"("tenantId", "parentId");

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department"
  USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- POSITION
-- ============================================================================

CREATE TABLE "Position" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", code)
);

CREATE INDEX idx_position_tenant ON "Position"("tenantId");

ALTER TABLE "Position" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Position"
  USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- CHART OF ACCOUNTS (ERP basic)
-- ============================================================================

CREATE TABLE "ChartOfAccounts" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type "AccountType" NOT NULL,
  "normalBalance" "NormalBalance" NOT NULL DEFAULT 'DEBIT',
  "parentId" TEXT,
  currency TEXT NOT NULL DEFAULT 'THB',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isPostable" BOOLEAN NOT NULL DEFAULT true,
  path TEXT NOT NULL DEFAULT '/',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", code)
);

CREATE INDEX idx_account_tenant ON "ChartOfAccounts"("tenantId");
CREATE INDEX idx_account_tenant_type ON "ChartOfAccounts"("tenantId", type);
CREATE INDEX idx_account_tenant_parent ON "ChartOfAccounts"("tenantId", "parentId");

ALTER TABLE "ChartOfAccounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChartOfAccounts"
  USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- VENDOR (ERP basic)
-- ============================================================================

CREATE TABLE "Vendor" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  "taxId" TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  "paymentTerms" INTEGER NOT NULL DEFAULT 30,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", code)
);

CREATE INDEX idx_vendor_tenant ON "Vendor"("tenantId");

ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Vendor"
  USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- INVOICE (ERP basic)
-- ============================================================================

CREATE TABLE "Invoice" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "vendorId" TEXT REFERENCES "Vendor"(id) ON DELETE SET NULL,
  "customerName" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  type "InvoiceType" NOT NULL DEFAULT 'AP',
  status "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "invoiceDate" TIMESTAMP NOT NULL,
  "dueDate" TIMESTAMP NOT NULL,
  total NUMERIC(15,2) NOT NULL,
  "taxAmount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "invoiceNo")
);

CREATE INDEX idx_invoice_tenant ON "Invoice"("tenantId");
CREATE INDEX idx_invoice_tenant_status ON "Invoice"("tenantId", status);
CREATE INDEX idx_invoice_tenant_due ON "Invoice"("tenantId", "dueDate");

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- MFA FACTOR (IAM basic)
-- ============================================================================

CREATE TABLE "MfaFactor" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  type "MfaType" NOT NULL,
  secret TEXT,
  "backupCodes" TEXT[] NOT NULL DEFAULT '{}',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastUsedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mfa_user ON "MfaFactor"("userId");
CREATE INDEX idx_mfa_user_type ON "MfaFactor"("userId", type);

-- MFA is user-scoped, not tenant-scoped (auth concern)
ALTER TABLE "MfaFactor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON "MfaFactor"
  USING ("userId" = current_setting('app.current_user', true));

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

CREATE TABLE "AuditLog" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT,
  "userId" TEXT,
  table TEXT NOT NULL,
  "rowId" TEXT,
  action "AuditAction" NOT NULL,
  before JSONB,
  after JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_tenant_created ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX idx_audit_user_created ON "AuditLog"("userId", "createdAt");
CREATE INDEX idx_audit_table_row ON "AuditLog"(table, "rowId");

-- Audit log: tenant-scoped (super_admin can see all via bypass)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = current_tenant_id() OR "tenantId" IS NULL);

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
DECLARE
  table_count INTEGER;
  policy_count INTEGER;
  rls_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO table_count FROM information_schema.tables WHERE table_schema = 'public';
  SELECT COUNT(*) INTO policy_count FROM pg_policies WHERE schemaname = 'public';
  SELECT COUNT(*) INTO rls_count FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;

  RAISE NOTICE 'Tables: %, RLS enabled: %, Policies: %', table_count, rls_count, policy_count;
  RAISE NOTICE 'Multi-tenant setup complete. Remember to SET app.current_tenant in each request.';
END $$;
