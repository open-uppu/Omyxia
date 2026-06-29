import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * List audit logs for the current tenant (paginated).
   * RBAC: OWNER/ADMIN only.
   */
  @Get()
  @Roles('OWNER', 'ADMIN')
  async list(
    @Req() req: any,
    @Query('table') table?: string,
    @Query('action') action?: AuditAction,
    @Query('userId') userId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');

    const filters = {
      table,
      action,
      userId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    };
    if (filters.dateFrom && isNaN(filters.dateFrom.getTime())) {
      throw new BadRequestException('dateFrom must be ISO 8601');
    }
    if (filters.dateTo && isNaN(filters.dateTo.getTime())) {
      throw new BadRequestException('dateTo must be ISO 8601');
    }

    const pagination = {
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? Math.min(parseInt(take, 10) || 50, 200) : 50,
    };

    return this.auditService.list(filters, pagination);
  }

  /**
   * Fetch a single audit log entry by id, scoped to current tenant.
   */
  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  async findOne(@Req() req: any, @Param('id') id: string) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');
    if (!id) throw new BadRequestException('Missing id');
    return this.auditService.findById(id);
  }
}
