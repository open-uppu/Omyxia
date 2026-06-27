import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { FmsService } from './fms.service';

@Controller('fms')
export class FmsController {
  constructor(private readonly service: FmsService) {}

  @Get('vehicles')
  listVehicles() {
    return this.service.listVehicles();
  }

  @Post('vehicles')
  createVehicle(@Body() body: any) {
    return this.service.createVehicle(body);
  }

  @Get('trips')
  listTrips(@Query('vehicleId') vehicleId?: string) {
    return this.service.listTrips(vehicleId);
  }

  @Post('trips')
  startTrip(@Body() body: any) {
    return this.service.startTrip(body);
  }

  @Post('trips/:id/end')
  endTrip(@Param('id') id: string, @Body() body: any) {
    return this.service.endTrip(id, new Date(body.endAt), body.distance, body.fuelUsed);
  }
}