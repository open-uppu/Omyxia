import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

// Mock both AWS SDK clients so the tests run without a real MinIO endpoint.
const sendMock = vi.fn();
const headBucketMock = vi.fn();
const createBucketMock = vi.fn();
const putObjectMock = vi.fn();
const getObjectMock = vi.fn();
const deleteObjectMock = vi.fn();
const headObjectMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({ kind: 'put', input })),
    GetObjectCommand: vi.fn().mockImplementation((input) => ({ kind: 'get', input })),
    DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ kind: 'delete', input })),
    HeadObjectCommand: vi.fn().mockImplementation((input) => ({ kind: 'head', input })),
    HeadBucketCommand: vi.fn().mockImplementation((input) => ({ kind: 'headBucket', input })),
    CreateBucketCommand: vi.fn().mockImplementation((input) => ({ kind: 'createBucket', input })),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockImplementation(async (_client, command, opts) => {
    return `https://minio.local/${command.kind}?Bucket=${encodeURIComponent(command.input.Bucket)}&Key=${encodeURIComponent(command.input.Key)}&expires=${opts.expiresIn}`;
  }),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ kind: 'put', input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ kind: 'get', input })),
}));

function makeConfig(values: Record<string, string> = {}) {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    headBucketMock.mockReset();
    createBucketMock.mockReset();
    putObjectMock.mockReset();
    getObjectMock.mockReset();
    deleteObjectMock.mockReset();
    headObjectMock.mockReset();
    // Reset which send() call resolves to which bucket command by mapping
    // the command kind returned from the mocked constructors.
    sendMock.mockImplementation(async (command: any) => {
      switch (command?.kind) {
        case 'headBucket':
          return {};
        case 'createBucket':
          return {};
        case 'put':
          return {};
        case 'get':
          return { Body: Buffer.from('hi') };
        case 'delete':
          return {};
        case 'head':
          return {
            ContentLength: 42,
            ContentType: 'text/plain',
            LastModified: new Date('2026-06-29T00:00:00Z'),
            ETag: '"abc123"',
          };
        default:
          return {};
      }
    });
  });

  it('configures the S3Client with path-style addressing and the configured endpoint', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const svc = new StorageService(
      makeConfig({
        MINIO_URL: 'http://minio:9000',
        MINIO_ROOT_USER: 'admin',
        MINIO_ROOT_PASSWORD: 'secret',
        S3_BUCKET: 'tenant-bucket',
      }),
    );
    // Avoid the real onModuleInit bucket probe
    (svc as any).bucketCreated = true;
    svc.getBucketName();
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://minio:9000',
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'admin', secretAccessKey: 'secret' },
      }),
    );
    expect(svc.getBucketName()).toBe('tenant-bucket');
  });

  it('falls back to localhost / minioadmin / openuppu defaults when env is missing', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const svc = new StorageService(makeConfig());
    (svc as any).bucketCreated = true;
    svc.getBucketName();
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:9000',
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      }),
    );
    expect(svc.getBucketName()).toBe('openuppu');
  });

  it('issues a presigned upload URL with the bucket, key, and content type', async () => {
    const svc = new StorageService(
      makeConfig({ S3_BUCKET: 'b1', MINIO_URL: 'http://m', MINIO_ROOT_USER: 'u', MINIO_ROOT_PASSWORD: 'p' }),
    );
    (svc as any).bucketCreated = true;

    const result = await svc.getPresignedUploadUrl('tenants/1/a.txt', 'text/plain', 600);

    expect(result.key).toBe('tenants/1/a.txt');
    expect(result.fields).toEqual({ 'Content-Type': 'text/plain' });
    expect(result.url).toContain('https://minio.local/put?');
    expect(result.url).toContain('Bucket=b1');
    expect(result.url).toContain('Key=tenants%2F1%2Fa.txt');
    expect(result.url).toContain('expires=600');
  });

  it('issues a presigned download URL pointing at the right object', async () => {
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;

    const result = await svc.getPresignedDownloadUrl('tenants/1/a.txt', 120);

    expect(result.url).toContain('https://minio.local/get?');
    expect(result.url).toContain('Bucket=b1');
    expect(result.url).toContain('Key=tenants%2F1%2Fa.txt');
    expect(result.url).toContain('expires=120');
  });

  it('getMetadata normalises size + ETag', async () => {
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;
    const meta = await svc.getMetadata('k');
    expect(meta).toEqual({
      key: 'k',
      size: 42,
      contentType: 'text/plain',
      lastModified: new Date('2026-06-29T00:00:00Z'),
      etag: 'abc123',
    });
  });

  it('getMetadata returns null when the object is missing (NotFound)', async () => {
    sendMock.mockImplementationOnce(async (command: any) => {
      if (command?.kind !== 'head') return {};
      const err: any = new Error('missing');
      err.name = 'NotFound';
      throw err;
    });
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;
    const meta = await svc.getMetadata('missing');
    expect(meta).toBeNull();
  });

  it('upload issues a PutObject with the right bucket, key, body, and content type', async () => {
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;
    await svc.upload('k', Buffer.from('hello'), 'text/plain');
    // The last call to send() should be the PutObjectCommand
    const last = sendMock.mock.calls[sendMock.mock.calls.length - 1][0];
    expect(last.kind).toBe('put');
    expect(last.input).toEqual({
      Bucket: 'b1',
      Key: 'k',
      Body: Buffer.from('hello'),
      ContentType: 'text/plain',
    });
  });

  it('ensureBucketExists creates a missing bucket', async () => {
    sendMock.mockImplementationOnce(async () => {
      const err: any = new Error('not found');
      err.name = 'NotFound';
      throw err;
    });
    sendMock.mockImplementationOnce(async () => ({})); // CreateBucket succeeds
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    await (svc as any).ensureBucketExists();
    // Two sends: HeadBucket (NotFound) + CreateBucket
    expect(sendMock.mock.calls.length).toBe(2);
    expect(sendMock.mock.calls[0][0].kind).toBe('headBucket');
    expect(sendMock.mock.calls[1][0].kind).toBe('createBucket');
  });

  it('ensureBucketExists is a no-op when the bucket already exists', async () => {
    sendMock.mockImplementationOnce(async () => ({})); // HeadBucket succeeds
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    await (svc as any).ensureBucketExists();
    expect(sendMock.mock.calls.length).toBe(1);
    expect(sendMock.mock.calls[0][0].kind).toBe('headBucket');
  });

  it('exposes the configured bucket name and underlying S3 client', async () => {
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;
    expect(svc.getBucketName()).toBe('b1');
    expect(svc.getClient()).toBeDefined();
  });

  it('rethrows non-NotFound errors from HeadObject', async () => {
    sendMock.mockImplementationOnce(async () => {
      const err: any = new Error('access denied');
      err.name = 'AccessDenied';
      throw err;
    });
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;
    await expect(svc.getMetadata('k')).rejects.toThrow('access denied');
  });

  it('issues a delete request to the configured bucket and key', async () => {
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    (svc as any).bucketCreated = true;
    await svc.delete('a/b/c.txt');
    const last = sendMock.mock.calls[sendMock.mock.calls.length - 1][0];
    expect(last.kind).toBe('delete');
    expect(last.input).toEqual({ Bucket: 'b1', Key: 'a/b/c.txt' });
  });

  it('onModuleInit triggers the bucket existence probe', async () => {
    sendMock.mockImplementationOnce(async () => ({})); // HeadBucket succeeds
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    await svc.onModuleInit();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].kind).toBe('headBucket');
  });

  it('ensureBucketExists treats a non-NotFound HeadBucket error as a no-op', async () => {
    sendMock.mockImplementationOnce(async () => {
      const err: any = new Error('forbidden');
      err.name = 'Forbidden';
      throw err;
    });
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    await (svc as any).ensureBucketExists();
    // Only HeadBucket was attempted; we did not try to create the bucket.
    expect(sendMock.mock.calls.length).toBe(1);
  });

  it('ensureBucketExists swallows BucketAlreadyExists from CreateBucket', async () => {
    sendMock.mockImplementationOnce(async () => {
      const err: any = new Error('not found');
      err.name = 'NotFound';
      throw err;
    });
    sendMock.mockImplementationOnce(async () => {
      const err: any = new Error('already exists');
      err.name = 'BucketAlreadyExists';
      throw err;
    });
    const svc = new StorageService(makeConfig({ S3_BUCKET: 'b1' }));
    await (svc as any).ensureBucketExists();
    expect(sendMock.mock.calls.length).toBe(2);
  });
});
