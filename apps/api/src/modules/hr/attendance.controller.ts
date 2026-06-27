import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query.employeeId, query.from, query.to);
  }

  @Post(':employeeId/clock-in')
  clockIn(@Param('employeeId') employeeId: string) {
    return this.service.clockIn(employeeId);
  }

  @Post(':employeeId/clock-out')
  clockOut(@Param('employeeId') employeeId: string) {
    return this.service.clockOut(employeeId);
  }
}