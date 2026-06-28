-- Align Prisma schema with live DB + add fields expected by services
-- Generated: 2026-06-28

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "folder" TEXT NOT NULL DEFAULT 'INBOX',
ADD COLUMN     "from" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receivedAt" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "EmailTemplate" ADD COLUMN     "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "baseSalary" DECIMAL(15,2) DEFAULT 0;

-- CreateIndex
CREATE INDEX "idx_email_tenant_folder" ON "EmailMessage"("tenantId", "folder");

-- CreateIndex
CREATE INDEX "idx_email_tenant_received" ON "EmailMessage"("tenantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_tenantId_code_key" ON "EmailTemplate"("tenantId", "code");