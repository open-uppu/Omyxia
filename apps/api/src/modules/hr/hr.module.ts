import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';

@Module({
  controllers: [AttendanceController, LeaveController, PayrollController, PositionsController],
  providers: [AttendanceService, LeaveService, PayrollService, PositionsService],
  exports: [AttendanceService, LeaveService, PayrollService, PositionsService],
})
export class HrModule {}