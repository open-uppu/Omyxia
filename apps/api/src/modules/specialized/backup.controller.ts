import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { BackupService } from './backup.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('backup')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Get()
  list() {
    return this.service.listBackups();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post()
  start(@Body('type') type: string) {
    return this.service.startBackup(type);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() body: any) {
    return this.service.completeBackup(id, body.sizeBytes, body.storageKey);
  }
}