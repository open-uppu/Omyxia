import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ItsmService } from './itsm.service';

@Controller('itsm')
export class ItsmController {
  constructor(private readonly service: ItsmService) {}

  @Get('tickets')
  list(@Query('status') status?: string, @Query('priority') priority?: string) {
    return this.service.listTickets(status, priority);
  }

  @Post('tickets')
  create(@Body() body: any) {
    return this.service.createTicket(body);
  }

  @Post('tickets/:id/assign')
  assign(@Param('id') id: string, @Body('assigneeId') assigneeId: string) {
    return this.service.assignTicket(id, assigneeId);
  }

  @Post('tickets/:id/resolve')
  resolve(@Param('id') id: string) {
    return this.service.resolveTicket(id);
  }
}