import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new Error('No tenant context');
    return tid;
  }

  async listFolders(parentId?: string) {
    return this.prisma.fileFolder.findMany({
      where: { tenantId: this.getTenantId(), parentId: parentId || null },
      include: { children: true },
    });
  }

  async createFolder(data: { name: string; parentId?: string; path: string }) {
    return this.prisma.fileFolder.create({
      data: {
        ...data,
        tenantId: this.getTenantId(),
        ownerId: this.tenantContext.getUserId(),
      },
    });
  }

  async listFiles(folderId?: string) {
    return this.prisma.fileItem.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(folderId && { folderId }),
      },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadFile(data: { name: string; mimeType: string; size: number; storageKey: string; folderId?: string }) {
    return this.prisma.fileItem.create({
      data: {
        ...data,
        tenantId: this.getTenantId(),
        ownerId: this.tenantContext.getUserId(),
      },
    });
  }
}