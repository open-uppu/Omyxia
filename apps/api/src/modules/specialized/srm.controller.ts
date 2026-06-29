import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { SrmService } from './srm.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('srm')
export class SrmController {
  constructor(private readonly service: SrmService) {}

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('scores/:vendorId')
  score(@Param('vendorId') vendorId: string, @Body() body: any) {
    return this.service.scoreVendor(
      vendorId,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.scores,
    );
  }

  @Get('scores/:vendorId')
  getScores(@Param('vendorId') vendorId: string) {
    return this.service.getVendorScores(vendorId);
  }
}