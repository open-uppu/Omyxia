import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import {
  getSignedUrl,
  PutObjectCommand as PresignedPutObjectCommand,
  GetObjectCommand as PresignedGetObjectCommand,
} from '@aws-sdk/s3-request-presigner';

export interface PresignedUploadUrl {
  url: string;
  key: string;
  fields?: Record<string, string>;
}

export interface PresignedDownloadUrl {
  url: string;
}

export interface FileMetadata {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  etag: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private bucket: string;
  private bucketCreated = false;

  constructor(private readonly configService: ConfigService) {
    const minioUrl = this.configService.get<string>('MINIO_URL') || 'http://localhost:9000';
    const accessKeyId = this.configService.get<string>('MINIO_ROOT_USER') || 'minioadmin';
    const secretAccessKey = this.configService.get<string>('MINIO_ROOT_PASSWORD') || 'minioadmin';
    this.bucket = this.configService.get<string>('S3_BUCKET') || 'openuppu';

    this.s3Client = new S3Client({
      endpoint: minioUrl,
      region: 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  private async ensureBucketExists(): Promise<void> {
    if (this.bucketCreated) return;

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketCreated = true;
      this.logger.log(`Bucket "${this.bucket}" already exists`);
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') {
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
          this.bucketCreated = true;
          this.logger.log(`Bucket "${this.bucket}" created successfully`);
        } catch (createError) {
          // Bucket might have been created by another process
          if (createError instanceof Error && createError.name !== 'BucketAlreadyExists' && createError.name !== 'BucketAlreadyOwnedByYou') {
            throw createError;
          }
          this.bucketCreated = true;
          this.logger.log(`Bucket "${this.bucket}" already exists`);
        }
      } else {
        // Bucket exists but might be owned by someone else, or other error
        this.bucketCreated = true;
        this.logger.log(`Bucket "${this.bucket}" exists`);
      }
    }
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.ensureBucketExists();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    } as PutObjectCommandInput);

    await this.s3Client.send(command);
  }

  async getPresignedUploadUrl(key: string, mimeType: string, expiresIn: number = 3600): Promise<PresignedUploadUrl> {
    await this.ensureBucketExists();

    const command = new PresignedPutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      url,
      key,
      fields: {
        'Content-Type': mimeType,
      },
    };
  }

  async getPresignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<PresignedDownloadUrl> {
    await this.ensureBucketExists();

    const command = new PresignedGetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });

    return { url };
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucketExists();

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  async getMetadata(key: string): Promise<FileMetadata | null> {
    await this.ensureBucketExists();

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      return {
        key,
        size: Number(response.ContentLength || 0),
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        etag: response.ETag?.replace(/"/g, '') || '',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  getBucketName(): string {
    return this.bucket;
  }

  getClient(): S3Client {
    return this.s3Client;
  }
}