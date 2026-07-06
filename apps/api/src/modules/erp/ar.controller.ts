import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ArService } from './ar.service';
import { Roles } from '../auth/rbac/roles.decorator';
import { FeatureGateGuard } from '../../common/entitlements/feature-gate.guard';
import { RequiresFeature } from '../../common/entitlements/requires-feature.decorator';


@Controller('ar')
@UseGuards(FeatureGateGuard)
@RequiresFeature('module.erp')
export class ArController {
  constructor(private readonly service: ArService) {}

  @Get('customers')
  listCustomers() {
    return this.service.listCustomers();
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('customers')
  createCustomer(@Body() body: any) {
    return this.service.createCustomer(body);
  }

  @Get('invoices')
  listInvoices(@Query('status') status?: string) {
    return this.service.listInvoices(status);
  }

  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @Post('invoices')
  createInvoice(@Body() body: any) {
    return this.service.createInvoice(body);
  }

  @Get('aging')
  aging() {
    return this.service.aging();
  }
}