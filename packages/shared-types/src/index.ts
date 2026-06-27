import { z } from 'zod';

// ============================================================================
// Tenant schemas
// ============================================================================

export const TenantPlanSchema = z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']);
export const TenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);

export const TenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  plan: TenantPlanSchema,
  status: TenantStatusSchema,
  createdAt: z.date(),
});

export type Tenant = z.infer<typeof TenantSchema>;

// ============================================================================
// User schemas
// ============================================================================

export const TenantRoleSchema = z.enum([
  'OWNER', 'ADMIN', 'HR_MANAGER', 'ACCOUNTANT',
  'MANAGER', 'MEMBER', 'SALES_REP', 'SUPPORT_AGENT', 'WAREHOUSE_MANAGER',
]);

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  locale: z.string().default('th'),
});

export type User = z.infer<typeof UserSchema>;

// ============================================================================
// Auth DTOs
// ============================================================================

export const SignupDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  tenantName: z.string().min(1),
});

export const LoginDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const SwitchTenantDtoSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
});

// ============================================================================
// Employee DTOs
// ============================================================================

export const EmploymentTypeSchema = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']);
export const EmployeeStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']);

export const CreateEmployeeDtoSchema = z.object({
  employeeNo: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  hireDate: z.date(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  managerId: z.string().optional(),
  baseSalary: z.number().optional(),
});

export const EmployeeSchema = CreateEmployeeDtoSchema.extend({
  id: z.string(),
  status: EmployeeStatusSchema,
  tenantId: z.string(),
});

export type Employee = z.infer<typeof EmployeeSchema>;

// ============================================================================
// HRM DTOs
// ============================================================================

export const LeaveTypeSchema = z.enum(['VACATION', 'SICK', 'PERSONAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']);
export const LeaveStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

export const CreateLeaveDtoSchema = z.object({
  employeeId: z.string(),
  leaveType: LeaveTypeSchema,
  startDate: z.date(),
  endDate: z.date(),
  reason: z.string().optional(),
});

export const PayrollStatusSchema = z.enum(['DRAFT', 'APPROVED', 'PAID', 'CANCELLED']);

// ============================================================================
// ERP DTOs
// ============================================================================

export const AccountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);

export const ChartOfAccountSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  tenantId: z.string(),
});

export const CreateJournalDtoSchema = z.object({
  date: z.date(),
  description: z.string().min(1),
  reference: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string(),
    debit: z.number().nonnegative().default(0),
    credit: z.number().nonnegative().default(0),
    description: z.string().optional(),
  })).min(2),
}).refine((data) => {
  const totalDebit = data.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = data.lines.reduce((sum, l) => sum + l.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}, { message: 'Journal entry must be balanced (debit = credit)' });

export const InvoiceStatusSchema = z.enum(['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID']);

export const CreateArInvoiceDtoSchema = z.object({
  customerId: z.string().optional(),
  invoiceDate: z.date(),
  dueDate: z.date(),
  subtotal: z.number().nonnegative(),
  notes: z.string().optional(),
});

// ============================================================================
// CRM DTOs
// ============================================================================

export const CrmLeadStatusSchema = z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']);

export const CreateLeadDtoSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  value: z.number().nonnegative().default(0),
  source: z.string().optional(),
  pipelineId: z.string().optional(),
});

// ============================================================================
// Tax DTOs
// ============================================================================

export const TaxTypeSchema = z.enum([
  'VAT', 'OUTPUT_VAT', 'INPUT_VAT',
  'WHT_1', 'WHT_2', 'WHT_3', 'WHT_5', 'STAMP_DUTY',
]);

export const CreateTaxRateDtoSchema = z.object({
  type: TaxTypeSchema,
  name: z.string().min(1),
  rate: z.number().min(0).max(100),
  effectiveFrom: z.date(),
  effectiveTo: z.date().optional(),
});

// ============================================================================
// Common helpers
// ============================================================================

export type ID = string;
export type ISODate = string;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  skip: number;
  take: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}