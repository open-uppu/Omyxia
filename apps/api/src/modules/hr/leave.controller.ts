import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { LeaveService } from './leave.service';

@Controller('leave')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query.employeeId, query.status);
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body('approverId') approverId: string) {
    return this.service.approve(id, approverId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body('approverId') approverId: string) {
    return this.service.reject(id, approverId);
  }

  @Get('quota/:employeeId/:year')
  getQuota(@Param('employeeId') employeeId: string, @Param('year') year: string) {
    return this.service.getQuota(employeeId, parseInt(year));
  }
}