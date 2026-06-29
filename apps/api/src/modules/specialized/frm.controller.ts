import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FrmService } from './frm.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('frm')
export class FrmController {
  constructor(private readonly service: FrmService) {}

  @Get('credit-assessments')
  list() {
    return this.service.listCreditAssessments();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('credit-assessments')
  assess(@Body() body: any) {
    return this.service.assessParty(body.partyType, body.partyId, body.creditLimit);
  }

  @Get('cash-flow')
  cashFlow(@Query('from') from: string, @Query('to') to: string) {
    return this.service.cashFlowForecast(new Date(from), new Date(to));
  }

  @Get('fraud-alerts')
  alerts() {
    return this.service.listFraudAlerts();
  }
}