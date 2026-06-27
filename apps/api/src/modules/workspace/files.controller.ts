import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Get('folders')
  listFolders(@Query('parentId') parentId?: string) {
    return this.service.listFolders(parentId);
  }

  @Post('folders')
  createFolder(@Body() body: any) {
    return this.service.createFolder(body);
  }

  @Get()
  listFiles(@Query('folderId') folderId?: string) {
    return this.service.listFiles(folderId);
  }

  @Post()
  upload(@Body() body: any) {
    return this.service.uploadFile(body);
  }
}