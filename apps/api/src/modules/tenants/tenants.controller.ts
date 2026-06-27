import { Controller, Get, Patch, Body } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('current')
  getCurrent() {
    return this.tenantsService.getCurrent();
  }

  @Patch('current')
  updateCurrent(@Body() body: { name?: string; settings?: any }) {
    return this.tenantsService.updateCurrent(body);
  }
}