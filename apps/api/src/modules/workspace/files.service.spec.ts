import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';

const TENANT = 'tenant-A';
const USER = 'user-1';

function makePrisma() {
  return {
    fileFolder: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    fileItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as any;
}

function makeTenantContext(overrides: Partial<{ tenantId: any; userId: any }> = {}) {
  return {
    getTenantId: vi.fn().mockReturnValue(overrides.tenantId ?? TENANT),
    getUserId: vi.fn().mockReturnValue(overrides.userId ?? USER),
  } as any;
}

function makeStorage(overrides: Partial<{ getPresignedUploadUrl: any; getPresignedDownloadUrl: any; getMetadata: any; delete: any }> = {}) {
  return {
    getPresignedUploadUrl: vi.fn().mockResolvedValue({
      url: 'https://minio.local/upload?sig=abc',
      key: 'placeholder',
      fields: { 'Content-Type': 'application/octet-stream' },
    }),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue({
      url: 'https://minio.local/download?sig=xyz',
    }),
    getMetadata: vi.fn().mockResolvedValue({
      key: 'k',
      size: 1024,
      contentType: 'text/plain',
      lastModified: new Date(),
      etag: 'deadbeef',
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

describe('FilesService — presignUpload', () => {
  let service: FilesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    storage = makeStorage();
    service = new FilesService(prisma, tenantContext, storage);
  });

  it('requires a tenant context', async () => {
    tenantContext.getTenantId.mockReturnValue(undefined);
    await expect(
      service.presignUpload({ name: 'a.txt', mimeType: 'text/plain', size: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a user context', async () => {
    tenantContext.getUserId.mockReturnValue(undefined);
    await expect(
      service.presignUpload({ name: 'a.txt', mimeType: 'text/plain', size: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects empty name', async () => {
    await expect(
      service.presignUpload({ name: '', mimeType: 'text/plain', size: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects negative size', async () => {
    await expect(
      service.presignUpload({ name: 'a.txt', mimeType: 'text/plain', size: -1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('persists a FileItem with a tenant-scoped key and returns a presigned URL', async () => {
    prisma.fileItem.create.mockResolvedValue({
      id: 'file-123',
      storageKey: 'placeholder',
    });

    const result = await service.presignUpload({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4321,
    });

    expect(prisma.fileItem.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.fileItem.create.mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe(TENANT);
    expect(createArgs.data.ownerId).toBe(USER);
    expect(createArgs.data.name).toBe('report.pdf');
    expect(createArgs.data.mimeType).toBe('application/pdf');
    expect(createArgs.data.size).toBe(BigInt(0));
    // key is tenant/<folderId?>/yyyy/mm/<rand>-<safeName>
    expect(createArgs.data.storageKey).toMatch(
      new RegExp(`^${TENANT}/root/\\d{4}/\\d{2}/[0-9a-f]{16}-report\\.pdf$`),
    );

    expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith(
      createArgs.data.storageKey,
      'application/pdf',
      expect.any(Number),
    );
    expect(result).toEqual({
      fileId: 'file-123',
      uploadUrl: 'https://minio.local/upload?sig=abc',
      key: createArgs.data.storageKey,
      expiresIn: expect.any(Number),
    });
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  it('scopes the storage key under the provided folderId', async () => {
    prisma.fileItem.create.mockImplementation(async ({ data }: any) => ({
      id: 'f-1',
      storageKey: data.storageKey,
    }));

    await service.presignUpload({
      name: 'note.md',
      mimeType: 'text/markdown',
      size: 12,
      folderId: 'folder-xyz',
    });

    const key = prisma.fileItem.create.mock.calls[0][0].data.storageKey;
    expect(key.startsWith(`${TENANT}/folder-xyz/`)).toBe(true);
  });

  it('caps expiresIn at one hour', async () => {
    prisma.fileItem.create.mockResolvedValue({ id: 'f', storageKey: 'k' });
    const result = await service.presignUpload({
      name: 'a.bin',
      mimeType: 'application/octet-stream',
      size: 1,
      expiresIn: 60 * 60 * 24, // 24h
    });
    expect(result.expiresIn).toBe(60 * 60);
  });

  it('sanitises unsafe characters in the filename component of the key', async () => {
    prisma.fileItem.create.mockImplementation(async ({ data }: any) => ({
      id: 'f',
      storageKey: data.storageKey,
    }));
    await service.presignUpload({
      name: '../../etc/passwd',
      mimeType: 'text/plain',
      size: 1,
    });
    const key = prisma.fileItem.create.mock.calls[0][0].data.storageKey;
    // No path traversal, no slashes inside the filename portion
    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc/');
    const tail = key.split('/').pop()!;
    expect(tail).not.toContain('/');
    // The leaf is the random hex prefix joined to a sanitised filename
    expect(tail).toMatch(/^[0-9a-f]{16}-[A-Za-z0-9._-]+$/);
  });
});

describe('FilesService — finalizeUpload', () => {
  let service: FilesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    storage = makeStorage();
    service = new FilesService(prisma, tenantContext, storage);
  });

  it('throws 404 when the file is not in the current tenant', async () => {
    prisma.fileItem.findFirst.mockResolvedValue(null);
    await expect(
      service.finalizeUpload('missing', { size: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prefers the server-side size from HeadObject over the client-reported size', async () => {
    prisma.fileItem.findFirst.mockResolvedValue({
      id: 'f-1',
      storageKey: 'tenant-A/root/2026/06/abc-report.pdf',
      version: 1,
    });
    storage.getMetadata.mockResolvedValue({
      key: 'tenant-A/root/2026/06/abc-report.pdf',
      size: 9999,
      contentType: 'application/pdf',
      lastModified: new Date(),
      etag: 'e1',
    });
    prisma.fileItem.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      ...data,
    }));

    const result = await service.finalizeUpload('f-1', { size: 1, checksum: 'sha256:1' });

    expect(prisma.fileItem.update).toHaveBeenCalledWith({
      where: { id: 'f-1' },
      data: {
        size: BigInt(9999),
        checksum: 'sha256:1',
        version: 2,
      },
    });
    expect(result.size).toBe(BigInt(9999));
  });

  it('falls back to the client-reported size when HeadObject fails', async () => {
    prisma.fileItem.findFirst.mockResolvedValue({
      id: 'f-1',
      storageKey: 'k',
      version: 3,
    });
    storage.getMetadata.mockRejectedValue(new Error('boom'));
    prisma.fileItem.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      ...data,
    }));

    const result = await service.finalizeUpload('f-1', { size: 42 });

    expect(prisma.fileItem.update).toHaveBeenCalledWith({
      where: { id: 'f-1' },
      data: {
        size: BigInt(42),
        checksum: null,
        version: 4,
      },
    });
    expect(result.size).toBe(BigInt(42));
  });

  it('always filters by the current tenant when looking up the file', async () => {
    prisma.fileItem.findFirst.mockResolvedValue(null);
    await expect(service.finalizeUpload('any', { size: 1 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.fileItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'any', tenantId: TENANT },
    });
  });
});

describe('FilesService — getDownloadUrl', () => {
  let service: FilesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    storage = makeStorage();
    service = new FilesService(prisma, tenantContext, storage);
  });

  it('returns 404 when the file is not in the current tenant', async () => {
    prisma.fileItem.findFirst.mockResolvedValue(null);
    await expect(service.getDownloadUrl('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a presigned download URL scoped to the file storage key', async () => {
    prisma.fileItem.findFirst.mockResolvedValue({
      id: 'f-1',
      storageKey: 'tenant-A/root/2026/06/abc-report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: BigInt(1234),
    });

    const result = await service.getDownloadUrl('f-1');

    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
      'tenant-A/root/2026/06/abc-report.pdf',
      expect.any(Number),
    );
    expect(result).toEqual({
      fileId: 'f-1',
      downloadUrl: 'https://minio.local/download?sig=xyz',
      expiresIn: expect.any(Number),
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1234,
    });
  });

  it('caps expiresIn at one hour', async () => {
    prisma.fileItem.findFirst.mockResolvedValue({
      id: 'f-1',
      storageKey: 'k',
      name: 'n',
      mimeType: 'text/plain',
      size: BigInt(1),
    });
    const result = await service.getDownloadUrl('f-1', 60 * 60 * 24);
    expect(result.expiresIn).toBe(60 * 60);
  });
});

describe('FilesService — deleteFile', () => {
  let service: FilesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    storage = makeStorage();
    service = new FilesService(prisma, tenantContext, storage);
  });

  it('returns 404 when the file is not in the current tenant', async () => {
    prisma.fileItem.findFirst.mockResolvedValue(null);
    await expect(service.deleteFile('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes the S3 object and the DB row', async () => {
    prisma.fileItem.findFirst.mockResolvedValue({
      id: 'f-1',
      storageKey: 'tenant-A/root/2026/06/abc.bin',
    });
    prisma.fileItem.delete.mockResolvedValue({ id: 'f-1' });

    const result = await service.deleteFile('f-1');

    expect(storage.delete).toHaveBeenCalledWith('tenant-A/root/2026/06/abc.bin');
    expect(prisma.fileItem.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
    expect(result).toEqual({ id: 'f-1', deleted: true });
  });

  it('still removes the DB row when the S3 delete fails', async () => {
    prisma.fileItem.findFirst.mockResolvedValue({
      id: 'f-1',
      storageKey: 'k',
    });
    storage.delete.mockRejectedValue(new Error('S3 down'));
    prisma.fileItem.delete.mockResolvedValue({ id: 'f-1' });

    const result = await service.deleteFile('f-1');

    expect(prisma.fileItem.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
    expect(result.deleted).toBe(true);
  });
});

describe('FilesService — listFiles / listFolders / createFolder / uploadFile (legacy)', () => {
  let service: FilesService;
  let prisma: ReturnType<typeof makePrisma>;
  let tenantContext: ReturnType<typeof makeTenantContext>;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    prisma = makePrisma();
    tenantContext = makeTenantContext();
    storage = makeStorage();
    service = new FilesService(prisma, tenantContext, storage);
  });

  it('listFolders scopes by tenant', async () => {
    prisma.fileFolder.findMany.mockResolvedValue([{ id: 'd' }]);
    await service.listFolders('parent-1');
    expect(prisma.fileFolder.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, parentId: 'parent-1' },
    });
  });

  it('createFolder attaches tenant + owner', async () => {
    prisma.fileFolder.create.mockResolvedValue({ id: 'd' });
    await service.createFolder({ name: 'docs', parentId: 'p', path: '/docs' });
    expect(prisma.fileFolder.create).toHaveBeenCalledWith({
      data: { name: 'docs', parentId: 'p', path: '/docs', tenantId: TENANT, ownerId: USER },
    });
  });

  it('listFiles includes owner info and supports folderId filter', async () => {
    prisma.fileItem.findMany.mockResolvedValue([]);
    await service.listFiles('folder-1');
    expect(prisma.fileItem.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, folderId: 'folder-1' },
      include: { User: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('uploadFile (legacy) attaches tenant + owner to the row', async () => {
    prisma.fileItem.create.mockResolvedValue({ id: 'f' });
    await service.uploadFile({
      name: 'a',
      mimeType: 'text/plain',
      size: 1,
      storageKey: 'k',
      folderId: 'folder',
    });
    expect(prisma.fileItem.create).toHaveBeenCalledWith({
      data: {
        name: 'a',
        mimeType: 'text/plain',
        size: 1,
        storageKey: 'k',
        folderId: 'folder',
        tenantId: TENANT,
        ownerId: USER,
      },
    });
  });
});
