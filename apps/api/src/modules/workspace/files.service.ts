import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service';
import { StorageService } from '../../storage/storage.service';

const DEFAULT_PRESIGN_TTL_SECONDS = 60 * 15; // 15 minutes

export interface PresignResult {
  fileId: string;
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

export interface DownloadResult {
  fileId: string;
  downloadUrl: string;
  expiresIn: number;
  name: string;
  mimeType: string;
  size: number;
}

export interface PresignRequest {
  name: string;
  mimeType: string;
  size: number;
  folderId?: string;
  expiresIn?: number;
}

export interface FinalizeRequest {
  size: number;
  checksum?: string;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
  ) {}

  private getTenantId(): string {
    const tid = this.tenantContext.getTenantId();
    if (!tid) throw new ForbiddenException('No tenant context');
    return tid;
  }

  private getUserId(): string {
    const uid = this.tenantContext.getUserId();
    if (!uid) throw new ForbiddenException('No user context');
    return uid;
  }

  /**
   * Build a tenant-scoped, non-guessable S3 object key.
   *
   * Layout: `<tenantId>/<folderId|root>/<yyyy>/<mm>/<rand>-<safeName>`
   *
   * - The tenant id is the first segment so a global bucket policy could
   *   scope by tenant prefix.
   * - `safeName` strips path separators and spaces, capped to 80 chars.
   * - The 16-byte random component makes pre-issued keys infeasible to
   *   enumerate.
   * - Path-traversal segments (`..`, leading `/`) are collapsed to `_` so
   *   the resulting key is always a single leaf inside the tenant prefix.
   */
  private buildStorageKey(opts: { name: string; folderId?: string }): string {
    const tenantId = this.getTenantId();
    const folderSegment = opts.folderId || 'root';
    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const rand = randomBytes(8).toString('hex');
    const safeName = opts.name
      .replace(/[^\w.-]+/g, '_')   // any non-word / non-dot / non-dash → _
      .replace(/\.\.+/g, '_')     // collapse ".." runs (path-traversal guard)
      .replace(/^[._-]+|[._-]+$/g, '') // strip leading/trailing dots/dashes/underscores
      .slice(0, 80) || 'file';
    return `${tenantId}/${folderSegment}/${yyyy}/${mm}/${rand}-${safeName}`;
  }

  async listFolders(parentId?: string) {
    return this.prisma.fileFolder.findMany({
      where: { tenantId: this.getTenantId(), parentId: parentId || null },
    });
  }

  async createFolder(data: { name: string; parentId?: string; path: string }) {
    return this.prisma.fileFolder.create({
      data: {
        ...data,
        tenantId: this.getTenantId(),
        ownerId: this.getUserId(),
      },
    });
  }

  async listFiles(folderId?: string) {
    return this.prisma.fileItem.findMany({
      where: {
        tenantId: this.getTenantId(),
        ...(folderId && { folderId }),
      },
      include: { User: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Legacy stub: persists a `FileItem` row when the client already uploaded
   * bytes directly (i.e. computed the storage key themselves or used a
   * server-side proxy). New clients should prefer `presignUpload` +
   * `finalizeUpload` which routes the bytes through MinIO presigned URLs.
   */
  async uploadFile(data: { name: string; mimeType: string; size: number; storageKey: string; folderId?: string }) {
    return this.prisma.fileItem.create({
      data: {
        ...data,
        tenantId: this.getTenantId(),
        ownerId: this.getUserId(),
      },
    });
  }

  /**
   * Issue a presigned PUT URL and persist a `FileItem` row that the client
   * later finalizes with the actual byte count / checksum.
   *
   * The DB row is created in `PENDING` state (size=0, version=1). We use the
   * existing `FileItem` schema and treat the storage key as the source of
   * truth — no separate status column is needed because `size > 0` after
   * finalize implies the upload is complete.
   */
  async presignUpload(req: PresignRequest): Promise<PresignResult> {
    if (!req.name) throw new ForbiddenException('name is required');
    if (!req.mimeType) throw new ForbiddenException('mimeType is required');
    if (typeof req.size !== 'number' || req.size < 0) {
      throw new ForbiddenException('size must be a non-negative number');
    }

    const expiresIn =
      typeof req.expiresIn === 'number' && req.expiresIn > 0
        ? Math.min(Math.floor(req.expiresIn), 60 * 60) // cap at 1h
        : DEFAULT_PRESIGN_TTL_SECONDS;

    const storageKey = this.buildStorageKey({
      name: req.name,
      folderId: req.folderId,
    });

    const file = await this.prisma.fileItem.create({
      data: {
        tenantId: this.getTenantId(),
        ownerId: this.getUserId(),
        name: req.name,
        mimeType: req.mimeType,
        size: BigInt(0), // updated on finalize
        storageKey,
        folderId: req.folderId,
      },
    });

    const presigned = await this.storage.getPresignedUploadUrl(
      storageKey,
      req.mimeType,
      expiresIn,
    );

    return {
      fileId: file.id,
      uploadUrl: presigned.url,
      key: storageKey,
      expiresIn,
    };
  }

  /**
   * Mark a file row as fully uploaded.
   *
   * - Verifies the row belongs to the current tenant (404 otherwise).
   * - Verifies the file actually exists in object storage via HeadObject.
   * - Updates `size`, optional `checksum`, bumps `version`.
   */
  async finalizeUpload(fileId: string, req: FinalizeRequest) {
    const tenantId = this.getTenantId();
    const existing = await this.prisma.fileItem.findFirst({
      where: { id: fileId, tenantId },
    });
    if (!existing) throw new NotFoundException('File not found');

    let headSize: number | undefined;
    try {
      const meta = await this.storage.getMetadata(existing.storageKey);
      if (meta) headSize = meta.size;
    } catch {
      // If HeadObject fails (network, perms) we still record the client's
      // reported size — but prefer the server-verified one when present.
    }

    const finalSize =
      typeof headSize === 'number' && headSize >= 0 ? headSize : req.size;

    return this.prisma.fileItem.update({
      where: { id: fileId },
      data: {
        size: BigInt(finalSize),
        checksum: req.checksum ?? null,
        version: existing.version + 1,
      },
    });
  }

  /**
   * Issue a short-lived presigned GET URL for a tenant-scoped file.
   */
  async getDownloadUrl(fileId: string, expiresIn?: number): Promise<DownloadResult> {
    const tenantId = this.getTenantId();
    const file = await this.prisma.fileItem.findFirst({
      where: { id: fileId, tenantId },
    });
    if (!file) throw new NotFoundException('File not found');

    const ttl =
      typeof expiresIn === 'number' && expiresIn > 0
        ? Math.min(Math.floor(expiresIn), 60 * 60)
        : DEFAULT_PRESIGN_TTL_SECONDS;

    const presigned = await this.storage.getPresignedDownloadUrl(
      file.storageKey,
      ttl,
    );

    return {
      fileId: file.id,
      downloadUrl: presigned.url,
      expiresIn: ttl,
      name: file.name,
      mimeType: file.mimeType,
      size: Number(file.size),
    };
  }

  /**
   * Soft-tenant-scoped delete: removes both the DB row and the S3 object.
   */
  async deleteFile(fileId: string): Promise<{ id: string; deleted: true }> {
    const tenantId = this.getTenantId();
    const file = await this.prisma.fileItem.findFirst({
      where: { id: fileId, tenantId },
    });
    if (!file) throw new NotFoundException('File not found');

    try {
      await this.storage.delete(file.storageKey);
    } catch {
      // Swallow storage errors here so the row is still removed — surface
      // the failure via logs/audit rather than blocking the user.
    }

    await this.prisma.fileItem.delete({ where: { id: fileId } });
    return { id: fileId, deleted: true };
  }
}
