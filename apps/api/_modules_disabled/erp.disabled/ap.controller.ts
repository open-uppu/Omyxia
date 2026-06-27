import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApService } from './ap.service';

@Controller('ap')
export class ApController {
  constructor(private readonly service: ApService) {}

  @Get('vendors')
  listVendors() {
    return this.service.listVendors();
  }

  @Post('vendors')
  createVendor(@Body() body: any) {
    return this.service.createVendor(body);
  }

  @Get('bills')
  listBills(@Query('status') status?: string) {
    return this.service.listBills(status);
  }

  @Post('bills')
  createBill(@Body() body: any) {
    return this.service.createBill(body);
  }

  @Get('aging')
  aging() {
    return this.service.aging();
  }
}