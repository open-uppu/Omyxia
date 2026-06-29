import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ItsmService } from './itsm.service';
import { Roles } from '../auth/rbac/roles.decorator';

@Controller('itsm')
export class ItsmController {
  constructor(private readonly service: ItsmService) {}

  @Get('tickets')
  list(@Query('status') status?: string, @Query('priority') priority?: string) {
    return this.service.listTickets(status, priority);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('tickets')
  create(@Body() body: any) {
    return this.service.createTicket(body);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('tickets/:id/assign')
  assign(@Param('id') id: string, @Body('assigneeId') assigneeId: string) {
    return this.service.assignTicket(id, assigneeId);
  }

  @Roles('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')
  @Post('tickets/:id/resolve')
  resolve(@Param('id') id: string) {
    return this.service.resolveTicket(id);
  }
}