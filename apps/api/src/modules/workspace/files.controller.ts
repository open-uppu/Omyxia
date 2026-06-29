import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FilesService } from './files.service';
import { Roles } from '../auth/rbac/roles.decorator';

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

  @Get()
  listFiles(@Query('folderId') folderId?: string) {
    return this.service.listFiles(folderId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post()
  upload(@Body() body: any) {
    return this.service.uploadFile(body);
  }
}