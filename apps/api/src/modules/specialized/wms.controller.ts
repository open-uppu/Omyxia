import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { WmsService } from './wms.service';

@Controller('wms')
export class WmsController {
  constructor(private readonly service: WmsService) {}

  @Get('warehouses')
  listWarehouses() {
    return this.service.listWarehouses();
  }

  @Post('warehouses')
  createWarehouse(@Body() body: any) {
    return this.service.createWarehouse(body);
  }

  @Get('inventory')
  inventory(@Query('warehouseId') warehouseId?: string) {
    return this.service.listInventory(warehouseId);
  }

  @Post('inventory')
  createItem(@Body() body: any) {
    return this.service.createItem(body);
  }

  @Post('movements')
  recordMovement(@Body() body: any) {
    return this.service.recordMovement(body);
  }
}