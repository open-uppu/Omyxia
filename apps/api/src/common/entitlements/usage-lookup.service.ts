/**
 * UsageLookupService — count rows to support `limit.*` checks.
 *
 * The guard asks "is the tenant's quota for `limit.maxEmployees` at
 * least 25?" — that requires a count of currently-active employees.
 * This service centralises the per-domain count queries so the guard
 * stays stateless and we don't end up with ad-hoc `prisma.x.count()`
 * scattered through guards.
 *
 * Counts are intentionally NOT cached here — they're cheap on the DB
 * with the existing indexes, and they need to be real-time accurate
 * (a user about to hit "Invite user #26" must see the live number).
 * Plan/entitlement data is what's cached (5-min TTL via Redis).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { LimitFeature } from './feature-catalog';

@Injectable()
export class UsageLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up the live usage count for a `limit.*` feature.
   * Returns `null` when no counter is defined for the key (the guard
   * then treats the limit check as "skip" rather than blocking).
   */
  async count(tenantId: string, feature: LimitFeature): Promise<number | null> {
    switch (feature) {
      case 'limit.maxEmployees':
        return this.prisma.employee.count({ where: { tenantId } });
      case 'limit.maxLeads':
        return this.prisma.crmLead.count({
          where: { tenantId, status: { notIn: ['WON', 'LOST'] } },
        });
      case 'limit.maxUsers':
        return this.prisma.userTenant.count({
          where: { tenantId, active: true },
        });
      case 'limit.maxProjects':
        return this.prisma.project.count({ where: { tenantId } });
      case 'limit.maxTickets':
        return this.prisma.ticket.count({
          where: { tenantId, status: { notIn: ['CLOSED', 'RESOLVED'] } },
        });
      case 'limit.maxStorageGB':
      case 'limit.maxBackupGB':
        // Storage totals live in S3 / MinIO; the entitlement record is
        // the source of truth for the quota and we don't enforce a
        // hard byte-count here. Return null so the limit-only rule
        // doesn't block.
        return null;
      default:
        return null;
    }
  }
}
