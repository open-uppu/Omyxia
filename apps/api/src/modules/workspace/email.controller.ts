import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { EmailService } from './email.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('email')
export class EmailController {
  constructor(private readonly service: EmailService) {}

  @Get('messages')
  list(@Query('folder') folder?: string) {
    return this.service.listMessages(folder);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('send')
  send(@Body() body: any) {
    return this.service.send(body);
  }

  @Get('templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('templates')
  createTemplate(@Body() body: any) {
    return this.service.createTemplate(body);
  }
}