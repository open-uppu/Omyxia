import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { Roles } from '../auth/rbac/roles.decorator';

/**
 * FilesController — REST surface for the Phase D file upload feature.
 *
 * Routes:
 *  GET  /files                     → list files in tenant (optionally folderId)
 *  GET  /files/folders             → list folders
 *  POST /files/folders             → create folder  (OWNER/ADMIN/MANAGER/MEMBER)
 *  POST /files/presign             → issue presigned PUT URL + persist file row
 *                                    (OWNER/ADMIN/MANAGER/MEMBER)
 *  POST /files/:id/finalize        → mark file fully uploaded
 *                                    (OWNER/ADMIN/MANAGER/MEMBER)
 *  GET  /files/:id                 → return presigned GET URL for download
 *                                    (OWNER/ADMIN/MANAGER/MEMBER)
 *  DELETE /files/:id               → delete tenant-scoped file + S3 object
 *                                    (OWNER/ADMIN)
 *
 * Auth + tenant scope are enforced upstream by the JWT middleware
 * (TenantContextMiddleware) and RolesGuard.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Get('folders')
  listFolders(@Query('parentId') parentId?: string) {
    return this.service.listFolders(parentId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('folders')
  createFolder(@Body() body: any) {
    return this.service.createFolder(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('presign')
  presign(
    @Body()
    body: {
      name: string;
      mimeType: string;
      size: number;
      folderId?: string;
      expiresIn?: number;
    },
  ) {
    return this.service.presignUpload(body);
  }

  @Get()
  listFiles(@Query('folderId') folderId?: string) {
    return this.service.listFiles(folderId);
  }

  // NOTE: keep the legacy `POST /files` route so older clients that uploaded
  // directly (storage key already known) keep working. New clients should
  // prefer the presign + finalize flow.
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post()
  upload(@Body() body: any) {
    return this.service.uploadFile(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post(':id/finalize')
  finalize(
    @Param('id') id: string,
    @Body() body: { size: number; checksum?: string },
  ) {
    return this.service.finalizeUpload(id, body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Get(':id')
  download(
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const ttl = expiresIn ? parseInt(expiresIn, 10) : undefined;
    return this.service.getDownloadUrl(id, Number.isFinite(ttl) ? ttl : undefined);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.deleteFile(id);
  }
}
