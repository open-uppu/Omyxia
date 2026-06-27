import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';

@Controller('accounts')
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  list(@Query('type') type?: string) {
    return this.service.list(type);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Post('seed-thai')
  seedThai() {
    return this.service.seedThaiChart();
  }
}