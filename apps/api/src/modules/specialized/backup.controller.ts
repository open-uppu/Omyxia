import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { BackupService } from './backup.service';

@Controller('backup')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Get()
  list() {
    return this.service.listBackups();
  }

  @Post()
  start(@Body('type') type: string) {
    return this.service.startBackup(type);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() body: any) {
    return this.service.completeBackup(id, body.sizeBytes, body.storageKey);
  }
}