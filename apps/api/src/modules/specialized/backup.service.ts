import { Injectable } from '@nestjs/common';
import { TenantScopedService } from './base.service';

@Injectable()
export class BackupService extends TenantScopedService {
  async listBackups() {
    return this.prisma.backupRecord.findMany({
      where: { tenantId: this.getTenantId() },
      orderBy: { startedAt: 'desc' },
    });
  }

  async startBackup(type: string) {
    return this.prisma.backupRecord.create({
      data: {
        tenantId: this.getTenantId(),
        type,
        status: 'PENDING',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600000), // 30 days
      },
    });
  }

  async completeBackup(id: string, sizeBytes: number, storageKey: string) {
    return this.prisma.backupRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        sizebytes: BigInt(sizeBytes),
        storageKey,
        completedAt: new Date(),
      },
    });
  }
}