import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { FiscalPeriodService } from './fiscal-period.service';

@Controller('fiscal-periods')
export class FiscalPeriodController {
  constructor(private readonly service: FiscalPeriodService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: { startDate: string; endDate: string }) {
    return this.service.create({
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Body('userId') userId: string) {
    return this.service.close(id, userId);
  }
}