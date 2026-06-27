import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CmpService } from './cmp.service';

@Controller('cmp')
export class CmpController {
  constructor(private readonly service: CmpService) {}

  @Get('consents')
  listConsents(@Query('subjectId') subjectId?: string) {
    return this.service.listConsents(subjectId);
  }

  @Post('consents')
  recordConsent(@Body() body: any) {
    return this.service.recordConsent(body);
  }

  @Post('consents/:id/withdraw')
  withdrawConsent(@Param('id') id: string) {
    return this.service.withdrawConsent(id);
  }

  @Get('dsr')
  listDSRs(@Query('status') status?: string) {
    return this.service.listDSRs(status);
  }

  @Post('dsr')
  createDSR(@Body() body: any) {
    return this.service.createDSR(body);
  }

  @Post('dsr/:id/complete')
  completeDSR(@Param('id') id: string) {
    return this.service.completeDSR(id);
  }

  @Post('cookie-consent')
  cookieConsent(@Body() body: any) {
    return this.service.recordCookieConsent(body.visitorId, body.categories);
  }

  @Post('breach')
  reportBreach(@Body() body: any) {
    return this.service.reportBreach(body);
  }
}