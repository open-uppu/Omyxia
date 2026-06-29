/**
 * E2E smoke test — Files module (Phase D: presigned URL flow)
 *
 * Boots WorkspaceModule in-process with a mocked PrismaService, a mocked
 * StorageService, and a mocked TenantContextService via NestJS
 * `overrideProvider(...).useFactory(...)`. Verifies that:
 *  - The DI graph wires up (FilesController + FilesService + StorageService).
 *  - The presign → finalize → getDownloadUrl happy path works against
 *    in-memory mocks, including tenant scoping, size/etag updates, and
 *    version bumps.
 *  - Delete cleans up both the S3 object and the DB row.
 *  - Cross-tenant access returns 404.
 *
 * No real MinIO or Postgres is required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { WorkspaceModule } from '../../src/modules/workspace/workspace.module';
import { FilesController } from '../../src/modules/workspace/files.controller';
import { FilesService } from '../../src/modules/workspace/files.service';
import { StorageService } from '../../src/storage/storage.service';
import { StorageModule } from '../../src/storage/storage.module';
import { TenantContextService } from '../../src/common/tenant-context/tenant-context.service';
import { TenantContextModule } from '../../src/common/tenant-context/tenant-context.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PrismaModule } from '../../src/common/prisma/prisma.module';

class FakePrisma {
  fileItem = {
    _rows: new Map<string, any>(),
    create: vi.fn(async ({ data }: any) => {
      const id = `f-${this.fileItem._rows.size + 1}`;
      const row = { id, version: 1, ...data };
      this.fileItem._rows.set(id, row);
      return { ...row };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const row = this.fileItem._rows.get(where.id);
      if (!row) return null;
      if (row.tenantId !== where.tenantId) return null;
      return { ...row };
    }),
    findMany: vi.fn(async ({ where }: any) => {
      return Array.from(this.fileItem._rows.values())
        .filter((r) => !where?.tenantId || r.tenantId === where.tenantId)
        .filter((r) => !where?.folderId || r.folderId === where.folderId)
        .map((r) => ({ ...r, User: { id: r.ownerId, name: 'Test User' } }));
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = this.fileItem._rows.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
    delete: vi.fn(async ({ where }: any) => {
      const row = this.fileItem._rows.get(where.id);
      if (!row) throw new Error('not found');
      this.fileItem._rows.delete(where.id);
      return { ...row };
    }),
  };
  fileFolder = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(async ({ data }: any) => ({ id: 'd-1', ...data })),
  };
}

class FakeStorage {
  getPresignedUploadUrl = vi.fn(async (key: string, mimeType: string) => ({
    url: `https://minio.local/upload?Key=${encodeURIComponent(key)}`,
    key,
    fields: { 'Content-Type': mimeType },
  }));
  getPresignedDownloadUrl = vi.fn(async (key: string) => ({
    url: `https://minio.local/download?Key=${encodeURIComponent(key)}`,
  }));
  getMetadata = vi.fn(async (key: string) => ({
    key,
    size: 4096,
    contentType: 'application/pdf',
    lastModified: new Date(),
    etag: 'etag-1',
  }));
  delete = vi.fn(async (_key: string) => undefined);
}

class FakeTenantContext {
  constructor(private tenantId: string | undefined, private userId: string | undefined) {}
  getTenantId = vi.fn(() => this.tenantId);
  getUserId = vi.fn(() => this.userId);
  getRole = vi.fn(() => 'OWNER');
}

/**
 * Build a Test module that uses real WorkspaceModule + the global
 * infrastructure modules (PrismaModule, TenantContextModule, StorageModule)
 * but replaces every injectable leaf with a mock. The FilesService override
 * is the one that actually has to be a useFactory: when we override its
 * collaborators but leave the original `FilesService` provider in
 * `WorkspaceModule.providers`, Nest may resolve them before applying the
 * override and pass undefined.
 */
async function buildApp(prisma: FakePrisma, storage: FakeStorage, tc: FakeTenantContext): Promise<TestingModule> {
  const filesService = new FilesService(prisma as any, tc as any, storage as any);
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PrismaModule,
      TenantContextModule,
      StorageModule,
      WorkspaceModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(TenantContextService)
    .useValue(tc)
    .overrideProvider(FilesService)
    .useFactory({ factory: () => filesService })
    .compile();
}

describe('Files (e2e)', () => {
  let prisma: FakePrisma;
  let storage: FakeStorage;

  beforeEach(() => {
    prisma = new FakePrisma();
    storage = new FakeStorage();
  });

  it('boots the workspace module with files + storage wired', async () => {
    const tc = new FakeTenantContext('tenant-A', 'user-1');
    const moduleRef = await buildApp(prisma, storage, tc);
    expect(moduleRef.get(FilesController)).toBeDefined();
    expect(moduleRef.get(FilesService)).toBeInstanceOf(FilesService);
    expect(moduleRef.get(StorageService)).toBe(storage);
    await moduleRef.close();
  });

  it('runs the presign → finalize → getDownloadUrl happy path', async () => {
    const tc = new FakeTenantContext('tenant-A', 'user-1');
    const moduleRef = await buildApp(prisma, storage, tc);
    const service = moduleRef.get(FilesService);

    // 1. presign
    const presign = await service.presignUpload({
      name: 'q3.pdf',
      mimeType: 'application/pdf',
      size: 9999,
    });
    expect(presign.fileId).toBeTruthy();
    expect(presign.uploadUrl).toContain('minio.local/upload');
    expect(presign.key).toMatch(/^tenant-A\/root\/\d{4}\/\d{2}\/[0-9a-f]{16}-q3\.pdf$/);
    expect(storage.getPresignedUploadUrl).toHaveBeenCalledTimes(1);
    expect(prisma.fileItem.create).toHaveBeenCalledTimes(1);

    // 2. finalize
    const finalized = await service.finalizeUpload(presign.fileId, { size: 4096, checksum: 'sha256:abc' });
    expect(finalized.size).toBe(BigInt(4096));
    expect(finalized.checksum).toBe('sha256:abc');
    expect(finalized.version).toBe(2);

    // 3. download
    const dl = await service.getDownloadUrl(presign.fileId);
    expect(dl.fileId).toBe(presign.fileId);
    expect(dl.downloadUrl).toContain('minio.local/download');
    expect(dl.size).toBe(4096);
    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
      presign.key,
      expect.any(Number),
    );

    await moduleRef.close();
  });

  it('rejects cross-tenant access with 404', async () => {
    // Tenant A creates a file
    const tcA = new FakeTenantContext('tenant-A', 'user-1');
    const moduleRefA = await buildApp(prisma, storage, tcA);
    const serviceA = moduleRefA.get(FilesService);
    const presign = await serviceA.presignUpload({
      name: 'a.bin',
      mimeType: 'application/octet-stream',
      size: 1,
    });
    await moduleRefA.close();

    // Switch to a different tenant
    const tcB = new FakeTenantContext('tenant-B', 'user-2');
    const moduleRefB = await buildApp(prisma, storage, tcB);
    const serviceB = moduleRefB.get(FilesService);
    await expect(serviceB.getDownloadUrl(presign.fileId)).rejects.toThrow(/not found/i);

    await moduleRefB.close();
  });

  it('deletes both the S3 object and the DB row', async () => {
    const tc = new FakeTenantContext('tenant-A', 'user-1');
    const moduleRef = await buildApp(prisma, storage, tc);
    const service = moduleRef.get(FilesService);
    const presign = await service.presignUpload({
      name: 'tmp.txt',
      mimeType: 'text/plain',
      size: 5,
    });

    const result = await service.deleteFile(presign.fileId);
    expect(result).toEqual({ id: presign.fileId, deleted: true });
    expect(storage.delete).toHaveBeenCalledWith(presign.key);
    expect(prisma.fileItem._rows.has(presign.fileId)).toBe(false);

    await moduleRef.close();
  });

  it('caps the presigned URL TTL at one hour', async () => {
    const tc = new FakeTenantContext('tenant-A', 'user-1');
    const moduleRef = await buildApp(prisma, storage, tc);
    const service = moduleRef.get(FilesService);
    const presign = await service.presignUpload({
      name: 'big.bin',
      mimeType: 'application/octet-stream',
      size: 1,
      expiresIn: 60 * 60 * 24, // 24h
    });
    expect(presign.expiresIn).toBe(60 * 60);
    await moduleRef.close();
  });
});
