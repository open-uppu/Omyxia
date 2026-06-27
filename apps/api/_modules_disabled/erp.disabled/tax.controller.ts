import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { TaxService } from './tax.service';

@Controller('tax')
export class TaxController {
  constructor(private readonly service: TaxService) {}

  @Get('rates')
  listRates() {
    return this.service.listRates();
  }

  @Post('rates')
  createRate(@Body() body: any) {
    return this.service.createRate({
      ...body,
      effectiveFrom: new Date(body.effectiveFrom),
    });
  }

  @Post('seed-thai')
  seedThai() {
    return this.service.seedThaiDefaults();
  }

  @Get('pp30')
  pp30(@Query('from') from: string, @Query('to') to: string) {
    return this.service.pp30Report(new Date(from), new Date(to));
  }
}