import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { FmsService } from './fms.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('fms')
export class FmsController {
  constructor(private readonly service: FmsService) {}

  @Get('vehicles')
  listVehicles() {
    return this.service.listVehicles();
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('vehicles')
  createVehicle(@Body() body: any) {
    return this.service.createVehicle(body);
  }

  @Get('trips')
  listTrips(@Query('vehicleId') vehicleId?: string) {
    return this.service.listTrips(vehicleId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('trips')
  startTrip(@Body() body: any) {
    return this.service.startTrip(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('trips/:id/end')
  endTrip(@Param('id') id: string, @Body() body: any) {
    return this.service.endTrip(id, new Date(body.endAt), body.distance, body.fuelUsed);
  }
}