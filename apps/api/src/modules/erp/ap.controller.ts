import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApService } from './ap.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { RequiresService } from '../../common/service-entitlements/requires-service.decorator';

@Controller('ap')
@RequiresService('erp')
export class ApController {
  constructor(private readonly service: ApService) {}

  @Get('vendors')
  listVendors() {
    return this.service.listVendors();
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('vendors')
  createVendor(@Body() body: any) {
    return this.service.createVendor(body);
  }

  @Get('bills')
  listBills(@Query('status') status?: string) {
    return this.service.listBills(status);
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('bills')
  createBill(@Body() body: any) {
    return this.service.createBill(body);
  }

  @Get('aging')
  aging() {
    return this.service.aging();
  }
}