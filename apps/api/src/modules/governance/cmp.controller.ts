import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CmpService } from './cmp.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('cmp')
export class CmpController {
  constructor(private readonly service: CmpService) {}

  @Get('consents')
  listConsents(@Query('subjectId') subjectId?: string) {
    return this.service.listConsents(subjectId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('consents')
  recordConsent(@Body() body: any) {
    return this.service.recordConsent(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('consents/:id/withdraw')
  withdrawConsent(@Param('id') id: string) {
    return this.service.withdrawConsent(id);
  }

  @Get('dsr')
  listDSRs(@Query('status') status?: string) {
    return this.service.listDSRs(status);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('dsr')
  createDSR(@Body() body: any) {
    return this.service.createDSR(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('dsr/:id/complete')
  completeDSR(@Param('id') id: string) {
    return this.service.completeDSR(id);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('cookie-consent')
  cookieConsent(@Body() body: any) {
    return this.service.recordCookieConsent(body.visitorId, body.categories);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('breach')
  reportBreach(@Body() body: any) {
    return this.service.reportBreach(body);
  }
}