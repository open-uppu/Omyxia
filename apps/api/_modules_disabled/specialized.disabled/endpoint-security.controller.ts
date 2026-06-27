import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { EndpointSecurityService } from './endpoint-security.service';

@Controller('endpoint')
export class EndpointSecurityController {
  constructor(private readonly service: EndpointSecurityService) {}

  @Get('devices')
  listDevices() {
    return this.service.listDevices();
  }

  @Post('devices')
  enroll(@Body() body: any) {
    return this.service.enrollDevice(body);
  }

  @Get('threats')
  listThreats(@Query('status') status?: string) {
    return this.service.listThreats(status);
  }

  @Post('threats')
  report(@Body() body: any) {
    return this.service.reportThreat(body);
  }

  @Post('threats/:id/resolve')
  resolve(@Param('id') id: string) {
    return this.service.resolveThreat(id);
  }
}