import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * StorageModule — global provider for the S3 / MinIO-backed StorageService.
 *
 * Phase D scope:
 *  - Wraps the existing StorageService so it is wired into the DI graph.
 *  - Marked @Global so the WorkspaceModule (and any other feature module
 *    that needs object storage) can inject StorageService without having
 *    to import this module explicitly.
 *  - The actual SDK clients are configured in StorageService from env
 *    (MINIO_URL, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, S3_BUCKET).
 *  - `forcePathStyle: true` + `region: 'us-east-1'` are set inside
 *    StorageService so the same code paths work against MinIO and AWS S3.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
