import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { DmsService } from './dms.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('dms')
export class DmsController {
  constructor(private readonly service: DmsService) {}

  @Get('templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('templates')
  createTemplate(@Body() body: any) {
    return this.service.createTemplate(body);
  }

  @Get('instances')
  listInstances() {
    return this.service.listInstances();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('instances')
  createInstance(@Body() body: any) {
    return this.service.createInstance(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('instances/:id/sign')
  sign(@Param('id') id: string, @Body('userId') userId: string) {
    return this.service.sign(id, userId);
  }
}