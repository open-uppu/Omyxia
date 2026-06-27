import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { DmsService } from './dms.service';

@Controller('dms')
export class DmsController {
  constructor(private readonly service: DmsService) {}

  @Get('templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  @Post('templates')
  createTemplate(@Body() body: any) {
    return this.service.createTemplate(body);
  }

  @Get('instances')
  listInstances() {
    return this.service.listInstances();
  }

  @Post('instances')
  createInstance(@Body() body: any) {
    return this.service.createInstance(body);
  }

  @Post('instances/:id/sign')
  sign(@Param('id') id: string, @Body('userId') userId: string) {
    return this.service.sign(id, userId);
  }
}