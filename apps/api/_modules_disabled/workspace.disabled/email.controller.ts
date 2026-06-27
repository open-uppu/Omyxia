import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  constructor(private readonly service: EmailService) {}

  @Get('messages')
  list(@Query('folder') folder?: string) {
    return this.service.listMessages(folder);
  }

  @Post('send')
  send(@Body() body: any) {
    return this.service.send(body);
  }

  @Get('templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  @Post('templates')
  createTemplate(@Body() body: any) {
    return this.service.createTemplate(body);
  }
}