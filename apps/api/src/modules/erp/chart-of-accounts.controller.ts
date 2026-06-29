import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { Roles } from '../auth/rbac/roles.decorator';

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

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('seed-thai')
  seedThai() {
    return this.service.seedThaiChart();
  }
}