import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

export interface AuditLogFilters {
  table?: string;
  action?: AuditAction;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AuditLogPagination {
  skip: number;
  take: number;
}

export interface AuditLogListResult {
  items: Array<{
    id: string;
    tenantId: string | null;
    userId: string | null;
    table: string;
    rowId: string | null;
    action: AuditAction;
    before: unknown;
    after: unknown;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
  }>;
  total: number;
}

/**
 * AuditService — read-only access layer for the AuditLog table.
 *
 * Always scopes queries to the current tenant via AsyncLocalStorage so cross-
 * tenant reads are impossible. Tenant isolation is enforced server-side; this
 * service does NOT expose any "all tenants" query and never bypasses the
 * tenantId where clause.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  /**
   * List AuditLog rows for the current tenant with optional filters and
   * pagination. Always returns the matching total via parallel count.
   */
  async list(filters: AuditLogFilters, pagination: AuditLogPagination): Promise<AuditLogListResult> {
    const tenantId = this.getTenantId();

    const where: any = { tenantId };
    if (filters.table !== undefined) where.table = filters.table;
    if (filters.action !== undefined) where.action = filters.action;
    if (filters.userId !== undefined) where.userId = filters.userId;
    if (filters.dateFrom !== undefined || filters.dateTo !== undefined) {
      where.createdAt = {};
      if (filters.dateFrom !== undefined) where.createdAt.gte = filters.dateFrom;
      if (filters.dateTo !== undefined) where.createdAt.lte = filters.dateTo;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Find a single AuditLog row by id, scoped to the current tenant.
   * Throws NotFoundException when the row is missing OR belongs to another
   * tenant (cross-tenant lookups must look like "not found").
   */
  async findById(id: string) {
    const tenantId = this.getTenantId();
    const row = await this.prisma.auditLog.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException(`AuditLog ${id} not found`);
    return row;
  }
}