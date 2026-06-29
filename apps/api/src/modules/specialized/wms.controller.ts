import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { WmsService } from './wms.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('wms')
export class WmsController {
  constructor(private readonly service: WmsService) {}

  @Get('warehouses')
  listWarehouses() {
    return this.service.listWarehouses();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('warehouses')
  createWarehouse(@Body() body: any) {
    return this.service.createWarehouse(body);
  }

  @Get('inventory')
  inventory(@Query('warehouseId') warehouseId?: string) {
    return this.service.listInventory(warehouseId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('inventory')
  createItem(@Body() body: any) {
    return this.service.createItem(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('movements')
  recordMovement(@Body() body: any) {
    return this.service.recordMovement(body);
  }
}