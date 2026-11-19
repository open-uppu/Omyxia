import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { TaxService } from './tax.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { RequiresService } from '../../common/service-entitlements/requires-service.decorator';

@Controller('tax')
@RequiresService('erp')
export class TaxController {
  constructor(private readonly service: TaxService) {}

  @Get('rates')
  listRates() {
    return this.service.listRates();
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('rates')
  createRate(@Body() body: any) {
    return this.service.createRate({
      ...body,
      effectiveFrom: new Date(body.effectiveFrom),
    });
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('seed-thai')
  seedThai() {
    return this.service.seedThaiDefaults();
  }

  @Get('pp30')
  pp30(@Query('from') from: string, @Query('to') to: string) {
    return this.service.pp30Report(new Date(from), new Date(to));
  }
}