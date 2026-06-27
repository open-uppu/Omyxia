-- open-uppu — Migration 0002: Sprint systems (loops #4-#7)
-- Adds: Workspace (Email/Chat/File), CRM, ERP core, HRM core, IAM

-- ============================================================================
-- HRM CORE ADDITIONS (loop #6)
-- ============================================================================

-- NEW ENUMS
-- ============================================================================

CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY');
CREATE TYPE "LeaveType" AS ENUM ('VACATION', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER');
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'REVIEW', 'POSTED', 'REVERSED');
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');
CREATE TYPE "TaxType" AS ENUM ('VAT', 'OUTPUT_VAT', 'INPUT_VAT', 'WHT_1', 'WHT_2', 'WHT_3', 'WHT_5', 'STAMP_DUTY');
CREATE TYPE "ArInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');
CREATE TYPE "ApBillStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE');
CREATE TYPE "EmailStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');
CREATE TYPE "ChatChannelType" AS ENUM ('PUBLIC', 'PRIVATE', 'DIRECT');
CREATE TYPE "ChatMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'GUEST');

CREATE TABLE "AttendanceRecord" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "employeeId" TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  date TIMESTAMP NOT NULL,
  "clockIn" TIMESTAMP,
  "clockOut" TIMESTAMP,
  "hoursWorked" NUMERIC(5,2),
  status "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "employeeId", date)
);

CREATE INDEX idx_attendance_tenant ON "AttendanceRecord"("tenantId");
CREATE INDEX idx_attendance_tenant_date ON "AttendanceRecord"("tenantId", date);
ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AttendanceRecord" USING ("tenantId" = current_tenant_id());

CREATE TABLE "LeaveRequest" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "employeeId" TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  "leaveType" "LeaveType" NOT NULL,
  "startDate" TIMESTAMP NOT NULL,
  "endDate" TIMESTAMP NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT,
  status "LeaveStatus" NOT NULL DEFAULT 'PENDING',
  "approverId" TEXT,
  "approvedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_leave_tenant ON "LeaveRequest"("tenantId");
CREATE INDEX idx_leave_tenant_status ON "LeaveRequest"("tenantId", status);
CREATE INDEX idx_leave_tenant_employee ON "LeaveRequest"("tenantId", "employeeId");
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveRequest" USING ("tenantId" = current_tenant_id());

CREATE TABLE "LeaveQuota" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "employeeId" TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  "leaveType" "LeaveType" NOT NULL,
  year INTEGER NOT NULL,
  "quotaDays" INTEGER NOT NULL,
  "usedDays" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "employeeId", "leaveType", year)
);

CREATE INDEX idx_leave_quota_tenant ON "LeaveQuota"("tenantId");
ALTER TABLE "LeaveQuota" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveQuota" USING ("tenantId" = current_tenant_id());

CREATE TABLE "PayrollPeriod" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "periodStart" TIMESTAMP NOT NULL,
  "periodEnd" TIMESTAMP NOT NULL,
  status "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP,
  "paidAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "periodStart")
);

CREATE INDEX idx_payroll_tenant ON "PayrollPeriod"("tenantId");
ALTER TABLE "PayrollPeriod" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollPeriod" USING ("tenantId" = current_tenant_id());

CREATE TABLE "PayrollLine" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "periodId" TEXT NOT NULL REFERENCES "PayrollPeriod"(id) ON DELETE CASCADE,
  "employeeId" TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  "baseSalary" NUMERIC(15,2) NOT NULL,
  overtime NUMERIC(15,2) NOT NULL DEFAULT 0,
  bonus NUMERIC(15,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  "socialSecurity" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "netPay" NUMERIC(15,2) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("periodId", "employeeId")
);

CREATE INDEX idx_payroll_line_tenant ON "PayrollLine"("tenantId");
CREATE INDEX idx_payroll_line_period ON "PayrollLine"("periodId");
ALTER TABLE "PayrollLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollLine" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- ERP CORE ADDITIONS (loop #5)
-- ============================================================================

CREATE TABLE "JournalEntry" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "entryNo" TEXT NOT NULL,
  date TIMESTAMP NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  status "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "entryNo")
);

CREATE INDEX idx_journal_tenant ON "JournalEntry"("tenantId");
CREATE INDEX idx_journal_tenant_status ON "JournalEntry"("tenantId", status);
CREATE INDEX idx_journal_tenant_date ON "JournalEntry"("tenantId", date);
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JournalEntry" USING ("tenantId" = current_tenant_id());

CREATE TABLE "JournalLine" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "entryId" TEXT NOT NULL REFERENCES "JournalEntry"(id) ON DELETE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "ChartOfAccounts"(id) ON DELETE RESTRICT,
  debit NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit NUMERIC(15,2) NOT NULL DEFAULT 0,
  description TEXT,
  "costCenter" TEXT,
  project TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_journal_line_tenant ON "JournalLine"("tenantId");
CREATE INDEX idx_journal_line_entry ON "JournalLine"("entryId");
ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JournalLine" USING ("tenantId" = current_tenant_id());

CREATE TABLE "FiscalPeriod" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "startDate" TIMESTAMP NOT NULL,
  "endDate" TIMESTAMP NOT NULL,
  status "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMP,
  "closedBy" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "startDate")
);

CREATE INDEX idx_fiscal_tenant ON "FiscalPeriod"("tenantId");
ALTER TABLE "FiscalPeriod" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalPeriod" USING ("tenantId" = current_tenant_id());

CREATE TABLE "TaxRate" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  type "TaxType" NOT NULL,
  name TEXT NOT NULL,
  rate NUMERIC(5,2) NOT NULL,
  "effectiveFrom" TIMESTAMP NOT NULL,
  "effectiveTo" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", type, "effectiveFrom")
);

CREATE INDEX idx_tax_rate_tenant ON "TaxRate"("tenantId");
ALTER TABLE "TaxRate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaxRate" USING ("tenantId" = current_tenant_id());

CREATE TABLE "TaxTransaction" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "taxRateId" TEXT NOT NULL REFERENCES "TaxRate"(id) ON DELETE RESTRICT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "baseAmount" NUMERIC(15,2) NOT NULL,
  "taxAmount" NUMERIC(15,2) NOT NULL,
  "certificateNo" TEXT,
  "filedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tax_tx_tenant ON "TaxTransaction"("tenantId");
CREATE INDEX idx_tax_tx_source ON "TaxTransaction"("tenantId", "sourceType", "sourceId");
ALTER TABLE "TaxTransaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaxTransaction" USING ("tenantId" = current_tenant_id());

CREATE TABLE "Customer" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  "taxId" TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  "creditLimit" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "paymentTerms" INTEGER NOT NULL DEFAULT 30,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", code)
);

CREATE INDEX idx_customer_tenant ON "Customer"("tenantId");
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Customer" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ArInvoice" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "customerId" TEXT REFERENCES "Customer"(id) ON DELETE SET NULL,
  "invoiceNo" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP NOT NULL,
  "dueDate" TIMESTAMP NOT NULL,
  subtotal NUMERIC(15,2) NOT NULL,
  "taxAmount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL,
  "paidAmount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  status "ArInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "invoiceNo")
);

CREATE INDEX idx_ar_tenant ON "ArInvoice"("tenantId");
CREATE INDEX idx_ar_tenant_status ON "ArInvoice"("tenantId", status);
ALTER TABLE "ArInvoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ArInvoice" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ApBill" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "vendorId" TEXT NOT NULL REFERENCES "Vendor"(id) ON DELETE RESTRICT,
  "billNo" TEXT NOT NULL,
  "billDate" TIMESTAMP NOT NULL,
  "dueDate" TIMESTAMP NOT NULL,
  subtotal NUMERIC(15,2) NOT NULL,
  "taxAmount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  "whtAmount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL,
  "paidAmount" NUMERIC(15,2) NOT NULL DEFAULT 0,
  status "ApBillStatus" NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "billNo")
);

CREATE INDEX idx_ap_tenant ON "ApBill"("tenantId");
ALTER TABLE "ApBill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApBill" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- CRM (loop #7)
-- ============================================================================

CREATE TABLE "CrmPipeline" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stages JSONB NOT NULL DEFAULT '[]',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", name)
);

CREATE INDEX idx_crm_pipeline_tenant ON "CrmPipeline"("tenantId");
ALTER TABLE "CrmPipeline" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmPipeline" USING ("tenantId" = current_tenant_id());

CREATE TABLE "CrmLead" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "customerId" TEXT REFERENCES "Customer"(id) ON DELETE SET NULL,
  "ownerId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "pipelineId" TEXT REFERENCES "CrmPipeline"(id) ON DELETE SET NULL,
  stage TEXT,
  source TEXT,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  value NUMERIC(15,2) NOT NULL DEFAULT 0,
  probability INTEGER NOT NULL DEFAULT 0,
  status "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
  "expectedCloseDate" TIMESTAMP,
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_crm_lead_tenant ON "CrmLead"("tenantId");
CREATE INDEX idx_crm_lead_tenant_status ON "CrmLead"("tenantId", status);
CREATE INDEX idx_crm_lead_tenant_stage ON "CrmLead"("tenantId", stage);
CREATE INDEX idx_crm_lead_tenant_owner ON "CrmLead"("tenantId", "ownerId");
ALTER TABLE "CrmLead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmLead" USING ("tenantId" = current_tenant_id());

CREATE TABLE "CrmActivity" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "leadId" TEXT REFERENCES "CrmLead"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  type "CrmActivityType" NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  "dueAt" TIMESTAMP,
  "completedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_crm_activity_tenant ON "CrmActivity"("tenantId");
CREATE INDEX idx_crm_activity_lead ON "CrmActivity"("leadId");
ALTER TABLE "CrmActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmActivity" USING ("tenantId" = current_tenant_id());

-- ============================================================================
-- WORKSPACE (loop #4)
-- ============================================================================

CREATE TABLE "EmailMessage" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "senderId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "fromAddress" TEXT NOT NULL,
  "toAddresses" TEXT[] NOT NULL,
  "ccAddresses" TEXT[] NOT NULL DEFAULT '{}',
  "bccAddresses" TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL,
  "bodyHtml" TEXT,
  "bodyText" TEXT,
  status "EmailStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_email_tenant ON "EmailMessage"("tenantId");
CREATE INDEX idx_email_tenant_status ON "EmailMessage"("tenantId", status);
CREATE INDEX idx_email_tenant_sent ON "EmailMessage"("tenantId", "sentAt");
ALTER TABLE "EmailMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailMessage" USING ("tenantId" = current_tenant_id());

CREATE TABLE "EmailTemplate" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL,
  variables TEXT[] NOT NULL DEFAULT '{}',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", name)
);

CREATE INDEX idx_email_template_tenant ON "EmailTemplate"("tenantId");
ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailTemplate" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ChatChannel" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type "ChatChannelType" NOT NULL DEFAULT 'PUBLIC',
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", name)
);

CREATE INDEX idx_chat_channel_tenant ON "ChatChannel"("tenantId");
ALTER TABLE "ChatChannel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChatChannel" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ChatChannelMember" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "channelId" TEXT NOT NULL REFERENCES "ChatChannel"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role "ChatMemberRole" NOT NULL DEFAULT 'MEMBER',
  "lastReadAt" TIMESTAMP,
  "joinedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("channelId", "userId")
);

CREATE INDEX idx_chat_member_tenant ON "ChatChannelMember"("tenantId");
CREATE INDEX idx_chat_member_user ON "ChatChannelMember"("userId");
ALTER TABLE "ChatChannelMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChatChannelMember" USING ("tenantId" = current_tenant_id());

CREATE TABLE "ChatMessage" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "channelId" TEXT NOT NULL REFERENCES "ChatChannel"(id) ON DELETE CASCADE,
  "senderId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  "parentId" TEXT,
  "editedAt" TIMESTAMP,
  "deletedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_msg_tenant ON "ChatMessage"("tenantId");
CREATE INDEX idx_chat_msg_channel ON "ChatMessage"("channelId", "createdAt");
CREATE INDEX idx_chat_msg_sender ON "ChatMessage"("senderId");
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChatMessage" USING ("tenantId" = current_tenant_id());

CREATE TABLE "FileFolder" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "parentId" TEXT,
  "ownerId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", "parentId", name)
);

CREATE INDEX idx_file_folder_tenant ON "FileFolder"("tenantId");
CREATE INDEX idx_file_folder_parent ON "FileFolder"("tenantId", "parentId");
ALTER TABLE "FileFolder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FileFolder" USING ("tenantId" = current_tenant_id());

CREATE TABLE "FileItem" (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "folderId" TEXT REFERENCES "FileFolder"(id) ON DELETE SET NULL,
  "ownerId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  size BIGINT NOT NULL,
  "storageKey" TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  checksum TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_file_item_tenant ON "FileItem"("tenantId");
CREATE INDEX idx_file_item_folder ON "FileItem"("tenantId", "folderId");
CREATE INDEX idx_file_item_owner ON "FileItem"("tenantId", "ownerId");
ALTER TABLE "FileItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FileItem" USING ("tenantId" = current_tenant_id());

-- ============================================================================
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
  RAISE NOTICE 'Phase 1 complete. Tables: %, RLS policies: %', table_count, policy_count;
END $$;