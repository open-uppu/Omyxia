import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FrmService } from './frm.service';

@Controller('frm')
export class FrmController {
  constructor(private readonly service: FrmService) {}

  @Get('credit-assessments')
  list() {
    return this.service.listCreditAssessments();
  }

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